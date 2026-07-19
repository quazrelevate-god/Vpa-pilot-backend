"""ticket: add reverted-* fields for the revert-to-review action

Revision ID: 032
Revises: 031
Create Date: 2026-07-17

Adds three nullable columns to `ticket` so a PA can revert an OPEN ticket
back to the Petition Review queue without losing its audit trail:

    reverted_at     — when the revert happened
    reverted_by     — the PA who did it
    revert_reason   — free-text reason (min 4 chars enforced in the service)

The `reverted` value itself is stored in the existing `status` column
(TicketStatus enum), which is already VARCHAR(30) — no widening needed.

On re-approve (PA changes their mind and re-approves the petition from the
review queue), the same ticket row is reused — status flips back to OPEN
and these columns are cleared. See `dashboard_service.update_appointment_status`.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "032"
down_revision: Union[str, None] = "031"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("ticket", sa.Column("reverted_at",   sa.DateTime(),      nullable=True))
    op.add_column("ticket", sa.Column("reverted_by",   sa.VARCHAR(100),    nullable=True))
    op.add_column("ticket", sa.Column("revert_reason", sa.Text(),          nullable=True))

    # Seed the v2 admin lookup so revert_ticket() can resolve the new status
    # to an admin.id. Every other ticket status was seeded in the v2 cutover;
    # we're just appending one more row.
    op.execute(
        "INSERT INTO admin (entity, name) "
        "SELECT 'ticket', 'reverted' "
        "WHERE NOT EXISTS ("
        "  SELECT 1 FROM admin WHERE entity='ticket' AND name='reverted'"
        ")"
    )


def downgrade() -> None:
    op.execute(
        "DELETE FROM admin WHERE entity='ticket' AND name='reverted'"
    )
    op.drop_column("ticket", "revert_reason")
    op.drop_column("ticket", "reverted_by")
    op.drop_column("ticket", "reverted_at")
