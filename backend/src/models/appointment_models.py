"""
SQLAlchemy ORM models for appointment management and OTP verification.
Defines core permanent tables for citizen data, appointments, and attachments.

v2 schema — table names and FK references match mla_scheduler_v2.
Column("db_name", ...) mapping used where v1 attribute names differ from v2 DB
column names, so existing service code keeps working without renaming.
"""
from sqlalchemy import (
    Column, Integer, BigInteger, String, Text, Boolean,
    DateTime, ForeignKey, Index
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from datetime import datetime

from src.core.database import Base


# ── Ticket lifecycle states ───────────────────────────────────────────────────
TICKET_STATUSES = (
    "OPEN",
    "TRIAGED",
    "ASSIGNED",
    "IN_PROGRESS",
    "PENDING_DEPT",
    "PENDING_CITIZEN",
    "RESOLVED",
    "CLOSED",
    "REOPENED",
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
    OTP verification records. Table renamed from v2's 'verification' to
    'otp_verification' with v1 column names per user decision.
    """
    __tablename__ = "otp_verification"

    id = Column(BigInteger, primary_key=True, autoincrement=True)

    session_token = Column(
        UUID(as_uuid=True),
        ForeignKey("gatekeeper.session_token", ondelete="CASCADE"),
        nullable=False, index=True,
        comment="FK to gatekeeper.session_token — links OTP to the specific "
                "device/session that requested it (device_fingerprint on gatekeeper).",
    )

    mobile_number = Column(String(15), nullable=False)

    hashed_otp_code = Column(
        String(64), nullable=False,
        comment="SHA-256 hash of 6-digit OTP code",
    )

    attempts_count = Column(Integer, nullable=False, default=0)

    is_verified = Column(
        Boolean, nullable=False, default=False,
        comment="True after citizen passes /otp/verify (pre-submit)",
    )

    is_used = Column(
        Boolean, nullable=False, default=False,
        comment="True after OTP has been consumed by form submission",
    )

    token_assigned = Column(
        BigInteger, nullable=True, index=True,
        comment="Token number of the appointment this OTP authorised. "
                "Set at form-submit time so we can trace OTP → appointment.",
    )

    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    expires_at = Column(DateTime, nullable=False)

    __table_args__ = (
        Index(
            'ix_otp_mobile_used_expires',
            'mobile_number', 'is_used', 'expires_at',
            postgresql_where=(is_used == False)
        ),
    )


class Citizen(Base):
    """Core permanent citizen registry with encrypted PII."""
    __tablename__ = "citizens"

    id = Column(Integer, primary_key=True, autoincrement=True)

    encrypted_name = Column(Text, nullable=False)
    encrypted_mobile = Column(String(512), nullable=False)

    # v1 attr name 'mobile_index' → v2 DB column 'identity_index'
    mobile_index = Column(
        "identity_index", String(64),
        nullable=True, unique=True, index=True,
        comment="Deterministic HMAC of the mobile for dedup",
    )

    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)

    appointments = relationship(
        "Appointment", back_populates="citizen",
        cascade="all, delete-orphan",
    )

    __table_args__ = (
        Index('ix_citizens_created_at', 'created_at'),
    )


class Appointment(Base):
    """
    Core appointment record. v2 schema — lean design with FK lookups.

    Column mapping (attribute → DB column):
        token_assigned → token_number
        venue_id       → venue
        grievance_category → category
    """
    __tablename__ = "appointment"

    id = Column(Integer, primary_key=True, autoincrement=True)

    citizen_id = Column(
        Integer, ForeignKey('citizens.id', ondelete='CASCADE'), nullable=False,
    )

    slot_id = Column(
        Integer, ForeignKey('slots.id', ondelete='SET NULL'), nullable=True,
        comment="v2: booked slot (was appointment_slot_id in v1). NULL for waiting/petition-only.",
    )

    # Persistent citizen intent — TRUE for meeting requests even after the
    # slot is released (waiting queue). slot_id alone isn't enough because it
    # goes NULL when we release, so `kind=meeting` filters would drop WAITING
    # rows without this.
    schedule_meeting = Column(
        Boolean, nullable=False, default=False, server_default="false",
    )

    # v1 attr → v2 DB column "token_number"
    token_assigned = Column(
        "token_number", BigInteger, nullable=False,
        comment="Token in YYYYMMDDNNNNN format",
    )

    encrypted_grievance = Column(Text, nullable=True)

    # PA-entered Tamil name for the review drawer. Not on Citizen because it's
    # per-appointment (a PA may re-enter it differently on a subsequent case).
    encrypted_name_ta = Column(
        Text,
        nullable=True,
        comment="Fernet-encrypted Tamil name (PA-entered in the review drawer)"
    )

    # v1 attr → v2 DB column "category"
    grievance_category = Column("category", String(50), nullable=True)

    # Bridge: v1 services still write string status alongside status_id
    status = Column(
        String(20), nullable=False, default='SCHEDULED',
        comment="Bridge column — v1 services still write this; v2 uses status_id",
    )

    status_id = Column(BigInteger, nullable=True)
    priority_id = Column(BigInteger, nullable=True)
    category_id = Column(BigInteger, nullable=True)

    num_persons = Column(Integer, nullable=False, default=1)

    # v1 attr → v2 DB column "venue"
    venue_id = Column("venue", String(100), nullable=True)

    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)

    queue_position = Column(Integer, nullable=True)
    waiting_since = Column(DateTime, nullable=True)

    summary_status = Column(
        String(20), nullable=False, default="PENDING", server_default="PENDING",
    )
    summary_attempts = Column(
        Integer, nullable=False, default=0, server_default="0",
    )
    summary_claimed_at = Column(DateTime, nullable=True)

    # Relationships
    citizen = relationship("Citizen", back_populates="appointments")
    attachments = relationship(
        "AppointmentAttachment", back_populates="appointment",
        cascade="all, delete-orphan",
    )
    grievance_summary = relationship(
        "GrievanceSummaryRecord", back_populates="appointment",
        cascade="all, delete-orphan",
        order_by="GrievanceSummaryRecord.created_at.desc()",
    )
    ticket = relationship(
        "Ticket", back_populates="appointment",
        cascade="all, delete-orphan", uselist=False,
    )
    scheduled_slot = relationship(
        "AppointmentSlot",
        foreign_keys=[slot_id],
        lazy="joined",
    )
    __table_args__ = (
        Index('ix_appointments_citizen_id', 'citizen_id'),
        Index('ix_appointments_token_assigned', 'token_number', unique=True),
        Index('ix_appointments_slot_id', 'slot_id'),
        Index('ix_appointments_status', 'status'),
        Index('ix_appointments_created_at', 'created_at'),
        Index('ix_appointments_queue_position', 'queue_position'),
        Index('ix_appointments_waiting_since', 'waiting_since'),
        Index('ix_appointments_summary_pending', 'summary_status',
              postgresql_where=(summary_status.in_(('PENDING', 'PROCESSING')))),
    )


class AppointmentAttachment(Base):
    """Media attachments linked to appointments."""
    __tablename__ = "attachments"

    id = Column(Integer, primary_key=True, autoincrement=True)

    appointment_id = Column(
        Integer, ForeignKey('appointment.id', ondelete='CASCADE'), nullable=False,
    )

    ticket_id = Column(
        BigInteger, ForeignKey('ticket.id', ondelete='SET NULL'), nullable=True,
    )

    attachment_type = Column(String(20), nullable=False)
    storage_url = Column(Text, nullable=False)
    file_size_bytes = Column(Integer, nullable=False)
    mime_type = Column(String(100), nullable=False)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)

    appointment = relationship("Appointment", back_populates="attachments")

    __table_args__ = (
        Index('ix_attachments_appointment_id', 'appointment_id'),
        Index('ix_attachments_type', 'attachment_type'),
    )


# v2: AppointmentEvent class removed — writes go through Activity
# (models/activity_models.py) as a unified audit log. Event-type strings
# ("status_changed", "priority_changed", "category_changed",
# "department_changed", "rescheduled", "slot_blocked", "moved_to_waiting",
# "auto_allocated") are used as free-form action_type values on Activity.
