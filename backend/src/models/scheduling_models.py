"""
SQLAlchemy ORM models for MLA scheduling and availability management.
Handles time slot allocation, MLA availability, and emergency rescheduling.
"""
from sqlalchemy import (
    Column, Integer, BigInteger, String, Text, Boolean, 
    DateTime, Date, Time, ForeignKey, Index
)
from sqlalchemy.orm import relationship
from datetime import datetime

from src.core.database import Base


class MLA(Base):
    """
    MLA (Member of Legislative Assembly) profile and contact information.
    
    Represents the elected official who will meet with citizens.
    Can have multiple availability schedules and time slots.
    
    Table: mlas
    """
    __tablename__ = "mlas"
    
    id = Column(
        Integer,
        primary_key=True,
        autoincrement=True,
        comment="Primary key, MLA unique identifier"
    )
    
    name = Column(
        String(200),
        nullable=False,
        comment="Full name of the MLA"
    )
    
    constituency = Column(
        String(100),
        nullable=False,
        comment="Electoral constituency name"
    )
    
    contact_mobile = Column(
        String(15),
        nullable=True,
        comment="MLA's contact mobile number (for internal use)"
    )
    
    contact_email = Column(
        String(100),
        nullable=True,
        comment="MLA's email address"
    )
    
    office_address = Column(
        Text,
        nullable=True,
        comment="Office address where meetings are held"
    )
    
    is_active = Column(
        Boolean,
        nullable=False,
        default=True,
        comment="Whether MLA is currently active (false if term ended)"
    )
    
    created_at = Column(
        DateTime,
        nullable=False,
        default=datetime.utcnow,
        comment="Timestamp when MLA record was created"
    )
    
    # Relationships
    availabilities = relationship(
        "MLADailyAvailability",
        back_populates="mla",
        cascade="all, delete-orphan"
    )
    
    __table_args__ = (
        Index('ix_mlas_constituency', 'constituency'),
        Index('ix_mlas_is_active', 'is_active'),
    )


class MLADailyAvailability(Base):
    """
    MLA availability schedule for specific dates.
    
    Defines when an MLA is available for meetings on a given day.
    Used to generate time slots and manage capacity.
    
    Table: mla_daily_availability
    """
    __tablename__ = "mla_daily_availability"
    
    id = Column(
        Integer,
        primary_key=True,
        autoincrement=True,
        comment="Primary key"
    )
    
    mla_id = Column(
        Integer,
        ForeignKey('mlas.id', ondelete='CASCADE'),
        nullable=False,
        comment="Foreign key to mlas table"
    )
    
    date = Column(
        Date,
        nullable=False,
        comment="Specific date for this availability record"
    )
    
    start_time = Column(
        Time,
        nullable=False,
        comment="Start time of availability (e.g., 16:00:00 for 4 PM)"
    )
    
    end_time = Column(
        Time,
        nullable=False,
        comment="End time of availability (e.g., 18:00:00 for 6 PM)"
    )
    
    slot_duration_minutes = Column(
        Integer,
        nullable=False,
        default=5,
        comment="Duration of each slot in minutes (default 5)"
    )
    
    total_slots = Column(
        Integer,
        nullable=False,
        comment="Total number of slots available (e.g., 24 for 2 hours)"
    )
    
    booked_slots = Column(
        Integer,
        nullable=False,
        default=0,
        comment="Number of slots currently booked"
    )
    
    status = Column(
        String(20),
        nullable=False,
        default='ACTIVE',
        comment="Status: ACTIVE, COMPLETED, CANCELLED"
    )
    
    created_at = Column(
        DateTime,
        nullable=False,
        default=datetime.utcnow,
        comment="Timestamp when availability record was created"
    )
    
    created_by = Column(
        String(100),
        nullable=True,
        comment="Username of admin who created this record"
    )
    
    # Relationships
    mla = relationship("MLA", back_populates="availabilities")
    time_windows = relationship(
        "TimeWindow",
        back_populates="availability",
        cascade="all, delete-orphan"
    )
    slots = relationship(
        "AppointmentSlot",
        back_populates="availability",
        cascade="all, delete-orphan"
    )
    
    __table_args__ = (
        Index('ix_mla_availability_mla_date', 'mla_id', 'date'),
        Index('ix_mla_availability_date', 'date'),
    )


