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
from src.core.timeutil import now_utc

from sqlalchemy import (
    BigInteger, Boolean, Column, DateTime, ForeignKey, Index, Integer, Text, VARCHAR,
    select as sa_select, table as sa_table, column as sa_column,
)
from sqlalchemy.ext.hybrid import hybrid_property

from src.core.database import Base

# Lightweight handle on the admin lookup so the hybrid status expression can
# emit a correlated subquery id → name (see appointment_models).
_ADMIN_LOOKUP = sa_table("admin", sa_column("id"), sa_column("entity"), sa_column("name"))


# ── Status constants ────────────────────────────────────────────────────────────
STATUS_QUEUED          = "QUEUED"
STATUS_PROCESSING      = "PROCESSING"
STATUS_AWAITING_REVIEW = "AWAITING_REVIEW"
STATUS_REVIEWED        = "REVIEWED"
STATUS_FAILED          = "FAILED"
# PA can mark a petition as reviewed WITHOUT creating a ticket / citizen /
# appointment — e.g. a courtesy audio message, or a duplicate submission.
# The row stays visible in "All" but hides from Awaiting / Reviewed / Failed
# segments so the queue does not collect noise.
STATUS_DISMISSED       = "DISMISSED"
# The classifier decided this upload is a proposal / association, not a petition.
# A row in proposal_submissions / association_submissions was created; this
# ai_uploads row is kept as a recoverable audit trail (routed_to + routed_ref_id)
# and drops out of the petition-review segments. A PA can move it back.
STATUS_ROUTED          = "ROUTED"


class AiUpload(Base):
    """One bulk-uploaded petition file and its extraction lifecycle."""

    __tablename__ = "ai_uploads"

    id        = Column(BigInteger, primary_key=True, autoincrement=True)
    batch_id  = Column(VARCHAR(40), nullable=False, comment="Groups one upload batch (uuid hex)")

    original_filename = Column(VARCHAR(300), nullable=False)
    storage_url       = Column(Text,         nullable=False, comment="storage_service key/path")
    mime_type         = Column(VARCHAR(100), nullable=False)

    # Pipeline status is stored ONLY as a FK id into the admin lookup
    # (entity=ai_upload). `status` is a hybrid over it — the getter/setter,
    # query filters, AND Core update().values(status=...) all keep working
    # (see the update_expression below), so the whole worker/service is unchanged.
    status_id = Column(
        BigInteger, ForeignKey("admin.id"), nullable=False, index=True,
        comment="FK → admin.id (entity=ai_upload): QUEUED|PROCESSING|AWAITING_REVIEW|"
                "REVIEWED|FAILED|DISMISSED|ROUTED",
    )

    @hybrid_property
    def status(self):
        if self.status_id is None:
            return None
        from src.services.admin_lookup import admin
        return admin.display_name(self.status_id)

    @status.setter
    def status(self, value):
        from src.services.admin_lookup import admin
        self.status_id = admin.ai_upload_status(value) if value else None

    @status.expression
    def status(cls):
        return (sa_select(_ADMIN_LOOKUP.c.name)
                .where(_ADMIN_LOOKUP.c.id == cls.status_id,
                       _ADMIN_LOOKUP.c.entity == "ai_upload").scalar_subquery())

    @status.update_expression
    def status(cls, value):
        # Enables Core `update(AiUpload).values(status="REVIEWED")` — maps the
        # name to status_id at statement-build time via the admin cache.
        from src.services.admin_lookup import admin
        return [(cls.status_id, admin.ai_upload_status(value))]

    # NOTE: all extracted content (name / mobile / category / priority / summary)
    # moved to GrievanceSummaryRecord (linked via ai_upload_id). This table is
    # now pipeline + review lifecycle + classifier routing only.

    # PA-chosen category for the whole batch — an INPUT directive to extraction,
    # not a result. When set (and not 'general') it may override the AI category
    # on approve. NULL/'general' => use the AI value.
    forced_category    = Column(VARCHAR(50), nullable=True)

    # Source channel chosen at upload time (ai_scan / postal / cm_office / etc.)
    source             = Column(VARCHAR(50), nullable=False, server_default="ai_scan")

    # Layer-1A dedup — SHA-256 hex of the uploaded file bytes (migration 057).
    # Set at intake by create_batch; used to hard-refuse exact re-uploads with
    # a helpful "already uploaded in batch X, ticket Y" toast. Nullable for
    # legacy rows created before this column existed.
    file_hash = Column(
        VARCHAR(64), nullable=True, index=True,
        comment="SHA-256 hex of the file bytes at upload time.",
    )

    error_message = Column(Text, nullable=True, comment="Reason a PROCESSING run FAILED")

    # ── Classifier routing (set when the doc is a proposal/association) ─────────
    # routed_to: 'proposal' | 'association'. routed_ref_id: the id in that table.
    # route_locked: a PA moved it back to petitions — the worker must NOT
    # re-classify it (that would just route it out again), so it does a plain
    # petition extraction on the next run.
    routed_to     = Column(VARCHAR(20), nullable=True)
    routed_ref_id = Column(BigInteger, nullable=True)
    route_locked  = Column(Boolean, nullable=False, server_default="false")

    # ── Set on approve ──────────────────────────────────────────────────────────
    appointment_id = Column(
        Integer, ForeignKey("appointment.id", ondelete="SET NULL"), nullable=True,
    )
    ticket_id = Column(
        BigInteger, ForeignKey("ticket.id", ondelete="SET NULL"), nullable=True,
    )
    ticket_number = Column(VARCHAR(20), nullable=True)

    # ── Timestamps ──────────────────────────────────────────────────────────────
    created_at   = Column(DateTime, nullable=False, default=now_utc)
    processed_at = Column(DateTime, nullable=True)
    reviewed_at  = Column(DateTime, nullable=True)
    reviewed_by  = Column(VARCHAR(100), nullable=True)

    __table_args__ = (
        # status is now the FK status_id (indexed via index=True on the column).
        Index("ix_ai_uploads_batch", "batch_id"),
        Index("ix_ai_uploads_created", "created_at"),
    )
