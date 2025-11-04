from __future__ import annotations

import argparse
import os
import sys
import time
from typing import Dict, Any, List, Tuple

from sqlalchemy import func
from sqlalchemy.orm import Session

from ..db import SessionLocal
from ..models import (
    Upload,
    UploadObject,
    Transcript,
    TranscriptSegment,
    BulletCitation,
)
# MinIO client (support old alias as in your codebase)
try:
    from ..storage import get_minio_client  # preferred
except ImportError:
    from ..storage import get_client as get_minio_client  # back-compat


# ---------------------------
# Logging
# ---------------------------
_LOG_PATH = os.getenv("NOTABLY_LOG_FILE", "/tmp/notably_worker.log")
_LOG_FH = None
try:
    _LOG_FH = open(_LOG_PATH, "a", buffering=1, encoding="utf-8")
except Exception:
    _LOG_FH = None

def _log(msg: str) -> None:
    line = f"[retention] {msg}"
    print(line, flush=True)
    if _LOG_FH:
        try:
            _LOG_FH.write(line + "\n")
        except Exception:
            pass


def _env_true(name: str, default: str = "false") -> bool:
    return os.getenv(name, default).lower() in {"1", "true", "yes", "y"}


# ---------------------------
# MinIO helpers
# ---------------------------
def _delete_minio_object(bucket: str, key: str) -> Tuple[bool, str]:
    if not _env_true("MINIO_ENABLE"):
        return False, "minio_disabled"
    try:
        client = get_minio_client()
    except Exception as e:
        _log(f"minio client error: {e}")
        return False, "client_error"
    try:
        client.remove_object(bucket, key)
        return True, "ok"
    except Exception as e:
        _log(f"minio delete failed bucket={bucket} key={key} err={e}")
        return False, "delete_error"


