from __future__ import annotations
import hashlib
import uuid
import typing
import os
import platform
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
from ...export_md import render_meeting_markdown
from backend.app.team_ops import get_or_create_default_team
from backend.app.access import (
    assert_user_can_access_meeting,
    assign_meeting_team_if_empty,
    get_visible_upload_or_404,
    ensure_meeting_exists,
)
from backend.app.auth import require_user, UserContext


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

def minio_enabled() -> bool:
    return os.getenv("MINIO_ENABLE", "false").lower() == "true"


def use_inline_processing() -> bool:
    """
    Local macOS runs can crash RQ work-horse children during fork-heavy media work.
    Default to in-process background execution on Darwin unless explicitly disabled.
    """
    override = os.getenv("NOTABLY_INLINE_UPLOAD_PROCESSING")
    if override is not None:
        return override.lower() in {"1", "true", "yes", "y"}
    return platform.system() == "Darwin"


def _log_upload(msg: str) -> None:
    # Keep it simple: print to console; if you want, you can copy the NOTABLY_LOG_FILE pattern
    print(f"[uploads] {msg}", flush=True)

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
    user: UserContext = Depends(require_user),
    background_tasks: BackgroundTasks = None,
):
    def _log_upload(msg: str) -> None:
        print(f"[uploads] {msg}", flush=True)

    _log_upload("create_upload called")

    # -------------------------
    # 1) Read file + basic checks
    # -------------------------
    blob = await file.read()
    if not blob:
        raise HTTPException(status_code=422, detail="empty file")
    sha = _sha256(blob)
    byte_size = len(blob)

    _log_upload(f"file read ok, bytes={byte_size}, sha={sha[:12]}..., meeting_id={meeting_id}")

    # -------------------------
    # 2) DB-level idempotency: reuse existing upload if same meeting+sha
    # -------------------------
    existing = db.query(Upload).filter(
        Upload.meeting_id == meeting_id,
        Upload.sha256 == sha,
    ).first()
    if existing:
        _log_upload(f"found existing Upload id={existing.id} status={existing.status}")
        return UploadCreateResp(upload_id=existing.id, status=existing.status)

    # -------------------------
    # 3) Create Upload row in DB
    # -------------------------
    uid = str(uuid.uuid4())
    created = _now_utc()

    db_row = Upload(
        id=uid,
        meeting_id=meeting_id,
        filename=file.filename or "upload.bin",
        mime_type=file.content_type or "application/octet-stream",
        byte_size=byte_size,
        sha256=sha,
        duration_sec=duration_sec,
        status="queued",
        error=None,
        created_at=created,
        retained_until=created + timedelta(days=90),
    )

    try:
        db.add(db_row)
        db.commit()
        _log_upload(f"inserted Upload id={uid} status=queued")
    except IntegrityError:
        db.rollback()
        existing = db.query(Upload).filter(
            Upload.meeting_id == meeting_id, Upload.sha256 == sha
        ).first()
        if existing:
            _log_upload(
                f"race on Upload; returning existing id={existing.id} status={existing.status}"
            )
            return UploadCreateResp(upload_id=existing.id, status=existing.status)
        raise

    # -------------------------
    # 4) Ensure meeting exists + attached to user's default team
    # -------------------------
    ensure_meeting_exists(db, meeting_id)
    team_id = get_or_create_default_team(db, user.user_id)
    assign_meeting_team_if_empty(db, meeting_id, team_id)
    _log_upload(f"meeting ensured + assigned to team_id={team_id}")

    # -------------------------
    # 5) Optional: push raw blob to MinIO
    # -------------------------
    if minio_enabled():
        try:
            client = get_minio_client()
            bucket = ensure_bucket(client)
            object_key = make_object_key(meeting_id, uid, file.filename or "upload.bin")

            client.put_object(
                bucket,
                object_key,
                data=BytesIO(blob),
                length=byte_size,
                content_type=file.content_type or "application/octet-stream",
            )
            _log_upload(f"MinIO put_object bucket={bucket} key={object_key}")

            obj = UploadObject(
                upload_id=uid,
                bucket=bucket,
                object_key=object_key,
                content_type=file.content_type or "application/octet-stream",
                byte_size=byte_size,
                sha256=sha,
            )
            db.add(obj)
            db.commit()
            _log_upload(f"UploadObject row created id={obj.id}")
        except Exception as e:
            u = db.get(Upload, uid)
            if u:
                u.status = "failed"
                u.error = f"minio: {e}"
                db.add(u)
                db.commit()
            _log_upload(f"MinIO error: {e}")
            raise HTTPException(status_code=500, detail="storage error")
    else:
        _log_upload("MINIO_ENABLE is false; skipping MinIO upload")

    # -------------------------
    # 6) Queue or local background processing
    # -------------------------
    from backend.app.queue import RQ_ENABLE, get_queue
    from backend.app.tasks import process_stub

    inline_processing = use_inline_processing()
    _log_upload(f"RQ_ENABLE in create_upload={RQ_ENABLE!r}, inline_processing={inline_processing!r}")

    if inline_processing:
        if background_tasks is None:
            raise HTTPException(status_code=500, detail="background_tasks_unavailable")
        background_tasks.add_task(process_stub, uid, meeting_id)
        _log_upload(f"scheduled inline background processing uid={uid} meeting_id={meeting_id}")
    else:
        if not RQ_ENABLE:
            raise HTTPException(
                status_code=500,
                detail="RQ_ENABLE is false; enable RQ or NOTABLY_INLINE_UPLOAD_PROCESSING=true",
            )

        q = get_queue()
        job = q.enqueue(process_stub, uid, meeting_id)
        _log_upload(
            f"enqueued process_stub job.id={getattr(job, 'id', None)} uid={uid} meeting_id={meeting_id}"
        )

    return UploadCreateResp(upload_id=uid, status="queued")



