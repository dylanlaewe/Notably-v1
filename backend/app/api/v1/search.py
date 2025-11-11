from __future__ import annotations

import os
from typing import Any, Dict, List, Optional, Tuple, Iterable, Set

from fastapi import APIRouter, HTTPException, Query, Depends
from sqlalchemy import text
from sqlalchemy.orm import Session

from ...db import SessionLocal
from backend.app.auth import require_user, UserContext
from backend.app.access import assert_user_can_access_meeting

router = APIRouter(prefix="/v1", tags=["search"])

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# ------------- logging (same tee) -------------
_LOG_PATH = os.getenv("NOTABLY_LOG_FILE", "/tmp/notably_worker.log")
_LOG_FH = None
try:
    _LOG_FH = open(_LOG_PATH, "a", buffering=1, encoding="utf-8")
except Exception:
    _LOG_FH = None

def _log(msg: str) -> None:
    line = f"[search] {msg}"
    print(line, flush=True)
    if _LOG_FH:
        try:
            _LOG_FH.write(line + "\n")
        except Exception:
            pass

# ------------- small helpers -------------

def _lower(s: str) -> str:
    return (s or "").lower()

def _format_time_s(sec: float | int | None) -> str:
    if sec is None:
        return "0:00"
    s = int(round(float(sec)))
    h, r = divmod(s, 3600)
    m, s2 = divmod(r, 60)
    if h:
        return f"{h}:{m:02d}:{s2:02d}"
    return f"{m}:{s2:02d}"

def _snippet(text: str, needles: List[str], radius: int = 90) -> str:
    """Return a compact snippet around the first hit."""
    t = text or ""
    tl = t.lower()
    idx = -1
    for n in needles:
        n = n.lower()
        j = tl.find(n)
        if j != -1 and (idx == -1 or j < idx):
            idx = j
    if idx == -1:
        return t[:max(0, radius * 2)]
    start = max(0, idx - radius)
    end = min(len(t), idx + radius)
    left_ellipsis = "…" if start > 0 else ""
    right_ellipsis = "…" if end < len(t) else ""
    return f"{left_ellipsis}{t[start:end]}{right_ellipsis}"

# ------------- tag helpers (namespaced tables) -------------

def _expand_tag_ids(
    db: Session,
    tag_ids: Optional[Iterable[str]],
    tag_names: Optional[Iterable[str]],
) -> List[str]:
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
                text("select id from notably_tag where lower(name) = any(:names)"),
                {"names": names},
            ).mappings().all()
            for r in rows:
                ids.add(str(r["id"]))
    return list(ids)

def _meeting_ids_for_tags(db: Session, tag_uuid_list: List[str], mode: str) -> Set[str]:
    if not tag_uuid_list:
        return set()
    if mode.lower() == "all":
        rows = db.execute(
            text(
                """
                select target_id
                  from notably_tag_link
                 where target_kind='meeting'
                   and tag_id = any(:tag_ids)
                 group by target_id
                having count(distinct tag_id) >= :need
                """
            ),
            {"tag_ids": tag_uuid_list, "need": len(set(tag_uuid_list))},
        ).mappings().all()
        return {str(r["target_id"]) for r in rows}
    rows = db.execute(
        text(
            """
            select distinct target_id
              from notably_tag_link
             where target_kind='meeting'
               and tag_id = any(:tag_ids)
            """
        ),
        {"tag_ids": tag_uuid_list},
    ).mappings().all()
    return {str(r["target_id"]) for r in rows}

# ------------- query parsing -------------

class ParsedQuery:
    def __init__(self, must: List[str], any_terms: List[str], not_terms: List[str]):
        self.must = must
        self.any_terms = any_terms
        self.not_terms = not_terms

def _parse_query(q: str) -> ParsedQuery:
    """
    Simple parser:
    - quoted phrases kept intact: "upload pipeline"
    - -negated terms: -draft
    - everything else -> tokens
    """
    s = q.strip()
    if not s:
        return ParsedQuery([], [], [])
    tokens: List[str] = []
    buf = []
    in_quote = False
    i = 0
    while i < len(s):
        c = s[i]
        if c == '"':
            if in_quote:
                tokens.append("".join(buf).strip())
                buf = []
                in_quote = False
            else:
                if buf:
                    tokens.append("".join(buf).strip())
                    buf = []
                in_quote = True
        elif c.isspace() and not in_quote:
            if buf:
                tokens.append("".join(buf).strip())
                buf = []
        else:
            buf.append(c)
        i += 1
    if buf:
        tokens.append("".join(buf).strip())

    must: List[str] = []
    any_terms: List[str] = []
    not_terms: List[str] = []
    for t in tokens:
        if not t:
            continue
        if t.startswith("-") and len(t) > 1:
            not_terms.append(t[1:])
        else:
            must.append(t)
    return ParsedQuery(must, any_terms, not_terms)

