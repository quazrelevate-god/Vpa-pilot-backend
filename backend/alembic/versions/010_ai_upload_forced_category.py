"""add forced_category to ai_uploads (PA category override)

Revision ID: 010
Revises: 009
Create Date: 2026-06-28

Staff can pick a category for a whole upload batch; when set (and not 'general')
it overrides the Gemini-detected category for every file in the batch.
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = '010'
down_revision: Union[str, None] = '009'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('ai_uploads', sa.Column('forced_category', sa.VARCHAR(50), nullable=True))


def downgrade() -> None:
    op.drop_column('ai_uploads', 'forced_category')
