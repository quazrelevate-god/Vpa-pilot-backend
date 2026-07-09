"""grievance summary: add district column

Revision ID: 027
Revises: 026
Create Date: 2026-07-09

Adds a nullable `district` column to grievance_summary_records so the AI
summarisation prompt can extract the originating Tamil Nadu district
(38-district enum) and the PA can override / fill it from the detail
drawer. NULL means "unknown" — either Gemini abstained or the row was
created before this column existed.

An index on district lets the leadership dashboard filter by district
without a full scan once volumes grow.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "027"
down_revision: Union[str, None] = "026"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "grievance_summary_records",
        sa.Column("district", sa.String(length=40), nullable=True),
    )
    op.create_index(
        "ix_gsr_district",
        "grievance_summary_records",
        ["district"],
    )


def downgrade() -> None:
    op.drop_index("ix_gsr_district", table_name="grievance_summary_records")
    op.drop_column("grievance_summary_records", "district")
