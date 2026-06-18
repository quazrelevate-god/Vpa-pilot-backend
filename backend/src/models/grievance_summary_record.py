"""
SQLAlchemy ORM model for persisting Gemini-generated GrievanceSummary outputs.

One GrievanceSummaryRecord per Appointment (one-to-one).  The record is
created immediately after the Gemini call succeeds and is never mutated —
if the PA requests a re-summarisation a new record is inserted and the
previous one is soft-archived via `is_latest = False`.

Design decisions
----------------
- JSONB for `key_details` / `key_details_ta`: lists are opaque to SQL queries,
  JSONB is the lightest storage with optional GIN indexing if search is needed later.
- All narrative text (summary, urgency_reason, etc.) is plain TEXT — no length
  cap at DB level since Pydantic already enforces max_length upstream.
- Enum values stored as VARCHAR(20) — easy to filter/group without a custom PG type.
- `gemini_model_used` and `gemini_latency_ms` support future cost/performance
  dashboards without requiring a separate audit table.

Table: grievance_summary_records
"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
    Column,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    SmallInteger,
    Text,
    VARCHAR,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import relationship

from src.core.database import Base


class GrievanceSummaryRecord(Base):
    """
    Persisted output of one Gemini summarisation call for an appointment.

    Lifecycle
    ---------
    1. Appointment is submitted → GrievanceSummarisationService.summarise() is called.
    2. Result is saved here immediately (within the same DB transaction).
    3. PA portal reads this record to display the bilingual triage card.
    4. If re-summarised, the old record is marked is_latest=False and a new one is inserted.

    Relationships
    -------------
    - Many-to-one with Appointment (an appointment can be re-summarised; only one is_latest=True)
    """

    __tablename__ = "grievance_summary_records"

    # ── Primary key ────────────────────────────────────────────────────────────
    id = Column(
        BigInteger,
        primary_key=True,
        autoincrement=True,
        comment="Primary key",
    )

    # ── Foreign key ────────────────────────────────────────────────────────────
    appointment_id = Column(
        Integer,
        ForeignKey("appointments.id", ondelete="CASCADE"),
        nullable=False,
        comment="The appointment this summary belongs to",
    )

    # ── Versioning ─────────────────────────────────────────────────────────────
    is_latest = Column(
        Boolean,
        nullable=False,
        default=True,
        comment="True for the most recent summary; False for archived re-runs",
    )

    # ── Classification (enum values — always English) ─────────────────────────
    urgency = Column(
        VARCHAR(20),
        nullable=False,
        comment="UrgencyLevel enum: low | medium | high | critical",
    )

    category = Column(
        VARCHAR(50),
        nullable=False,
        comment="GrievanceCategory enum value for routing",
    )

    sentiment = Column(
        VARCHAR(20),
        nullable=False,
        comment="CitizenSentiment enum: distressed | frustrated | neutral | hopeful",
    )

    # ── English narrative fields ───────────────────────────────────────────────
    headline = Column(
        VARCHAR(150),
        nullable=False,
        comment="One-line English case title (≤ 150 chars)",
    )

    summary = Column(
        Text,
        nullable=False,
        comment="2-3 sentence English summary of the grievance",
    )

    citizen_ask = Column(
        Text,
        nullable=False,
        comment="Specific action requested by the citizen (English)",
    )

    urgency_reason = Column(
        Text,
        nullable=True,
        comment="Why urgency is HIGH/CRITICAL (English). NULL for low/medium.",
    )

    key_details = Column(
        JSONB,
        nullable=False,
        comment="3-6 factual bullet points extracted from the grievance (English). Stored as JSON array.",
    )

    attachment_notes = Column(
        Text,
        nullable=True,
        comment="What the image/PDF/audio showed (English). NULL if no attachment.",
    )

    # ── Tamil narrative fields (_ta suffix mirrors GrievanceSummary schema) ───
    headline_ta = Column(
        VARCHAR(200),
        nullable=False,
        comment="Tamil translation of headline (தமிழ்)",
    )

    summary_ta = Column(
        Text,
        nullable=False,
        comment="Tamil translation of summary (தமிழ்)",
    )

    citizen_ask_ta = Column(
        Text,
        nullable=False,
        comment="Tamil translation of citizen_ask (தமிழ்)",
    )

    urgency_reason_ta = Column(
        Text,
        nullable=True,
        comment="Tamil translation of urgency_reason. NULL for low/medium urgency.",
    )

    key_details_ta = Column(
        JSONB,
        nullable=False,
        comment="Tamil translation of key_details bullet list. Stored as JSON array.",
    )

    attachment_notes_ta = Column(
        Text,
        nullable=True,
        comment="Tamil translation of attachment_notes. NULL if no attachment.",
    )

    # ── Gemini metadata (for cost / performance audit) ────────────────────────
    gemini_model_used = Column(
        VARCHAR(60),
        nullable=False,
        comment="Exact model ID used for this call, e.g. gemini-2.5-flash",
    )

    gemini_latency_ms = Column(
        Integer,
        nullable=True,
        comment="End-to-end Gemini round-trip in milliseconds",
    )

    # ── Timestamps ─────────────────────────────────────────────────────────────
    created_at = Column(
        DateTime,
        nullable=False,
        default=datetime.utcnow,
        comment="When this summary record was created (UTC)",
    )

    # ── Factory helper ─────────────────────────────────────────────────────────
    @classmethod
    def from_gemini_response(
        cls,
        appointment_id: int,
        summary: "GrievanceSummary",  # noqa: F821 — forward ref, imported at call site
        gemini_model_used: str,
        gemini_latency_ms: int | None = None,
    ) -> "GrievanceSummaryRecord":
        """
        Build a ready-to-persist record from a GrievanceSummary Pydantic object.

        Usage (inside a service / API handler)::

            from src.models.grievance_summary_record import GrievanceSummaryRecord

            record = GrievanceSummaryRecord.from_gemini_response(
                appointment_id=appt.id,
                summary=gemini_summary,
                gemini_model_used=svc._model_name,
                gemini_latency_ms=elapsed_ms,
            )
            db.add(record)
            await db.commit()
        """
        return cls(
            appointment_id=appointment_id,
            is_latest=True,
            # classification
            urgency=summary.urgency.value,
            category=summary.category.value,
            sentiment=summary.sentiment.value,
            # English fields
            headline=summary.headline,
            summary=summary.summary,
            citizen_ask=summary.citizen_ask,
            urgency_reason=summary.urgency_reason,
            key_details=summary.key_details,
            attachment_notes=summary.attachment_notes,
            # Tamil fields
            headline_ta=summary.headline_ta,
            summary_ta=summary.summary_ta,
            citizen_ask_ta=summary.citizen_ask_ta,
            urgency_reason_ta=summary.urgency_reason_ta,
            key_details_ta=summary.key_details_ta,
            attachment_notes_ta=summary.attachment_notes_ta,
            # Gemini metadata
            gemini_model_used=gemini_model_used,
            gemini_latency_ms=gemini_latency_ms,
        )

    # ── Relationship ───────────────────────────────────────────────────────────
    appointment = relationship(
        "Appointment",
        back_populates="grievance_summary",
    )

    # ── Indexes ────────────────────────────────────────────────────────────────
    __table_args__ = (
        # Fast lookup: PA portal fetches the latest summary for an appointment
        Index(
            "ix_gsr_appointment_latest",
            "appointment_id",
            "is_latest",
        ),
        # Dashboard queries: filter/sort by urgency or category
        Index("ix_gsr_urgency", "urgency"),
        Index("ix_gsr_category", "category"),
        Index("ix_gsr_created_at", "created_at"),
    )
