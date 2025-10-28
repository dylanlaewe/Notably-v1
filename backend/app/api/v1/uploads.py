from __future__ import annotations
import hashlib
import uuid
from datetime import datetime, timedelta, timezone
from typing import Dict, Tuple, List, Optional

from fastapi import APIRouter, UploadFile, File, Form, HTTPException
from fastapi import BackgroundTasks
from time import sleep
from pydantic import BaseModel
from starlette.status import HTTP_202_ACCEPTED

from fastapi import Depends
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError

from ...db import get_session
from ...db import SessionLocal
from ...models import (
    Upload,
    Transcript,
    TranscriptSegment,
    Summary,
    SummaryBullet as ORMSummaryBullet,
    BulletCitation as ORMBulletCitation,
)



router = APIRouter()

# ---------------------------
# In-memory store (dev only)
# ---------------------------
class _UploadRec(BaseModel):
    id: str
    meeting_id: str
    filename: str
    mime_type: str
    byte_size: int
    sha256: str
    duration_sec: Optional[float] = None
    status: str = "queued"       # queued | processing | done | failed
    error: Optional[str] = None
    created_at: str
    retained_until: Optional[str] = None
    # stubbed result payloads:
    segments: List[dict] = []
    bullets: List[dict] = []
    action_items: List[dict] = []

_UPLOADS: Dict[str, _UploadRec] = {}
_INDEX: Dict[Tuple[str, str], str] = {}  # (meeting_id, sha256) -> upload_id

# ---------------------------
# Response models
# ---------------------------
class UploadCreateResp(BaseModel):
    upload_id: str
    status: str

class UploadStatusResp(BaseModel):
    id: str
    meeting_id: str
    filename: str
    mime_type: str
    byte_size: int
    sha256: str
    duration_sec: Optional[float] = None
    status: str
    error: Optional[str] = None
    created_at: str
    retained_until: Optional[str] = None

class Segment(BaseModel):
    id: int
    t_start: float
    t_end: float
    text: str

class BulletCitation(BaseModel):
    segment_id: int

class SummaryBullet(BaseModel):
    id: str
    text: str
    citations: List[BulletCitation]

class SummaryOut(BaseModel):
    bullets: List[SummaryBullet]
    action_items: List[SummaryBullet]  # reuse structure for stub

class TranscriptOut(BaseModel):
    language: str
    segments: List[Segment]

class UploadResultResp(BaseModel):
    transcript: TranscriptOut
    summary: SummaryOut

# ---------------------------
# Helpers
# ---------------------------
def _sha256(data: bytes) -> str:
    h = hashlib.sha256(); h.update(data); return h.hexdigest()

def _now_utc() -> datetime:
    return datetime.now(timezone.utc)

def _iso(dt: Optional[datetime]) -> Optional[str]:
    return dt.isoformat() if dt else None

def _make_stub_result() -> tuple[list[dict], list[dict], list[dict]]:
    # two tiny segments; bullets cite segment ids
    segs = [
        {"id": 1, "t_start": 0.00, "t_end": 5.40, "text": "Welcome; today we review the MVP slice."},
        {"id": 2, "t_start": 5.40, "t_end": 12.30, "text": "Next steps: wire upload -> background job."},
    ]
    b1 = {"id": str(uuid.uuid4()), "text": "MVP scope confirmed.", "citations": [{"segment_id": 1}]}
    b2 = {"id": str(uuid.uuid4()), "text": "Upload enqueues processing job.", "citations": [{"segment_id": 2}]}
    bullets = [b1, b2]
    actions = [{"id": str(uuid.uuid4()), "text": "Connect UI to POST /v1/uploads.", "citations": [{"segment_id": 2}]}]
    return segs, bullets, actions

