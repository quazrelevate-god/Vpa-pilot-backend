"""ORM model for web-push subscriptions used by the /events PWA.

One row per browser-endpoint that has opted in to receive event reminders.
Tied to a `login`, so revoking a user's event_reviewer role can disable all
their subscriptions in a single query.

See alembic migration 041 for the exact schema + indexes.
"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import (
    BigInteger, Boolean, Column, DateTime, ForeignKey, Index, Integer,
    Text, VARCHAR, text,
)

from src.core.database import Base


class PushSubscription(Base):
    """One browser push endpoint an events user has opted into."""

    __tablename__ = "push_subscriptions"

    id           = Column(BigInteger, primary_key=True, autoincrement=True)
    login_id     = Column(Integer, ForeignKey("login.id", ondelete="CASCADE"), nullable=False)

    # Browser-issued push endpoint URL — unique per (device, origin) pair.
    # Upsert on subscribe replaces the existing row.
    endpoint     = Column(Text, nullable=False)
    # p256dh + auth are the ECDH public key + auth secret the push service
    # uses to encrypt payloads for THIS subscription.
    p256dh       = Column(Text, nullable=False)
    auth         = Column(Text, nullable=False)
    device_label = Column(VARCHAR(200), nullable=True)

    # is_active = false when the push service returned 404/410 for this
    # endpoint (browser uninstalled / re-installed / permission revoked).
    # We stop trying but keep the row for audit until the user opts out.
    is_active    = Column(Boolean, nullable=False, default=True, server_default=text("true"))

    created_at   = Column(DateTime, nullable=False, default=datetime.utcnow, server_default=text("now()"))
    last_seen_at = Column(DateTime, nullable=True)

    __table_args__ = (
        Index("ux_push_subscriptions_endpoint", "endpoint", unique=True),
        Index("ix_push_subscriptions_active_login", "is_active", "login_id"),
    )
