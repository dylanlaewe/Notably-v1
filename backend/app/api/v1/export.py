from __future__ import annotations

from typing import List, Dict, Any
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import PlainTextResponse, Response
from sqlalchemy.orm import Session

from ...db import SessionLocal
from ...models import (
    Upload,
    Transcript,
    TranscriptSegment,
    Summary,
    SummaryBullet,
    BulletCitation,
)

import io
import os

router = APIRouter(prefix="/v1", tags=["export"])

# ---------------------------
# Logging
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


def _format_time_s(s: float | int | None) -> str:
    if s is None:
        return "0:00"
    s = int(round(float(s)))
    m, sec = divmod(s, 60)
    return f"{m}:{sec:02d}"


def _latest_transcript(db: Session, meeting_id: str) -> Transcript | None:
    return (
        db.query(Transcript)
        .join(Upload, Upload.id == Transcript.upload_id)
        .filter(Upload.meeting_id == meeting_id)
        .order_by(Transcript.id.desc())
        .first()
    )


def _latest_summary(db: Session, meeting_id: str) -> Summary | None:
    return (
        db.query(Summary)
        .filter(Summary.meeting_id == meeting_id)
        .order_by(Summary.id.desc())
        .first()
    )


# --------------------------------------------------------------------
# MARKDOWN EXPORT (kept from previous version)
# --------------------------------------------------------------------
@router.get("/meetings/{meeting_id}/export.md", response_class=PlainTextResponse)
def export_markdown(
    meeting_id: str,
    include_transcript: bool = Query(True),
    max_segments: int = Query(10000, ge=1, le=20000),
    filename: str | None = Query(None, description="Optional download filename"),
):
    """
    Export meeting summary (bullets with citations) and transcript to Markdown.
    """
    db = SessionLocal()
    try:
        t = _latest_transcript(db, meeting_id)
        s = _latest_summary(db, meeting_id)

        if not s and not t:
            raise HTTPException(status_code=404, detail="No summary or transcript for meeting")

        md: List[str] = []
        md.append(f"# Meeting {meeting_id}\n")

        # --- Summary section
        md.append("## Summary\n")
        if not s:
            md.append("_No summary found._\n")
        else:
            bullets: List[SummaryBullet] = (
                db.query(SummaryBullet)
                .filter(SummaryBullet.summary_id == str(s.id))
                .order_by(SummaryBullet.id.asc())
                .all()
            )

            for b in bullets:
                cites = (
                    db.query(BulletCitation, TranscriptSegment)
                    .join(TranscriptSegment, TranscriptSegment.id == BulletCitation.segment_id)
                    .filter(BulletCitation.summary_bullet_id == b.id)
                    .order_by(TranscriptSegment.t_start.asc())
                    .all()
                )
                stamps = []
                for (_, seg) in cites:
                    ts = _format_time_s(seg.t_start)
                    te = _format_time_s(seg.t_end)
                    if seg.t_end and float(seg.t_end or 0) > float(seg.t_start or 0):
                        stamps.append(f"[{ts}–{te}]")
                    else:
                        stamps.append(f"[{ts}]")
                stamps_str = " ".join(stamps) if stamps else ""
                text = (b.text or "").replace("\n", " ").strip()
                md.append(f"- {text} {stamps_str}".rstrip() + "\n")

        # --- Transcript section
        if include_transcript:
            md.append("\n## Transcript\n")
            if not t:
                md.append("_No transcript found._\n")
            else:
                segs = (
                    db.query(TranscriptSegment)
                    .filter(TranscriptSegment.transcript_id == t.id)
                    .order_by(TranscriptSegment.id.asc())
                    .limit(max_segments)
                    .all()
                )
                for sgm in segs:
                    ts = _format_time_s(sgm.t_start)
                    safe = (sgm.text or "").replace("\n", " ").strip()
                    md.append(f"- [{ts}] {safe}\n")

        body = "".join(md) or "# (empty)\n"

        headers = {}
        if filename:
            headers["Content-Disposition"] = f'attachment; filename="{filename}"'
        return PlainTextResponse(content=body, media_type="text/markdown", headers=headers)
    finally:
        db.close()


# --------------------------------------------------------------------
# PDF EXPORT
# --------------------------------------------------------------------
# Requires: pip install reportlab
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, ListFlowable, ListItem, PageBreak
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.units import inch

