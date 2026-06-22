"""
SQLAlchemy ORM models for slot-based scheduling.

Design: fixed 08:00-18:00 window → 20 half-hour slots per open date.
Each slot holds up to MAX_CAPACITY (6) citizens.
Concurrency-safe via SELECT ... FOR UPDATE in booking service.
"""
from sqlalchemy import (
    Column, Integer, String, Text, Boolean,
    DateTime, Date, Time, ForeignKey, Index, UniqueConstraint,
)
from sqlalchemy.orm import relationship
from datetime import datetime, time

from src.core.database import Base

# ── Fixed scheduling constants ────────────────────────────────────────────────
SLOT_START_HOUR  = 8     # 08:00
SLOT_END_HOUR    = 18    # 18:00
SLOT_DURATION    = 30    # minutes per slot
MAX_CAPACITY     = 6     # citizens per slot
TOTAL_SLOTS      = (SLOT_END_HOUR - SLOT_START_HOUR) * 60 // SLOT_DURATION  # 20
FIXED_START_TIME = time(SLOT_START_HOUR, 0)
FIXED_END_TIME   = time(SLOT_END_HOUR, 0)


class MLA(Base):
    """MLA profile — the official citizens meet with."""
    __tablename__ = "mlas"

    id             = Column(Integer, primary_key=True, autoincrement=True)
    name           = Column(String(200), nullable=False)
    constituency   = Column(String(100), nullable=False)
    contact_mobile = Column(String(15),  nullable=True)
    contact_email  = Column(String(100), nullable=True)
    office_address = Column(Text,        nullable=True)
    is_active      = Column(Boolean,     nullable=False, default=True)
    created_at     = Column(DateTime,    nullable=False, default=datetime.utcnow)

    availabilities = relationship(
        "MLADailyAvailability",
        back_populates="mla",
        cascade="all, delete-orphan",
    )

    __table_args__ = (
        Index("ix_mlas_constituency", "constituency"),
        Index("ix_mlas_is_active",    "is_active"),
    )


class MLADailyAvailability(Base):
    """
    One row per open date.

    Fixed hours: 08:00 – 18:00 (stored for display; logic uses constants).
    Creating this row + its 20 AppointmentSlot children opens that date for bookings.
    """
    __tablename__ = "mla_daily_availability"

    id         = Column(Integer,     primary_key=True, autoincrement=True)
    mla_id     = Column(Integer,     ForeignKey("mlas.id", ondelete="CASCADE"), nullable=False)
    date       = Column(Date,        nullable=False)
    start_time = Column(Time,        nullable=False, default=FIXED_START_TIME)
    end_time   = Column(Time,        nullable=False, default=FIXED_END_TIME)
    status     = Column(String(20),  nullable=False, default="ACTIVE",
                        comment="ACTIVE or CANCELLED")
    created_at = Column(DateTime,    nullable=False, default=datetime.utcnow)
    created_by = Column(String(100), nullable=True)

    mla   = relationship("MLA", back_populates="availabilities")
    slots = relationship(
        "AppointmentSlot",
        back_populates="availability",
        cascade="all, delete-orphan",
        order_by="AppointmentSlot.slot_number",
    )

    __table_args__ = (
        UniqueConstraint("mla_id", "date", name="uq_mla_date"),
        Index("ix_mla_availability_date",     "date"),
        Index("ix_mla_availability_mla_date", "mla_id", "date"),
    )


class AppointmentSlot(Base):
    """
    One 30-minute slot inside an open date.

    Up to max_capacity (6) citizens can be booked into the same slot.
    status:
      AVAILABLE — accepting bookings (booked_count < max_capacity)
      FULL      — booked_count == max_capacity, no more bookings accepted
      BLOCKED   — PA admin blocked this slot (e.g. lunch break)
    """
    __tablename__ = "appointment_slots"

    id              = Column(Integer,    primary_key=True, autoincrement=True)
    availability_id = Column(Integer,    ForeignKey("mla_daily_availability.id", ondelete="CASCADE"), nullable=False)
    slot_number     = Column(Integer,    nullable=False, comment="1-20")
    start_time      = Column(Time,       nullable=False)
    end_time        = Column(Time,       nullable=False)
    status          = Column(String(20), nullable=False, default="AVAILABLE",
                             comment="AVAILABLE | FULL | BLOCKED")
    max_capacity    = Column(Integer,    nullable=False, default=MAX_CAPACITY)
    booked_count    = Column(Integer,    nullable=False, default=0)
    created_at      = Column(DateTime,   nullable=False, default=datetime.utcnow)

    availability = relationship("MLADailyAvailability", back_populates="slots")
    bookings     = relationship(
        "SlotBooking",
        back_populates="slot",
        cascade="all, delete-orphan",
    )

    __table_args__ = (
        Index("ix_appointment_slots_availability", "availability_id"),
        Index("ix_appointment_slots_status",       "status"),
    )


class SlotBooking(Base):
    """
    Junction: one appointment books one slot.
    Many appointments can point to the same slot (up to max_capacity).
    """
    __tablename__ = "slot_bookings"

    id             = Column(Integer,  primary_key=True, autoincrement=True)
    slot_id        = Column(Integer,  ForeignKey("appointment_slots.id", ondelete="CASCADE"), nullable=False)
    appointment_id = Column(Integer,  ForeignKey("appointments.id",      ondelete="CASCADE"), nullable=False, unique=True)
    booked_at      = Column(DateTime, nullable=False, default=datetime.utcnow)

    slot        = relationship("AppointmentSlot", back_populates="bookings")
    appointment = relationship("Appointment")

    __table_args__ = (
        Index("ix_slot_bookings_slot_id",        "slot_id"),
        Index("ix_slot_bookings_appointment_id", "appointment_id"),
    )


class RescheduleLog(Base):
    """Audit log for appointment rescheduling events."""
    __tablename__ = "reschedule_logs"

    id               = Column(Integer,    primary_key=True, autoincrement=True)
    appointment_id   = Column(Integer,    ForeignKey("appointments.id", ondelete="CASCADE"), nullable=False)
    old_slot_id      = Column(Integer,    ForeignKey("appointment_slots.id", ondelete="SET NULL"), nullable=True)
    new_slot_id      = Column(Integer,    ForeignKey("appointment_slots.id", ondelete="SET NULL"), nullable=True)
    reason           = Column(String(50), nullable=False)
    reason_details   = Column(Text,       nullable=True)
    rescheduled_by   = Column(String(100),nullable=True)
    notification_sent= Column(Boolean,    nullable=False, default=False)
    created_at       = Column(DateTime,   nullable=False, default=datetime.utcnow)

    appointment = relationship("Appointment",    foreign_keys=[appointment_id])
    old_slot    = relationship("AppointmentSlot",foreign_keys=[old_slot_id])
    new_slot    = relationship("AppointmentSlot",foreign_keys=[new_slot_id])

    __table_args__ = (
        Index("ix_reschedule_logs_appointment", "appointment_id"),
        Index("ix_reschedule_logs_created_at",  "created_at"),
    )
