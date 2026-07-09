"""ai_uploads: add source column

Revision ID: 029
Revises: 028
Create Date: 2026-07-09

Adds a `source` column to ai_uploads so the uploading PA can declare the
intake channel (ai_scan / postal / cm_office / …) at upload time instead of
always defaulting to ai_scan.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "029"
down_revision: Union[str, None] = "028"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "ai_uploads",
        sa.Column("source", sa.VARCHAR(50), nullable=False, server_default="ai_scan"),
    )


def downgrade() -> None:
    op.drop_column("ai_uploads", "source")
