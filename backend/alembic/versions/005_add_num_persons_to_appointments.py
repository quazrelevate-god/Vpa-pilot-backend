"""add num_persons column to appointments

Revision ID: 005
Revises: 004
Create Date: 2026-06-24

Adds num_persons (INTEGER, NOT NULL, DEFAULT 1) to the appointments table.
Stores how many persons the citizen indicated will attend the MLA meeting (1–4).
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "005"
down_revision: Union[str, None] = "004"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "appointments",
        sa.Column(
            "num_persons",
            sa.Integer(),
            nullable=False,
            server_default="1",
            comment="Number of persons attending the meeting (1-4, citizen-selected at booking)",
        ),
    )


def downgrade() -> None:
    op.drop_column("appointments", "num_persons")
