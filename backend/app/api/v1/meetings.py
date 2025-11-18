from __future__ import annotations

from typing import Optional, List, Dict, Any, Iterable, Set
from fastapi import APIRouter, HTTPException, Query, Depends, Response
from sqlalchemy.orm import Session
from sqlalchemy import func, case, text
from uuid import uuid4

from backend.app.api.v1.teams import get_db
from ...db import SessionLocal
from ...models import Upload, Summary
from pydantic import BaseModel
from backend.app.db import get_session
from backend.app.auth import require_user, UserContext
from backend.app.access import assert_user_can_access_meeting, ensure_meeting_exists, assign_meeting_team_if_empty, get_visible_meeting_or_404
from backend.app.team_ops import get_or_create_default_team

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
    limit: int = 50,
    offset: int = 0,
    user: UserContext = Depends(require_user),
    db: Session = Depends(get_session),
):
    """
    List meetings visible to the current user.
    Adds `latest_upload_filename` so the UI can show a human label.
    """
    limit = max(1, min(limit, 100))
    offset = max(0, offset)

    # Recent meetings; we filter by access in Python.
    rows = db.execute(
        text(
            """
            select
              m.id,
              m.created_at,
              m.name
              (
                select u.filename
                from upload u
                where u.meeting_id = m.id
                order by u.created_at desc
                limit 1
              ) as latest_upload_filename
            from meeting m
            order by m.created_at desc
            limit :limit offset :offset
            """
        ),
        {"limit": limit, "offset": offset},
    ).mappings().all()

    items: list[dict[str, Any]] = []
    for row in rows:
        mid = str(row["id"])

        # re-use your existing access guard
        try:
            assert_user_can_access_meeting(db, user.user_id, mid)
        except HTTPException:
            continue

        created_at = row.get("created_at")

        items.append(
            {
                "id": mid,
                "created_at": created_at.isoformat() if created_at else None,
                "latest_upload_filename": row.get("latest_upload_filename"),
                "name": row.get("name"),
            }
        )

    return {
        "total": len(items),
        "limit": limit,
        "offset": offset,
        "items": items,
    }

class MeetingUpdateReq(BaseModel):
    name: Optional[str] = None


class MeetingCreateResp(BaseModel):
    id: str


@router.post("/meetings", response_model=MeetingCreateResp)
def create_meeting(
    user: UserContext = Depends(require_user),
    db: Session = Depends(get_session),
):
    """
    Create a new meeting ID for the current user/team and return it.

    For now we keep this super simple:
      - generate a UUID meeting_id
      - ensure a meeting row exists
      - attach it to the caller's default team
    """
    meeting_id = str(uuid4())

    # Create row if missing (helper knows how to do the minimal insert)
    ensure_meeting_exists(db, meeting_id)

    # Attach to user's default team (idempotent)
    team_id = get_or_create_default_team(db, user.user_id)
    assign_meeting_team_if_empty(db, meeting_id, team_id)

    return MeetingCreateResp(id=meeting_id)

@router.patch("/meetings/{meeting_id}")
def update_meeting(
    meeting_id: str,
    payload: MeetingUpdateReq,
    user: UserContext = Depends(require_user),
    db: Session = Depends(get_db),
):
    """
    Update mutable fields on a meeting (currently just `name`).
    """
    # Ensure user can see this meeting
    _ = get_visible_meeting_or_404(db, user.user_id, meeting_id)

    new_name = (payload.name or "").strip() or None

    db.execute(
        text("UPDATE meeting SET name = :name WHERE id = :mid"),
        {"name": new_name, "mid": meeting_id},
    )
    db.commit()

    return {"id": meeting_id, "name": new_name}


@router.delete("/meetings/{meeting_id}", status_code=204)
def delete_meeting(
    meeting_id: str,
    user: UserContext = Depends(require_user),
    db: Session = Depends(get_db),
):
    """
    Hard-delete a meeting the user can see.

    Assumes your foreign keys (upload, transcript, summary, actions, etc.)
    either have ON DELETE CASCADE or are otherwise safe to remove.
    """
    # Enforce access (team membership, etc.)
    _ = get_visible_meeting_or_404(db, user.user_id, meeting_id)

    # Delete the meeting row itself
    db.execute(
        text("DELETE FROM meeting WHERE id = :mid"),
        {"mid": meeting_id},
    )
    db.commit()

    # 204 No Content
    return Response(status_code=204)