class TimeWindow(Base):
    """
    30-minute time windows for citizen selection.
    
    Groups individual slots into user-friendly time windows.
    Example: 4:30 PM - 5:00 PM contains 6 slots of 5 minutes each.
    
    Table: time_windows
    """
    __tablename__ = "time_windows"
    
    id = Column(
        Integer,
        primary_key=True,
        autoincrement=True,
        comment="Primary key"
    )
    
    availability_id = Column(
        Integer,
        ForeignKey('mla_daily_availability.id', ondelete='CASCADE'),
        nullable=False,
        comment="Foreign key to mla_daily_availability table"
    )
    
    window_start = Column(
        Time,
        nullable=False,
        comment="Start time of the window (e.g., 16:30:00)"
    )
    
    window_end = Column(
        Time,
        nullable=False,
        comment="End time of the window (e.g., 17:00:00)"
    )
    
    window_label = Column(
        String(50),
        nullable=True,
        comment="Display label (e.g., '4:30 PM - 5:00 PM')"
    )
    
    total_slots_in_window = Column(
        Integer,
        nullable=False,
        comment="Total number of slots in this window (e.g., 6)"
    )
    
    available_slots = Column(
        Integer,
        nullable=False,
        comment="Number of available slots remaining"
    )
    
    is_available = Column(
        Boolean,
        nullable=False,
        default=True,
        comment="Whether this window has any available slots"
    )
    
    # Relationships
    availability = relationship("MLADailyAvailability", back_populates="time_windows")
    
    __table_args__ = (
        Index('ix_time_windows_availability', 'availability_id'),
    )


class AppointmentSlot(Base):
    """
    Individual 5-minute time slots for appointments.
    
    Represents specific time windows when citizens can book appointments.
    Slots are created based on MLA availability.
    
    Table: appointment_slots
    """
    __tablename__ = "appointment_slots"
    
    id = Column(
        Integer,
        primary_key=True,
        autoincrement=True,
        comment="Primary key, slot unique identifier"
    )
    
    availability_id = Column(
        Integer,
        ForeignKey('mla_daily_availability.id', ondelete='CASCADE'),
        nullable=False,
        comment="Foreign key to mla_daily_availability table"
    )
    
    appointment_id = Column(
        Integer,
        ForeignKey('appointments.id', ondelete='SET NULL'),
        nullable=True,
        comment="Foreign key to appointments table (null if slot is available)"
    )
    
    slot_number = Column(
        Integer,
        nullable=False,
        comment="Sequential slot number (1, 2, 3, ..., 24)"
    )
    
    start_time = Column(
        Time,
        nullable=False,
        comment="Start time of the slot (e.g., 16:00:00)"
    )
    
    end_time = Column(
        Time,
        nullable=False,
        comment="End time of the slot (e.g., 16:05:00)"
    )
    
    status = Column(
        String(20),
        nullable=False,
        default='AVAILABLE',
        comment="Status: AVAILABLE, BOOKED, COMPLETED, CANCELLED"
    )
    
    created_at = Column(
        DateTime,
        nullable=False,
        default=datetime.utcnow,
        comment="Timestamp when slot was created"
    )
    
    # Relationships
    availability = relationship("MLADailyAvailability", back_populates="slots")
    appointment = relationship("Appointment", foreign_keys=[appointment_id])
    
    __table_args__ = (
        Index('ix_appointment_slots_availability', 'availability_id'),
        Index('ix_appointment_slots_appointment', 'appointment_id'),
        Index('ix_appointment_slots_status', 'status'),
    )


class RescheduleLog(Base):
    """
    Audit log for appointment rescheduling events.
    
    Tracks all rescheduling actions including emergency cancellations,
    MLA unavailability, and manual rescheduling by staff.
    
    Table: reschedule_logs
    """
    __tablename__ = "reschedule_logs"
    
    id = Column(
        BigInteger,
        primary_key=True,
        autoincrement=True,
        comment="Primary key"
    )
    
    appointment_id = Column(
        Integer,
        ForeignKey('appointments.id', ondelete='CASCADE'),
        nullable=False,
        comment="Foreign key to appointments table"
    )
    
    old_slot_id = Column(
        Integer,
        ForeignKey('appointment_slots.id', ondelete='SET NULL'),
        nullable=True,
        comment="Original time slot ID"
    )
    
    new_slot_id = Column(
        Integer,
        ForeignKey('appointment_slots.id', ondelete='SET NULL'),
        nullable=True,
        comment="New time slot ID (null if cancelled)"
    )
    
    reason = Column(
        String(50),
        nullable=False,
        comment="Reason code: EMERGENCY_LEAVE, PLANNED_LEAVE, CITIZEN_REQUEST, ADMIN_ACTION"
    )
    
    reason_details = Column(
        Text,
        nullable=True,
        comment="Detailed explanation for the reschedule"
    )
    
    rescheduled_by = Column(
        String(100),
        nullable=True,
        comment="Username of admin who performed the reschedule (null if automatic)"
    )
    
    notification_sent = Column(
        Boolean,
        nullable=False,
        default=False,
        comment="Whether SMS notification was sent to citizen"
    )
    
    created_at = Column(
        DateTime,
        nullable=False,
        default=datetime.utcnow,
        comment="Timestamp when reschedule occurred"
    )
    
    # Relationships
    appointment = relationship("Appointment", foreign_keys=[appointment_id])
    old_slot = relationship("AppointmentSlot", foreign_keys=[old_slot_id])
    new_slot = relationship("AppointmentSlot", foreign_keys=[new_slot_id])
    
    __table_args__ = (
        Index('ix_reschedule_logs_appointment', 'appointment_id'),
        Index('ix_reschedule_logs_created_at', 'created_at'),
    )
