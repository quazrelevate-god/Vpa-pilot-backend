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
from src.core.timeutil import now_utc

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    Column,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Text,
    VARCHAR,
    select as sa_select,
    table as sa_table,
    column as sa_column,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import relationship
from sqlalchemy.ext.hybrid import hybrid_property

from src.core.database import Base

# Lightweight handle on the admin lookup so the hybrid classification
# expressions can emit a correlated subquery id → name (see appointment_models).
_ADMIN_LOOKUP = sa_table("admin", sa_column("id"), sa_column("entity"), sa_column("name"))


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

    # ── Parent links (exactly one pre-approval; both after approve) ─────────────
    # appointment_id is nullable: an AI-scan extraction exists before any
    # appointment is created. A CHECK (see __table_args__) guarantees at least
    # one of (appointment_id, ai_upload_id) is present so a record is never
    # orphaned.
    appointment_id = Column(
        Integer,
        ForeignKey("appointment.id", ondelete="CASCADE"),
        nullable=True,
        comment="The appointment this summary belongs to (NULL until an AI-scan "
                "extraction is approved into an appointment)",
    )

    ai_upload_id = Column(
        BigInteger,
        ForeignKey("ai_uploads.id", ondelete="CASCADE"),
        nullable=True,
        comment="The AI-scan pipeline row this extraction came from. Set at "
                "extraction time; kept as provenance after approval.",
    )

    # Pre-approval contact number read off the scan (plaintext until approve,
    # where it is encrypted onto the Citizen). NULL for citizen-intake records.
    contact_mobile = Column(
        VARCHAR(20),
        nullable=True,
        comment="Extracted contact mobile, pipeline-only (encrypted onto Citizen on approve)",
    )

    # ── Versioning ─────────────────────────────────────────────────────────────
    is_latest = Column(
        Boolean,
        nullable=False,
        default=True,
        comment="True for the most recent summary; False for archived re-runs",
    )

    # ── Classification (stored ONLY as FK ids into the admin lookup) ───────────
    # priority/category/ministry/district are computed hybrids (below) over these
    # ids, so every call site — including from_gemini_response(summary=...) which
    # passes the Gemini enum values as kwargs — keeps working while the redundant
    # string columns are gone from storage. The migration seeds admin from the
    # code enums and asserts every value resolves, so a Gemini output can never
    # silently fail to map.
    priority_id = Column(
        BigInteger, ForeignKey("admin.id"), nullable=False, index=True,
        comment="FK → admin.id (entity=priority): low | medium | high | critical",
    )
    category_id = Column(
        BigInteger, ForeignKey("admin.id"), nullable=False, index=True,
        comment="FK → admin.id (entity=category) — GrievanceCategory for routing",
    )
    ministry_id = Column(
        BigInteger, ForeignKey("admin.id"), nullable=False, index=True,
        comment="FK → admin.id (entity=ministry) — the owning ministry",
    )
    district_id = Column(
        BigInteger, ForeignKey("admin.id"), nullable=True, index=True,
        comment="FK → admin.id (entity=district). NULL when Gemini abstained "
                "('unknown' is never stored — normalised to NULL).",
    )

    # ── Hybrid string facades over the classification ids ──────────────────────
    @hybrid_property
    def priority(self):
        if self.priority_id is None:
            return None
        from src.services.admin_lookup import admin
        return admin.display_name(self.priority_id)

    @priority.setter
    def priority(self, value):
        from src.services.admin_lookup import admin
        self.priority_id = admin.priority(value) if value else None

    @priority.expression
    def priority(cls):
        return (sa_select(_ADMIN_LOOKUP.c.name)
                .where(_ADMIN_LOOKUP.c.id == cls.priority_id,
                       _ADMIN_LOOKUP.c.entity == "priority").scalar_subquery())

    @hybrid_property
    def category(self):
        if self.category_id is None:
            return None
        from src.services.admin_lookup import admin
        return admin.display_name(self.category_id)

    @category.setter
    def category(self, value):
        from src.services.admin_lookup import admin
        self.category_id = admin.category(value) if value else None

    @category.expression
    def category(cls):
        return (sa_select(_ADMIN_LOOKUP.c.name)
                .where(_ADMIN_LOOKUP.c.id == cls.category_id,
                       _ADMIN_LOOKUP.c.entity == "category").scalar_subquery())

    @hybrid_property
    def ministry(self):
        if self.ministry_id is None:
            return None
        from src.services.admin_lookup import admin
        return admin.display_name(self.ministry_id)

    @ministry.setter
    def ministry(self, value):
        from src.services.admin_lookup import admin
        self.ministry_id = admin.ministry(value) if value else None

    @ministry.expression
    def ministry(cls):
        return (sa_select(_ADMIN_LOOKUP.c.name)
                .where(_ADMIN_LOOKUP.c.id == cls.ministry_id,
                       _ADMIN_LOOKUP.c.entity == "ministry").scalar_subquery())

    @hybrid_property
    def district(self):
        if self.district_id is None:
            return None
        from src.services.admin_lookup import admin
        return admin.display_name(self.district_id)

    @district.setter
    def district(self, value):
        # 'unknown' is a calibrated abstention — store NULL, never an id.
        from src.services.admin_lookup import admin
        self.district_id = admin.get("district", value) if (value and value != "unknown") else None

    @district.expression
    def district(cls):
        return (sa_select(_ADMIN_LOOKUP.c.name)
                .where(_ADMIN_LOOKUP.c.id == cls.district_id,
                       _ADMIN_LOOKUP.c.entity == "district").scalar_subquery())

    # ISO YYYY-MM-DD date written ON the petition document (letterhead/signature
    # date), extracted by Gemini. NULL when none is written. Distinct from the
    # received/created date. (Write wired with the intake-router integration.)
    document_date = Column(VARCHAR(10), nullable=True)

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
        default=now_utc,
        comment="When this summary record was created (UTC)",
    )

    # ── Factory helper ─────────────────────────────────────────────────────────
    @classmethod
    def from_gemini_response(
        cls,
        appointment_id: int | None,
        summary: "GrievanceSummary",  # noqa: F821 — forward ref
        gemini_model_used: str,
        gemini_latency_ms: int | None = None,
        audio_transcript: str | None = None,
        audio_stt_latency_ms: int | None = None,
        ai_upload_id: int | None = None,
        contact_mobile: str | None = None,
    ) -> "GrievanceSummaryRecord":
        """Build a ready-to-persist record from a GrievanceSummary Pydantic object.

        Pass `appointment_id` for the citizen-intake path, or `ai_upload_id`
        (+ optional `contact_mobile`) for an AI-scan extraction created before
        an appointment exists. At least one parent id must be supplied.
        """
        # District: Gemini returns "unknown" as calibrated abstention;
        # persist that as NULL so the frontend can treat missing / abstained
        # the same way and the "unknown" string never leaks into the DB.
        district_value = summary.district.value if summary.district else None
        if district_value == "unknown":
            district_value = None

        return cls(
            appointment_id=appointment_id,
            ai_upload_id=ai_upload_id,
            contact_mobile=contact_mobile,
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

    # ── Constraints & indexes ──────────────────────────────────────────────────
    __table_args__ = (
        CheckConstraint(
            "appointment_id IS NOT NULL OR ai_upload_id IS NOT NULL",
            name="ck_gsr_has_parent",
        ),
        Index(
            "ix_gsr_appointment_latest",
            "appointment_id",
            "is_latest",
        ),
        Index(
            "ix_gsr_ai_upload_latest",
            "ai_upload_id",
            "is_latest",
        ),
        # classification is now the FK ids (indexed via index=True on each id
        # column); the old string indexes are gone with the string columns.
        Index("ix_gsr_created_at", "created_at"),
    )
