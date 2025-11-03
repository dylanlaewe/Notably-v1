from __future__ import annotations

import io
from typing import List

from .db import SessionLocal  # not used here but kept for parity
from .models import Upload, Transcript, TranscriptSegment, Summary

def _try_import_reportlab():
    try:
        from reportlab.lib.pagesizes import LETTER
        from reportlab.pdfgen import canvas
        from reportlab.lib.units import inch
        return LETTER, canvas, inch
    except Exception as e:
        raise ImportError(f"reportlab missing: {e}")

def render_meeting_pdf(db, meeting_id: str) -> bytes:
    """
    Build a very simple PDF:
      - Title: Meeting <id>
      - Transcript segments (t_start–t_end text)
      - Summary bullets
    Returns PDF bytes or raises ImportError if reportlab is missing.
    """
    LETTER, canvas, inch = _try_import_reportlab()

    # Latest transcript for this meeting
    t = (
        db.query(Transcript)
        .join(Upload, Upload.id == Transcript.upload_id)
        .filter(Upload.meeting_id == meeting_id)
        .order_by(Transcript.id.desc())  # id is fine; created_at if you added it
        .first()
    )
    segments: List[TranscriptSegment] = []
    if t:
        segments = (
            db.query(TranscriptSegment)
            .filter(TranscriptSegment.transcript_id == t.id)
            .order_by(TranscriptSegment.t_start.asc(), TranscriptSegment.id.asc())
            .all()
        )

    # Latest summary for this meeting
    summary = (
        db.query(Summary)
        .filter(Summary.meeting_id == meeting_id)
        .order_by(Summary.id.desc())
        .first()
    )
    bullets = list(summary.bullets) if summary else []

    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=LETTER)
    width, height = LETTER
    margin = 0.75 * inch
    y = height - margin

    def write(line: str, *, bold: bool = False, size: int = 11):
        nonlocal y
        if y < margin:
            c.showPage()
            y = height - margin
        c.setFont("Helvetica-Bold" if bold else "Helvetica", size)
        # naive wrap: hard-truncate long lines so we keep this tiny
        c.drawString(margin, y, line[:110])
        y -= 14

    write(f"Meeting {meeting_id}", bold=True, size=13)
    y -= 6

    if segments:
        write("Transcript", bold=True)
        for s in segments[:200]:
            t0 = float(s.t_start or 0.0)
            t1 = float(s.t_end or 0.0)
            write(f"[{t0:.1f}–{t1:.1f}] {s.text or ''}")

    if bullets:
        y -= 6
        write("Summary bullets", bold=True)
        for b in bullets[:100]:
            write(f"• {b.text or ''}")

    c.showPage()
    c.save()
    return buf.getvalue()
