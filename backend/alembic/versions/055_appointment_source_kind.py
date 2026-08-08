"""appointment.source_kind — mark shadow appointments minted from associations

Revision ID: 055
Revises: 054
Create Date: 2026-08-08

Associations don't have their own ticket table — until now, approving an
association just flipped a status column and nothing crossed into the ticket
workflow. Building an "Association → Ticket" flow needs a way to distinguish
the two kinds of appointments that live on the same table:

  * `citizen`      — a real citizen visit / petition (every current row)
  * `association`  — a shadow appointment minted from an AssociationSubmission
                     purely to reuse the existing Citizen → Appointment → Ticket
                     pipeline. NOT a real visit; hidden from the walk-in queue,
                     scheduler and appointments list; shown only on the tickets
                     surface with an "Association" badge.

Additive-only, non-breaking:
  * `source_kind` is `NOT NULL DEFAULT 'citizen'` so every existing appointment
    reads as a real citizen visit. New association-approval flow writes
    `'association'`; nothing else changes.

Index it — every visit-side surface (walk-in queue, scheduler, appointments
list) will filter on `source_kind = 'citizen'`, so the col will be a hot
filter path.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "055"
down_revision: Union[str, None] = "054"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "appointment",
        sa.Column(
            "source_kind",
            sa.VARCHAR(20),
            nullable=False,
            server_default=sa.text("'citizen'"),
            comment="citizen | association — 'association' rows are shadow "
                    "appointments minted from AssociationSubmission approval; "
                    "hidden from visit surfaces, surfaced only as tickets.",
        ),
    )
    op.create_index(
        "ix_appointment_source_kind",
        "appointment",
        ["source_kind"],
    )


def downgrade() -> None:
    op.drop_index("ix_appointment_source_kind", table_name="appointment")
    op.drop_column("appointment", "source_kind")
