"""petition_groups: signature petitions (many appointments → one ticket)

Revision ID: 054
Revises: 053
Create Date: 2026-08-06

Mass / campaign petitions problem: N citizens photocopy or forward the same
demand ("Repair the road", "Save our school"). Today each becomes its own
ticket, drowning the department in identical work.

Fix: a `petition_groups` row represents one signature petition. Every member
appointment carries a nullable `group_id`. On approve of the primary, ONE
ticket is created (the primary's) and every other member is flipped to
REVIEWED without spawning its own ticket — its identity is preserved as a
signatory on the primary's ticket, so no citizen is lost.

Additive-only:
  * `petition_groups` is new.
  * `appointment.group_id` is nullable → every existing petition (`group_id
    IS NULL`) behaves exactly as before. Approve without similar candidates
    still creates one ticket per appointment.

Recoverable:
  * A signatory can be split back out (✕ on the ticket): `group_id` is nulled,
    the appointment goes back to AWAITING_REVIEW, `signatory_count` is
    recomputed. Nothing is ever deleted.
  * If splitting drops the group to 1 member (the primary), the row lingers
    harmlessly — the ticket just renders as a normal single-petition ticket.

Deliberately NO status column on `petition_groups` — group state is derived
from the primary appointment (AWAITING_REVIEW → open group, REVIEWED → merged).
Keeps the id-normalization surface small: nothing new to seed into admin.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "054"
down_revision: Union[str, None] = "053"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── petition_groups: one row per campaign / signature petition ───────────
    op.create_table(
        "petition_groups",
        sa.Column("id", sa.BigInteger, primary_key=True, autoincrement=True),
        # The primary appointment — the "leader" whose ticket owns the campaign.
        # UNIQUE so the same appointment can never be the primary of two groups.
        # SET NULL on cascade so a bug-deleted primary doesn't cascade-drop the
        # whole group + its signatories.
        sa.Column(
            "primary_appointment_id",
            sa.Integer,
            sa.ForeignKey("appointment.id", ondelete="SET NULL"),
            nullable=True, unique=True,
        ),
        # Snapshot of the block-key at merge time so a later admin edit to
        # category/district on the primary doesn't invisibly reshape the group.
        # FKs into admin (entity=category / district) — the v2 id-normalized way.
        sa.Column(
            "category_id",
            sa.BigInteger,
            sa.ForeignKey("admin.id"),
            nullable=True,
        ),
        sa.Column(
            "district_id",
            sa.BigInteger,
            sa.ForeignKey("admin.id"),
            nullable=True,
        ),
        # The one-line canonical ask (from the primary) — kept here so the
        # ticket roster header and any audit can render it without joining.
        sa.Column("canonical_ask", sa.Text, nullable=True),
        # Cached count for cheap render (kept in sync in service code).
        sa.Column(
            "signatory_count",
            sa.Integer,
            nullable=False,
            server_default=sa.text("1"),
        ),
        sa.Column("created_by", sa.VARCHAR(100), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime,
            nullable=False,
            server_default=sa.text("(now() at time zone 'utc')"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime,
            nullable=False,
            server_default=sa.text("(now() at time zone 'utc')"),
        ),
    )
    op.create_index(
        "ix_petition_groups_primary_appointment_id",
        "petition_groups",
        ["primary_appointment_id"],
    )

    # ── appointment.group_id (nullable, no default) ──────────────────────────
    # SET NULL on cascade → deleting a group frees its members, not deletes them.
    op.add_column(
        "appointment",
        sa.Column(
            "group_id",
            sa.BigInteger,
            sa.ForeignKey("petition_groups.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.create_index(
        "ix_appointment_group_id",
        "appointment",
        ["group_id"],
        postgresql_where=sa.text("group_id IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index("ix_appointment_group_id", table_name="appointment")
    op.drop_column("appointment", "group_id")
    op.drop_index("ix_petition_groups_primary_appointment_id", table_name="petition_groups")
    op.drop_table("petition_groups")
