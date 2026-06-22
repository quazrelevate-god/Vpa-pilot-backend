"""add ticketing, grievance_summary_records tables, encrypted_name column, token_assigned bigint

Revision ID: 004
Revises: 003
Create Date: 2026-06-22

This migration adds:
1. grievance_summary_records table (AI-generated summaries)
2. tickets table (PA case-management)
3. ticket_events table (audit log)
4. encrypted_name column on appointments (per-submission name)
5. token_assigned column type change from INTEGER to BIGINT
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB


# revision identifiers, used by Alembic.
revision: str = '004'
down_revision: Union[str, None] = '003'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── 1. grievance_summary_records table ──────────────────────────────────
    op.create_table(
        'grievance_summary_records',
        sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False, comment='Primary key'),
        sa.Column('appointment_id', sa.Integer(), nullable=False, comment='The appointment this summary belongs to'),
        sa.Column('is_latest', sa.Boolean(), nullable=False, server_default='true', comment='True for the most recent summary; False for archived re-runs'),
        sa.Column('urgency', sa.VARCHAR(20), nullable=False, comment='UrgencyLevel enum: low | medium | high | critical'),
        sa.Column('category', sa.VARCHAR(50), nullable=False, comment='GrievanceCategory enum value for routing'),
        sa.Column('department', sa.VARCHAR(60), nullable=False, server_default='other', comment='PRIMARY Department enum value'),
        sa.Column('secondary_departments', JSONB, nullable=False, server_default='[]', comment='0-2 additional Department enum values'),
        sa.Column('headline', sa.VARCHAR(150), nullable=False, comment='One-line English case title'),
        sa.Column('summary', sa.Text(), nullable=False, comment='2-3 sentence English summary'),
        sa.Column('citizen_ask', sa.Text(), nullable=False, comment='Specific action requested by the citizen (English)'),
        sa.Column('urgency_reason', sa.Text(), nullable=True, comment='Why urgency is HIGH/CRITICAL'),
        sa.Column('key_details', JSONB, nullable=False, comment='3-6 factual bullet points (English)'),
        sa.Column('attachment_notes', sa.Text(), nullable=True, comment='What the image/PDF/audio showed (English)'),
        sa.Column('headline_ta', sa.VARCHAR(200), nullable=False, comment='Tamil translation of headline'),
        sa.Column('summary_ta', sa.Text(), nullable=False, comment='Tamil translation of summary'),
        sa.Column('citizen_ask_ta', sa.Text(), nullable=False, comment='Tamil translation of citizen_ask'),
        sa.Column('urgency_reason_ta', sa.Text(), nullable=True, comment='Tamil translation of urgency_reason'),
        sa.Column('key_details_ta', JSONB, nullable=False, comment='Tamil translation of key_details'),
        sa.Column('attachment_notes_ta', sa.Text(), nullable=True, comment='Tamil translation of attachment_notes'),
        sa.Column('audio_transcript', sa.Text(), nullable=True, comment='Verbatim transcript of audio recording'),
        sa.Column('audio_stt_latency_ms', sa.Integer(), nullable=True, comment='End-to-end STT round-trip in ms'),
        sa.Column('gemini_model_used', sa.VARCHAR(60), nullable=False, comment='Exact model ID used'),
        sa.Column('gemini_latency_ms', sa.Integer(), nullable=True, comment='End-to-end Gemini round-trip in ms'),
        sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.func.now(), comment='When this summary record was created (UTC)'),
        sa.ForeignKeyConstraint(['appointment_id'], ['appointments.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_gsr_appointment_latest', 'grievance_summary_records', ['appointment_id', 'is_latest'])
    op.create_index('ix_gsr_urgency', 'grievance_summary_records', ['urgency'])
    op.create_index('ix_gsr_category', 'grievance_summary_records', ['category'])
    op.create_index('ix_gsr_department', 'grievance_summary_records', ['department'])
    op.create_index('ix_gsr_created_at', 'grievance_summary_records', ['created_at'])

    # ── 2. tickets table ────────────────────────────────────────────────────
    op.create_table(
        'tickets',
        sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column('appointment_id', sa.Integer(), nullable=False, comment='One-to-one link back to the originating appointment'),
        sa.Column('ticket_number', sa.VARCHAR(20), nullable=False, comment='Display id, e.g., TKT-2026-00001'),
        sa.Column('status', sa.VARCHAR(30), nullable=False, server_default='open', comment='TicketStatus enum value'),
        sa.Column('priority', sa.VARCHAR(5), nullable=True, comment='TicketPriority enum (P0/P1/P2/P3)'),
        sa.Column('assigned_to_pa', sa.VARCHAR(100), nullable=True, comment='PA username currently owning this ticket'),
        sa.Column('due_date', sa.DateTime(), nullable=True, comment='Manual SLA deadline set by PA'),
        sa.Column('forwarded_to_dept', sa.VARCHAR(60), nullable=True, comment='Department enum value the ticket was forwarded to'),
        sa.Column('forwarded_at', sa.DateTime(), nullable=True, comment='When the ticket was forwarded'),
        sa.Column('forwarded_by', sa.VARCHAR(100), nullable=True, comment='PA username who forwarded the ticket'),
        sa.Column('forwarded_notes', sa.Text(), nullable=True, comment='Free-text note for forwarding'),
        sa.Column('resolution_notes', sa.Text(), nullable=True, comment='What action was taken to resolve the case'),
        sa.Column('closure_reason', sa.VARCHAR(40), nullable=True, comment='ClosureReason enum value'),
        sa.Column('resolved_at', sa.DateTime(), nullable=True, comment='When RESOLVED status was set'),
        sa.Column('closed_at', sa.DateTime(), nullable=True, comment='When CLOSED status was set'),
        sa.Column('reopened_at', sa.DateTime(), nullable=True, comment='When the ticket was last reopened'),
        sa.Column('reopen_count', sa.Integer(), nullable=False, server_default='0', comment='Number of times this ticket has been reopened'),
        sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(['appointment_id'], ['appointments.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('appointment_id', name='uq_tickets_appointment_id'),
        sa.UniqueConstraint('ticket_number', name='uq_tickets_ticket_number'),
    )
    op.create_index('ix_tickets_status', 'tickets', ['status'])
    op.create_index('ix_tickets_priority', 'tickets', ['priority'])
    op.create_index('ix_tickets_assigned_to', 'tickets', ['assigned_to_pa'])
    op.create_index('ix_tickets_created_at', 'tickets', ['created_at'])
    op.create_index('ix_tickets_forwarded_to_dept', 'tickets', ['forwarded_to_dept'])
    op.create_index('ix_tickets_due_date', 'tickets', ['due_date'])

    # ── 3. ticket_events table ──────────────────────────────────────────────
    op.create_table(
        'ticket_events',
        sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column('ticket_id', sa.BigInteger(), nullable=False, comment='FK to tickets table'),
        sa.Column('event_type', sa.VARCHAR(40), nullable=False, comment='TicketEventType enum value'),
        sa.Column('actor', sa.VARCHAR(100), nullable=False, comment='PA username or system'),
        sa.Column('note', sa.Text(), nullable=True, comment='Free-text note attached to the event'),
        sa.Column('payload', JSONB, nullable=True, comment='Event-specific structured data'),
        sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(['ticket_id'], ['tickets.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_ticket_events_ticket_id', 'ticket_events', ['ticket_id'])
    op.create_index('ix_ticket_events_ticket_created', 'ticket_events', ['ticket_id', 'created_at'])

    # ── 4. encrypted_name column on appointments ────────────────────────────
    op.add_column('appointments',
        sa.Column('encrypted_name', sa.Text(), nullable=True,
                  comment='Base64-encoded name submitted with this specific appointment'))

    # ── 5. token_assigned: INTEGER → BIGINT ─────────────────────────────────
    op.alter_column('appointments', 'token_assigned',
        existing_type=sa.Integer(),
        type_=sa.BigInteger(),
        existing_nullable=False,
        comment='Token number in YYYYMMDDNNNNN format (e.g. 2026062200001) for queue management')


def downgrade() -> None:
    # Revert token_assigned to INTEGER
    op.alter_column('appointments', 'token_assigned',
        existing_type=sa.BigInteger(),
        type_=sa.Integer(),
        existing_nullable=False,
        comment='Sequential token number assigned to citizen for queue management')

    # Drop encrypted_name
    op.drop_column('appointments', 'encrypted_name')

    # Drop ticket_events
    op.drop_index('ix_ticket_events_ticket_created', 'ticket_events')
    op.drop_index('ix_ticket_events_ticket_id', 'ticket_events')
    op.drop_table('ticket_events')

    # Drop tickets
    op.drop_index('ix_tickets_due_date', 'tickets')
    op.drop_index('ix_tickets_forwarded_to_dept', 'tickets')
    op.drop_index('ix_tickets_created_at', 'tickets')
    op.drop_index('ix_tickets_assigned_to', 'tickets')
    op.drop_index('ix_tickets_priority', 'tickets')
    op.drop_index('ix_tickets_status', 'tickets')
    op.drop_table('tickets')

    # Drop grievance_summary_records
    op.drop_index('ix_gsr_created_at', 'grievance_summary_records')
    op.drop_index('ix_gsr_department', 'grievance_summary_records')
    op.drop_index('ix_gsr_category', 'grievance_summary_records')
    op.drop_index('ix_gsr_urgency', 'grievance_summary_records')
    op.drop_index('ix_gsr_appointment_latest', 'grievance_summary_records')
    op.drop_table('grievance_summary_records')
