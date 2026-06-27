"""
SQLAlchemy ORM models for appointment management and OTP verification.
Defines core permanent tables for citizen data, appointments, and attachments.
"""
from sqlalchemy import (
    Column, Integer, BigInteger, String, Text, Boolean,
    DateTime, Date, Time, ForeignKey, Index
)
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import relationship
from datetime import datetime

from src.core.database import Base


# ── Ticket lifecycle states ───────────────────────────────────────────────────
# The PA team moves a petition through these states manually.
# NOTE: distinct from Appointment.status (which is queue-centric:
# SCHEDULED / WAITING / RESCHEDULED / AWAITING_REVIEW / REVIEWED). ticket_status is case-management:
# "where is the petition's resolution".
TICKET_STATUSES = (
    "OPEN",              # just submitted (auto)
    "TRIAGED",           # AI summary done, ready to assign (auto when summary lands)
    "ASSIGNED",          # PA officer picked it up
    "IN_PROGRESS",       # PA is actively working
    "PENDING_DEPT",      # forwarded to a govt dept, awaiting dept response
    "PENDING_CITIZEN",   # awaiting more info from citizen
    "RESOLVED",          # action taken, awaiting close confirmation
    "CLOSED",            # case closed
    "REOPENED",          # citizen / PA re-opened a closed case
)

TICKET_PRIORITIES = ("P0", "P1", "P2", "P3")

TICKET_CLOSURE_REASONS = (
    "action_taken",
    "not_actionable",
    "duplicate",
    "resolved_by_dept",
    "no_response_from_citizen",
    "withdrawn_by_citizen",
)


class OTPVerification(Base):
    """
    Temporary OTP verification records for stateless identity gatekeeper.
    
    Lifecycle:
        1. Created when citizen requests OTP via /api/v1/otp/request
        2. Validated during atomic submission at /api/v1/appointments/submit
        3. Marked as used (is_used=True) after successful verification
        4. Expires after 3 minutes (expires_at timestamp)
    
    Security:
        - OTP code is hashed using SHA-256 before storage
        - Brute-force protection via attempts_count (max 3 attempts)
        - Indexed on (mobile_number, is_used, expires_at) for fast lookups
        - Tied to session_token from gatekeeper_sessions for audit trail
    
    Table: otp_verifications
    """
    __tablename__ = "otp_verifications"
    
    id = Column(
        BigInteger,
        primary_key=True,
        autoincrement=True,
        comment="Primary key, auto-incrementing BigInt for high volume"
    )
    
    session_token = Column(
        UUID(as_uuid=True),
        nullable=False,
        comment="Reference to gatekeeper_sessions.session_token for audit trail"
    )
    
    mobile_number = Column(
        String(15),
        nullable=False,
        comment="Citizen's mobile number (10-15 digits, international format supported)"
    )
    
    hashed_otp_code = Column(
        String(64),
        nullable=False,
        comment="SHA-256 hash of 6-digit OTP code (never store plaintext OTP)"
    )
    
    attempts_count = Column(
        Integer,
        nullable=False,
        default=0,
        comment="Number of failed OTP verification attempts (max 3)"
    )
    
    is_verified = Column(
        Boolean,
        nullable=False,
        default=False,
        comment="True after citizen passes the /otp/verify step (before form submit)"
    )

    is_used = Column(
        Boolean,
        nullable=False,
        default=False,
        comment="True if OTP has been consumed by form submission"
    )
    
    created_at = Column(
        DateTime,
        nullable=False,
        default=datetime.utcnow,
        comment="Timestamp when OTP was generated"
    )
    
    expires_at = Column(
        DateTime,
        nullable=False,
        comment="Expiration timestamp (typically created_at + 3 minutes)"
    )
    
    __table_args__ = (
        Index(
            'ix_otp_mobile_used_expires',
            'mobile_number',
            'is_used',
            'expires_at',
            postgresql_where=(is_used == False)
        ),
    )


