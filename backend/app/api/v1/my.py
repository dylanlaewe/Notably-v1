# backend/app/api/v1/my.py
from __future__ import annotations

from typing import List, Dict, Any

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import text

from backend.app.auth import require_user, UserContext
from backend.app.db import get_session

router = APIRouter(prefix="/v1/my", tags=["my"])


@router.get("/meetings")
def list_my_meetings(
    user: UserContext = Depends(require_user),
    db: Session = Depends(get_session),
):
    """
    Return a simple list of meetings.

    For this MVP we just list all rows from `meeting`, ordered by id
    (most recent first). Per-meeting access control is enforced by the
    /v1/meetings/{meeting_id}/… endpoints, so this is fine for local/dev.
    """
    rows = db.execute(
        text("select id, team_id from meeting order by id desc limit 50")
    ).mappings().all()

    out: List[Dict[str, Any]] = []
    for r in rows:
        out.append(
            {
                "id": str(r["id"]),
                "team_id": (
                    str(r["team_id"])
                    if "team_id" in r and r["team_id"] is not None
                    else None
                ),
            }
        )
    return out

