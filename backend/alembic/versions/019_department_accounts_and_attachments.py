"""department accounts + ticket attachments + progress_pct

Revision ID: 019
Revises: 018
Create Date: 2026-07-02

- department_accounts: 10 shared department logins (seed via seed_departments.py)
- ticket_attachments: resolution proof files a department uploads to resolve
- tickets.progress_pct: department-reported 0-100 progress
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = '019'
down_revision: Union[str, None] = '018'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('tickets', sa.Column('progress_pct', sa.Integer(), nullable=False, server_default='0'))

    op.create_table(
        'department_accounts',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('department', sa.String(60), nullable=False, unique=True),
        sa.Column('username', sa.String(60), nullable=False, unique=True),
        sa.Column('password_hash', sa.String(128), nullable=False),
        sa.Column('display_name', sa.String(150), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.text('now()')),
    )

    op.create_table(
        'ticket_attachments',
        sa.Column('id', sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column('ticket_id', sa.BigInteger(), sa.ForeignKey('tickets.id', ondelete='CASCADE'), nullable=False),
        sa.Column('kind', sa.String(20), nullable=False, server_default='resolution'),
        sa.Column('storage_url', sa.Text(), nullable=False),
        sa.Column('mime_type', sa.String(100), nullable=False),
        sa.Column('file_size_bytes', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('original_filename', sa.String(255), nullable=True),
        sa.Column('uploaded_by', sa.String(100), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.text('now()')),
    )
    op.create_index('ix_ticket_attachments_ticket_id', 'ticket_attachments', ['ticket_id'])


def downgrade() -> None:
    op.drop_index('ix_ticket_attachments_ticket_id', table_name='ticket_attachments')
    op.drop_table('ticket_attachments')
    op.drop_table('department_accounts')
    op.drop_column('tickets', 'progress_pct')
