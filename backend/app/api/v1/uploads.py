from __future__ import annotations
import hashlib
import uuid
import typing
import os
from io import BytesIO
from datetime import datetime, timedelta, timezone
from typing import Dict, Tuple, List, Optional, Literal

from fastapi import APIRouter, UploadFile, File, Form, HTTPException
from fastapi import BackgroundTasks
from time import sleep
from pydantic import BaseModel
from starlette.status import HTTP_202_ACCEPTED
from fastapi import Depends
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
from sqlalchemy import func
from fastapi import Response
from fastapi import Query
from ...export_pdf import render_meeting_pdf


# RQ (optional)
from backend.app.queue import get_queue, RQ_ENABLE
from backend.app.tasks import process_stub

from ...db import get_session
from ...db import SessionLocal
from ...models import (
    Upload,
    Transcript,
    TranscriptSegment,
    Summary,
    SummaryBullet as ORMSummaryBullet,
    BulletCitation as ORMBulletCitation,
    UploadObject,
    Tag,
    UploadTag,
)
from ...storage import get_client as get_minio_client, ensure_bucket, make_object_key
from ...stubs import _make_stub_result
from ...models import Tag as ORMTag, UploadTag as ORMUploadTag


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
MAX_UPLOAD_BYTES = 1_000_000_000
# 1 GB cap

def minio_enabled() -> bool:
    return os.getenv("MINIO_ENABLE", "false").lower() == "true"


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

class SearchHit(BaseModel):
    upload_id: str
    meeting_id: str
    transcript_id: str 
    segment_id: int
    t_start: float
    t_end: float
    text: str
    filename: str


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

class TagListIn(BaseModel):
    tags: List[str]

class TagListOut(BaseModel):
    tags: List[str]

class PresignedURLResp(BaseModel):
    url: str
    expires_at: str  # ISO8601


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

def _env_true(name: str, default: str = "false") -> bool:
    return os.getenv(name, default).lower() in {"1", "true", "yes", "y"}

def _pick_upload_object(db: Session, upload_id: str, kind: str) -> Optional[UploadObject]:
    q = (
        db.query(UploadObject)
        .filter(UploadObject.upload_id == upload_id)
        .order_by(UploadObject.id.desc())
    )
    rows = q.all()
    if not rows:
        return None
    if kind == "audio16k":
        for r in rows:
            if r.object_key.endswith("/audio-16k.wav"):
                return r
        return None
    # "original" (default): prefer the latest that is NOT our derived audio-16k
    for r in rows:
        if not r.object_key.endswith("/audio-16k.wav"):
            return r
    # fallback: if somehow only audio-16k exists, return it
    return rows[0]


# ---------------------------
# Routes
# ---------------------------
@router.post("/uploads", response_model=UploadCreateResp, status_code=HTTP_202_ACCEPTED)
async def create_upload(
    file: UploadFile = File(...),
    meeting_id: str = Form(...),
    duration_sec: typing.Optional[float] = Form(None),
    db: Session = Depends(get_session),
    background_tasks: BackgroundTasks = None,
):
    # read once
    blob = await file.read()
    if not blob:
        raise HTTPException(status_code=422, detail="empty file")
    sha = _sha256(blob)
    byte_size = len(blob)
    if byte_size > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="file too large (limit 1 GB)")
    if duration_sec is not None and duration_sec > 3600:
        raise HTTPException(status_code=422, detail="duration exceeds 60 minutes")

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
        duration_sec=duration_sec,
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
        duration_sec=duration_sec,
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

    # Optional: push raw blob to MinIO
    if minio_enabled():
        try:
            client = get_minio_client()
            bucket = ensure_bucket(client)
            object_key = make_object_key(meeting_id, uid, rec.filename)

            client.put_object(
                bucket,
                object_key,
                data=BytesIO(blob),
                length=byte_size,
                content_type=rec.mime_type,
            )
            # record where we put it
            obj = UploadObject(
                upload_id=uid,
                bucket=bucket,
                object_key=object_key,
                content_type=rec.mime_type,
                byte_size=rec.byte_size,
                sha256=rec.sha256,
            )
            db.add(obj)
            db.commit()
        except Exception as e:
            # mark failed and surface an error
            u = db.get(Upload, uid)
            if u:
                u.status = "failed"
                u.error = f"minio: {e}"
                db.add(u)
                db.commit()
            raise HTTPException(status_code=500, detail="storage error")

    # enqueue background processor to flip to processing -> done and write results
    if RQ_ENABLE:
        q = get_queue()
        q.enqueue(process_stub, uid, meeting_id)
    else:
        if background_tasks is None:
            raise HTTPException(status_code=500, detail="background task unavailable")
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


@router.get("/uploads", response_model=list[UploadStatusResp])
async def list_uploads(
    meeting_id: Optional[str] = None,
    tag: Optional[str] = Query(None),
    limit: int = 25,
    db: Session = Depends(get_session),
):
    q = db.query(Upload)
    if meeting_id:
        q = q.filter(Upload.meeting_id == meeting_id)
    if tag:
        q = (
            q.join(ORMUploadTag, ORMUploadTag.upload_id == Upload.id)
             .join(ORMTag, ORMTag.id == ORMUploadTag.tag_id)
             .filter(ORMTag.name == tag)
        )
    q = q.order_by(Upload.created_at.desc()).limit(limit)
    rows = q.all()
    return [
        UploadStatusResp(
            id=u.id,
            meeting_id=u.meeting_id,
            filename=u.filename or "",
            mime_type=u.mime_type or "application/octet-stream",
            byte_size=u.byte_size,
            sha256=u.sha256,
            duration_sec=float(u.duration_sec) if u.duration_sec is not None else None,
            status=u.status,
            error=u.error,
            created_at=u.created_at.isoformat() if u.created_at else "",
            retained_until=u.retained_until.isoformat() if u.retained_until else None,
        )
        for u in rows
    ]

