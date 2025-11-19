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
    limit: int = 50,
    user: UserContext = Depends(require_user),
    db: Session = Depends(get_session),
) -> List[Dict[str, Any]]:
    """
    Return a simple list of meetings for the current user/dev env.

    For now we just:
      - read from `meeting`
      - order newest first
      - cap to `limit` (default 50)
    """
    rows = (
        db.execute(
            text(
                """
                SELECT id, team_id, created_at
                FROM meeting
                ORDER BY created_at DESC
                LIMIT :limit
                """
            ),
            {"limit": limit},
        )
        .mappings()
        .all()
    )

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
                "created_at": r.get("created_at"),
            }
        )
    return out

