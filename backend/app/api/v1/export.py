from __future__ import annotations

import io
import os
from typing import Any, Dict, List, Optional, Tuple

from fastapi import APIRouter, HTTPException, Query, Depends
from fastapi.responses import PlainTextResponse, StreamingResponse
from sqlalchemy import text
from sqlalchemy.orm import Session
from uuid import UUID
from ...db import SessionLocal
from backend.app.auth import require_user, UserContext
from backend.app.access import assert_user_can_access_meeting
from backend.app.access import get_visible_meeting_or_404

router = APIRouter(prefix="/v1", tags=["export"])

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

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
    line = f"[export] {msg}"
    print(line, flush=True)
    if _LOG_FH:
        try:
            _LOG_FH.write(line + "\n")
        except Exception:
            pass

# ---------------------------
# Helpers
# ---------------------------
def _format_time_s(s: float | int | None) -> str:
    if s is None:
        return "0:00"
    s = int(round(float(s)))
    h, rem = divmod(s, 3600)
    m, sec = divmod(rem, 60)
    if h:
        return f"{h}:{m:02d}:{sec:02d}"
    return f"{m}:{sec:02d}"

def _fetch_summary(db: Session, meeting_id: str) -> Tuple[Optional[str], List[Dict[str, Any]]]:
    # latest summary id for meeting
    sid_row = db.execute(
        text("""select id from summary where meeting_id = :mid order by id desc limit 1"""),
        {"mid": meeting_id},
    ).mappings().first()
    if not sid_row:
        return None, []

    sid = str(sid_row["id"])
    bullets = db.execute(
        text("""select id, text from summary_bullet where summary_id = :sid order by id asc"""),
        {"sid": sid},
    ).mappings().all()

    items: List[Dict[str, Any]] = []
    for b in bullets:
        bid = str(b["id"])
        cites = db.execute(
            text(
                """
                select ts.id as segment_id, ts.t_start, ts.t_end
                  from bullet_citation bc
                  join transcript_segment ts on ts.id = bc.segment_id
                 where bc.summary_bullet_id = :bid
                 order by ts.t_start asc
                """
            ),
            {"bid": bid},
        ).mappings().all()
        citations = []
        for c in cites:
            t0 = float(c["t_start"]) if c["t_start"] is not None else 0.0
            t1 = float(c["t_end"]) if c["t_end"] is not None else 0.0
            citations.append(
                {
                    "segment_id": int(c["segment_id"]),
                    "t_start": t0,
                    "t_end": t1,
                    "t_start_str": _format_time_s(t0),
                    "t_end_str": _format_time_s(t1),
                }
            )
        items.append({"id": bid, "text": b["text"], "citations": citations})
    return sid, items

def _fetch_transcript(db: Session, meeting_id: str) -> Tuple[Optional[str], List[Dict[str, Any]]]:
    # latest transcript for meeting (via upload linkage)
    row = db.execute(
        text(
            """
            select t.id
              from transcript t
              join upload u on u.id = t.upload_id
             where u.meeting_id = :mid
             order by t.id desc
             limit 1
            """
        ),
        {"mid": meeting_id},
    ).mappings().first()
    if not row:
        return None, []
    tid = str(row["id"])

    segs = db.execute(
        text(
            """
            select id, t_start, t_end, text
              from transcript_segment
             where transcript_id = :tid
             order by t_start asc, id asc
            """
        ),
        {"tid": tid},
    ).mappings().all()

    items = []
    for s in segs:
        t0 = float(s["t_start"]) if s["t_start"] is not None else 0.0
        t1 = float(s["t_end"]) if s["t_end"] is not None else 0.0
        items.append(
            {
                "id": int(s["id"]),
                "t_start": t0,
                "t_end": t1,
                "t_start_str": _format_time_s(t0),
                "t_end_str": _format_time_s(t1),
                "text": s["text"],
            }
        )
    return tid, items

