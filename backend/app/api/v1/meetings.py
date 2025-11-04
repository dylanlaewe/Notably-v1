from __future__ import annotations

from typing import Optional, List, Dict, Any, Iterable, Set
from fastapi import APIRouter, Query
from sqlalchemy.orm import Session
from sqlalchemy import func, case, text

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


# ---------------------------
# Tag helpers (namespaced tables)
# ---------------------------

def _lower(s: str) -> str:
    return s.lower()

def _expand_tag_ids(
    db: Session,
    tag_ids: Optional[Iterable[str]],
    tag_names: Optional[Iterable[str]],
) -> List[str]:
    """Return a list of UUID strings for the requested tag ids/names (deduped)."""
    ids: Set[str] = set()
    if tag_ids:
        for tid in tag_ids:
            tid = (tid or "").strip()
            if tid:
                ids.add(tid)

    if tag_names:
        names = [n.strip().lower() for n in tag_names if n and n.strip()]
        if names:
            rows = db.execute(
                text(
                    """
                    select id from notably_tag
                    where lower(name) = any(:names)
                    """
                ),
                {"names": names},
            ).mappings().all()
            for r in rows:
                ids.add(str(r["id"]))
    return list(ids)

def _meeting_ids_for_tags(
    db: Session, tag_uuid_list: List[str], mode: str
) -> Set[str]:
    """Return meeting_ids that match ANY/ALL of the given tag ids."""
    if not tag_uuid_list:
        return set()

    if mode.lower() == "all":
        # Require all tags to be attached to the same meeting
        rows = db.execute(
            text(
                """
                select target_id
                from notably_tag_link
                where target_kind = 'meeting'
                  and tag_id = any(:tag_ids)
                group by target_id
                having count(distinct tag_id) >= :need
                """
            ),
            {"tag_ids": tag_uuid_list, "need": len(set(tag_uuid_list))},
        ).mappings().all()
        return {str(r["target_id"]) for r in rows}

    # ANY (default)
    rows = db.execute(
        text(
            """
            select distinct target_id
            from notably_tag_link
            where target_kind = 'meeting'
              and tag_id = any(:tag_ids)
            """
        ),
        {"tag_ids": tag_uuid_list},
    ).mappings().all()
    return {str(r["target_id"]) for r in rows}


@router.get("/meetings")
def list_meetings(
    q: Optional[str] = Query(None, description="Filter by meeting_id substring"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    order: str = Query("last_upload_at_desc"),  # validated below
    # NEW: tag filters
    tag_id: Optional[List[str]] = Query(None, description="Repeatable: tag UUID to filter by"),
    tag_name: Optional[List[str]] = Query(None, description="Repeatable: tag name to filter by (case-insensitive)"),
    tag_mode: str = Query("any", description="Tag match mode: 'any' or 'all'"),
):
    """
    List meetings with aggregates:
      - meeting_id
      - first_upload_at / last_upload_at (ISO 8601 strings)
      - total_duration_sec (sum of upload.duration_sec)
      - upload_count
      - has_summary

    Filters:
      - q: substring on meeting_id
      - tag_id / tag_name (repeatable); tag_mode = any|all
    Sorted by last_upload_at desc by default.
    """
    db: Session = SessionLocal()
    try:
        # Validate order + tag_mode
        allowed_order = {"last_upload_at_desc", "last_upload_at_asc"}
        if order not in allowed_order:
            order = "last_upload_at_desc"
        tag_mode = tag_mode.lower()
        if tag_mode not in {"any", "all"}:
            tag_mode = "any"

        # Resolve tag ids (by id and/or name)
        resolved_tag_ids = _expand_tag_ids(db, tag_id, tag_name)

        # If tag filters are present, compute allowed meeting_ids upfront
        allowed_meeting_ids: Optional[Set[str]] = None
        if resolved_tag_ids:
            allowed_meeting_ids = _meeting_ids_for_tags(db, resolved_tag_ids, tag_mode)
            if not allowed_meeting_ids:
                # No matches; short-circuit empty response
                _log(f"list_meetings — tags={resolved_tag_ids} mode={tag_mode} → 0 matches")
                return {"total": 0, "limit": limit, "offset": offset, "order": order, "q": q, "items": []}

        # Total distinct meetings (for pagination UI)
        total_q = db.query(func.count(func.distinct(Upload.meeting_id)))
        if q:
            total_q = total_q.filter(Upload.meeting_id.ilike(f"%{q}%"))
        if allowed_meeting_ids is not None:
            total_q = total_q.filter(Upload.meeting_id.in_(list(allowed_meeting_ids)))
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
        if allowed_meeting_ids is not None:
            agg = agg.filter(Upload.meeting_id.in_(list(allowed_meeting_ids)))
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

        _log(
            f"listed {len(items)}/{total_count} meetings "
            f"(q={q!r}, tags={resolved_tag_ids or []}, mode={tag_mode}, order={order}, limit={limit}, offset={offset})"
        )
        return {
            "total": total_count,
            "limit": limit,
            "offset": offset,
            "order": order,
            "q": q,
            "tag_id": tag_id,
            "tag_name": tag_name,
            "tag_mode": tag_mode,
            "items": items,
        }
    finally:
        db.close()
