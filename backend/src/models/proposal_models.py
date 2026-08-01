"""
ORM model for the /proposal intake pipeline — institutional proposals to the
Hon'ble Minister for School Education.

Each row is one proposal submission moving through:

    QUEUED -> PROCESSING -> AWAITING_REVIEW -> (APPROVED | REJECTED | NEEDS_CLARIFICATION)
    (PROCESSING may instead go to FAILED, which is retryable)

Deliberately isolated from the petition/appointment/ticket flow — a proposal is
a pitch judged on merit, NOT a grievance routed to a department to be resolved.
It never becomes a Ticket. Identity (org / person / contact) comes from the
/proposal form and is authoritative; PII is encrypted at rest with the same
Fernet layer as citizen data (src.core.crypto). Gemini fills extraction_json.

Table: proposal_submissions
"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import BigInteger, Column, DateTime, Index, Text, VARCHAR
from sqlalchemy.dialects.postgresql import JSONB

from src.core.database import Base


# ── Status constants ────────────────────────────────────────────────────────────
# Extraction lifecycle
STATUS_QUEUED          = "QUEUED"
STATUS_PROCESSING      = "PROCESSING"
STATUS_AWAITING_REVIEW = "AWAITING_REVIEW"   # extracted, ready for the Minister/super-admin
STATUS_FAILED          = "FAILED"
# Decision lifecycle (set by the super-admin reviewer, from AWAITING_REVIEW)
STATUS_APPROVED            = "APPROVED"
STATUS_REJECTED            = "REJECTED"
STATUS_NEEDS_CLARIFICATION = "NEEDS_CLARIFICATION"

DECISION_STATUSES = frozenset({STATUS_APPROVED, STATUS_REJECTED, STATUS_NEEDS_CLARIFICATION})


class ProposalSubmission(Base):
    """One proposal submission and its extraction + decision lifecycle."""

    __tablename__ = "proposal_submissions"

    id           = Column(BigInteger, primary_key=True, autoincrement=True)
    tracking_ref = Column(VARCHAR(40), nullable=False, unique=True,
                          comment="Public reference shown to the submitter, e.g. NK/SCH/2026/AB12C")

    # Which desk the proposal is aimed at (from the form): school | tamil | information | film
    category = Column(VARCHAR(40), nullable=True)

    # ISO YYYY-MM-DD date written on the proposal document (extracted), if any.
    document_date = Column(VARCHAR(10), nullable=True)

    # ── Identity — from the form, authoritative. PII encrypted (Fernet). ─────────
    org_name     = Column(VARCHAR(300), nullable=True)   # organisation name (not secret)
    person_name  = Column(VARCHAR(200), nullable=True)   # contact person (not secret)
    designation  = Column(VARCHAR(200), nullable=True)
    email_enc    = Column(Text,         nullable=True, comment="Fernet-encrypted email")
    phone_enc    = Column(VARCHAR(512), nullable=True, comment="Fernet-encrypted phone")
    phone_index  = Column(VARCHAR(64),  nullable=True, index=True,
                          comment="Blind HMAC index of phone for equality lookup")

    # ── Uploaded document(s): [{original_filename, storage_url, mime_type}, ...] ──
    documents = Column(JSONB, nullable=True)

    status = Column(
        VARCHAR(24), nullable=False, default=STATUS_QUEUED, server_default=STATUS_QUEUED,
        comment="QUEUED | PROCESSING | AWAITING_REVIEW | FAILED | APPROVED | REJECTED | NEEDS_CLARIFICATION",
    )

    # ── Gemini brief (ProposalExtraction) ───────────────────────────────────────
    extraction_json = Column(JSONB, nullable=True)
    error_message   = Column(Text,  nullable=True, comment="Reason a PROCESSING run FAILED")

    # ── Decision (set by the super-admin reviewer) ──────────────────────────────
    reviewed_by   = Column(VARCHAR(100), nullable=True)
    reviewed_at   = Column(DateTime,     nullable=True)
    decision_note = Column(Text,         nullable=True, comment="Reviewer's reason / note on the decision")

    # ── Timestamps ──────────────────────────────────────────────────────────────
    created_at   = Column(DateTime, nullable=False, default=datetime.utcnow)
    processed_at = Column(DateTime, nullable=True)

    __table_args__ = (
        Index("ix_proposal_submissions_status", "status"),
        Index("ix_proposal_submissions_created", "created_at"),
        Index("ix_proposal_submissions_category", "category"),
    )