@router.get("/segments/search", response_model=List[SearchHit])
async def search_segments(
    q: str,
    meeting_id: Optional[str] = None,
    limit: int = 25,
    offset: int = 0,
    db: Session = Depends(get_session),
):
    """
    Case-insensitive substring search over TranscriptSegment.text.
    Optional meeting_id filter. Simple pagination via limit/offset.
    """
    limit = max(1, min(limit, 100))
    offset = max(0, offset)

    # Join Upload -> Transcript -> TranscriptSegment
    qry = (
        db.query(Upload, Transcript, TranscriptSegment)
        .join(Transcript, Transcript.upload_id == Upload.id)
        .join(TranscriptSegment, TranscriptSegment.transcript_id == Transcript.id)
        .filter(TranscriptSegment.text.ilike(f"%{q}%"))
        .order_by(TranscriptSegment.id.asc())
    )
    if meeting_id:
        qry = qry.filter(Upload.meeting_id == meeting_id)

    rows = qry.offset(offset).limit(limit).all()

    out: List[SearchHit] = []
    for u, t, s in rows:
        out.append(
            SearchHit(
                upload_id=u.id,
                meeting_id=u.meeting_id,
                transcript_id=str(t.id),
                segment_id=s.id,
                t_start=float(s.t_start or 0.0),
                t_end=float(s.t_end or 0.0),
                text=s.text or "",
                filename=u.filename or "",
            )
        )
    return out

@router.get("/exports/pdf")
async def export_pdf(meeting_id: str, db: Session = Depends(get_session)):
    """
    Render a minimal PDF for a meeting: transcript + summary bullets.
    """
    try:
        pdf_bytes = render_meeting_pdf(db, meeting_id)
    except ImportError as e:
        raise HTTPException(status_code=503, detail=str(e))
    if not pdf_bytes:
        raise HTTPException(status_code=404, detail="Nothing to export")
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="meeting-{meeting_id}.pdf"'},
    )

@router.post("/uploads/{upload_id}/tags", response_model=TagListOut)
async def add_tags(upload_id: str, payload: TagListIn, db: Session = Depends(get_session)):
    u = db.get(Upload, upload_id)
    if not u:
        raise HTTPException(status_code=404, detail="Upload not found")

    names = [n.strip() for n in (payload.tags or []) if n and n.strip()]
    if not names:
        return TagListOut(tags=[])

    # find-or-create tags
    tag_map = {}
    for name in names:
        t = db.query(Tag).filter(func.lower(Tag.name) == name.lower()).first()
        if not t:
            t = Tag(name=name)
            db.add(t)
            db.flush()
        tag_map[name] = t

    # link tags to this upload (ignore if already linked)
    for t in tag_map.values():
        exists = (
            db.query(UploadTag)
            .filter(UploadTag.upload_id == upload_id, UploadTag.tag_id == t.id)
            .first()
        )
        if not exists:
            db.add(UploadTag(upload_id=upload_id, tag_id=t.id))

    db.commit()

    # return current tag names for this upload
    current = (
        db.query(Tag.name)
        .join(UploadTag, UploadTag.tag_id == Tag.id)
        .filter(UploadTag.upload_id == upload_id)
        .order_by(Tag.name.asc())
        .all()
    )
    return TagListOut(tags=[row[0] for row in current])

@router.get("/uploads/{upload_id}/download", response_model=PresignedURLResp)
async def presigned_download(
    upload_id: str,
    kind: Literal["original", "audio16k"] = "original",
    ttl: int = Query(3600, ge=60, le=86400),
    filename: Optional[str] = Query(None),
    db: Session = Depends(get_session),
):
    # 1) feature flag
    if not minio_enabled():
        raise HTTPException(status_code=400, detail="MinIO disabled")

    # 2) existence check
    u = db.get(Upload, upload_id)
    if not u:
        raise HTTPException(status_code=404, detail="Upload not found")

    # 3) pick object by kind
    q = db.query(UploadObject).filter(UploadObject.upload_id == upload_id)
    if kind == "audio16k":
        q = q.filter(UploadObject.object_key.like("%/audio-16k.wav"))
    else:
        q = q.filter(~UploadObject.object_key.like("%/audio-16k.wav"))
    obj = q.order_by(UploadObject.id.desc()).first()
    if not obj:
        raise HTTPException(status_code=404, detail=f"{kind} not available")

    # 4) presign with optional filename
    client = get_minio_client()
    headers = None
    if filename:
        headers = {"response-content-disposition": f'attachment; filename="{filename}"'}

    expires = timedelta(seconds=int(ttl))
    url = client.presigned_get_object(
        obj.bucket,
        obj.object_key,
        expires=expires,
        response_headers=headers,
    )

    return PresignedURLResp(url=url, expires_at=_iso(_now_utc() + expires))


def _process_stub(upload_id: str, meeting_id: str) -> None:
    """
    Simulate background processing:
    - status: queued -> processing -> done
    - write transcript segments + summary with citations into DB
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

