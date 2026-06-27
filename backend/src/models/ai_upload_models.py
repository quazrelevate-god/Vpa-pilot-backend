"""
ORM model for the AI Uploads pipeline — bulk petition extraction.

Each row is one uploaded petition file (PDF/image) moving through:

    QUEUED -> PROCESSING -> AWAITING_REVIEW -> REVIEWED
    (PROCESSING may instead go to FAILED, which is retryable)

Deliberately isolated from the appointment/scan-petition flow. The Citizen +
Appointment + GrievanceSummaryRecord + Ticket are created lazily only when the
PA approves a row (see ai_upload_service.approve), reusing the existing ticket
pipeline. Until then nothing pollutes the appointment/queue views.

Table: ai_uploads
"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import (
    BigInteger, Column, DateTime, ForeignKey, Index, Integer, Text, VARCHAR,
)
from sqlalchemy.dialects.postgresql import JSONB

from src.core.database import Base


# ── Status constants ────────────────────────────────────────────────────────────
STATUS_QUEUED          = "QUEUED"
STATUS_PROCESSING      = "PROCESSING"
STATUS_AWAITING_REVIEW = "AWAITING_REVIEW"
STATUS_REVIEWED        = "REVIEWED"
STATUS_FAILED          = "FAILED"


class AiUpload(Base):
    """One bulk-uploaded petition file and its extraction lifecycle."""

    __tablename__ = "ai_uploads"

    id        = Column(BigInteger, primary_key=True, autoincrement=True)
    batch_id  = Column(VARCHAR(40), nullable=False, comment="Groups one upload batch (uuid hex)")

    original_filename = Column(VARCHAR(300), nullable=False)
    storage_url       = Column(Text,         nullable=False, comment="storage_service key/path")
    mime_type         = Column(VARCHAR(100), nullable=False)

    status = Column(
        VARCHAR(20), nullable=False, default=STATUS_QUEUED, server_default=STATUS_QUEUED,
        comment="QUEUED | PROCESSING | AWAITING_REVIEW | REVIEWED | FAILED",
    )

    # ── Extracted identity (editable by PA before approve) ──────────────────────
    extracted_name    = Column(VARCHAR(200), nullable=True)
    extracted_name_ta = Column(VARCHAR(200), nullable=True)
    extracted_mobile  = Column(VARCHAR(20),  nullable=True)

    # ── Denormalised classification (table sort/filter) ─────────────────────────
    grievance_category = Column(VARCHAR(50), nullable=True)
    urgency            = Column(VARCHAR(20), nullable=True)

    # ── Full Gemini extraction (used to build a GrievanceSummaryRecord on approve)
    summary_json = Column(JSONB, nullable=True)

    error_message = Column(Text, nullable=True, comment="Reason a PROCESSING run FAILED")

    # ── Set on approve ──────────────────────────────────────────────────────────
    appointment_id = Column(
        Integer, ForeignKey("appointments.id", ondelete="SET NULL"), nullable=True,
    )
    ticket_id = Column(
        BigInteger, ForeignKey("tickets.id", ondelete="SET NULL"), nullable=True,
    )
    ticket_number = Column(VARCHAR(20), nullable=True)

    # ── Timestamps ──────────────────────────────────────────────────────────────
    created_at   = Column(DateTime, nullable=False, default=datetime.utcnow)
    processed_at = Column(DateTime, nullable=True)
    reviewed_at  = Column(DateTime, nullable=True)
    reviewed_by  = Column(VARCHAR(100), nullable=True)

    __table_args__ = (
        Index("ix_ai_uploads_status", "status"),
        Index("ix_ai_uploads_batch", "batch_id"),
        Index("ix_ai_uploads_created", "created_at"),
    )
