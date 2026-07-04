"""
SQLAlchemy ORM models for slot-based scheduling (v2 schema).

Design: fixed 08:00-18:00 window → 20 half-hour slots per open date.
Each slot holds up to MAX_CAPACITY citizens.
Concurrency-safe via SELECT ... FOR UPDATE in booking service.

v2 changes:
- availability is lean (just mla_id, date, is_open)
- slots renamed: total_slots→max_capacity, slots_booked→booked_count
- slot_bookings removed (appointment.slot_id covers it)
- reschedule_logs removed (activity table covers audit)
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
MAX_CAPACITY     = 12    # citizens per slot
TOTAL_SLOTS      = (SLOT_END_HOUR - SLOT_START_HOUR) * 60 // SLOT_DURATION  # 20
FIXED_START_TIME = time(SLOT_START_HOUR, 0)
FIXED_END_TIME   = time(SLOT_END_HOUR, 0)


class MLA(Base):
    """MLA profile — the official citizens meet with."""
    __tablename__ = "mla"

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
    One row per open date. v2 lean design — scheduling metadata lives in slots.
    Uses is_open boolean instead of ACTIVE/CANCELLED status string.
    """
    __tablename__ = "availability"

    id      = Column(Integer, primary_key=True, autoincrement=True)
    mla_id  = Column(Integer, ForeignKey("mla.id", ondelete="CASCADE"), nullable=False)
    date    = Column(Date,    nullable=False)
    is_open = Column(Boolean, nullable=False, default=True)

    mla   = relationship("MLA", back_populates="availabilities")
    slots = relationship(
        "AppointmentSlot",
        back_populates="availability",
        cascade="all, delete-orphan",
        order_by="AppointmentSlot.slot_number",
    )

    __table_args__ = (
        UniqueConstraint("mla_id", "date", name="uq_availability_mla_date"),
        Index("ix_mla_availability_date", "date"),
    )


class AppointmentSlot(Base):
    """
    One 30-minute slot inside an open date.

    Up to max_capacity citizens can be booked into the same slot.
    status: AVAILABLE | FULL | BLOCKED
    """
    __tablename__ = "slots"

    id              = Column(Integer,    primary_key=True, autoincrement=True)
    availability_id = Column(Integer,    ForeignKey("availability.id", ondelete="CASCADE"), nullable=False)
    slot_number     = Column(Integer,    nullable=False)
    start_time      = Column(Time,       nullable=False)
    end_time        = Column(Time,       nullable=False)
    status          = Column(String(20), nullable=False, default="AVAILABLE")
    max_capacity    = Column(Integer,    nullable=False, default=MAX_CAPACITY)
    booked_count    = Column(Integer,    nullable=False, default=0)

    availability = relationship("MLADailyAvailability", back_populates="slots")

    __table_args__ = (
        Index("ix_appointment_slots_availability", "availability_id"),
        Index("ix_appointment_slots_status",       "status"),
    )
