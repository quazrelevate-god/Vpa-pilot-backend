"""
SQLAlchemy model for petition_groups — a signature petition (one campaign,
many signatories). See migration 054 for the design rationale.

Group state is DERIVED from the primary appointment's status (no status column
here on purpose), so nothing new is added to the admin lookup for this feature.
"""
from __future__ import annotations

from sqlalchemy import (
    BigInteger, Column, DateTime, ForeignKey, Index, Integer, Text, VARCHAR,
)
from sqlalchemy.orm import relationship

from src.core.database import Base
from src.core.timeutil import now_utc


class PetitionGroup(Base):
    """One signature petition — N appointments that reviewers merged into
    a single ticket because they all state the same collective demand."""

    __tablename__ = "petition_groups"

    id = Column(BigInteger, primary_key=True, autoincrement=True)

    # The "leader" appointment whose ticket represents the campaign.
    # SET NULL on cascade (not DELETE): a bug-deleted primary must not
    # cascade-drop the whole group and its signatories.
    primary_appointment_id = Column(
        Integer,
        ForeignKey("appointment.id", ondelete="SET NULL"),
        nullable=True,
        unique=True,
    )

    # Block-key snapshot at merge time — so an admin later editing category /
    # district on the primary doesn't invisibly redefine what the campaign was
    # about. FK ids into admin (entity=category / district) — the v2 pattern.
    # Resolved via the shadow admin table registered on Base.metadata above.
    category_id = Column(BigInteger, ForeignKey("admin.id"), nullable=True)
    district_id = Column(BigInteger, ForeignKey("admin.id"), nullable=True)

    # One-line demand cached here so the ticket roster header and audit can
    # render without joining back to the primary's GSR every time.
    canonical_ask = Column(Text, nullable=True)

    # Cached row-count of members (kept in sync in service code).
    # Starts at 1 (just the primary at group-creation time — merge_service
    # inserts the primary + N signatories together and stamps N+1).
    signatory_count = Column(Integer, nullable=False, default=1, server_default="1")

    created_by = Column(VARCHAR(100), nullable=True)
    created_at = Column(DateTime, nullable=False, default=now_utc)
    updated_at = Column(DateTime, nullable=False, default=now_utc, onupdate=now_utc)

    # Relationships — resolved by string to avoid a top-of-module Appointment
    # import (circular: appointment models don't import PetitionGroup).
    primary_appointment = relationship(
        "Appointment", foreign_keys=[primary_appointment_id], lazy="joined",
    )

    __table_args__ = (
        Index("ix_petition_groups_primary_appointment_id", "primary_appointment_id"),
    )
