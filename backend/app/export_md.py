# backend/app/export_md.py
from __future__ import annotations

from typing import List
from sqlalchemy.orm import Session

from .models import (
    Summary,
    SummaryBullet,
    BulletCitation,
    Transcript,
    TranscriptSegment,
    Upload,
)

def _format_time_s(v) -> str:
    """Format seconds as M:SS for readability."""
    try:
        secs = float(v or 0.0)
    except Exception:
        secs = 0.0
    m = int(secs // 60)
    s = int(round(secs - m * 60))
    return f"{m}:{s:02d}"

def _get_latest_transcript_for_meeting(db: Session, meeting_id: str) -> Transcript | None:
    """
    Match the helper you already use elsewhere:
    pick the latest Transcript whose Upload.meeting_id = meeting_id.
    """
    return (
        db.query(Transcript)
        .join(Upload, Upload.id == Transcript.upload_id)
        .filter(Upload.meeting_id == meeting_id)
        .order_by(Transcript.id.desc())
        .first()
    )

def _get_latest_summary_for_meeting(db: Session, meeting_id: str) -> Summary | None:
    return (
        db.query(Summary)
        .filter(Summary.meeting_id == meeting_id)
        .order_by(Summary.id.desc())
        .first()
    )

def render_meeting_markdown(db: Session, meeting_id: str) -> bytes | None:
    """
    Build a simple markdown export for a meeting.
    Returns UTF-8 bytes or None if there's nothing to export.
    """
    lines: List[str] = []

    # Header
    lines.append(f"# Meeting {meeting_id}")
    lines.append("")

    # --- Summary ---
    summary = _get_latest_summary_for_meeting(db, meeting_id)
    if summary:
        lines.append("## Summary")
        lines.append("")
        bullets: List[SummaryBullet] = (
            db.query(SummaryBullet)
            .filter(SummaryBullet.summary_id == summary.id)
            .order_by(SummaryBullet.id.asc())
            .all()
        )

        for b in bullets:
            text = (b.text or "").strip()
            if not text:
                continue

            # Collect citations as [M:SS–M:SS]
            cites: List[BulletCitation] = (
                db.query(BulletCitation)
                .filter(BulletCitation.summary_bullet_id == b.id)
                .all()
            )
            if cites:
                # Grab the earliest/ latest segment times for this bullet
                seg_ids = [c.segment_id for c in cites]
                segs: List[TranscriptSegment] = (
                    db.query(TranscriptSegment)
                    .filter(TranscriptSegment.id.in_(seg_ids))
                    .all()
                )
                if segs:
                    t_start = min(float(s.t_start or 0.0) for s in segs)
                    t_end = max(float(s.t_end or 0.0) for s in segs)
                    lines.append(
                        f"- {text} _(cites { _format_time_s(t_start) }–{ _format_time_s(t_end) })_"
                    )
                    continue

            # Fallback: no timing info
            lines.append(f"- {text}")

        lines.append("")

    # --- Transcript ---
    t = _get_latest_transcript_for_meeting(db, meeting_id)
    if t:
        lines.append("## Transcript")
        lines.append("")
        segs: List[TranscriptSegment] = (
            db.query(TranscriptSegment)
            .filter(TranscriptSegment.transcript_id == t.id)
            .order_by(TranscriptSegment.id.asc())
            .all()
        )
        for s in segs:
            ts = _format_time_s(s.t_start)
            te = _format_time_s(s.t_end)
            text = s.text or ""
            lines.append(f"- [{ts}–{te}] {text}")
        lines.append("")

    # If we only wrote the header and nothing else, treat as empty.
    body = "\n".join(lines).strip()
    if not body:
        return None
    return (body + "\n").encode("utf-8")
