from __future__ import annotations

from typing import Optional, List, Dict, Any
from fastapi import APIRouter, Query
from sqlalchemy.orm import Session
from sqlalchemy import func, case

from ...db import SessionLocal
from ...models import Upload, Summary

import os

router = APIRouter(prefix="/v1", tags=["meetings"])

# ---------------------------
# Logging (same tee as worker)
# ---------------------------
_LOG_PATH = os.getenv("NOTABLY_LOG_FILE", "/tmp/notably_worker.log")
_LOG_FH = None
try:
    _LOG_FH = open(_LOG_PATH, "a", buffering=1, encoding="utf-8")
except Exception:
    _LOG_FH = None

def _log(msg: str) -> None:
    line = f"[meetings] {msg}"
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
    h, rem = divmod(s, 3600)
    m, sec = divmod(rem, 60)
    if h:
        return f"{h}:{m:02d}:{sec:02d}"
    return f"{m}:{sec:02d}"


@router.get("/meetings")
def list_meetings(
    q: Optional[str] = Query(None, description="Filter by meeting_id substring"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    order: str = Query("last_upload_at_desc"),  # validated below for maximum compatibility
):
    """
    List meetings with aggregates:
      - meeting_id
      - first_upload_at / last_upload_at (ISO 8601 strings)
      - total_duration_sec (sum of upload.duration_sec)
      - upload_count
      - has_summary
    Sorted by last_upload_at desc by default. Supports substring filter on meeting_id.
    """
    db: Session = SessionLocal()
    try:
        # Validate order param (avoid FastAPI pattern/regex differences across versions)
        allowed = {"last_upload_at_desc", "last_upload_at_asc"}
        if order not in allowed:
            order = "last_upload_at_desc"

        # Total distinct meetings (for pagination UI)
        total_q = db.query(func.count(func.distinct(Upload.meeting_id)))
        if q:
            total_q = total_q.filter(Upload.meeting_id.ilike(f"%{q}%"))
        total_count = int(total_q.scalar() or 0)

        # Aggregates per meeting
        agg = (
            db.query(
                Upload.meeting_id.label("meeting_id"),
                func.min(Upload.created_at).label("first_upload_at"),
                func.max(Upload.created_at).label("last_upload_at"),
                func.coalesce(func.sum(func.coalesce(Upload.duration_sec, 0.0)), 0.0).label("total_duration_sec"),
                func.count(Upload.id).label("upload_count"),
            )
        )
        if q:
            agg = agg.filter(Upload.meeting_id.ilike(f"%{q}%"))
        agg = agg.group_by(Upload.meeting_id).subquery(name="agg")

        # Distinct meetings that have a summary
        summ_meetings = db.query(Summary.meeting_id.label("meeting_id")).distinct().subquery(name="summ_meetings")

        # has_summary flag
        has_summary_col = case(
            (summ_meetings.c.meeting_id.isnot(None), True),
            else_=False,
        ).label("has_summary")

        final_q = (
            db.query(
                agg.c.meeting_id,
                agg.c.first_upload_at,
                agg.c.last_upload_at,
                agg.c.total_duration_sec,
                agg.c.upload_count,
                has_summary_col,
            )
            .outerjoin(summ_meetings, summ_meetings.c.meeting_id == agg.c.meeting_id)
        )

        # Sort
        if order == "last_upload_at_asc":
            final_q = final_q.order_by(agg.c.last_upload_at.asc())
        else:
            final_q = final_q.order_by(agg.c.last_upload_at.desc())

        # Page
        rows = final_q.offset(offset).limit(limit).all()

        items: List[Dict[str, Any]] = []
        for r in rows:
            # Convert datetimes to ISO strings so the response is always JSON-serializable
            first_iso = r.first_upload_at.isoformat() if r.first_upload_at else None
            last_iso  = r.last_upload_at.isoformat() if r.last_upload_at else None
            items.append(
                {
                    "meeting_id": r.meeting_id,
                    "first_upload_at": first_iso,
                    "last_upload_at": last_iso,
                    "upload_count": int(r.upload_count or 0),
                    "total_duration_sec": float(r.total_duration_sec or 0.0),
                    "total_duration_str": _format_time_s(r.total_duration_sec or 0.0),
                    "has_summary": bool(r.has_summary),
                }
            )

        _log(f"listed {len(items)}/{total_count} meetings (q={q!r}, order={order}, limit={limit}, offset={offset})")
        # Return a plain dict so FastAPI applies jsonable_encoder (safe for datetimes etc.)
        return {
            "total": total_count,
            "limit": limit,
            "offset": offset,
            "order": order,
            "q": q,
            "items": items,
        }
    finally:
        db.close()

