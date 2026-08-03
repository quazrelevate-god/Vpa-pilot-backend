"""events: web-push subscriptions + per-event reminder flags

Revision ID: 041
Revises: 040
Create Date: 2026-07-30

Two changes, both in service of the new push-notification reminder feature
for the events PWA:

  1. `push_subscriptions` — one row per browser-endpoint that has opted in
     to receive event reminders. Endpoint is unique (browsers issue one
     endpoint per (device, origin) pair; re-subscribing on the same device
     replaces the existing row via UPSERT on ON CONFLICT(endpoint)).
     Rows are tied to a `login` — reviewers get reminders wherever they
     sign in, and revoking a user's reviewer role can disable all their
     subscriptions in one query. `is_active=false` when the push service
     tells us the endpoint is dead (410 Gone / 404); we stop trying but
     keep the row for audit.

  2. Three `notified_*` flags on `invitation_events` — one per reminder
     window (night-before at 21:00 IST, morning at 09:00 IST, one-hour
     before start). Each is flipped inside the same DB tx that dispatches
     the push, so a scheduler tick that crashes mid-fan-out cannot cause
     a duplicate reminder on the next tick.

No backfill needed: the flags default false, so existing events won't
retro-trigger a reminder — desired behaviour, otherwise the first minute
after deploy would spam every reviewer for every historic date.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "041"
down_revision: Union[str, None] = "040"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── push_subscriptions ──────────────────────────────────────────────
    op.create_table(
        "push_subscriptions",
        sa.Column("id",           sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("login_id",     sa.Integer(), sa.ForeignKey("login.id", ondelete="CASCADE"), nullable=False),
        # Browser-issued push endpoint URL; unique per (device, origin).
        sa.Column("endpoint",     sa.Text(),        nullable=False),
        # p256dh + auth are the ECDH public key + auth secret the push
        # service uses to encrypt payloads for THIS subscription.
        sa.Column("p256dh",       sa.Text(),        nullable=False),
        sa.Column("auth",         sa.Text(),        nullable=False),
        sa.Column("device_label", sa.VARCHAR(200),  nullable=True,
                  comment="Free-text hint the browser can send (e.g. UA-derived) — optional."),
        sa.Column("is_active",    sa.Boolean(),     nullable=False, server_default=sa.true()),
        sa.Column("created_at",   sa.DateTime(),    nullable=False, server_default=sa.func.now()),
        sa.Column("last_seen_at", sa.DateTime(),    nullable=True,
                  comment="Bumped each time we successfully dispatch a push to this endpoint."),
    )
    # Unique — one row per endpoint. Upsert on subscribe replaces the row
    # (a re-subscription with the same endpoint bumps last_seen_at + flips
    # is_active back on if it had been marked dead).
    op.create_index(
        "ux_push_subscriptions_endpoint",
        "push_subscriptions", ["endpoint"], unique=True,
    )
    # Lookup pattern used by the scheduler: "active subscriptions belonging
    # to logins with role X". Compound with is_active first to short-circuit
    # the dead ones.
    op.create_index(
        "ix_push_subscriptions_active_login",
        "push_subscriptions", ["is_active", "login_id"],
    )

    # ── per-event reminder flags ────────────────────────────────────────
    op.add_column("invitation_events",
                  sa.Column("notified_night_before", sa.Boolean(),
                            nullable=False, server_default=sa.false()))
    op.add_column("invitation_events",
                  sa.Column("notified_morning", sa.Boolean(),
                            nullable=False, server_default=sa.false()))
    op.add_column("invitation_events",
                  sa.Column("notified_1h", sa.Boolean(),
                            nullable=False, server_default=sa.false()))


def downgrade() -> None:
    op.drop_column("invitation_events", "notified_1h")
    op.drop_column("invitation_events", "notified_morning")
    op.drop_column("invitation_events", "notified_night_before")
    op.drop_index("ix_push_subscriptions_active_login", table_name="push_subscriptions")
    op.drop_index("ux_push_subscriptions_endpoint",     table_name="push_subscriptions")
    op.drop_table("push_subscriptions")
