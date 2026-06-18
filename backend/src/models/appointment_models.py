"""
SQLAlchemy ORM models for appointment management and OTP verification.
Defines core permanent tables for citizen data, appointments, and attachments.
"""
from sqlalchemy import (
    Column, Integer, BigInteger, String, Text, Boolean, 
    DateTime, ForeignKey, Index
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from datetime import datetime

from src.core.database import Base


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
    
    is_used = Column(
        Boolean,
        nullable=False,
        default=False,
        comment="True if OTP has been successfully verified and consumed"
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
        Integer,
        nullable=False,
        comment="Sequential token number assigned to citizen for queue management"
    )
    
    encrypted_grievance = Column(
        Text,
        nullable=False,
        comment="AES-256 encrypted grievance/query description"
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
        comment="Appointment status: SCHEDULED, IN_PROGRESS, COMPLETED, CANCELLED"
    )
    
    schedule_meeting = Column(
        Boolean,
        nullable=False,
        default=False,
        comment="Whether citizen requested a scheduled meeting with official"
    )
    
    created_at = Column(
        DateTime,
        nullable=False,
        default=datetime.utcnow,
        comment="Timestamp when appointment was created"
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
    
    __table_args__ = (
        Index('ix_appointments_citizen_id', 'citizen_id'),
        Index('ix_appointments_slot_id', 'slot_id'),
        Index('ix_appointments_status', 'status'),
        Index('ix_appointments_created_at', 'created_at'),
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
