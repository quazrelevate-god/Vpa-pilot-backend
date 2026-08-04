"""association: source_appointment_id — provenance for the petition→association migration

Revision ID: 046
Revises: 045
Create Date: 2026-08-05

Mirror of migration 045 (proposals) for the association pipeline. Records which
petition (appointment) an association_submissions row was migrated from, for the
"move mis-filed associations out of petition review" tooling
(scripts/migrate_associations_from_petitions.py). It is:

  • the idempotency key — a re-run skips appointments that already produced an
    association;
  • the validation link — validate_association_migration.py checks every
    migrated petition has exactly one association pointing back at it;
  • the safety gate for deletion — delete_migrated_association_petitions.py only
    removes an appointment that has a confirmed association referencing it.

Deliberately NOT a foreign key: association_submissions is kept isolated, and
the referenced appointment is HARD-DELETED at the end of the migration — an FK
would either block that delete or null this column on cascade. A plain indexed
BigInteger is correct.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "046"
down_revision: Union[str, None] = "045"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "association_submissions",
        sa.Column("source_appointment_id", sa.BigInteger, nullable=True,
                  comment="appointment.id this association was migrated from (no FK — provenance only)"),
    )
    op.create_index(
        "ix_association_submissions_source_appointment_id",
        "association_submissions", ["source_appointment_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_association_submissions_source_appointment_id", table_name="association_submissions")
    op.drop_column("association_submissions", "source_appointment_id")