def _terms_present(text: str, terms: List[str], mode: str) -> bool:
    tl = text.lower()
    if not terms:
        return True
    hits = [n.lower() in tl for n in terms]
    return any(hits) if mode == "any" else all(hits)

def _no_terms_present(text: str, terms: List[str]) -> bool:
    tl = text.lower()
    return all(n.lower() not in tl for n in terms)

def _score(text: str, terms: List[str]) -> int:
    tl = text.lower()
    return sum(tl.count(t.lower()) for t in terms)

# ------------- fetchers (coarse DB prefilters + Python scoring) -------------

def _prefilter_clause(terms: List[str]) -> Tuple[str, Dict[str, Any]]:
    """
    Build a coarse OR ilike prefilter to keep DB result sets reasonable.
    """
    if not terms:
        return "true", {}
    ors = []
    params: Dict[str, Any] = {}
    for i, t in enumerate(terms):
        p = f"t{i}"
        ors.append(f"({{COL}} ilike :{p})")
        params[p] = f"%{t}%"
    return "(" + " or ".join(ors) + ")", params

def _fetch_bullets(db: Session, meeting_ids: Optional[Set[str]], terms: List[str]) -> List[Dict[str, Any]]:
    where = ["1=1"]
    params: Dict[str, Any] = {}
    if meeting_ids is not None:
        where.append("s.meeting_id = any(:mids)")
        params["mids"] = list(meeting_ids)
    if terms:
        clause, p = _prefilter_clause(terms)
        where.append(clause.replace("{COL}", "sb.text"))
        params.update(p)

    rows = db.execute(
        text(
            f"""
            select sb.id as id, s.meeting_id as meeting_id, sb.text as text
              from summary_bullet sb
              join summary s on s.id = sb.summary_id
             where {' and '.join(where)}
             order by sb.id desc
             limit 500
            """
        ),
        params,
    ).mappings().all()

    out: List[Dict[str, Any]] = []
    for r in rows:
        out.append(
            {
                "kind": "bullet",
                "id": str(r["id"]),
                "meeting_id": r["meeting_id"],
                "text": r["text"],
            }
        )
    return out

def _fetch_segments(db: Session, meeting_ids: Optional[Set[str]], terms: List[str]) -> List[Dict[str, Any]]:
    where = ["1=1"]
    params: Dict[str, Any] = {}
    if meeting_ids is not None:
        where.append("u.meeting_id = any(:mids)")
        params["mids"] = list(meeting_ids)
    if terms:
        clause, p = _prefilter_clause(terms)
        where.append(clause.replace("{COL}", "ts.text"))
        params.update(p)

    rows = db.execute(
        text(
            f"""
            select ts.id as id, u.meeting_id as meeting_id, ts.text as text,
                   ts.t_start as t_start, ts.t_end as t_end
              from transcript_segment ts
              join transcript t on t.id = ts.transcript_id
              join upload u on u.id = t.upload_id
             where {' and '.join(where)}
             order by ts.t_start asc, ts.id asc
             limit 800
            """
        ),
        params,
    ).mappings().all()

    out: List[Dict[str, Any]] = []
    for r in rows:
        t0 = float(r["t_start"]) if r["t_start"] is not None else 0.0
        t1 = float(r["t_end"]) if r["t_end"] is not None else 0.0
        out.append(
            {
                "kind": "segment",
                "id": int(r["id"]),
                "meeting_id": r["meeting_id"],
                "text": r["text"],
                "t_start": t0,
                "t_end": t1,
                "t_start_str": _format_time_s(t0),
                "t_end_str": _format_time_s(t1),
            }
        )
    return out

def _fetch_actions(db: Session, meeting_ids: Optional[Set[str]], terms: List[str]) -> List[Dict[str, Any]]:
    # tables may not exist until first write; if missing, just return []
    try:
        db.execute(text("select 1 from notably_action_item limit 1"))
    except Exception:
        return []

    where = ["1=1"]
    params: Dict[str, Any] = {}
    if meeting_ids is not None:
        where.append("a.meeting_id = any(:mids)")
        params["mids"] = list(meeting_ids)
    if terms:
        clause, p = _prefilter_clause(terms)
        where.append(clause.replace("{COL}", "a.text"))
        params.update(p)

    rows = db.execute(
        text(
            f"""
            select a.id as id, a.meeting_id as meeting_id, a.text as text, a.is_done as is_done,
                   a.priority as priority, a.assignee as assignee, a.due_at as due_at
              from notably_action_item a
             where {' and '.join(where)}
             order by a.created_at desc
             limit 500
            """
        ),
        params,
    ).mappings().all()

    out: List[Dict[str, Any]] = []
    for r in rows:
        out.append(
            {
                "kind": "action",
                "id": str(r["id"]),
                "meeting_id": r["meeting_id"],
                "text": r["text"],
                "is_done": bool(r["is_done"]),
                "priority": r.get("priority"),
                "assignee": r.get("assignee"),
                "due_at": r.get("due_at").isoformat() if r.get("due_at") else None,
            }
        )
    return out

