from __future__ import annotations

import os
import re
import uuid
from typing import Optional, List, Dict, Any

from fastapi import APIRouter, HTTPException, Query, Body
from sqlalchemy.orm import Session
from sqlalchemy import text

from ...db import SessionLocal

router = APIRouter(prefix="/v1", tags=["tags"])

# ---------------------------------
# Logging (same tee as worker)
# ---------------------------------
_LOG_PATH = os.getenv("NOTABLY_LOG_FILE", "/tmp/notably_worker.log")
_LOG_FH = None
try:
    _LOG_FH = open(_LOG_PATH, "a", buffering=1, encoding="utf-8")
except Exception:
    _LOG_FH = None

def _log(msg: str) -> None:
    line = f"[tags] {msg}"
    print(line, flush=True)
    if _LOG_FH:
        try:
            _LOG_FH.write(line + "\n")
        except Exception:
            pass

# ---------------------------------
# Schema bootstrap (idempotent)
# Use namespaced tables to avoid collision with any existing "tag" table.
# ---------------------------------
DDL = """
create table if not exists notably_tag (
  id uuid primary key,
  name text not null unique,
  color text,
  created_at timestamptz not null default now()
);

create table if not exists notably_tag_link (
  id uuid primary key,
  tag_id uuid not null references notably_tag(id) on delete cascade,
  target_kind text not null check (target_kind in ('meeting','upload','bullet','segment')),
  target_id text not null,
  created_at timestamptz not null default now(),
  unique(tag_id, target_kind, target_id)
);

create index if not exists idx_nb_tag_name_lower on notably_tag (lower(name));
create index if not exists idx_nb_tag_link_target on notably_tag_link (target_kind, target_id);
"""

def _ensure_tables(db: Session) -> None:
    try:
        for stmt in [s.strip() for s in DDL.split(";") if s.strip()]:
            db.execute(text(stmt))
        db.commit()
    except Exception as e:
        db.rollback()
        _log(f"DDL error: {e}")
        raise

# ---------------------------------
# Helpers
# ---------------------------------
def _uuid() -> str:
    return str(uuid.uuid4())

def _normalize_name(name: str) -> str:
    return re.sub(r"\s+", " ", name.strip())

def _row_to_tag_dict(r: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "id": str(r.get("id")),
        "name": r.get("name"),
        "color": r.get("color"),
        "created_at": r.get("created_at").isoformat() if r.get("created_at") else None,
    }

def _get_or_create_tag(db: Session, name: str, color: Optional[str]) -> Dict[str, Any]:
    name = _normalize_name(name)
    if not name:
        raise HTTPException(status_code=400, detail="Tag name cannot be empty")

    row = db.execute(
        text(
            """
            insert into notably_tag (id, name, color)
            values (:id, :name, :color)
            on conflict (name) do update set
              color = coalesce(excluded.color, notably_tag.color)
            returning id, name, color, created_at
            """
        ),
        {"id": _uuid(), "name": name, "color": color},
    ).mappings().first()

    return _row_to_tag_dict(dict(row))

def _attach_tag(db: Session, tag_id: str, target_kind: str, target_id: str) -> Dict[str, Any]:
    row = db.execute(
        text(
            """
            insert into notably_tag_link (id, tag_id, target_kind, target_id)
            values (:id, :tag_id, :target_kind, :target_id)
            on conflict (tag_id, target_kind, target_id) do nothing
            returning id
            """
        ),
        {"id": _uuid(), "tag_id": tag_id, "target_kind": target_kind, "target_id": target_id},
    ).mappings().first()
    return {"linked": bool(row)}

# ---------------------------------
# Endpoints
# ---------------------------------

