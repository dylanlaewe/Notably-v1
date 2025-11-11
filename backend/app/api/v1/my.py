# backend/app/api/v1/my.py
from __future__ import annotations
from typing import List, Dict

from fastapi import APIRouter, Depends, Query
from sqlalchemy import text
from sqlalchemy.orm import Session

from backend.app.db import SessionLocal
from backend.app.auth import require_user, UserContext
from backend.app.team_schema import ensure_team_schema

router = APIRouter(prefix="/v1", tags=["meetings"])

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

@router.get("/my/meetings")
def my_meetings(
    user: UserContext = Depends(require_user),
    db: Session = Depends(get_db),
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    include_unassigned: bool = Query(False, description="Also include meetings with no team_id (legacy items)"),
):
    """
    Return meetings the caller can access:
      - meetings whose team_id the user is a member of
      - optionally include meetings with team_id IS NULL (legacy/unassigned)
    Ordered by last activity (latest upload time, else meeting.created_at) DESC.
    """
    ensure_team_schema(db)

    # Build WHERE clause
    where_cond = "tm.user_id = CAST(:uid AS uuid)"
    if include_unassigned:
        where_cond = f"({where_cond} OR m.team_id IS NULL)"

    rows = db.execute(
        text(f"""
            with last_upload as (
              select
                u.meeting_id::uuid as meeting_id,       -- cast once here
                max(u.created_at)   as last_upload_at,
                count(*)            as upload_count
              from upload u
              group by 1
            )
            select
              m.id,
              m.created_at,
              lu.last_upload_at,
              coalesce(lu.upload_count, 0) as upload_count
            from meeting m
            left join last_upload lu on lu.meeting_id = m.id
            left join team_member tm on tm.team_id = m.team_id
            where {where_cond}
            group by m.id, m.created_at, lu.last_upload_at, lu.upload_count
            order by coalesce(lu.last_upload_at, m.created_at) desc
            limit :limit offset :offset
        """),
        {"uid": user.user_id, "limit": limit, "offset": offset}
    ).fetchall()

    items: List[Dict] = []
    for r in rows:
        items.append({
            "id": r[0],
            "created_at": r[1].isoformat() if r[1] else None,
            "last_upload_at": r[2].isoformat() if r[2] else None,
            "upload_count": int(r[3]) if r[3] is not None else 0,
        })

    return {"total": len(items), "items": items}
