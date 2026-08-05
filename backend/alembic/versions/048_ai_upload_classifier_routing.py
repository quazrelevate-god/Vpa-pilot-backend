"""ai_uploads: classifier routing provenance (proposal/association)

Revision ID: 048
Revises: 047
Create Date: 2026-08-05

The AI-upload worker now classifies every uploaded document first and routes
proposals/associations into their own tables instead of forcing everything
through petition extraction. When that happens the ai_uploads row is kept
(status='ROUTED') as a recoverable audit trail — a PA can see it was routed and
move it back to the petition queue if the classifier was wrong.

Three additive, nullable columns support that:
  • routed_to     — 'proposal' | 'association' (what it became)
  • routed_ref_id — the proposal_submissions / association_submissions id
  • route_locked  — set True on a "move back to petitions" action so the worker
                    re-processes it as a petition WITHOUT re-classifying (which
                    would just route it out again).

All nullable / defaulted, so this is a safe online add on the live table.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "048"
down_revision: Union[str, None] = "047"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("ai_uploads", sa.Column("routed_to", sa.VARCHAR(20), nullable=True))
    op.add_column("ai_uploads", sa.Column("routed_ref_id", sa.BigInteger, nullable=True))
    op.add_column(
        "ai_uploads",
        sa.Column("route_locked", sa.Boolean, nullable=False, server_default=sa.text("false")),
    )
    op.create_index("ix_ai_uploads_routed_to", "ai_uploads", ["routed_to"])


def downgrade() -> None:
    op.drop_index("ix_ai_uploads_routed_to", table_name="ai_uploads")
    op.drop_column("ai_uploads", "route_locked")
    op.drop_column("ai_uploads", "routed_ref_id")
    op.drop_column("ai_uploads", "routed_to")
