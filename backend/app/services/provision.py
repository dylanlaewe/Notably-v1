from __future__ import annotations
from typing import Optional
from uuid import uuid4
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

# Adjust these imports/names to your actual models if they differ:
from backend.app.models import User, Team, TeamMember  # noqa: F401

async def ensure_user_and_personal_team(
    db: AsyncSession,
    *,
    auth_sub: str,
    email: Optional[str],
    name: Optional[str],
):
    """
    Idempotently ensure a User exists keyed by external subject (auth_sub),
    and that they have a personal Team with membership.
    Returns the User row.
    """
    # 1) find/create user by external subject
    user = await db.scalar(select(User).where(User.auth_sub == auth_sub))
    if not user:
        user = User(
            id=uuid4(),              # drop if your model autogenerates
            auth_sub=auth_sub,       # add a unique index later via Alembic
            email=email,
            name=name,
        )
        db.add(user)
        await db.flush()

    # 2) ensure a personal team exists (adapt fields to your schema)
    team = await db.scalar(select(Team).where(Team.owner_user_id == user.id))
    if not team:
        team = Team(
            id=uuid4(),
            name=(name or email or "Personal Team"),
            owner_user_id=user.id,
            is_personal=True,        # omit if you don’t have this column
        )
        db.add(team)
        await db.flush()

    # 3) ensure membership
    membership = await db.scalar(
        select(TeamMember).where(
            TeamMember.team_id == team.id,
            TeamMember.user_id == user.id,
        )
    )
    if not membership:
        db.add(TeamMember(team_id=team.id, user_id=user.id))
        await db.flush()

    return user