class Citizen(Base):
    """
    Core permanent citizen registry with encrypted PII.
    
    Stores citizen identity information with field-level encryption
    for name and mobile number to comply with data protection regulations.
    
    Relationships:
        - One-to-many with Appointment (citizen can have multiple appointments)
    
    Table: citizens
    """
    __tablename__ = "citizens"
    
    id = Column(
        Integer,
        primary_key=True,
        autoincrement=True,
        comment="Primary key, citizen unique identifier"
    )
    
    encrypted_name = Column(
        Text,
        nullable=False,
        comment="AES-256 encrypted full name of citizen"
    )
    
    encrypted_mobile = Column(
        String(255),
        nullable=False,
        unique=True,
        comment="AES-256 encrypted mobile number (unique constraint for deduplication)"
    )
    
    ward_or_region = Column(
        String(100),
        nullable=True,
        comment="Constituency/ward/region identifier (plaintext for analytics)"
    )
    
    created_at = Column(
        DateTime,
        nullable=False,
        default=datetime.utcnow,
        comment="Timestamp when citizen record was first created"
    )
    
    # Relationships
    appointments = relationship(
        "Appointment",
        back_populates="citizen",
        cascade="all, delete-orphan"
    )
    
    __table_args__ = (
        Index('ix_citizens_created_at', 'created_at'),
    )


class Appointment(Base):
    """
    Core appointment booking record linking citizen to time slot.
    
    Represents a scheduled appointment with encrypted grievance description.
    Uses atomic slot allocation with FOR UPDATE SKIP LOCKED to prevent
    race conditions in high-concurrency environments.
    
    Relationships:
        - Many-to-one with Citizen
        - One-to-many with AppointmentAttachment
    
    Table: appointments
    """
    __tablename__ = "appointments"
    
    id = Column(
        Integer,
        primary_key=True,
        autoincrement=True,
        comment="Primary key, appointment unique identifier"
    )
    
    citizen_id = Column(
        Integer,
        ForeignKey('citizens.id', ondelete='CASCADE'),
        nullable=False,
        comment="Foreign key to citizens table"
    )
    
    slot_id = Column(
        Integer,
        nullable=False,
        comment="Reference to slot ID from slots table (allocated atomically)"
    )
    
    token_assigned = Column(
        BigInteger,
        nullable=False,
        comment="Token number in YYYYMMDDNNNNN format (e.g. 2026062200001) for queue management"
    )
    
    encrypted_grievance = Column(
        Text,
        nullable=True,
        comment="AES-256 encrypted grievance/query description (optional if audio provided)"
    )

    encrypted_name = Column(
        Text,
        nullable=True,
        comment="Base64-encoded name submitted with this specific appointment"
    )
    
    audio_recording_url = Column(
        Text,
        nullable=True,
        comment="Storage URL for citizen's voice recording (blob storage path)"
    )
    
    grievance_category = Column(
        String(50),
        nullable=True,
        comment="Category classification (e.g., HEALTH, EDUCATION, INFRASTRUCTURE)"
    )
    
    status = Column(
        String(20),
        nullable=False,
        default='SCHEDULED',
        comment="Appointment status: SCHEDULED, WAITING, RESCHEDULED, AWAITING_REVIEW, REVIEWED, NOT_CAME"
    )

    pre_floor_status = Column(
        String(20),
        nullable=True,
        comment="Original status captured the first time the floor board marked attendance, "
                "so a mistaken Came/Not Came can be reverted exactly (SCHEDULED vs RESCHEDULED)."
    )

    schedule_meeting = Column(
        Boolean,
        nullable=False,
        default=False,
        comment="Whether citizen requested a scheduled meeting with official"
    )

    num_persons = Column(
        Integer,
        nullable=False,
        default=1,
        comment="Number of persons attending the meeting (1-4, citizen-selected at booking)"
    )
    
    created_at = Column(
        DateTime,
        nullable=False,
        default=datetime.utcnow,
        comment="Timestamp when appointment was created"
    )
    
    # MLA Scheduling columns
    scheduled_date = Column(
        Date,
        nullable=True,
        comment="Date when meeting is scheduled (null if not scheduled yet)"
    )
    
    scheduled_start_time = Column(
        Time,
        nullable=True,
        comment="Start time of scheduled meeting"
    )
    
    scheduled_end_time = Column(
        Time,
        nullable=True,
        comment="End time of scheduled meeting"
    )
    
    appointment_slot_id = Column(
        Integer,
        ForeignKey('appointment_slots.id', ondelete='SET NULL'),
        nullable=True,
        comment="Foreign key to appointment_slots table"
    )
    
    queue_position = Column(
        Integer,
        nullable=True,
        comment="Position in waiting queue (null if not waiting)"
    )
    
    waiting_since = Column(
        DateTime,
        nullable=True,
        comment="Timestamp when appointment was moved to waiting queue"
    )
    
    priority_score = Column(
        Integer,
        nullable=False,
        default=0,
        comment="Priority score for queue processing (higher = older/more urgent)"
    )
    
    # Relationships
    citizen = relationship("Citizen", back_populates="appointments")
    attachments = relationship(
        "AppointmentAttachment",
        back_populates="appointment",
        cascade="all, delete-orphan",
    )
    grievance_summary = relationship(
        "GrievanceSummaryRecord",
        back_populates="appointment",
        cascade="all, delete-orphan",
        order_by="GrievanceSummaryRecord.created_at.desc()",
    )
    ticket = relationship(
        "Ticket",
        back_populates="appointment",
        cascade="all, delete-orphan",
        uselist=False,
    )
    events = relationship(
        "AppointmentEvent",
        back_populates="appointment",
        cascade="all, delete-orphan",
        order_by="AppointmentEvent.created_at.desc()",
    )
    scheduled_slot = relationship(
        "AppointmentSlot",
        foreign_keys=[appointment_slot_id],
    )
    
    __table_args__ = (
        Index('ix_appointments_citizen_id', 'citizen_id'),
        Index('ix_appointments_slot_id', 'slot_id'),
        Index('ix_appointments_status', 'status'),
        Index('ix_appointments_created_at', 'created_at'),
        Index('ix_appointments_scheduled_date', 'scheduled_date'),
        Index('ix_appointments_queue_position', 'queue_position'),
        Index('ix_appointments_waiting_since', 'waiting_since'),
    )


