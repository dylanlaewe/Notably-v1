from __future__ import annotations

from typing import Optional, List, Dict, Any
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from ...db import SessionLocal
from ...models import (
    Upload,
    Transcript,
    TranscriptSegment,
    Summary,
    SummaryBullet,
    BulletCitation,
)

import os

router = APIRouter(prefix="/v1", tags=["browse", "search"])

# ---------------------------
# Logging (tee to the same worker log, harmless in API)
# ---------------------------
_LOG_PATH = os.getenv("NOTABLY_LOG_FILE", "/tmp/notably_worker.log")
_LOG_FH = None
try:
    _LOG_FH = open(_LOG_PATH, "a", buffering=1, encoding="utf-8")
except Exception:
    _LOG_FH = None

def _log(msg: str) -> None:
    line = f"[browse] {msg}"
    print(line, flush=True)
    if _LOG_FH:
        try:
            _LOG_FH.write(line + "\n")
        except Exception:
            pass


def _format_time_s(s: float | int | None) -> str:
    if s is None:
        return "0:00"
    s = int(round(float(s)))
    m, sec = divmod(s, 60)
    return f"{m}:{sec:02d}"


# ---------------------------
# Helpers
# ---------------------------
def _get_latest_transcript_for_meeting(db: Session, meeting_id: str) -> Optional[Transcript]:
    # Transcript -> Upload (meeting_id)
    return (
        db.query(Transcript)
        .join(Upload, Upload.id == Transcript.upload_id)
        .filter(Upload.meeting_id == meeting_id)
        .order_by(Transcript.id.desc())
        .first()
    )

def _get_latest_summary_for_meeting(db: Session, meeting_id: str) -> Optional[Summary]:
    return (
        db.query(Summary)
        .filter(Summary.meeting_id == meeting_id)
        .order_by(Summary.id.desc())
        .first()
    )


# ---------------------------
# Endpoints
# ---------------------------

@router.get("/meetings/{meeting_id}/transcript", response_class=JSONResponse)
def get_transcript(
    meeting_id: str,
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
):
    """
    Return transcript segments for the latest transcript tied to this meeting_id.
    Paginated via limit/offset. Ordered by segment id ascending.
    """
    db = SessionLocal()
    try:
        t = _get_latest_transcript_for_meeting(db, meeting_id)
        if not t:
            raise HTTPException(status_code=404, detail="Transcript not found for meeting")

        q = (
            db.query(TranscriptSegment)
            .filter(TranscriptSegment.transcript_id == t.id)
            .order_by(TranscriptSegment.id.asc())
        )
        total = q.count()
        segs = q.offset(offset).limit(limit).all()

        items = [
            {
                "id": s.id,
                "t_start": float(s.t_start or 0.0),
                "t_end": float(s.t_end or 0.0),
                "t_start_str": _format_time_s(s.t_start),
                "t_end_str": _format_time_s(s.t_end),
                "text": s.text or "",
            }
            for s in segs
        ]
        return JSONResponse(
            {
                "meeting_id": meeting_id,
                "transcript_id": str(t.id),
                "total": total,
                "limit": limit,
                "offset": offset,
                "items": items,
            }
        )
    finally:
        db.close()


@router.get("/meetings/{meeting_id}/summary", response_class=JSONResponse)
def get_summary(meeting_id: str):
    """
    Return the latest summary for meeting_id with bullets and their citations,
    joined to segment timestamps (if available).
    """
    db = SessionLocal()
    try:
        s = _get_latest_summary_for_meeting(db, meeting_id)
        if not s:
            raise HTTPException(status_code=404, detail="Summary not found for meeting")

        bullets: List[SummaryBullet] = (
            db.query(SummaryBullet)
            .filter(SummaryBullet.summary_id == str(s.id))  # summary_bullet.summary_id may be varchar
            .order_by(SummaryBullet.id.asc())
            .all()
        )

        # Fetch citations and associated segment times
        bullet_dicts: List[Dict[str, Any]] = []
        for b in bullets:
            cites = (
                db.query(BulletCitation, TranscriptSegment)
                .join(TranscriptSegment, TranscriptSegment.id == BulletCitation.segment_id)
                .filter(BulletCitation.summary_bullet_id == b.id)
                .order_by(TranscriptSegment.t_start.asc())
                .all()
            )
            citems = [
                {
                    "segment_id": seg.id,
                    "t_start": float(seg.t_start or 0.0),
                    "t_end": float(seg.t_end or 0.0),
                    "t_start_str": _format_time_s(seg.t_start),
                    "t_end_str": _format_time_s(seg.t_end),
                }
                for (_, seg) in cites
            ]
            bullet_dicts.append(
                {
                    "id": b.id,
                    "text": b.text or "",
                    "citations": citems,
                }
            )

        return JSONResponse(
            {
                "meeting_id": meeting_id,
                "summary_id": str(s.id),
                "bullets": bullet_dicts,
                "bullet_count": len(bullet_dicts),
            }
        )
    finally:
        db.close()


@router.get("/search", response_class=JSONResponse)
def search(
    q: str = Query(..., min_length=1, description="Search string"),
    meeting_id: Optional[str] = Query(None),
    limit: int = Query(50, ge=1, le=200),
):
    """
    Lightweight search over transcript segments and summary bullets (ILIKE).
    Optional filter to a specific meeting_id.
    """
    db = SessionLocal()
    try:
        q_like = f"%{q}%"

        # SEGMENTS
        seg_query = (
            db.query(
                Upload.meeting_id,
                TranscriptSegment.id.label("segment_id"),
                TranscriptSegment.t_start,
                TranscriptSegment.t_end,
                TranscriptSegment.text,
            )
            .join(Transcript, Transcript.id == TranscriptSegment.transcript_id)
            .join(Upload, Upload.id == Transcript.upload_id)
            .filter(TranscriptSegment.text.ilike(q_like))
        )
        if meeting_id:
            seg_query = seg_query.filter(Upload.meeting_id == meeting_id)
        segs = seg_query.order_by(TranscriptSegment.id.asc()).limit(limit).all()

        seg_items = [
            {
                "kind": "segment",
                "meeting_id": m_id,
                "segment_id": seg_id,
                "t_start": float(t0 or 0.0),
                "t_end": float(t1 or 0.0),
                "t_start_str": _format_time_s(t0),
                "t_end_str": _format_time_s(t1),
                "snippet": (text or "")[:300],
            }
            for (m_id, seg_id, t0, t1, text) in segs
        ]

        # BULLETS
        bul_query = (
            db.query(
                Summary.meeting_id,
                SummaryBullet.id.label("bullet_id"),
                SummaryBullet.text,
            )
            .join(Summary, Summary.id == SummaryBullet.summary_id)  # summary_id may be string; SQLA handles
            .filter(SummaryBullet.text.ilike(q_like))
        )
        if meeting_id:
            bul_query = bul_query.filter(Summary.meeting_id == meeting_id)
        buls = bul_query.order_by(SummaryBullet.id.asc()).limit(limit).all()

        bul_items = [
            {
                "kind": "bullet",
                "meeting_id": m_id,
                "bullet_id": b_id,
                "text": (text or "")[:300],
            }
            for (m_id, b_id, text) in buls
        ]

        # Combine with simple cap
        combined = (seg_items + bul_items)[:limit]
        return JSONResponse({"q": q, "meeting_id": meeting_id, "limit": limit, "results": combined})
    finally:
        db.close()