def _pdf_story_for_meeting(db: Session, meeting_id: str, include_transcript: bool, max_segments: int) -> List:
    """
    Build a ReportLab story (flowables) for the requested meeting.
    """
    styles = getSampleStyleSheet()
    # Tweak styles for a clean, modern look
    title = ParagraphStyle(
        "TitleCustom",
        parent=styles["Title"],
        fontName="Helvetica-Bold",
        fontSize=20,
        leading=24,
        alignment=TA_LEFT,
        spaceAfter=12,
    )
    h2 = ParagraphStyle(
        "H2",
        parent=styles["Heading2"],
        fontName="Helvetica-Bold",
        fontSize=14,
        leading=18,
        spaceBefore=6,
        spaceAfter=6,
    )
    body = ParagraphStyle(
        "Body",
        parent=styles["BodyText"],
        fontName="Helvetica",
        fontSize=10.5,
        leading=14,
    )

    story: List = []
    story.append(Paragraph(f"Meeting {meeting_id}", title))
    story.append(Spacer(1, 0.15 * inch))

    # Summary
    story.append(Paragraph("Summary", h2))

    s = _latest_summary(db, meeting_id)
    if not s:
        story.append(Paragraph("No summary found.", body))
    else:
        bullets: List[SummaryBullet] = (
            db.query(SummaryBullet)
            .filter(SummaryBullet.summary_id == str(s.id))
            .order_by(SummaryBullet.id.asc())
            .all()
        )

        items = []
        for b in bullets:
            cites = (
                db.query(BulletCitation, TranscriptSegment)
                .join(TranscriptSegment, TranscriptSegment.id == BulletCitation.segment_id)
                .filter(BulletCitation.summary_bullet_id == b.id)
                .order_by(TranscriptSegment.t_start.asc())
                .all()
            )
            stamps = []
            for (_, seg) in cites:
                ts = _format_time_s(seg.t_start)
                te = _format_time_s(seg.t_end)
                if seg.t_end and float(seg.t_end or 0) > float(seg.t_start or 0):
                    stamps.append(f"[{ts}–{te}]")
                else:
                    stamps.append(f"[{ts}]")
            stamp = " ".join(stamps) if stamps else ""
            txt = (b.text or "").replace("\n", " ").strip()
            para = Paragraph(f"{txt} <font size=9 color=#666666>{stamp}</font>", body)
            items.append(ListItem(para, leftIndent=10, value="bullet"))

        if items:
            story.append(ListFlowable(items, bulletType="bullet", start=None, leftIndent=12))
        else:
            story.append(Paragraph("No bullets.", body))

    # Transcript
    if include_transcript:
        story.append(Spacer(1, 0.25 * inch))
        story.append(Paragraph("Transcript", h2))
        t = _latest_transcript(db, meeting_id)
        if not t:
            story.append(Paragraph("No transcript found.", body))
        else:
            segs = (
                db.query(TranscriptSegment)
                .filter(TranscriptSegment.transcript_id == t.id)
                .order_by(TranscriptSegment.id.asc())
                .limit(max_segments)
                .all()
            )
            if not segs:
                story.append(Paragraph("No transcript segments.", body))
            else:
                items = []
                for sgm in segs:
                    ts = _format_time_s(sgm.t_start)
                    txt = (sgm.text or "").replace("\n", " ").strip()
                    para = Paragraph(f"<b>[{ts}]</b> {txt}", body)
                    items.append(ListItem(para, leftIndent=10, value="bullet"))
                story.append(ListFlowable(items, bulletType="bullet", start=None, leftIndent=12))

    return story


@router.get("/meetings/{meeting_id}/export.pdf")
def export_pdf(
    meeting_id: str,
    include_transcript: bool = Query(True),
    max_segments: int = Query(1000, ge=1, le=10000),
    filename: str | None = Query(None, description="Optional download filename"),
):
    """
    Export meeting summary + (optional) transcript as a nicely formatted PDF.
    """
    # Build the PDF in-memory
    buf = io.BytesIO()
    try:
        db = SessionLocal()
        try:
            # Quick existence check
            if not _latest_summary(db, meeting_id) and not _latest_transcript(db, meeting_id):
                raise HTTPException(status_code=404, detail="No summary or transcript for meeting")

            from reportlab.lib.pagesizes import letter
            doc = SimpleDocTemplate(
                buf,
                pagesize=letter,
                leftMargin=0.75 * inch,
                rightMargin=0.75 * inch,
                topMargin=0.75 * inch,
                bottomMargin=0.75 * inch,
                title=f"Meeting {meeting_id}",
                author="Notably",
            )

            story = _pdf_story_for_meeting(db, meeting_id, include_transcript, max_segments)

            # Simple page-number footer
            def _footer(canvas, doc_):
                canvas.setFont("Helvetica", 9)
                w, h = letter
                canvas.drawRightString(w - 0.75 * inch, 0.5 * inch, f"Page {doc_.page}")

            doc.build(story, onFirstPage=_footer, onLaterPages=_footer)

        finally:
            db.close()

        pdf = buf.getvalue()
        headers = {"Content-Type": "application/pdf"}
        if filename:
            headers["Content-Disposition"] = f'attachment; filename="{filename}"'
        return Response(content=pdf, media_type="application/pdf", headers=headers)
    finally:
        buf.close()