class AppointmentAttachment(Base):
    """
    Media attachments linked to appointments (audio, images, documents, video).
    
    Stores filesystem metadata for uploaded files. Actual binary data is
    stored on disk at the path specified in storage_url.
    
    Supported Types:
        - AUDIO: Voice recordings, audio notes
        - IMAGE: Photos, scanned documents
        - DOCUMENT: PDFs, Word files, spreadsheets
        - VIDEO: Video recordings
    
    Table: appointment_attachments
    """
    __tablename__ = "appointment_attachments"
    
    id = Column(
        Integer,
        primary_key=True,
        autoincrement=True,
        comment="Primary key, attachment unique identifier"
    )
    
    appointment_id = Column(
        Integer,
        ForeignKey('appointments.id', ondelete='CASCADE'),
        nullable=False,
        comment="Foreign key to appointments table"
    )
    
    attachment_type = Column(
        String(20),
        nullable=False,
        comment="Type of attachment: AUDIO, IMAGE, DOCUMENT, VIDEO"
    )
    
    storage_url = Column(
        Text,
        nullable=False,
        comment="Filesystem path or cloud storage URL where file is stored"
    )
    
    file_size_bytes = Column(
        Integer,
        nullable=False,
        comment="File size in bytes for storage quota tracking"
    )
    
    mime_type = Column(
        String(100),
        nullable=False,
        comment="MIME type of the file (e.g., audio/mpeg, image/jpeg, application/pdf)"
    )
    
    created_at = Column(
        DateTime,
        nullable=False,
        default=datetime.utcnow,
        comment="Timestamp when attachment was uploaded"
    )
    
    # Relationships
    appointment = relationship("Appointment", back_populates="attachments")
    
    __table_args__ = (
        Index('ix_attachments_appointment_id', 'appointment_id'),
        Index('ix_attachments_type', 'attachment_type'),
    )


# ── Appointment event types ─────────────────────────────────────────────────
APPOINTMENT_EVENT_TYPES = (
    "created",
    "status_changed",
    "urgency_changed",
    "category_changed",
    "department_changed",
    "rescheduled",
    "slot_blocked",
    "slot_unblocked",
    "moved_to_waiting",
    "auto_allocated",
)


class AppointmentEvent(Base):
    """
    Audit log for appointment-level changes (status, urgency, category, etc.).
    Mirrors the TicketEvent pattern so the PA portal can show a timeline.
    """
    __tablename__ = "appointment_events"

    id = Column(BigInteger, primary_key=True, autoincrement=True)

    appointment_id = Column(
        Integer,
        ForeignKey("appointments.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    event_type = Column(
        String(40),
        nullable=False,
        comment="Event type: status_changed, urgency_changed, etc.",
    )

    actor = Column(
        String(100),
        nullable=False,
        comment="PA username or 'system'",
    )

    note = Column(Text, nullable=True)

    payload = Column(JSONB, nullable=True, comment="Structured event data, e.g. {from: 'SCHEDULED', to: 'WAITING'}")

    created_at = Column(
        DateTime,
        nullable=False,
        default=datetime.utcnow,
    )

    appointment = relationship("Appointment", back_populates="events")

    __table_args__ = (
        Index("ix_appt_events_appt_created", "appointment_id", "created_at"),
    )
