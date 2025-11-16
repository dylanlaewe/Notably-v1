from __future__ import annotations

import os
import re
from typing import Optional, List, Dict, Any
from fastapi import APIRouter, HTTPException, Query, Depends
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session
from sqlalchemy import and_, or_, func, case, desc, text
from backend.app.auth import require_user, UserContext
from backend.app.access import assert_user_can_access_meeting
from ...db import SessionLocal
from backend.app.api.v1.teams import get_db
from backend.app.access import get_visible_meeting_or_404
from ...models import (
    Upload,
    Transcript,
    TranscriptSegment,
    Summary,
    SummaryBullet,
    BulletCitation,
)

router = APIRouter(prefix="/v1", tags=["browse", "search"])

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

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

@router.get("/meetings/{meeting_id}/transcript")
def get_transcript(
    meeting_id: str,
    limit: int = 100,
    offset: int = 0,
    user: UserContext = Depends(require_user),
    db: Session = Depends(get_db),
):
    _ = get_visible_meeting_or_404(db, user.user_id, meeting_id)

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
        return {
            "meeting_id": meeting_id,
            "transcript_id": str(t.id),
            "total": total,
            "limit": limit,
            "offset": offset,
            "items": items,
        }
    finally:
        db.close()


@router.get("/meetings/{meeting_id}/summary")
def get_summary(
    meeting_id: str,
    user: UserContext = Depends(require_user),
    db: Session = Depends(get_db),
):
    _ = get_visible_meeting_or_404(db, user.user_id, meeting_id)
    try:
        s = _get_latest_summary_for_meeting(db, meeting_id)
        if not s:
            raise HTTPException(status_code=404, detail="Summary not found for meeting")

        bullets: List[SummaryBullet] = (
            db.query(SummaryBullet)
            .filter(SummaryBullet.summary_id == str(s.id))
            .order_by(SummaryBullet.id.asc())
            .all()
        )

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

        return {
            "meeting_id": meeting_id,
            "summary_id": str(s.id),
            "bullets": bullet_dicts,
            "bullet_count": len(bullet_dicts),
        }
    finally:
        db.close()

'''
@router.get("/search", response_class=JSONResponse)
def search(
    q: str = Query(..., min_length=1, description="Search string"),
    meeting_id: Optional[str] = Query(None),
    limit: int = Query(50, ge=1, le=200),
    mode: str = Query("and", description="Match mode: 'and' or 'or'"),
):
    """
    Tokenized search across transcript segments and summary bullets.
    - Splits q into tokens (alnum); default AND semantics across tokens.
    - Optional `mode=or` for OR semantics.
    - Ranks results by simple term-hit score (more hits first).
    """
    db = SessionLocal()
    try:
        # Tokenize (keep alphanumeric; case-insensitive)
        tokens = re.findall(r"[A-Za-z0-9]+", q.lower())
        tokens = [t for t in tokens if t]
        if not tokens:
            return {"q": q, "meeting_id": meeting_id, "limit": limit, "mode": mode, "results": []}

        # Build AND/OR condition builders
        def _build_text_cond(column):
            conds = [column.ilike(f"%{t}%") for t in tokens]
            return and_(*conds) if mode.lower() == "and" else or_(*conds)

        def _build_score(column):
            # Sum(# of tokens that match) for simple ranking
            parts = [case((column.ilike(f"%{t}%"), 1), else_=0) for t in tokens]
            # SQLAlchemy sums python-side; use func.sum over literal? summing expressions is fine.
            s = parts[0]
            for p in parts[1:]:
                s = s + p
            return s.label("score")

        # SEGMENTS
        seg_cond = _build_text_cond(TranscriptSegment.text)
        seg_score = _build_score(TranscriptSegment.text)
        seg_query = (
            db.query(
                Upload.meeting_id,
                TranscriptSegment.id.label("segment_id"),
                TranscriptSegment.t_start,
                TranscriptSegment.t_end,
                TranscriptSegment.text,
                seg_score,
            )
            .join(Transcript, Transcript.id == TranscriptSegment.transcript_id)
            .join(Upload, Upload.id == Transcript.upload_id)
            .filter(seg_cond)
        )
        if meeting_id:
            seg_query = seg_query.filter(Upload.meeting_id == meeting_id)
        seg_rows = (
            seg_query
            .order_by(desc("score"), TranscriptSegment.id.asc())
            .limit(limit)
            .all()
        )
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
                "score": int(score or 0),
            }
            for (m_id, seg_id, t0, t1, text, score) in seg_rows
        ]

        # BULLETS
        bul_cond = _build_text_cond(SummaryBullet.text)
        bul_score = _build_score(SummaryBullet.text)
        bul_query = (
            db.query(
                Summary.meeting_id,
                SummaryBullet.id.label("bullet_id"),
                SummaryBullet.text,
                bul_score,
            )
            .join(Summary, Summary.id == SummaryBullet.summary_id)
            .filter(bul_cond)
        )
        if meeting_id:
            bul_query = bul_query.filter(Summary.meeting_id == meeting_id)
        bul_rows = (
            bul_query
            .order_by(desc("score"), SummaryBullet.id.asc())
            .limit(limit)
            .all()
        )
        bul_items = [
            {
                "kind": "bullet",
                "meeting_id": m_id,
                "bullet_id": b_id,
                "text": (text or "")[:300],
                "score": int(score or 0),
            }
            for (m_id, b_id, text, score) in bul_rows
        ]

        # Merge + rank in Python (keeps types simple); cap to limit
        combined = seg_items + bul_items
        combined.sort(key=lambda x: x.get("score", 0), reverse=True)
        combined = combined[:limit]

        _log(f"search q={q!r} tokens={tokens} mode={mode} results={len(combined)}")
        return {"q": q, "meeting_id": meeting_id, "limit": limit, "mode": mode, "results": combined}
    finally:
        db.close()
'''