"""events: audio + transcript columns for voice-captured events

Revision ID: 042
Revises: 041
Create Date: 2026-07-30

Adds the four columns a voice-captured event needs on top of the existing
photo-capture schema, all nullable so:

  * photo-created events stay untouched (columns are null),
  * manual-created events stay untouched (image_path=sentinel already),
  * voice-created events leave image_path=sentinel + populate audio_*.

Two columns store the audio blob metadata (path + mime), and two store the
resulting transcript (Tamil + English translation from Sarvam). We keep the
transcript on the row for two reasons: (1) the reviewer can double-check
what the AI heard before approving, and (2) if a future extraction pass
wants to re-run against a different LLM without re-transcribing, the raw
transcript is right there.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "042"
down_revision: Union[str, None] = "041"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("invitation_events",
                  sa.Column("audio_path",    sa.Text(),         nullable=True,
                            comment="storage_service key, e.g. events/<hex>.webm"))
    op.add_column("invitation_events",
                  sa.Column("audio_mime",    sa.VARCHAR(100),   nullable=True))
    op.add_column("invitation_events",
                  sa.Column("transcript_ta", sa.Text(),         nullable=True,
                            comment="Sarvam STT transcript in the source language (usually Tamil)"))
    op.add_column("invitation_events",
                  sa.Column("transcript_en", sa.Text(),         nullable=True,
                            comment="Sarvam translate-mode English rendering"))


def downgrade() -> None:
    op.drop_column("invitation_events", "transcript_en")
    op.drop_column("invitation_events", "transcript_ta")
    op.drop_column("invitation_events", "audio_mime")
    op.drop_column("invitation_events", "audio_path")
