"""
ORM model for the Association / Union pipeline.

An association submission is a collective matter from a union / association / body.
It uses the SAME grievance categorisation as petitions (job_requests,
action_required, pension_requests, …) plus the association's own identity and
collective ask — but lives in its own table with its own review surface, never a
Ticket. Rows are created by the intake router when the classifier tags a scanned
document as `association` (there is no public association form).

Table: association_submissions
"""
from __future__ import annotations

from datetime import datetime
from src.core.timeutil import now_utc

from sqlalchemy import BigInteger, Boolean, Column, DateTime, Index, Text, VARCHAR
from sqlalchemy.dialects.postgresql import JSONB

from src.core.database import Base


STATUS_AWAITING_REVIEW = "AWAITING_REVIEW"
STATUS_REVIEWED        = "REVIEWED"
STATUS_FORWARDED       = "FORWARDED"      # acknowledged + sent to the concerned department


class AssociationSubmission(Base):
    """One association/union submission and its review lifecycle."""

    __tablename__ = "association_submissions"

    id         = Column(BigInteger, primary_key=True, autoincrement=True)
    created_at = Column(DateTime, nullable=False, default=now_utc)

    # Provenance — where the document came from (router-created).
    source     = Column(VARCHAR(40), nullable=True, comment="ai_upload | scan | qr | manual")
    source_ref = Column(VARCHAR(80), nullable=True, comment="Traceback to the origin, e.g. 'ai_upload:123'")

    # Uploaded document(s): [{original_filename, storage_url, mime_type}, ...]
    documents = Column(JSONB, nullable=True)

    # ── Association identity (extracted from the document) ───────────────────────
    association_name           = Column(VARCHAR(300), nullable=True)
    member_count               = Column(VARCHAR(120), nullable=True)
    representative_name        = Column(VARCHAR(200), nullable=True)
    representative_designation = Column(VARCHAR(200), nullable=True)

    # ── Denormalised grievance classification (same taxonomy as petitions) ───────
    category      = Column(VARCHAR(50), nullable=True)
    ministry      = Column(VARCHAR(80), nullable=True)
    urgency       = Column(VARCHAR(20), nullable=True)
    district      = Column(VARCHAR(60), nullable=True)
    document_date = Column(VARCHAR(10), nullable=True, comment="ISO YYYY-MM-DD written on the document")

    # ── Full AssociationExtraction brief ────────────────────────────────────────
    extraction_json = Column(JSONB, nullable=True)

    status = Column(
        VARCHAR(24), nullable=False, default=STATUS_AWAITING_REVIEW, server_default=STATUS_AWAITING_REVIEW,
        comment="AWAITING_REVIEW | REVIEWED | FORWARDED",
    )

    reviewed_by   = Column(VARCHAR(100), nullable=True)
    reviewed_at   = Column(DateTime,     nullable=True)
    decision_note = Column(Text,         nullable=True)

    # ── Provenance (set only by the petition→association migration tooling) ─────
    # appointment.id this association was migrated from. Plain BigInteger, NOT a
    # FK: association_submissions stays isolated and the source appointment is
    # hard-deleted after migration — an FK would block that or null this out.
    # NULL for associations created directly by the intake router.
    source_appointment_id = Column(BigInteger, nullable=True)

    # ── Layer-1B dedup (migration 057) ─────────────────────────────────────────
    # Fingerprint = sha1(association_name.lower() + "|" + normalised_ask).
    # Set at create_from_extraction time. `is_duplicate` + `duplicate_of_id`
    # are the SOFT-FLAG the drawer surfaces — the row still enters review with
    # a "Duplicate of TKT-XXX" pill so the PA decides. Never auto-refuses.
    dedup_fingerprint = Column(
        VARCHAR(40), nullable=True, index=True,
        comment="sha1(name|normalised_ask) for the fingerprint match.",
    )
    is_duplicate = Column(
        Boolean, nullable=False, default=False, server_default="false",
        comment="Soft-flag: fingerprint matched an earlier row within window.",
    )
    duplicate_of_id = Column(
        BigInteger, nullable=True, index=True,
        comment="Back-pointer to the earlier association this row duplicates.",
    )

    __table_args__ = (
        Index("ix_association_submissions_status", "status"),
        Index("ix_association_submissions_created", "created_at"),
        Index("ix_association_submissions_category", "category"),
        Index("ix_association_submissions_source_appointment_id", "source_appointment_id"),
    )
