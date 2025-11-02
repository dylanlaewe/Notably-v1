from __future__ import annotations

from time import sleep
import json
import subprocess
import tempfile
import os

# Robust import: support either get_minio_client() or get_client()
try:
    from .storage import get_minio_client  # preferred
except ImportError:  # back-compat
    from .storage import get_client as get_minio_client

from .models import UploadObject
from .db import SessionLocal
from .models import (
    Upload,
    Transcript,
    TranscriptSegment,
    Summary,
    SummaryBullet as ORMSummaryBullet,
    BulletCitation as ORMBulletCitation,
)

from .stubs import _make_stub_result


def _probe_duration_sec(path: str) -> float | None:
    """
    Return duration in seconds for media at `path` using ffprobe, or None on failure.
    """
    try:
        proc = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "json", path],
            capture_output=True,
            text=True,
            check=True,
        )
        data = json.loads(proc.stdout or "{}")
        dur = data.get("format", {}).get("duration")
        return float(dur) if dur is not None else None
    except Exception:
        return None


def _minio_enabled() -> bool:
    return os.getenv("MINIO_ENABLE", "false").lower() == "true"


def process_stub(upload_id: str, meeting_id: str) -> None:
    """
    RQ-friendly task:
    Simulate background processing for an upload:
      queued -> processing -> done
    Persists transcript segments + summary + citations to the DB.
    """
    db = SessionLocal()
    u = None
    try:
        # mark processing
        u = db.get(Upload, upload_id)
        if not u:
            db.close()
            return
        u.status = "processing"
        db.add(u)
        db.commit()

        # small delay so status transition is observable
        sleep(1.0)

        # --- Try to determine duration via MinIO + ffprobe (best-effort) ---
        try:
            if _minio_enabled():
                obj = (
                    db.query(UploadObject)
                    .filter(UploadObject.upload_id == upload_id)
                    .order_by(UploadObject.id.desc())
                    .first()
                )
                if obj:
                    client = get_minio_client()
                    # stream object to a temp file
                    resp = client.get_object(obj.bucket, obj.object_key)
                    try:
                        with tempfile.NamedTemporaryFile(delete=True) as tmp:
                            tmp.write(resp.read())
                            tmp.flush()
                            dur = _probe_duration_sec(tmp.name)
                            if dur is not None:
                                u.duration_sec = float(dur)
                                db.add(u)
                                db.commit()
                    finally:
                        # ensure the response stream is released
                        try:
                            resp.close()
                        except Exception:
                            pass
                        try:
                            resp.release_conn()
                        except Exception:
                            pass
        except Exception:
            # best-effort; ignore any probe/storage errors
            pass

        # fabricate result (stubbed transcript + bullets with citations)
        segs, bullets, actions = _make_stub_result()

        # transcript
        t = Transcript(upload_id=upload_id, language="en")
        db.add(t)
        db.flush()  # t.id

        seg_id_by_index = {}
        for i, s in enumerate(segs, start=1):
            seg = TranscriptSegment(
                transcript_id=t.id,
                t_start=s["t_start"],
                t_end=s["t_end"],
                text=s["text"],
            )
            db.add(seg)
            db.flush()
            seg_id_by_index[i] = seg.id

        # summary + bullets + citations
        summary = Summary(meeting_id=meeting_id)
        db.add(summary)
        db.flush()

        for b in bullets:
            b_row = ORMSummaryBullet(summary_id=summary.id, text=b["text"])
            db.add(b_row)
            db.flush()
            for c in b.get("citations", []):
                idx = c["segment_id"]
                real_seg_id = seg_id_by_index.get(idx)
                if real_seg_id is not None:
                    db.add(ORMBulletCitation(summary_bullet_id=b_row.id, segment_id=real_seg_id))

        # done
        u.status = "done"
        db.add(u)
        db.commit()
    except Exception as e:
        if u:
            u.status = "failed"
            u.error = str(e)
            db.add(u)
            db.commit()
        raise
    finally:
        db.close()
