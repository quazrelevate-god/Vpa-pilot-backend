"""track courtesy transcript work state on appointments

Revision ID: 023
Revises: 022
Create Date: 2026-07-04

Fire-and-forget transcription drops the audio on a Sarvam/Gemini outage: the
audio sits on disk, the row lives, no transcript ever gets written. This
migration adds the durable-worker state so a background loop can drain pending
transcripts and cap retries.

transcript_status:
  NULL        — not a courtesy row (or no audio to transcribe)
  'PENDING'   — needs transcription; the worker will pick this up
  'DONE'      — transcript written to encrypted_transcript
  'FAILED'    — hit the retry cap; the PA still has the audio to play

transcript_attempts: cheap counter so we can cap retries and stop hammering
  a Sarvam+Gemini double outage.
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = '023'
down_revision: Union[str, None] = '022'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('appointments', sa.Column('transcript_status', sa.String(20), nullable=True))
    op.add_column('appointments', sa.Column(
        'transcript_attempts', sa.Integer(), nullable=False, server_default='0',
    ))
    # Partial index so the worker's poll is O(pending), not O(all appointments).
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_appointments_transcript_pending "
        "ON appointments (id) WHERE transcript_status = 'PENDING'"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_appointments_transcript_pending")
    op.drop_column('appointments', 'transcript_attempts')
    op.drop_column('appointments', 'transcript_status')
