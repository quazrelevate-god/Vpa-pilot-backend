"""events: attendance marker on invitation_events

Revision ID: 036
Revises: 035
Create Date: 2026-07-22

Adds a single nullable `attendance` column so the PA can mark, post-event,
whether the Minister actually attended: 'attended' | 'not_attended' | NULL
(not yet reviewed). Left as a VARCHAR (not enum) so a future extension —
e.g. 'sent_representative' — is one PATCH away, no migration needed.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "036"
down_revision: Union[str, None] = "035"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "invitation_events",
        sa.Column("attendance", sa.VARCHAR(20), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("invitation_events", "attendance")
