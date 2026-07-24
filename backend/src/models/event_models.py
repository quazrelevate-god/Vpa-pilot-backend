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

from sqlalchemy import (
    BigInteger, Column, Date, DateTime, Index, Text, Time, VARCHAR,
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

    # ── Attendance (post-event) ─────────────────────────────────────────────────
    # Simple three-state marker set by the PA after the event: NULL means not
    # yet reviewed / not applicable; 'attended' / 'not_attended' record the
    # outcome. Kept as a plain string (not an enum) so a future third state —
    # e.g. 'sent_representative' — can be added without a schema migration.
    attendance = Column(VARCHAR(20), nullable=True, comment="attended | not_attended | NULL")

    # ── Timestamps / audit ──────────────────────────────────────────────────────
    created_by   = Column(VARCHAR(100), nullable=False, comment="events_session username")
    created_at   = Column(DateTime, nullable=False, default=datetime.utcnow)
    processed_at = Column(DateTime, nullable=True)
    updated_at   = Column(DateTime, nullable=True)
    updated_by   = Column(VARCHAR(100), nullable=True, comment="events_session username of the last PATCH")

    __table_args__ = (
        Index("ix_inv_events_date", "event_date"),
        Index("ix_inv_events_status", "status"),
        Index("ix_inv_events_created", "created_at"),
    )