# ---------------------------
# Core sweep
# ---------------------------
def sweep_expired_once(db: Session, limit: int = 100, dry_run: bool = True) -> Dict[str, Any]:
    """
    Sweep up to `limit` expired uploads (retained_until < now()).
    Deletes:
      - MinIO objects for UploadObject rows (best-effort)
      - BulletCitation rows that cite segments under expired transcripts
      - TranscriptSegment rows, then Transcript rows
      - UploadObject rows
      - Upload rows
    Returns a dict of counters.
    """
    t0 = time.monotonic()

    # Find expired uploads with a cap
    exp = (
        db.query(Upload)
        .filter(Upload.retained_until.isnot(None))
        .filter(Upload.retained_until < func.now())
        .order_by(Upload.created_at.asc())
        .limit(limit)
        .all()
    )
    if not exp:
        return {"found": 0, "deleted": 0, "objects_deleted": 0, "segments_deleted": 0, "citations_deleted": 0, "elapsed_ms": int((time.monotonic()-t0)*1000)}

    upload_ids = [u.id for u in exp]

    # Collect transcripts & segments for these uploads
    transcripts = db.query(Transcript).filter(Transcript.upload_id.in_(upload_ids)).all()
    t_ids = [t.id for t in transcripts] or [None]  # avoid empty IN()
    segs = db.query(TranscriptSegment).filter(TranscriptSegment.transcript_id.in_(t_ids)).all()
    seg_ids = [s.id for s in segs] or [None]

    # Collect objects
    objs = db.query(UploadObject).filter(UploadObject.upload_id.in_(upload_ids)).all()

    # Counters
    c_found = len(exp)
    c_deleted = 0
    c_obj_deleted = 0
    c_seg_deleted = 0
    c_cit_deleted = 0

    _log(f"found {c_found} expired uploads (dry_run={dry_run}, limit={limit})")

    if dry_run:
        # No DB writes; just report
        return {
            "found": c_found,
            "deleted": 0,
            "objects_deleted": 0,
            "segments_deleted": 0,
            "citations_deleted": 0,
            "elapsed_ms": int((time.monotonic()-t0)*1000),
            "preview": {
                "upload_ids": upload_ids,
                "transcript_count": len(transcripts),
                "segment_count": len(segs),
                "object_count": len(objs),
            },
        }

    # Delete citations for segments (if any)
    try:
        if seg_ids and seg_ids != [None]:
            c = db.query(BulletCitation).filter(BulletCitation.segment_id.in_(seg_ids)).delete(synchronize_session=False)
            c_cit_deleted += int(c or 0)
    except Exception as e:
        _log(f"bullet_citation delete error: {e}")

    # Delete transcript segments
    try:
        if seg_ids and seg_ids != [None]:
            c = db.query(TranscriptSegment).filter(TranscriptSegment.id.in_(seg_ids)).delete(synchronize_session=False)
            c_seg_deleted += int(c or 0)
    except Exception as e:
        _log(f"transcript_segment delete error: {e}")

    # Delete transcripts
    try:
        if t_ids and t_ids != [None]:
            db.query(Transcript).filter(Transcript.id.in_(t_ids)).delete(synchronize_session=False)
    except Exception as e:
        _log(f"transcript delete error: {e}")

    # MinIO + UploadObject rows
    for o in objs:
        ok, why = _delete_minio_object(o.bucket, o.object_key)
        if ok:
            c_obj_deleted += 1
        # Always attempt to delete the DB row regardless of MinIO result
        try:
            db.query(UploadObject).filter(UploadObject.id == o.id).delete(synchronize_session=False)
        except Exception as e:
            _log(f"upload_object delete error id={o.id} err={e}")

    # Finally, delete uploads
    try:
        c = db.query(Upload).filter(Upload.id.in_(upload_ids)).delete(synchronize_session=False)
        c_deleted += int(c or 0)
    except Exception as e:
        _log(f"upload delete error: {e}")

    db.commit()

    return {
        "found": c_found,
        "deleted": c_deleted,
        "objects_deleted": c_obj_deleted,
        "segments_deleted": c_seg_deleted,
        "citations_deleted": c_cit_deleted,
        "elapsed_ms": int((time.monotonic()-t0)*1000),
    }


def sweep_loop(limit: int = 100, dry_run: bool = True) -> Dict[str, Any]:
    """
    Keep sweeping until no more expired uploads are found (or a few iterations to be safe).
    """
    db = SessionLocal()
    try:
        total = {"found": 0, "deleted": 0, "objects_deleted": 0, "segments_deleted": 0, "citations_deleted": 0}
        for _ in range(10):  # hard cap, prevents runaway
            out = sweep_expired_once(db, limit=limit, dry_run=dry_run)
            for k in total:
                total[k] += int(out.get(k, 0))
            if out.get("found", 0) == 0:
                break
        return {**total, "dry_run": dry_run}
    finally:
        db.close()


# ---------------------------
# CLI
# ---------------------------
def _parse_args(argv: List[str]) -> argparse.Namespace:
    p = argparse.ArgumentParser(prog="retention")
    sub = p.add_subparsers(dest="cmd")

    s = sub.add_parser("sweep", help="Delete expired uploads and related resources")
    s.add_argument("--limit", type=int, default=100, help="Max rows per pass")
    s.add_argument("--dry-run", action="store_true", help="Preview only (no deletes)")
    s.add_argument("--no-dry-run", dest="dry_run", action="store_false", help="Actually delete")
    s.set_defaults(dry_run=True)

    return p.parse_args(argv)


def main(argv: List[str] | None = None) -> int:
    if argv is None:
        argv = sys.argv[1:]
    args = _parse_args(argv)

    if args.cmd == "sweep":
        res = sweep_loop(limit=args.limit, dry_run=args.dry_run)
        _log(f"sweep done: {res}")
        print(res)
        return 0

    print("Usage: python -m backend.app.maintenance.retention sweep [--limit 100] [--dry-run|--no-dry-run]")
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