@router.get("/tags")
def list_tags(
    q: Optional[str] = Query(None, description="Filter by name (ILIKE)"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
):
    """
    List tags (from notably_tag) with optional substring filter and usage counts (across all target kinds).
    Returns JSON-safe primitives (ids as strings, datetimes as ISO strings).
    """
    db = SessionLocal()
    try:
        _ensure_tables(db)
        where = ""
        params: Dict[str, Any] = {}
        if q:
            where = "where lower(t.name) like :q"
            params["q"] = f"%{q.lower()}%"

        rows = db.execute(
            text(
                f"""
                select
                  t.id, t.name, t.color, t.created_at,
                  coalesce(count(l.id), 0) as usage_count
                from notably_tag t
                left join notably_tag_link l on l.tag_id = t.id
                {where}
                group by t.id, t.name, t.color, t.created_at
                order by lower(t.name) asc
                limit :limit offset :offset
                """
            ),
            {**params, "limit": limit, "offset": offset},
        ).mappings().all()

        items = []
        for r in rows:
            d = _row_to_tag_dict(dict(r))
            uc = r.get("usage_count", 0)
            d["usage_count"] = int(uc or 0)
            items.append(d)

        _log(f"list_tags q={q!r} count={len(items)}")
        return {"limit": limit, "offset": offset, "q": q, "items": items}
    finally:
        db.close()

@router.post("/tags")
def create_tag(payload: Dict[str, Any] = Body(...)):
    """
    Create (or fetch) a tag by name in notably_tag. Body: { "name": "...", "color": "#RRGGBB"? }
    Upserts by name; returns the tag.
    """
    db = SessionLocal()
    try:
        _ensure_tables(db)
        name = _normalize_name(str(payload.get("name", "")))
        color = payload.get("color")
        if not name:
            raise HTTPException(status_code=400, detail="Missing 'name'")
        tag = _get_or_create_tag(db, name, color)
        db.commit()
        return tag
    finally:
        db.close()

@router.get("/meetings/{meeting_id}/tags")
def get_meeting_tags(meeting_id: str):
    """
    List tags attached to a meeting (via notably_tag_link).
    """
    db = SessionLocal()
    try:
        _ensure_tables(db)
        rows = db.execute(
            text(
                """
                select t.id, t.name, t.color, t.created_at
                from notably_tag_link l
                join notably_tag t on t.id = l.tag_id
                where l.target_kind = 'meeting' and l.target_id = :mid
                order by lower(t.name) asc
                """
            ),
            {"mid": meeting_id},
        ).mappings().all()
        items = [_row_to_tag_dict(dict(r)) for r in rows]
        return {"meeting_id": meeting_id, "items": items}
    finally:
        db.close()

@router.post("/meetings/{meeting_id}/tags")
def attach_tag_to_meeting(
    meeting_id: str,
    payload: Dict[str, Any] = Body(..., description="Provide either {tag_id} or {name[, color]}"),
):
    """
    Attach a tag (from notably_tag) to a meeting via notably_tag_link. Body supports either:
      - { "tag_id": "..." }
      - { "name": "New Tag", "color": "#ff9900"? }  (auto-creates if needed)
    Idempotent—re-attaching is a no-op.
    """
    db = SessionLocal()
    try:
        _ensure_tables(db)

        tag_id: Optional[str] = payload.get("tag_id")
        name: Optional[str] = payload.get("name")
        color: Optional[str] = payload.get("color")

        if tag_id:
            row = db.execute(
                text("select id, name, color, created_at from notably_tag where id = :id"),
                {"id": tag_id},
            ).mappings().first()
            if not row:
                raise HTTPException(status_code=404, detail="Tag not found")
            tag = _row_to_tag_dict(dict(row))
        elif name:
            tag = _get_or_create_tag(db, name, color)
        else:
            raise HTTPException(status_code=400, detail="Provide 'tag_id' or 'name'")

        link = _attach_tag(db, tag["id"], "meeting", meeting_id)
        db.commit()
        return {"meeting_id": meeting_id, "tag": tag, "attached": link["linked"]}
    finally:
        db.close()

@router.delete("/meetings/{meeting_id}/tags/{tag_id}")
def detach_tag_from_meeting(meeting_id: str, tag_id: str):
    """
    Detach a tag from a meeting (no error if it wasn't attached).
    """
    db = SessionLocal()
    try:
        _ensure_tables(db)
        db.execute(
            text(
                """
                delete from notably_tag_link
                where target_kind = 'meeting' and target_id = :mid and tag_id = :tid
                """
            ),
            {"mid": meeting_id, "tid": tag_id},
        )
        db.commit()
        return {"meeting_id": meeting_id, "tag_id": tag_id, "detached": True}
    finally:
        db.close()

