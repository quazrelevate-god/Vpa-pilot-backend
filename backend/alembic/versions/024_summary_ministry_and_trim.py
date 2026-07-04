"""grievance summary: rename dept → ministry, drop unused, add bilingual name

Revision ID: 024
Revises: 023
Create Date: 2026-07-04

The QR summarisation prompt was retuned to drop fields the PA never used
(headline, urgency_reason, attachment_notes, secondary_departments) and to
tighten the ministry-first routing. This migration takes the DB the rest of
the way:

  - Rename `department` → `ministry`. Same VARCHAR(60) enum values on both
    sides, so this is pure metadata.
  - Drop unused columns.
  - Add `name_en` / `name_ta` — bilingual echo of the citizen's name that
    Gemini now returns alongside the summary.

The unused columns were NOT NULL, so downgrade fills them with empty
strings — pilot data is fine to leave lossy through the round-trip.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "024"
down_revision: Union[str, None] = "023"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Rename department → ministry (data preserved, values are same enum).
    op.alter_column(
        "grievance_summary_records",
        "department",
        new_column_name="ministry",
    )
    op.execute("ALTER INDEX ix_gsr_department RENAME TO ix_gsr_ministry")

    # 2. Drop columns the retuned prompt no longer produces.
    op.drop_column("grievance_summary_records", "secondary_departments")
    op.drop_column("grievance_summary_records", "headline")
    op.drop_column("grievance_summary_records", "headline_ta")
    op.drop_column("grievance_summary_records", "priority_reason")
    op.drop_column("grievance_summary_records", "priority_reason_ta")
    op.drop_column("grievance_summary_records", "attachment_notes")
    op.drop_column("grievance_summary_records", "attachment_notes_ta")

    # 3. Bilingual name — model now returns both scripts.
    op.add_column(
        "grievance_summary_records",
        sa.Column("name_en", sa.String(200), nullable=False, server_default=""),
    )
    op.add_column(
        "grievance_summary_records",
        sa.Column("name_ta", sa.String(200), nullable=False, server_default=""),
    )


def downgrade() -> None:
    op.drop_column("grievance_summary_records", "name_ta")
    op.drop_column("grievance_summary_records", "name_en")

    op.add_column(
        "grievance_summary_records",
        sa.Column("attachment_notes_ta", sa.Text(), nullable=True),
    )
    op.add_column(
        "grievance_summary_records",
        sa.Column("attachment_notes", sa.Text(), nullable=True),
    )
    op.add_column(
        "grievance_summary_records",
        sa.Column("priority_reason_ta", sa.Text(), nullable=True),
    )
    op.add_column(
        "grievance_summary_records",
        sa.Column("priority_reason", sa.Text(), nullable=True),
    )
    op.add_column(
        "grievance_summary_records",
        sa.Column("headline_ta", sa.String(200), nullable=False, server_default=""),
    )
    op.add_column(
        "grievance_summary_records",
        sa.Column("headline", sa.String(150), nullable=False, server_default=""),
    )
    op.add_column(
        "grievance_summary_records",
        sa.Column(
            "secondary_departments",
            JSONB(),
            nullable=False,
            server_default="[]",
        ),
    )

    op.execute("ALTER INDEX ix_gsr_ministry RENAME TO ix_gsr_department")
    op.alter_column(
        "grievance_summary_records",
        "ministry",
        new_column_name="department",
    )
