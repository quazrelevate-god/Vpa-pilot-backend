"""proposal: source_appointment_id — provenance for the petition→proposal migration

Revision ID: 045
Revises: 044
Create Date: 2026-08-02

Records which petition (appointment) a proposal_submissions row was migrated
from, for the one-off "move mis-filed proposals out of petition review" tooling
(scripts/migrate_proposals_from_petitions.py). It is:

  • the idempotency key — a re-run skips appointments that already produced a
    proposal;
  • the validation link — validate_proposal_migration.py checks every migrated
    petition has exactly one proposal pointing back at it;
  • the safety gate for deletion — delete_migrated_petitions.py only removes an
    appointment that has a confirmed proposal referencing it.

Deliberately NOT a foreign key: proposal_submissions is kept isolated (no FKs),
and the referenced appointment is HARD-DELETED at the end of the migration —
an FK would either block that delete or null this column on cascade, destroying
the provenance record we want to keep. A plain indexed BigInteger is correct.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "045"
down_revision: Union[str, None] = "044"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "proposal_submissions",
        sa.Column("source_appointment_id", sa.BigInteger, nullable=True,
                  comment="appointment.id this proposal was migrated from (no FK — provenance only)"),
    )
    op.create_index(
        "ix_proposal_submissions_source_appointment_id",
        "proposal_submissions", ["source_appointment_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_proposal_submissions_source_appointment_id", table_name="proposal_submissions")
    op.drop_column("proposal_submissions", "source_appointment_id")