@router.get("/uploads/{upload_id}", response_model=UploadStatusResp)
async def get_upload(
    upload_id: str,
    user: UserContext = Depends(require_user), 
    db: Session = Depends(get_session),
):
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
    if getattr(rec, "meeting_id", None):
        # verify access to meeting
        assert_user_can_access_meeting(db, user.user_id, rec.meeting_id)   
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

@router.get("/exports/markdown")
async def export_markdown(meeting_id: str, db: Session = Depends(get_session)):
    """
    Render a markdown export for a meeting: transcript + summary bullets.
    """
    try:
        md_bytes = render_meeting_markdown(db, meeting_id)
    except ImportError as e:
        raise HTTPException(status_code=503, detail=str(e))

    if not md_bytes:
        raise HTTPException(status_code=404, detail="Nothing to export")

    return Response(
        content=md_bytes,
        media_type="text/markdown; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename=\"meeting-{meeting_id}.md\"'},
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
    Simulate background processing for dev/tests (no RQ worker):

    - Ensure there's a meeting row for access checks and visibility.
    - Flip Upload.status: queued -> processing -> done.
    - Fabricate transcript segments and a summary with citations in the DB.

    This mirrors the behavior of backend.app.tasks.process_stub in a simpler,
    in-process way so that tests (and dev) can rely on meeting-scoped endpoints
    like /v1/meetings/{meeting_id}/transcript and /summary.
    """
    db = SessionLocal()
    u: Upload | None = None
    try:
        # 1) Mark upload as processing
        u = db.get(Upload, upload_id)
        if not u:
            db.close()
            return

        u.status = "processing"
        db.add(u)
        db.commit()

        # 2) Ensure a meeting row exists (needed for get_visible_meeting_or_404)
        ensure_meeting_exists(db, meeting_id)

        # Small delay so you can see the transition in /uploads/{id}
        sleep(1.0)

        # 3) Fabricate stub transcript data
        segs, bullets, actions = _make_stub_result()

        # Transcript row
        t = Transcript(upload_id=upload_id, language="en")
        db.add(t)
        db.flush()  # t.id

        # Transcript segments
        seg_id_by_index: dict[int, int] = {}
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

        # 4) Summary + bullets + citations
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
                    db.add(
                        ORMBulletCitation(
                            summary_bullet_id=b_row.id,
                            segment_id=real_seg_id,
                        )
                    )

        # 5) Mark upload as done
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
