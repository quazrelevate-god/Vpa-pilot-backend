"""add_scheduling_tables

Revision ID: 001
Revises: 
Create Date: 2026-06-20 15:30:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '001'
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Create MLAs table
    op.create_table(
        'mlas',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False, comment='Primary key, MLA unique identifier'),
        sa.Column('name', sa.String(200), nullable=False, comment='Full name of the MLA'),
        sa.Column('constituency', sa.String(100), nullable=False, comment='Electoral constituency name'),
        sa.Column('contact_mobile', sa.String(15), nullable=True, comment="MLA's contact mobile number (for internal use)"),
        sa.Column('contact_email', sa.String(100), nullable=True, comment="MLA's email address"),
        sa.Column('office_address', sa.Text(), nullable=True, comment='Office address where meetings are held'),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default='true', comment='Whether MLA is currently active (false if term ended)'),
        sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.func.now(), comment='Timestamp when MLA record was created'),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_mlas_constituency', 'mlas', ['constituency'])
    op.create_index('ix_mlas_is_active', 'mlas', ['is_active'])
    
    # Create MLA Daily Availability table
    op.create_table(
        'mla_daily_availability',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False, comment='Primary key'),
        sa.Column('mla_id', sa.Integer(), nullable=False, comment='Foreign key to mlas table'),
        sa.Column('date', sa.Date(), nullable=False, comment='Specific date for this availability record'),
        sa.Column('start_time', sa.Time(), nullable=False, comment='Start time of availability (e.g., 16:00:00 for 4 PM)'),
        sa.Column('end_time', sa.Time(), nullable=False, comment='End time of availability (e.g., 18:00:00 for 6 PM)'),
        sa.Column('slot_duration_minutes', sa.Integer(), nullable=False, server_default='5', comment='Duration of each slot in minutes (default 5)'),
        sa.Column('total_slots', sa.Integer(), nullable=False, comment='Total number of slots available (e.g., 24 for 2 hours)'),
        sa.Column('booked_slots', sa.Integer(), nullable=False, server_default='0', comment='Number of slots currently booked'),
        sa.Column('status', sa.String(20), nullable=False, server_default='ACTIVE', comment='Status: ACTIVE, COMPLETED, CANCELLED'),
        sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.func.now(), comment='Timestamp when availability record was created'),
        sa.Column('created_by', sa.String(100), nullable=True, comment='Username of admin who created this record'),
        sa.ForeignKeyConstraint(['mla_id'], ['mlas.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('mla_id', 'date', name='uq_mla_date')
    )
    op.create_index('ix_mla_availability_mla_date', 'mla_daily_availability', ['mla_id', 'date'])
    op.create_index('ix_mla_availability_date', 'mla_daily_availability', ['date'])
    
    # Create Time Windows table
    op.create_table(
        'time_windows',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False, comment='Primary key'),
        sa.Column('availability_id', sa.Integer(), nullable=False, comment='Foreign key to mla_daily_availability table'),
        sa.Column('window_start', sa.Time(), nullable=False, comment='Start time of the window (e.g., 16:30:00)'),
        sa.Column('window_end', sa.Time(), nullable=False, comment='End time of the window (e.g., 17:00:00)'),
        sa.Column('window_label', sa.String(50), nullable=True, comment="Display label (e.g., '4:30 PM - 5:00 PM')"),
        sa.Column('total_slots_in_window', sa.Integer(), nullable=False, comment='Total number of slots in this window (e.g., 6)'),
        sa.Column('available_slots', sa.Integer(), nullable=False, comment='Number of available slots remaining'),
        sa.Column('is_available', sa.Boolean(), nullable=False, server_default='true', comment='Whether this window has any available slots'),
        sa.ForeignKeyConstraint(['availability_id'], ['mla_daily_availability.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('availability_id', 'window_start', name='uq_availability_window')
    )
    op.create_index('ix_time_windows_availability', 'time_windows', ['availability_id'])
    
    # Create Appointment Slots table
    op.create_table(
        'appointment_slots',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False, comment='Primary key, slot unique identifier'),
        sa.Column('availability_id', sa.Integer(), nullable=False, comment='Foreign key to mla_daily_availability table'),
        sa.Column('appointment_id', sa.Integer(), nullable=True, comment='Foreign key to appointments table (null if slot is available)'),
        sa.Column('slot_number', sa.Integer(), nullable=False, comment='Sequential slot number (1, 2, 3, ..., 24)'),
        sa.Column('start_time', sa.Time(), nullable=False, comment='Start time of the slot (e.g., 16:00:00)'),
        sa.Column('end_time', sa.Time(), nullable=False, comment='End time of the slot (e.g., 16:05:00)'),
        sa.Column('status', sa.String(20), nullable=False, server_default='AVAILABLE', comment='Status: AVAILABLE, BOOKED, COMPLETED, CANCELLED'),
        sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.func.now(), comment='Timestamp when slot was created'),
        sa.ForeignKeyConstraint(['availability_id'], ['mla_daily_availability.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['appointment_id'], ['appointments.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('availability_id', 'slot_number', name='uq_availability_slot')
    )
    op.create_index('ix_appointment_slots_availability', 'appointment_slots', ['availability_id'])
    op.create_index('ix_appointment_slots_appointment', 'appointment_slots', ['appointment_id'])
    op.create_index('ix_appointment_slots_status', 'appointment_slots', ['status'])
    
    # Create Reschedule Logs table
    op.create_table(
        'reschedule_logs',
        sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False, comment='Primary key'),
        sa.Column('appointment_id', sa.Integer(), nullable=False, comment='Foreign key to appointments table'),
        sa.Column('old_slot_id', sa.Integer(), nullable=True, comment='Original time slot ID'),
        sa.Column('new_slot_id', sa.Integer(), nullable=True, comment='New time slot ID (null if cancelled)'),
        sa.Column('reason', sa.String(50), nullable=False, comment='Reason code: EMERGENCY_LEAVE, PLANNED_LEAVE, CITIZEN_REQUEST, ADMIN_ACTION'),
        sa.Column('reason_details', sa.Text(), nullable=True, comment='Detailed explanation for the reschedule'),
        sa.Column('rescheduled_by', sa.String(100), nullable=True, comment='Username of admin who performed the reschedule (null if automatic)'),
        sa.Column('notification_sent', sa.Boolean(), nullable=False, server_default='false', comment='Whether SMS notification was sent to citizen'),
        sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.func.now(), comment='Timestamp when reschedule occurred'),
        sa.ForeignKeyConstraint(['appointment_id'], ['appointments.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['old_slot_id'], ['appointment_slots.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['new_slot_id'], ['appointment_slots.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_reschedule_logs_appointment', 'reschedule_logs', ['appointment_id'])
    op.create_index('ix_reschedule_logs_created_at', 'reschedule_logs', ['created_at'])
    
    # Add new columns to appointments table
    op.add_column('appointments', sa.Column('scheduled_date', sa.Date(), nullable=True, comment='Date when meeting is scheduled (null if not scheduled yet)'))
    op.add_column('appointments', sa.Column('scheduled_start_time', sa.Time(), nullable=True, comment='Start time of scheduled meeting'))
    op.add_column('appointments', sa.Column('scheduled_end_time', sa.Time(), nullable=True, comment='End time of scheduled meeting'))
    op.add_column('appointments', sa.Column('appointment_slot_id', sa.Integer(), nullable=True, comment='Foreign key to appointment_slots table'))
    op.add_column('appointments', sa.Column('preferred_window_id', sa.Integer(), nullable=True, comment="Citizen's preferred time window selection"))
    op.add_column('appointments', sa.Column('queue_position', sa.Integer(), nullable=True, comment='Position in waiting queue (null if not waiting)'))
    op.add_column('appointments', sa.Column('waiting_since', sa.DateTime(), nullable=True, comment='Timestamp when appointment was moved to waiting queue'))
    op.add_column('appointments', sa.Column('priority_score', sa.Integer(), nullable=False, server_default='0', comment='Priority score for queue processing (higher = older/more urgent)'))
    
    op.create_foreign_key('fk_appointments_slot', 'appointments', 'appointment_slots', ['appointment_slot_id'], ['id'], ondelete='SET NULL')
    op.create_foreign_key('fk_appointments_window', 'appointments', 'time_windows', ['preferred_window_id'], ['id'], ondelete='SET NULL')
    op.create_index('ix_appointments_scheduled_date', 'appointments', ['scheduled_date'])
    op.create_index('ix_appointments_queue_position', 'appointments', ['queue_position'])
    op.create_index('ix_appointments_waiting_since', 'appointments', ['waiting_since'])


def downgrade() -> None:
    # Drop in reverse order
    op.drop_index('ix_appointments_waiting_since', 'appointments')
    op.drop_index('ix_appointments_queue_position', 'appointments')
    op.drop_index('ix_appointments_scheduled_date', 'appointments')
    op.drop_constraint('fk_appointments_window', 'appointments', type_='foreignkey')
    op.drop_constraint('fk_appointments_slot', 'appointments', type_='foreignkey')
    
    op.drop_column('appointments', 'priority_score')
    op.drop_column('appointments', 'waiting_since')
    op.drop_column('appointments', 'queue_position')
    op.drop_column('appointments', 'preferred_window_id')
    op.drop_column('appointments', 'appointment_slot_id')
    op.drop_column('appointments', 'scheduled_end_time')
    op.drop_column('appointments', 'scheduled_start_time')
    op.drop_column('appointments', 'scheduled_date')
    
    op.drop_table('reschedule_logs')
    op.drop_table('appointment_slots')
    op.drop_table('time_windows')
    op.drop_table('mla_daily_availability')
    op.drop_table('mlas')
