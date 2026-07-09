"""
SQLAlchemy ORM model for persisting Gemini-generated GrievanceSummary outputs.

One GrievanceSummaryRecord per Appointment (one-to-one).  The record is
created immediately after the Gemini call succeeds and is never mutated —
if the PA requests a re-summarisation a new record is inserted and the
previous one is soft-archived via `is_latest = False`.

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
    Text,
    VARCHAR,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import relationship

from src.core.database import Base


class GrievanceSummaryRecord(Base):
    """
    Persisted output of one Gemini summarisation call for an appointment.
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
        ForeignKey("appointment.id", ondelete="CASCADE"),
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
    priority = Column(
        VARCHAR(20),
        nullable=False,
        comment="Priority level (from AI review): low | medium | high | critical",
    )

    category = Column(
        VARCHAR(50),
        nullable=False,
        comment="GrievanceCategory enum value for routing",
    )

    ministry = Column(
        VARCHAR(60),
        nullable=False,
        server_default="other",
        comment="Ministry enum value — the ministry owning the root cause",
    )

    district = Column(
        VARCHAR(40),
        nullable=True,
        comment=(
            "Tamil Nadu district enum value the petition originates from. "
            "NULL when Gemini could not confidently extract a district; PA "
            "may fill it manually from the detail drawer. Never store the "
            "sentinel string 'unknown' — persist as NULL instead."
        ),
    )

    # ── Citizen name (bilingual echo) ──────────────────────────────────────────
    name_en = Column(
        VARCHAR(200),
        nullable=False,
        server_default="",
        comment="Citizen name in Latin script (echoed / transliterated by Gemini)",
    )
    name_ta = Column(
        VARCHAR(200),
        nullable=False,
        server_default="",
        comment="Citizen name in Tamil script (echoed / transliterated by Gemini)",
    )

    # ── English narrative fields ───────────────────────────────────────────────
    summary = Column(
        Text,
        nullable=False,
        comment="Bulleted English summary of the petition (newline-separated '• ' bullets)",
    )

    citizen_ask = Column(
        Text,
        nullable=False,
        comment="One-line subject / regarding, in English",
    )

    key_details = Column(
        JSONB,
        nullable=False,
        comment="3–8 factual bullet points extracted from the petition (English)",
    )

    # ── Tamil narrative fields ────────────────────────────────────────────────
    summary_ta = Column(
        Text,
        nullable=False,
        comment="Bulleted Tamil summary (mirror of `summary`)",
    )

    citizen_ask_ta = Column(
        Text,
        nullable=False,
        comment="One-line subject / regarding, in Tamil",
    )

    key_details_ta = Column(
        JSONB,
        nullable=False,
        comment="Tamil mirror of key_details bullet list",
    )

    # ── STT transcript (Gemini speech-to-text on audio attachment) ────────────
    audio_transcript = Column(
        Text,
        nullable=True,
        comment="Verbatim Tamil/English transcript of the citizen's audio recording, "
                "produced by Gemini STT before summarisation. NULL if no audio was provided.",
    )

    audio_stt_latency_ms = Column(
        Integer,
        nullable=True,
        comment="End-to-end Gemini STT round-trip in milliseconds. NULL if no audio.",
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
        summary: "GrievanceSummary",  # noqa: F821 — forward ref
        gemini_model_used: str,
        gemini_latency_ms: int | None = None,
        audio_transcript: str | None = None,
        audio_stt_latency_ms: int | None = None,
    ) -> "GrievanceSummaryRecord":
        """Build a ready-to-persist record from a GrievanceSummary Pydantic object."""
        # District: Gemini returns "unknown" as calibrated abstention;
        # persist that as NULL so the frontend can treat missing / abstained
        # the same way and the "unknown" string never leaks into the DB.
        district_value = summary.district.value if summary.district else None
        if district_value == "unknown":
            district_value = None

        return cls(
            appointment_id=appointment_id,
            is_latest=True,
            # classification
            priority=summary.urgency.value,
            category=summary.category.value,
            ministry=summary.ministry.value,
            district=district_value,
            # bilingual name
            name_en=summary.name_en,
            name_ta=summary.name_ta,
            # English fields
            summary=summary.summary,
            citizen_ask=summary.citizen_ask,
            key_details=summary.key_details,
            # Tamil fields
            summary_ta=summary.summary_ta,
            citizen_ask_ta=summary.citizen_ask_ta,
            key_details_ta=summary.key_details_ta,
            # STT
            audio_transcript=audio_transcript,
            audio_stt_latency_ms=audio_stt_latency_ms,
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
        Index(
            "ix_gsr_appointment_latest",
            "appointment_id",
            "is_latest",
        ),
        Index("ix_gsr_priority", "priority"),
        Index("ix_gsr_category", "category"),
        Index("ix_gsr_ministry", "ministry"),
        Index("ix_gsr_district", "district"),
        Index("ix_gsr_created_at", "created_at"),
    )
