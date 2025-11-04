from __future__ import annotations

import os
import uuid
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Body, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import text

from ...db import SessionLocal

router = APIRouter(prefix="/v1", tags=["actions"])

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
    line = f"[actions] {msg}"
    print(line, flush=True)
    if _LOG_FH:
        try:
            _LOG_FH.write(line + "\n")
        except Exception:
            pass

def _uuid() -> str:
    return str(uuid.uuid4())

def _format_ts(dt) -> Optional[str]:
    return dt.isoformat() if dt else None

def _format_time_s(sec: float | int | None) -> str:
    if sec is None:
        return "0:00"
    s = int(round(float(sec)))
    h, r = divmod(s, 3600)
    m, s2 = divmod(r, 60)
    if h:
        return f"{h}:{m:02d}:{s2:02d}"
    return f"{m}:{s2:02d}"

# ---------------------------
# Idempotent schema (namespaced to avoid collisions)
# ---------------------------
DDL = """
create table if not exists notably_action_item (
  id uuid primary key,
  meeting_id text not null,
  text text not null,
  is_done boolean not null default false,
  priority smallint,
  assignee text,
  due_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists notably_action_citation (
  id uuid primary key,
  action_id uuid not null references notably_action_item(id) on delete cascade,
  segment_id integer not null references transcript_segment(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique(action_id, segment_id)
);

create index if not exists idx_nb_action_meeting on notably_action_item (meeting_id);
create index if not exists idx_nb_action_open on notably_action_item (is_done);
create index if not exists idx_nb_action_due on notably_action_item (due_at);
create index if not exists idx_nb_action_cite_action on notably_action_citation (action_id);
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

# ---------------------------
# Helpers
# ---------------------------
def _row_to_action_dict(r: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "id": str(r["id"]),
        "meeting_id": r["meeting_id"],
        "text": r["text"],
        "is_done": bool(r["is_done"]),
        "priority": r.get("priority"),
        "assignee": r.get("assignee"),
        "due_at": _format_ts(r.get("due_at")),
        "created_at": _format_ts(r.get("created_at")),
        "updated_at": _format_ts(r.get("updated_at")),
    }

def _citations_for_action(db: Session, action_id: str) -> List[Dict[str, Any]]:
    rows = db.execute(
        text(
            """
            select
              c.segment_id,
              ts.t_start, ts.t_end
            from notably_action_citation c
            join transcript_segment ts on ts.id = c.segment_id
            where c.action_id = :aid
            order by ts.t_start asc
            """
        ),
        {"aid": action_id},
    ).mappings().all()
    out: List[Dict[str, Any]] = []
    for r in rows:
        t0 = float(r["t_start"]) if r["t_start"] is not None else 0.0
        t1 = float(r["t_end"]) if r["t_end"] is not None else 0.0
        out.append(
            {
                "segment_id": int(r["segment_id"]),
                "t_start": t0,
                "t_end": t1,
                "t_start_str": _format_time_s(t0),
                "t_end_str": _format_time_s(t1),
            }
        )
    return out

def _validate_segments_belong_to_meeting(db: Session, meeting_id: str, segment_ids: List[int]) -> None:
    if not segment_ids:
        return
    rows = db.execute(
        text(
            """
            select ts.id
            from transcript_segment ts
            join transcript t on t.id = ts.transcript_id
            join upload u on u.id = t.upload_id
            where u.meeting_id = :mid and ts.id = any(:seg_ids)
            """
        ),
        {"mid": meeting_id, "seg_ids": segment_ids},
    ).mappings().all()
    ok_ids = {int(r["id"]) for r in rows}
    missing = [sid for sid in segment_ids if sid not in ok_ids]
    if missing:
        raise HTTPException(
            status_code=400,
            detail=f"These segment_ids don't belong to meeting {meeting_id}: {missing}",
        )

def _attach_citations(db: Session, action_id: str, segment_ids: List[int]) -> int:
    inserted = 0
    for sid in segment_ids:
        row = db.execute(
            text(
                """
                insert into notably_action_citation (id, action_id, segment_id)
                values (:id, :aid, :sid)
                on conflict (action_id, segment_id) do nothing
                returning id
                """
            ),
            {"id": _uuid(), "aid": action_id, "sid": int(sid)},
        ).mappings().first()
        if row:
            inserted += 1
    return inserted

# ---------------------------
# Endpoints
# ---------------------------

@router.get("/meetings/{meeting_id}/actions")
def list_actions_for_meeting(
    meeting_id: str,
    only_open: bool = Query(False, description="If true, only return is_done = false"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    order: str = Query("created_at_desc", description="created_at_desc|created_at_asc|due_at_asc|due_at_desc"),
):
    """
    List action items for a meeting with optional 'only_open' filter and ordering.
    Includes timestamp citations (segment_id + t_start/t_end strings).
    """
    db = SessionLocal()
    try:
        _ensure_tables(db)
        where = "where a.meeting_id = :mid"
        if only_open:
            where += " and a.is_done = false"

        if order not in {"created_at_desc", "created_at_asc", "due_at_asc", "due_at_desc"}:
            order = "created_at_desc"
        if order == "created_at_asc":
            order_clause = "order by a.created_at asc"
        elif order == "due_at_asc":
            order_clause = "order by a.due_at asc nulls last"
        elif order == "due_at_desc":
            order_clause = "order by a.due_at desc nulls last"
        else:
            order_clause = "order by a.created_at desc"

        total = db.execute(
            text(f"select count(1) as c from notably_action_item a {where}"),
            {"mid": meeting_id},
        ).mappings().first()
        total_count = int(total["c"] if total and total["c"] is not None else 0)

        rows = db.execute(
            text(
                f"""
                select
                  a.id, a.meeting_id, a.text, a.is_done, a.priority, a.assignee,
                  a.due_at, a.created_at, a.updated_at
                from notably_action_item a
                {where}
                {order_clause}
                limit :limit offset :offset
                """
            ),
            {"mid": meeting_id, "limit": limit, "offset": offset},
        ).mappings().all()

        items: List[Dict[str, Any]] = []
        for r in rows:
            base = _row_to_action_dict(dict(r))
            base["citations"] = _citations_for_action(db, base["id"])
            items.append(base)

        _log(f"list actions meeting={meeting_id} only_open={only_open} -> {len(items)}/{total_count}")
        return {"meeting_id": meeting_id, "total": total_count, "limit": limit, "offset": offset, "order": order, "items": items}
    finally:
        db.close()


@router.post("/meetings/{meeting_id}/actions")
def create_action_for_meeting(
    meeting_id: str,
    payload: Dict[str, Any] = Body(
        ...,
        description="Body: { text, due_at?, assignee?, priority?, citations?: [segment_id, ...] }",
    ),
):
    """
    Create an action item for a meeting. Optionally attach timestamp citations.
    """
    db = SessionLocal()
    try:
        _ensure_tables(db)

        text_val = (payload.get("text") or "").strip()
        if not text_val:
            raise HTTPException(status_code=400, detail="Missing 'text'")

        due_at = payload.get("due_at")   # ISO timestamp or null
        assignee = payload.get("assignee")
        priority = payload.get("priority")
        citations = payload.get("citations") or []
        if not isinstance(citations, list):
            raise HTTPException(status_code=400, detail="'citations' must be a list of segment_id integers")

        seg_ids = [int(s) for s in citations] if citations else []
        _validate_segments_belong_to_meeting(db, meeting_id, seg_ids)

        aid = _uuid()
        row = db.execute(
            text(
                """
                insert into notably_action_item
                  (id, meeting_id, text, is_done, priority, assignee, due_at)
                values
                  (:id, :mid, :txt, false, :prio, :asg, :due)
                returning id, meeting_id, text, is_done, priority, assignee, due_at, created_at, updated_at
                """
            ),
            {"id": aid, "mid": meeting_id, "txt": text_val, "prio": priority, "asg": assignee, "due": due_at},
        ).mappings().first()

        added = _attach_citations(db, aid, seg_ids)
        db.commit()

        base = _row_to_action_dict(dict(row))
        base["citations"] = _citations_for_action(db, base["id"])
        _log(f"create action meeting={meeting_id} citations_added={added}")
        return base
    finally:
        db.close()


@router.patch("/actions/{action_id}")
def update_action(
    action_id: str,
    payload: Dict[str, Any] = Body(
        ...,
        description="Any of: { text?, is_done?, due_at?, assignee?, priority? }",
    ),
):
    """
    Update mutable fields and bump updated_at.
    """
    db = SessionLocal()
    try:
        _ensure_tables(db)

        fields = []
        params: Dict[str, Any] = {"id": action_id}

        if "text" in payload:
            txt = (payload.get("text") or "").strip()
            if not txt:
                raise HTTPException(status_code=400, detail="If provided, 'text' cannot be empty")
            fields.append("text = :txt")
            params["txt"] = txt
        if "is_done" in payload:
            fields.append("is_done = :done")
            params["done"] = bool(payload.get("is_done"))
        if "due_at" in payload:
            fields.append("due_at = :due")
            params["due"] = payload.get("due_at")  # ISO string or null
        if "assignee" in payload:
            fields.append("assignee = :asg")
            params["asg"] = payload.get("assignee")
        if "priority" in payload:
            fields.append("priority = :prio")
            params["prio"] = payload.get("priority")

        if not fields:
            raise HTTPException(status_code=400, detail="No updatable fields provided")

        fields.append("updated_at = now()")
        set_clause = ", ".join(fields)

        row = db.execute(
            text(
                f"""
                update notably_action_item
                   set {set_clause}
                 where id = :id
                returning id, meeting_id, text, is_done, priority, assignee, due_at, created_at, updated_at
                """
            ),
            params,
        ).mappings().first()

        if not row:
            raise HTTPException(status_code=404, detail="Action not found")

        db.commit()

        base = _row_to_action_dict(dict(row))
        base["citations"] = _citations_for_action(db, base["id"])
        _log(f"update action id={action_id}")
        return base
    finally:
        db.close()


@router.delete("/actions/{action_id}")
def delete_action(action_id: str):
    """
    Delete an action item (citations cascade).
    """
    db = SessionLocal()
    try:
        _ensure_tables(db)
        row = db.execute(
            text("delete from notably_action_item where id = :id returning id"),
            {"id": action_id},
        ).mappings().first()
        db.commit()
        if not row:
            raise HTTPException(status_code=404, detail="Action not found")
        _log(f"delete action id={action_id}")
        return {"deleted": True, "id": action_id}
    finally:
        db.close()


@router.post("/actions/{action_id}/citations")
def add_action_citation(
    action_id: str,
    payload: Dict[str, Any] = Body(..., description="Body: { segment_id }"),
):
    """
    Attach a single transcript segment as a citation to an action.
    Validates that the segment belongs to the same meeting as the action.
    """
    db = SessionLocal()
    try:
        _ensure_tables(db)

        # Fetch action + meeting
        a = db.execute(
            text("select id, meeting_id from notably_action_item where id = :id"),
            {"id": action_id},
        ).mappings().first()
        if not a:
            raise HTTPException(status_code=404, detail="Action not found")
        meeting_id = a["meeting_id"]

        seg_id = int(payload.get("segment_id", 0))
        if not seg_id:
            raise HTTPException(status_code=400, detail="Missing or invalid 'segment_id'")

        _validate_segments_belong_to_meeting(db, meeting_id, [seg_id])
        _attach_citations(db, action_id, [seg_id])
        db.commit()

        return {"action_id": action_id, "citations": _citations_for_action(db, action_id)}
    finally:
        db.close()


@router.delete("/actions/{action_id}/citations/{segment_id}")
def remove_action_citation(action_id: str, segment_id: int):
    """
    Detach a single citation (no error if it wasn't attached).
    """
    db = SessionLocal()
    try:
        _ensure_tables(db)
        db.execute(
            text(
                "delete from notably_action_citation where action_id = :aid and segment_id = :sid"
            ),
            {"aid": action_id, "sid": int(segment_id)},
        )
        db.commit()
        return {"action_id": action_id, "segment_id": int(segment_id), "detached": True}
    finally:
        db.close()


@router.get("/actions")
def list_actions_global(
    meeting_id: Optional[str] = Query(None),
    only_open: bool = Query(False),
    q: Optional[str] = Query(None, description="Simple ILIKE filter on text"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    order: str = Query("created_at_desc"),
):
    """
    Global listing of actions with optional filters.
    """
    db = SessionLocal()
    try:
        _ensure_tables(db)

        where = ["1=1"]
        params: Dict[str, Any] = {}

        if meeting_id:
            where.append("a.meeting_id = :mid")
            params["mid"] = meeting_id
        if only_open:
            where.append("a.is_done = false")
        if q:
            where.append("a.text ilike :q")
            params["q"] = f"%{q}%"

        if order not in {"created_at_desc", "created_at_asc", "due_at_asc", "due_at_desc"}:
            order = "created_at_desc"
        if order == "created_at_asc":
            order_clause = "order by a.created_at asc"
        elif order == "due_at_asc":
            order_clause = "order by a.due_at asc nulls last"
        elif order == "due_at_desc":
            order_clause = "order by a.due_at desc nulls last"
        else:
            order_clause = "order by a.created_at desc"

        where_sql = " where " + " and ".join(where)

        total = db.execute(
            text(f"select count(1) as c from notably_action_item a {where_sql}"),
            params,
        ).mappings().first()
        total_count = int(total["c"] if total and total["c"] is not None else 0)

        rows = db.execute(
            text(
                f"""
                select
                  a.id, a.meeting_id, a.text, a.is_done, a.priority, a.assignee,
                  a.due_at, a.created_at, a.updated_at
                from notably_action_item a
                {where_sql}
                {order_clause}
                limit :limit offset :offset
                """
            ),
            {**params, "limit": limit, "offset": offset},
        ).mappings().all()

        items: List[Dict[str, Any]] = []
        for r in rows:
            base = _row_to_action_dict(dict(r))
            base["citations"] = _citations_for_action(db, base["id"])
            items.append(base)

        return {"total": total_count, "limit": limit, "offset": offset, "order": order, "q": q, "meeting_id": meeting_id, "items": items}
    finally:
        db.close()