def _fetch_actions(db: Session, meeting_id: str) -> List[Dict[str, Any]]:
    # namespaced MVP actions tables
    db.execute(text("select 1"))  # keep simple; tables are created on first write
    rows = db.execute(
        text(
            """
            select id, meeting_id, text, is_done, priority, assignee, due_at, created_at, updated_at
              from notably_action_item
             where meeting_id = :mid
             order by is_done asc, coalesce(due_at, now() + interval '100 years') asc, created_at asc
            """
        ),
        {"mid": meeting_id},
    ).mappings().all()

    out: List[Dict[str, Any]] = []
    for r in rows:
        aid = str(r["id"])
        cites = db.execute(
            text(
                """
                select ts.id as segment_id, ts.t_start, ts.t_end
                  from notably_action_citation c
                  join transcript_segment ts on ts.id = c.segment_id
                 where c.action_id = :aid
                 order by ts.t_start asc
                """
            ),
            {"aid": aid},
        ).mappings().all()
        citations = []
        for c in cites:
            t0 = float(c["t_start"]) if c["t_start"] is not None else 0.0
            t1 = float(c["t_end"]) if c["t_end"] is not None else 0.0
            citations.append(
                {
                    "segment_id": int(c["segment_id"]),
                    "t_start": t0,
                    "t_end": t1,
                    "t_start_str": _format_time_s(t0),
                    "t_end_str": _format_time_s(t1),
                }
            )
        out.append(
            {
                "id": aid,
                "text": r["text"],
                "is_done": bool(r["is_done"]),
                "priority": r.get("priority"),
                "assignee": r.get("assignee"),
                "due_at": r.get("due_at").isoformat() if r.get("due_at") else None,
                "citations": citations,
            }
        )
    return out

def _markdown_export(meeting_id: str, bullets: List[Dict[str, Any]], actions: List[Dict[str, Any]], segs: List[Dict[str, Any]]) -> str:
    lines: List[str] = []
    lines.append(f"# Meeting {meeting_id}")
    # Summary
    lines.append("## Summary")
    if not bullets:
        lines.append("_No summary yet._")
    else:
        for b in bullets:
            cite_str = ""
            if b["citations"]:
                windows = [f"{c['t_start_str']}–{c['t_end_str']}" for c in b["citations"]]
                cite_str = f" [{' , '.join(windows)}]"
            lines.append(f"- {b['text']}{cite_str}")

    # Action Items
    lines.append("\n## Action Items")
    if not actions:
        lines.append("_No action items yet._")
    else:
        open_items = [a for a in actions if not a["is_done"]]
        done_items = [a for a in actions if a["is_done"]]

        def fmt_action(a: Dict[str, Any]) -> str:
            box = "[x]" if a["is_done"] else "[ ]"
            meta_bits = []
            if a.get("assignee"):
                meta_bits.append(f"@{a['assignee']}")
            if a.get("priority") is not None:
                meta_bits.append(f"P{a['priority']}")
            if a.get("due_at"):
                meta_bits.append(f"due {a['due_at']}")
            meta = f" ({', '.join(meta_bits)})" if meta_bits else ""
            cites = ""
            if a["citations"]:
                windows = [f"{c['t_start_str']}–{c['t_end_str']}" for c in a["citations"]]
                cites = f" [{' , '.join(windows)}]"
            return f"- {box} {a['text']}{meta}{cites}"

        if open_items:
            lines.append("### Open")
            lines.extend(fmt_action(a) for a in open_items)
        if done_items:
            if open_items:
                lines.append("")  # spacer
            lines.append("### Completed")
            lines.extend(fmt_action(a) for a in done_items)

    # Transcript
    lines.append("\n## Transcript")
    if not segs:
        lines.append("_No transcript yet._")
    else:
        for s in segs:
            lines.append(f"- [{s['t_start_str']}] {s['text']}")

    return "\n".join(lines) + "\n"

