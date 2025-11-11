# backend/app/team_ops.py
from __future__ import annotations
import uuid
from typing import List, Dict
from sqlalchemy import text
from sqlalchemy.orm import Session

def get_or_create_default_team(db: Session, user_id: str) -> str:
    """
    Return a team_id the user belongs to. If none, create a personal team and add them as owner.
    """
    row = db.execute(
        text("select team_id from team_member where user_id = :uid limit 1"),
        {"uid": user_id},
    ).fetchone()
    if row:
        return row[0]

    team_id = str(uuid.uuid4())
    db.execute(
        text("insert into team(id, name) values (:id, :name)"),
        {"id": team_id, "name": "Personal Team"},
    )
    db.execute(
        text("insert into team_member(team_id, user_id, role) values (:tid, :uid, 'owner')"),
        {"tid": team_id, "uid": user_id},
    )
    db.commit()
    return team_id


def list_user_teams(db: Session, user_id: str) -> List[Dict]:
    rows = db.execute(
        text("""
            select t.id, t.name, tm.role, t.created_at
            from team t
            join team_member tm on tm.team_id = t.id
            where tm.user_id = :uid
            order by t.created_at desc
        """),
        {"uid": user_id},
    ).fetchall()
    return [
        {"id": r[0], "name": r[1], "role": r[2], "created_at": r[3].isoformat()}
        for r in rows
    ]
