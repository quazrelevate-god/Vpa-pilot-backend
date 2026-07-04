"""add appointments.encrypted_transcript for courtesy voice messages

Revision ID: 022
Revises: 021
Create Date: 2026-07-04

Courtesy submissions (invitation/greetings) skip the AI summary pipeline, so
their audio never gets transcribed as part of that call. We still want the PA
to see what the citizen actually said — this column stores the STT transcript,
Fernet-encrypted like the other PII fields. Nullable: it's only populated for
courtesy submissions that included an audio recording.
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = '022'
down_revision: Union[str, None] = '021'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('appointments', sa.Column('encrypted_transcript', sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column('appointments', 'encrypted_transcript')
