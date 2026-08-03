"""
ORM model for the Events (invitation calendar) PWA.

Each row is one photographed greeting/invitation card moving through:

    QUEUED -> PROCESSING -> READY
    (PROCESSING may instead go to FAILED, which is retryable)

"Needs review" is DERIVED, not a status: any non-READY row, plus READY rows
with no event_date (the invitation was readable but no date was detected).
A manual PATCH that sets a date on a FAILED row flips it to READY.

Deliberately isolated from the petition/appointment flow — the events PWA is
a standalone shared calendar for the PA team.

Table: invitation_events
"""
from __future__ import annotations

from datetime import datetime
from src.core.timeutil import now_utc

from sqlalchemy import (
    BigInteger, Boolean, Column, Date, DateTime, Index, Text, Time, VARCHAR, text,
)
from sqlalchemy.dialects.postgresql import JSONB

from src.core.database import Base


# ── Status constants ────────────────────────────────────────────────────────────
STATUS_QUEUED     = "QUEUED"
STATUS_PROCESSING = "PROCESSING"
STATUS_READY      = "READY"
STATUS_FAILED     = "FAILED"

# Canonical event types the extractor is constrained to.
EVENT_TYPES = (
    "wedding", "opening_ceremony", "temple_festival", "political_meeting",
    "housewarming", "memorial", "school_function", "other",
)


class InvitationEvent(Base):
    """One photographed invitation card and its extraction lifecycle."""

    __tablename__ = "invitation_events"

    id         = Column(BigInteger, primary_key=True, autoincrement=True)

    image_path = Column(Text,         nullable=False, comment="storage_service key, e.g. events/<hex>.jpg")
    image_mime = Column(VARCHAR(100), nullable=False)

    # ── Voice-capture (a spoken invitation instead of a photo) ──────────────────
    # image_path stays set to the sentinel ("events/manual") for voice events so
    # the NOT-NULL constraint doesn't fail; the has_photo/serialize logic picks
    # audio_path over image_path for these rows. Both null on a normal photo or
    # manual event; both set only on voice-created events.
    audio_path    = Column(Text,         nullable=True, comment="storage_service key, e.g. events/<hex>.webm")
    audio_mime    = Column(VARCHAR(100), nullable=True)
    # Sarvam STT gives us the source-language transcript plus (in translate
    # mode) an English rendering — we keep both so the reviewer can audit.
    transcript_ta = Column(Text,         nullable=True)
    transcript_en = Column(Text,         nullable=True)

    # PA's optional note — takes display priority over the extracted title.
    note       = Column(Text, nullable=True)

    # ── Extracted fields (editable by the PA team) ──────────────────────────────
    # Bilingual title + venue — the PWA has an EN/TA toggle and needs both
    # sides. Gemini always fills both (see event_extraction.EXTRACTION_PROMPT).
    # `title` / `venue` (below) are the legacy single-language columns; still
    # populated for back-compat but the UI reads title_en/_ta and venue_en/_ta.
    title      = Column(VARCHAR(300), nullable=True, comment="Legacy single-language title (kept for back-compat)")
    title_en   = Column(VARCHAR(300), nullable=True, comment="Title in English (populated for both EN- and TA-sourced cards)")
    title_ta   = Column(VARCHAR(300), nullable=True, comment="Title in Tamil (populated for both EN- and TA-sourced cards)")
    venue      = Column(VARCHAR(300), nullable=True, comment="Legacy single-language venue (kept for back-compat)")
    venue_en   = Column(VARCHAR(300), nullable=True, comment="Venue in English")
    venue_ta   = Column(VARCHAR(300), nullable=True, comment="Venue in Tamil")
    event_type = Column(VARCHAR(50),  nullable=True, comment="One of EVENT_TYPES")
    event_date = Column(Date, nullable=True, comment="NULL => unscheduled / needs review")
    start_time = Column(Time, nullable=True, comment="NULL with a date set => all-day")
    end_time   = Column(Time, nullable=True)

    status = Column(
        VARCHAR(20), nullable=False, default=STATUS_QUEUED, server_default=STATUS_QUEUED,
        comment="QUEUED | PROCESSING | READY | FAILED",
    )
    error_message = Column(Text, nullable=True, comment="Reason a PROCESSING run FAILED")

    # Full raw Gemini extraction (audit/debug; columns above are the truth).
    extraction_json = Column(JSONB, nullable=True)

    # ── Approval / attendance ──────────────────────────────────────────────────
    # is_approved now doubles as the attendance flag: reviewer approves a
    # today+ event to mark it as attended (or committed-to-attend). The old
    # `attendance` column was dropped in migration 040. False = not attended,
    # True = attended. The calendar shows every event regardless of this flag
    # (see event_service.list_events); it's a marker, not a visibility gate.
    is_approved  = Column(Boolean, nullable=False, default=False, server_default=text("false"))
    approved_by  = Column(VARCHAR(100), nullable=True, comment="events_session username who approved")
    approved_at  = Column(DateTime, nullable=True)

    # ── Reminder-fired flags (web-push scheduler) ──────────────────────────────
    # Each is flipped inside the same DB tx that dispatches the corresponding
    # reminder, so a scheduler-tick crash mid-fan-out can't cause a duplicate
    # send. See notification_scheduler.py.
    notified_night_before = Column(Boolean, nullable=False, default=False, server_default=text("false"))
    notified_morning      = Column(Boolean, nullable=False, default=False, server_default=text("false"))
    notified_1h           = Column(Boolean, nullable=False, default=False, server_default=text("false"))

    # ── Timestamps / audit ──────────────────────────────────────────────────────
    created_by   = Column(VARCHAR(100), nullable=False, comment="events_session username")
    created_at   = Column(DateTime, nullable=False, default=now_utc)
    processed_at = Column(DateTime, nullable=True)
    updated_at   = Column(DateTime, nullable=True)
    updated_by   = Column(VARCHAR(100), nullable=True, comment="events_session username of the last PATCH")

    __table_args__ = (
        Index("ix_inv_events_date", "event_date"),
        Index("ix_inv_events_status", "status"),
        Index("ix_inv_events_created", "created_at"),
    )