def _pdf_export_bytes(meeting_id: str, bullets: List[Dict[str, Any]], actions: List[Dict[str, Any]], segs: List[Dict[str, Any]]) -> bytes:
    # late import so reportlab is optional during install
    from reportlab.lib.pagesizes import LETTER
    from reportlab.pdfgen import canvas

    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=LETTER)
    width, height = LETTER

    x_margin = 54
    y = height - 54
    line_h = 14

    def text(s: str, bold: bool=False):
        nonlocal y
        if y < 60:
            c.showPage()
            y = height - 54
        c.setFont("Helvetica-Bold" if bold else "Helvetica", 11 if not bold else 12)
        c.drawString(x_margin, y, s)
        y -= line_h

    # Title
    text(f"Meeting {meeting_id}", bold=True)

    # Summary
    text("", bold=False)
    text("Summary", bold=True)
    if not bullets:
        text("No summary yet.")
    else:
        for b in bullets:
            cite = ""
            if b["citations"]:
                windows = [f"{c['t_start_str']}-{c['t_end_str']}" for c in b["citations"]]
                cite = f"  [{' , '.join(windows)}]"
            text(f"• {b['text']}{cite}")

    # Actions
    text("", bold=False)
    text("Action Items", bold=True)
    if not actions:
        text("No action items yet.")
    else:
        open_items = [a for a in actions if not a["is_done"]]
        done_items = [a for a in actions if a["is_done"]]

        def draw_action(a: Dict[str, Any]):
            box = "☐" if not a["is_done"] else "☑"
            meta_bits = []
            if a.get("assignee"):
                meta_bits.append(f"@{a['assignee']}")
            if a.get("priority") is not None:
                meta_bits.append(f"P{a['priority']}")
            if a.get("due_at"):
                meta_bits.append(f"due {a['due_at']}")
            meta = f" ({', '.join(meta_bits)})" if meta_bits else ""
            cite = ""
            if a["citations"]:
                windows = [f"{c['t_start_str']}-{c['t_end_str']}" for c in a["citations"]]
                cite = f"  [{' , '.join(windows)}]"
            text(f"{box} {a['text']}{meta}{cite}")

        if open_items:
            text("Open", bold=True)
            for a in open_items:
                draw_action(a)
        if done_items:
            text("", bold=False)
            text("Completed", bold=True)
            for a in done_items:
                draw_action(a)

    # Transcript
    text("", bold=False)
    text("Transcript", bold=True)
    if not segs:
        text("No transcript yet.")
    else:
        for s in segs:
            text(f"[{s['t_start_str']}] {s['text']}")

    c.save()
    return buf.getvalue()

# ---------------------------
# Endpoints
# ---------------------------

@router.get("/meetings/{meeting_id}/export.md")
def export_md(
    meeting_id: str,
    filename: str | None = None,
    user: UserContext = Depends(require_user),
    db: Session = Depends(get_db)):
    _ = get_visible_meeting_or_404(db, user.user_id, meeting_id)

    try:
        sid, bullets = _fetch_summary(db, meeting_id)
        tid, segs = _fetch_transcript(db, meeting_id)
        actions = _fetch_actions(db, meeting_id)
        body = _markdown_export(meeting_id, bullets, actions, segs)
        headers = {}
        if filename:
            headers["Content-Disposition"] = f'attachment; filename="{filename}"'
        _log(f"export.md meeting={meeting_id} bullets={len(bullets)} actions={len(actions)} segs={len(segs)}")
        return PlainTextResponse(content=body, media_type="text/markdown; charset=utf-8", headers=headers)
    finally:
        db.close()

@router.get("/meetings/{meeting_id}/export.pdf")
def export_pdf(
    meeting_id: str,
    filename: str | None = None,
    user: UserContext = Depends(require_user),
    db: Session = Depends(get_db)):
    _ = get_visible_meeting_or_404(db, user.user_id, meeting_id)

    try:
        sid, bullets = _fetch_summary(db, meeting_id)
        tid, segs = _fetch_transcript(db, meeting_id)
        actions = _fetch_actions(db, meeting_id)
        pdf_bytes = _pdf_export_bytes(meeting_id, bullets, actions, segs)
        headers = {}
        out_name = filename or "meeting.pdf"
        headers["Content-Disposition"] = f'attachment; filename="{out_name}"'
        _log(f"export.pdf meeting={meeting_id} bullets={len(bullets)} actions={len(actions)} segs={len(segs)} bytes={len(pdf_bytes)}")
        return StreamingResponse(io.BytesIO(pdf_bytes), media_type="application/pdf", headers=headers)
    finally:
        db.close()