# ---------------------------
# Routes
# ---------------------------
@router.post("/uploads", response_model=UploadCreateResp, status_code=HTTP_202_ACCEPTED)
async def create_upload(
    file: UploadFile = File(...),
    meeting_id: str = Form(...),
    db: Session = Depends(get_session),
    background_tasks: BackgroundTasks = None,
):
    # read once
    blob = await file.read()
    if not blob:
        raise HTTPException(status_code=422, detail="empty file")
    sha = _sha256(blob)
    byte_size = len(blob)

    # in-memory dedupe (keeps stub compatibility)
    key = (meeting_id, sha)
    if key in _INDEX:
        uid = _INDEX[key]
        rec = _UPLOADS[uid]
        return UploadCreateResp(upload_id=rec.id, status=rec.status)

    # DB-level idempotency first
    existing = db.query(Upload).filter(
        Upload.meeting_id == meeting_id,
        Upload.sha256 == sha,
    ).first()
    if existing:
        return UploadCreateResp(upload_id=existing.id, status=existing.status)

    # create in-memory record (status queued; no inline result)
    uid = str(uuid.uuid4())
    created = _now_utc()
    rec = _UploadRec(
        id=uid,
        meeting_id=meeting_id,
        filename=file.filename or "upload.bin",
        mime_type=file.content_type or "application/octet-stream",
        byte_size=byte_size,
        sha256=sha,
        status="queued",
        created_at=_iso(created),
        retained_until=_iso(created + timedelta(days=90)),
        segments=[],
        bullets=[],
        action_items=[],
    )
    _UPLOADS[uid] = rec
    _INDEX[key] = uid

    # DB row as queued (no transcript/summary yet)
    db_row = Upload(
        id=uid,
        meeting_id=meeting_id,
        filename=rec.filename,
        mime_type=rec.mime_type,
        byte_size=rec.byte_size,
        sha256=rec.sha256,
        duration_sec=None,
        status="queued",
        error=None,
        created_at=created,
        retained_until=created + timedelta(days=90),
    )
    try:
        db.add(db_row)
        db.commit()
    except IntegrityError:
        db.rollback()
        existing = db.query(Upload).filter(
            Upload.meeting_id == meeting_id, Upload.sha256 == sha
        ).first()
        if existing:
            return UploadCreateResp(upload_id=existing.id, status=existing.status)
        raise

    # enqueue background processor to flip to processing -> done and write results
    background_tasks.add_task(_process_stub, uid, meeting_id)

    return UploadCreateResp(upload_id=uid, status="queued")


@router.get("/uploads/{upload_id}", response_model=UploadStatusResp)
async def get_upload(upload_id: str, db: Session = Depends(get_session)):
    # 1) Try DB first
    db_row = db.get(Upload, upload_id)
    if db_row:
        return UploadStatusResp(
            id=db_row.id,
            meeting_id=db_row.meeting_id,
            filename=db_row.filename,
            mime_type=db_row.mime_type,
            byte_size=db_row.byte_size,
            sha256=db_row.sha256,
            duration_sec=float(db_row.duration_sec) if db_row.duration_sec is not None else None,
            status=db_row.status,
            error=db_row.error,
            created_at=db_row.created_at.isoformat() if db_row.created_at else None,
            retained_until=db_row.retained_until.isoformat() if db_row.retained_until else None,
        )

    # 2) Fall back to in-memory (pre-DB uploads)
    rec = _UPLOADS.get(upload_id)
    if not rec:
        raise HTTPException(status_code=404, detail="Upload not found")
    return UploadStatusResp(**rec.model_dump())


@router.get("/uploads/{upload_id}/result", response_model=UploadResultResp)
async def get_result(upload_id: str, db: Session = Depends(get_session)):
    # 1) Try DB first
    u = db.get(Upload, upload_id)
    if u:
        if u.status != "done":
            raise HTTPException(status_code=404, detail="Result not ready")

        t = u.transcript
        if not t:
            raise HTTPException(status_code=404, detail="Transcript missing")

        # Build transcript
        seg_models = t.segments
        segments = [
            Segment(id=s.id, t_start=float(s.t_start), t_end=float(s.t_end), text=s.text)
            for s in seg_models
        ]

        # Get latest summary for this meeting
        summary = (
            db.query(Summary)
            .filter(Summary.meeting_id == u.meeting_id)
            .order_by(Summary.created_at.desc())
            .first()
        )
        if not summary:
            raise HTTPException(status_code=404, detail="Summary missing")

        bullets_out = []
        for b in summary.bullets:
            cits = [BulletCitation(segment_id=bc.segment_id) for bc in b.citations]
            bullets_out.append(SummaryBullet(id=b.id, text=b.text, citations=cits))

        return UploadResultResp(
            transcript=TranscriptOut(language=t.language or "en", segments=segments),
            summary=SummaryOut(bullets=bullets_out, action_items=[]),
        )

    # 2) Fall back to in-memory (pre-DB uploads)
    rec = _UPLOADS.get(upload_id)
    if not rec:
        raise HTTPException(status_code=404, detail="Upload not found")

    segments = [Segment(**s) for s in rec.segments]
    bullets = [SummaryBullet(**b) for b in rec.bullets]
    actions = [SummaryBullet(**a) for a in rec.action_items]

    return UploadResultResp(
        transcript=TranscriptOut(language="en", segments=segments),
        summary=SummaryOut(bullets=bullets, action_items=actions),
    )

def _process_stub(upload_id: str, meeting_id: str) -> None:
    print(f"[BG] start processing {upload_id}")

    """
    Simulate background processing:
    - status: queued -> processing -> done
    - write transcript segments + summary with citations into SQLite
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

        # small delay so you can see the transition in /status
        sleep(1.0)

        # fabricate result
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

            print(f"[BG] done processing {upload_id}")

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
