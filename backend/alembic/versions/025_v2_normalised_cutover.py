"""v2 normalised-schema cutover (v1 -> v2)

Renames the plural v1 tables to their singular v2 names, splits
mla_daily_availability into a lean availability + slots pair, folds
appointment_events / ticket_events / reschedule_logs / slot_bookings into a
single `activity` audit log, introduces the `admin` lookup (+ login) that backs
status/priority/category FK ids, seeds that lookup, and repoints the booking
link onto appointment.slot_id.

The whole transformation lives in scripts/v1_to_v2_cutover.run_cutover_conn so
the standalone runner (scripts/migrate_v1_to_v2.py) and this revision stay in
lock-step. Idempotent: a no-op if the DB is already v2.

Revision ID: 025
Revises: 024
Create Date: 2026-07-05
"""
from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "025"
down_revision: Union[str, None] = "024"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Import lazily so a broken import can never wedge alembic history loading.
    from scripts.v1_to_v2_cutover import run_cutover_conn
    run_cutover_conn(op.get_bind(), verbose=True)


def downgrade() -> None:
    # This is a one-way structural cutover (table renames + column drops +
    # audit-log fold). Reversing it would silently lose data that was folded
    # into `activity` and dropped columns; refuse rather than pretend.
    raise NotImplementedError(
        "025 v2 cutover is not reversible — restore from a pre-migration backup."
    )
