"""ticket department routing + acceptance tracking

Revision ID: 018
Revises: 017
Create Date: 2026-07-02

New ticketing workflow: a ticket is routed to one of the 10 School Education
departments, whose staff accept / forward / resolve it. Adds:
  - tickets.department    (SchoolDepartment the ticket is routed to)
  - tickets.accepted_at   (when the department accepted)
  - tickets.accepted_by   (which department account accepted)
New TicketStatus (awaiting_department) and TicketEventType values are stored in
existing VARCHAR columns, so no schema change is needed for those.
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = '018'
down_revision: Union[str, None] = '017'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('tickets', sa.Column('department', sa.String(60), nullable=True))
    op.add_column('tickets', sa.Column('accepted_at', sa.DateTime(), nullable=True))
    op.add_column('tickets', sa.Column('accepted_by', sa.String(100), nullable=True))
    op.create_index('ix_tickets_department', 'tickets', ['department'])


def downgrade() -> None:
    op.drop_index('ix_tickets_department', table_name='tickets')
    op.drop_column('tickets', 'accepted_by')
    op.drop_column('tickets', 'accepted_at')
    op.drop_column('tickets', 'department')