# ------------- endpoint -------------

@router.get("/search")
def search(
    q: str = Query(..., description='Query string; supports quotes for phrases and "-" for negation'),
    mode: str = Query("all", description="Match mode across terms: 'all' (default) or 'any'"),
    meeting_id: Optional[str] = Query(None),
    kind: Optional[List[str]] = Query(None, description="Repeatable: filter to 'segment'|'bullet'|'action'"),
    # optional tag filters
    tag_id: Optional[List[str]] = Query(None, description="Repeatable tag UUID"),
    tag_name: Optional[List[str]] = Query(None, description="Repeatable tag name (case-insensitive)"),
    tag_mode: str = Query("any", description="Tag match mode: 'any' or 'all'"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    order: str = Query("score_desc", description="score_desc (default) | time_asc | time_desc"),
):
    """
    Tokenized search over:
      - Summary bullets
      - Transcript segments
      - Action items

    Returns mixed items with a lightweight score and snippet.
    """
    if mode not in {"all", "any"}:
        mode = "all"
    if order not in {"score_desc", "time_asc", "time_desc"}:
        order = "score_desc"

    pq = _parse_query(q)
    if not pq.must and not pq.any_terms:
        raise HTTPException(status_code=400, detail="Empty query")

    kset = {k.lower() for k in (kind or [])}
    include_bullets = (not kset) or ("bullet" in kset)
    include_segments = (not kset) or ("segment" in kset)
    include_actions = (not kset) or ("action" in kset)

    db: Session = SessionLocal()
    try:
        # Resolve allowed meetings via tags
        resolved_tag_ids = _expand_tag_ids(db, tag_id, tag_name)
        allowed_meetings: Optional[Set[str]] = None
        if resolved_tag_ids:
            allowed_meetings = _meeting_ids_for_tags(db, resolved_tag_ids, tag_mode)
            if not allowed_meetings:
                return {"q": q, "mode": mode, "total": 0, "limit": limit, "offset": offset, "items": []}
        if meeting_id:
            if allowed_meetings is None:
                allowed_meetings = {meeting_id}
            else:
                # intersection
                allowed_meetings = {meeting_id} & allowed_meetings
                if not allowed_meetings:
                    return {"q": q, "mode": mode, "total": 0, "limit": limit, "offset": offset, "items": []}

        positive_terms = pq.must  # we treat "must" as our term list (phrases allowed)
        negative_terms = pq.not_terms

        candidates: List[Dict[str, Any]] = []

        if include_bullets:
            candidates.extend(_fetch_bullets(db, allowed_meetings, positive_terms))
        if include_segments:
            candidates.extend(_fetch_segments(db, allowed_meetings, positive_terms))
        if include_actions:
            candidates.extend(_fetch_actions(db, allowed_meetings, positive_terms))

        # Final filtering + scoring in Python for correctness (AND/ANY + NOT) and ranking
        results: List[Dict[str, Any]] = []
        for r in candidates:
            txt = r.get("text") or ""
            if not _no_terms_present(txt, negative_terms):
                continue
            if not _terms_present(txt, positive_terms, mode):
                continue

            sc = _score(txt, positive_terms)
            # small weights: bullets > actions > segments (tweakable)
            w = 3 if r["kind"] == "bullet" else 2 if r["kind"] == "action" else 1
            sc_weighted = sc * w

            out = dict(r)
            out["score"] = int(sc_weighted)
            out["snippet"] = _snippet(txt, positive_terms)
            results.append(out)

        # Ordering / pagination
        if order == "score_desc":
            results.sort(key=lambda x: (x.get("score", 0), x.get("kind") == "bullet"), reverse=True)
        else:
            # time ordering only makes sense for segments; others grouped arbitrarily
            def tkey(x: Dict[str, Any]) -> Tuple[int, float]:
                if x["kind"] == "segment":
                    return (0, float(x.get("t_start", 0.0)))
                return (1, 0.0)
            results.sort(key=tkey, reverse=(order == "time_desc"))

        total = len(results)
        page = results[offset: offset + limit]

        _log(f"q={q!r} mode={mode} kinds={sorted(list(kset)) or ['all']} → total={total}, returned={len(page)}")
        return {
            "q": q,
            "mode": mode,
            "limit": limit,
            "offset": offset,
            "order": order,
            "total": total,
            "items": page,
        }
    finally:
        db.close()
