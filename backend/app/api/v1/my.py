# backend/app/api/v1/my.py
from __future__ import annotations

from typing import List, Dict, Any

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import text

from backend.app.auth import require_user, UserContext
from backend.app.db import get_session
from backend.app.access import assert_user_can_access_meeting

router = APIRouter(prefix="/v1/my", tags=["my"])


@router.get("/meetings")
def list_my_meetings(
    limit: int = 50,
    user: UserContext = Depends(require_user),
    db: Session = Depends(get_session),
) -> List[Dict[str, Any]]:
    """
    Return a simple list of meetings *visible to the current user*.

    We:
      * read from `meeting` (newest first, capped by `limit`)
      * filter each row with assert_user_can_access_meeting
      * attach `latest_upload_filename` for UI labels
      * include `name` so rename persists after refresh
    """
    limit = max(1, min(limit, 100))

    # Keep the simple, working base query — just add `name`
    rows = (
        db.execute(
            text(
                """
                SELECT id, team_id, created_at, name
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
        mid = str(r["id"])

        # 🔒 Enforce per-user / per-team access
        try:
            assert_user_can_access_meeting(db, user.user_id, mid)
        except HTTPException:
            # user is not allowed to see this meeting → skip it
            continue

        # 🎧 Look up the newest upload filename for this meeting (if any)
        upload_row = (
            db.execute(
                text(
                    """
                    SELECT filename
                    FROM upload
                    WHERE meeting_id = :mid
                    ORDER BY created_at DESC
                    LIMIT 1
                    """
                ),
                {"mid": mid},  # pass the meeting id as a string → matches varchar
            )
            .mappings()
            .first()
        )

        latest_upload_filename = (
            upload_row["filename"]
            if upload_row and "filename" in upload_row
            else None
        )

        out.append(
            {
                "id": mid,
                "team_id": (
                    str(r["team_id"])
                    if "team_id" in r and r["team_id"] is not None
                    else None
                ),
                "created_at": r.get("created_at"),
                "latest_upload_filename": latest_upload_filename,
                "name": r.get("name"),
            }
        )

    return out


