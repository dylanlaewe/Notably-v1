# backend/app/api/v1/teams.py
from __future__ import annotations
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from backend.app.db import SessionLocal
from backend.app.auth import require_user, UserContext
from backend.app.team_schema import ensure_team_schema
from backend.app.team_ops import get_or_create_default_team, list_user_teams
from backend.app.access import assign_meeting_team_if_empty

router = APIRouter(prefix="/v1", tags=["teams"])

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

@router.get("/teams")
def teams_index(
    user: UserContext = Depends(require_user),
    db: Session = Depends(get_db),
):
    ensure_team_schema(db)
    items = list_user_teams(db, user.user_id)
    return {"total": len(items), "items": items}


@router.post("/teams/dev_bootstrap")
def dev_bootstrap(
    meeting_id: str | None = Query(default=None, description="Optional meeting to assign"),
    user: UserContext = Depends(require_user),
    db: Session = Depends(get_db),
):
    """
    Dev convenience: ensure schema, ensure the caller has a team, and (optionally) assign a meeting to it.
    Safe to call repeatedly.
    """
    ensure_team_schema(db)
    team_id = get_or_create_default_team(db, user.user_id)
    assigned = False
    if meeting_id:
        assign_meeting_team_if_empty(db, meeting_id, team_id)
        assigned = True
    return {"team_id": team_id, "assigned_meeting": assigned}
