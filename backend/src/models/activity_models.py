"""
Unified audit log (v2) — replaces appointment_events, ticket_events, reschedule_logs.

Every state-changing action writes one row to the activity table so we can
render timelines in the PA portal and answer "who did what when".
"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import (
    BigInteger, Column, DateTime, ForeignKey, Index, String, Text,
)
from sqlalchemy.dialects.postgresql import JSONB

from src.core.database import Base


class Activity(Base):
    """Unified audit log spanning appointments and tickets."""
    __tablename__ = "activity"

    id = Column(BigInteger, primary_key=True, autoincrement=True)

    appointment_id = Column(
        BigInteger, ForeignKey("appointment.id", ondelete="CASCADE"),
        nullable=True,
    )

    ticket_id = Column(
        BigInteger, ForeignKey("ticket.id", ondelete="CASCADE"),
        nullable=True,
    )

    user = Column(String(100), nullable=False)
    action_type = Column(String(40), nullable=False)
    message = Column(Text, nullable=True)
    payload = Column(
        JSONB, nullable=True,
        comment="Structured event data, e.g. {from: 'medium', to: 'low'} — "
                "used by PA portal to render change arrows.",
    )
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)

    __table_args__ = (
        Index("ix_activity_appt_created", "appointment_id", "created_at"),
        Index("ix_activity_ticket_created", "ticket_id", "created_at"),
    )
