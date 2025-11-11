# backend/app/team_schema.py
from __future__ import annotations
from sqlalchemy import text
from sqlalchemy.orm import Session

DDL = [
    # team
    """
    create table if not exists team (
      id uuid primary key,
      name text not null,
      created_at timestamptz not null default now()
    )
    """,
    # team_member
    """
    create table if not exists team_member (
      team_id uuid not null references team(id) on delete cascade,
      user_id uuid not null,
      role text not null check (role in ('owner','admin','member')),
      created_at timestamptz not null default now(),
      unique(team_id, user_id)
    )
    """,
    # meeting (minimal registry if you don't already have one)
    """
    create table if not exists meeting (
      id uuid primary key,
      team_id uuid null references team(id) on delete set null,
      created_at timestamptz not null default now()
    )
    """,
    # add team_id if meeting existed without it
    """
    alter table meeting
    add column if not exists team_id uuid null references team(id) on delete set null
    """,
    # helpful indexes
    "create index if not exists idx_team_member_user on team_member(user_id)",
    "create index if not exists idx_meeting_team on meeting(team_id)",
]

def ensure_team_schema(db: Session) -> None:
    for stmt in DDL:
        db.execute(text(stmt))
    db.commit()
