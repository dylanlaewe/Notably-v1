# backend/app/access.py
from __future__ import annotations
from typing import Optional
from fastapi import HTTPException
from sqlalchemy import text, select, literal
from sqlalchemy.orm import Session
from sqlalchemy.ext.asyncio import AsyncSession
from uuid import UUID

from backend.app.models import Meeting, TeamMember, Upload

def _parse_uuid(s: str) -> UUID:
    return UUID(s)

def _table_exists(db: Session, table: str) -> bool:
    row = db.execute(
        text("select 1 from information_schema.tables where table_name=:t limit 1"),
        {"t": table},
    ).fetchone()
    return bool(row)

def _column_exists(db: Session, table: str, column: str) -> bool:
    row = db.execute(
        text("""
            select 1
            from information_schema.columns
            where table_name=:t and column_name=:c
            limit 1
        """),
        {"t": table, "c": column},
    ).fetchone()
    return bool(row)

def ensure_meeting_exists(db: Session, meeting_id: str) -> None:
    """
    Create a minimal meeting row if missing so access checks don’t 404.
    Safe and idempotent.
    """
    # ensure table/column exist (no-op if already created by team_schema)
    db.execute(text("""
        create table if not exists meeting (
          id uuid primary key,
          team_id uuid null,
          created_at timestamptz not null default now()
        )
    """))
    # team_id FK is optional here; team_schema adds the FK/indexes.
    db.execute(
        text("insert into meeting(id) values (:mid) on conflict (id) do nothing"),
        {"mid": meeting_id},
    )
    db.commit()

def _get_meeting_team_id(db: Session, meeting_id: str) -> Optional[str]:
    """
    Return team_id for meeting, or None if (a) table/column missing OR (b) row missing.
    Returning None makes the guard a no-op for legacy/unassigned meetings.
    """
    if not _table_exists(db, "meeting"):
        return None
    if not _column_exists(db, "meeting", "team_id"):
        return None
    row = db.execute(
        text("select team_id from meeting where id=:mid limit 1"),
        {"mid": meeting_id},
    ).fetchone()
    if not row:
        return None
    return row[0]  # may be None

def assert_user_can_access_meeting(db: Session, user_id: str, meeting_id: str) -> None:
    """
    Enforce team membership *only if* meeting.team_id is present.
    Otherwise, allow (back-compat) so endpoints don’t 404 before a meeting row exists.
    """
    team_id = _get_meeting_team_id(db, meeting_id)
    if team_id is None:
        return  # legacy/unassigned meeting → allow

    if not _table_exists(db, "team_member"):
        return

    row = db.execute(
        text("""
            select 1
            from team_member
            where team_id=:tid and user_id=:uid
            limit 1
        """),
        {"tid": team_id, "uid": user_id},
    ).fetchone()
    if not row:
        raise HTTPException(status_code=403, detail="Forbidden: not a team member")

def assign_meeting_team_if_empty(db: Session, meeting_id: str, team_id: str) -> None:
    if not _table_exists(db, "meeting") or not _column_exists(db, "meeting", "team_id"):
        return
    db.execute(
        text("update meeting set team_id=:tid where id=:mid and team_id is null"),
        {"tid": team_id, "mid": meeting_id},
    )
    db.commit()

async def get_visible_meeting_or_404(db: AsyncSession, user_id: UUID, meeting_id: str) -> Meeting:
    try:
        mid = _parse_uuid(meeting_id)
    except Exception:
        raise HTTPException(status_code=422, detail="invalid_meeting_id")

    meeting = await db.scalar(select(Meeting).where(Meeting.id == mid))
    if meeting is None:
        raise HTTPException(status_code=404, detail="meeting_not_found")

    allowed = await db.scalar(
        select(literal(True)).select_from(TeamMember).where(
            TeamMember.team_id == meeting.team_id,
            TeamMember.user_id == user_id,
        ).limit(1)
    )
    if not allowed:
        # Invisible across teams
        raise HTTPException(status_code=404, detail="meeting_not_found")

    return meeting

async def get_visible_upload_or_404(db: AsyncSession, user_id: UUID, upload_id: str) -> Upload:
    try:
        uid = _parse_uuid(upload_id)
    except Exception:
        raise HTTPException(status_code=422, detail="invalid_upload_id")

    upload = await db.scalar(select(Upload).where(Upload.id == uid))
    if upload is None:
        raise HTTPException(status_code=404, detail="upload_not_found")

    # join upload -> meeting -> team_member
    meeting = await db.scalar(select(Meeting).where(Meeting.id == upload.meeting_id))
    if meeting is None:
        raise HTTPException(status_code=404, detail="meeting_not_found")

    allowed = await db.scalar(
        select(literal(True)).select_from(TeamMember).where(
            TeamMember.team_id == meeting.team_id,
            TeamMember.user_id == user_id,
        ).limit(1)
    )
    if not allowed:
        raise HTTPException(status_code=404, detail="upload_not_found")

    return upload