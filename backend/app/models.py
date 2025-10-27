from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import List, Optional

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


# -----------------------------
# Upload + Transcript entities
# -----------------------------

class Upload(Base):
    __tablename__ = "upload"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    meeting_id: Mapped[str] = mapped_column(String(36), nullable=False)

    filename: Mapped[str] = mapped_column(Text, nullable=False)
    mime_type: Mapped[str] = mapped_column(Text, nullable=False)
    byte_size: Mapped[int] = mapped_column(BigInteger, nullable=False)
    sha256: Mapped[str] = mapped_column(String(64), nullable=False)

    duration_sec: Mapped[Optional[float]] = mapped_column(Numeric, nullable=True)

    status: Mapped[str] = mapped_column(String(16), nullable=False, default="queued")
    error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now_utc)
    retained_until: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    __table_args__ = (
        UniqueConstraint("meeting_id", "sha256", name="uq_upload_meeting_sha256"),
        CheckConstraint("status in ('queued','processing','done','failed')", name="ck_upload_status"),
    )

    transcript: Mapped["Transcript"] = relationship(back_populates="upload", uselist=False)


class Transcript(Base):
    __tablename__ = "transcript"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    upload_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("upload.id", ondelete="CASCADE"),
        unique=True,
        nullable=False,
    )
    language: Mapped[Optional[str]] = mapped_column(String(8), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now_utc)

    upload: Mapped[Upload] = relationship(back_populates="transcript")
    segments: Mapped[List["TranscriptSegment"]] = relationship(
        back_populates="transcript", cascade="all, delete-orphan"
    )


class TranscriptSegment(Base):
    __tablename__ = "transcript_segment"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    transcript_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("transcript.id", ondelete="CASCADE"), nullable=False
    )
    t_start: Mapped[float] = mapped_column(Numeric, nullable=False)
    t_end: Mapped[float] = mapped_column(Numeric, nullable=False)
    text: Mapped[str] = mapped_column(Text, nullable=False)

    transcript: Mapped[Transcript] = relationship(back_populates="segments")


# -----------------------------
# Summary + Citations entities
# -----------------------------

class Summary(Base):
    __tablename__ = "summary"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    meeting_id: Mapped[str] = mapped_column(String(36), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now_utc)

    bullets: Mapped[List["SummaryBullet"]] = relationship(
        back_populates="summary", cascade="all, delete-orphan"
    )


class SummaryBullet(Base):
    __tablename__ = "summary_bullet"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    summary_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("summary.id", ondelete="CASCADE"), nullable=False
    )
    text: Mapped[str] = mapped_column(Text, nullable=False)

    summary: Mapped[Summary] = relationship(back_populates="bullets")
    citations: Mapped[List["BulletCitation"]] = relationship(
        back_populates="bullet", cascade="all, delete-orphan"
    )


class BulletCitation(Base):
    __tablename__ = "bullet_citation"

    summary_bullet_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("summary_bullet.id", ondelete="CASCADE"), primary_key=True
    )
    segment_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("transcript_segment.id", ondelete="CASCADE"), primary_key=True
    )

    bullet: Mapped[SummaryBullet] = relationship(back_populates="citations")
