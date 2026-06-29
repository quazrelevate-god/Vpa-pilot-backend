"""
SQLAlchemy ORM models for the REFERRAL booking system.

Fully isolated from the petition/appointment scheduling tables so the two
flows never conflict. Design mirrors scheduling_models.py:

  - Fixed window 11:00 – 13:00 → 4 half-hour slots per open date.
  - Each slot holds up to max_capacity referrals (default 6).
  - Concurrency-safe booking via SELECT ... FOR UPDATE in the service.

Differences from petition scheduling:
  - No rescheduling, no waiting queue.
  - Booking captures: name, mobile (optional), num_persons (1-3), referred_by.
  - Access is via a daily-reset QR (see referral_service.py), not OTP/QR-gatekeeper.
"""
from sqlalchemy import (
    Column, Integer, BigInteger, String, Text, DateTime, Date, Time, ForeignKey, Index, UniqueConstraint,
)
from sqlalchemy.orm import relationship
from datetime import datetime, time

from src.core.database import Base

# ── Fixed referral window constants ───────────────────────────────────────────
REFERRAL_START_HOUR = 11    # 11:00 AM
REFERRAL_END_HOUR   = 13    # 01:00 PM
SLOT_DURATION       = 30    # minutes per slot
MAX_CAPACITY        = 6     # referrals per slot (default; overridable per date)
TOTAL_SLOTS         = (REFERRAL_END_HOUR - REFERRAL_START_HOUR) * 60 // SLOT_DURATION  # 4
FIXED_START_TIME    = time(REFERRAL_START_HOUR, 0)
FIXED_END_TIME      = time(REFERRAL_END_HOUR, 0)

MAX_PERSONS         = 3     # max persons per referral booking


class ReferralAvailability(Base):
    """One row per open referral date. Children = 4 ReferralSlot rows."""
    __tablename__ = "referral_availability"

    id         = Column(Integer,     primary_key=True, autoincrement=True)
    date       = Column(Date,        nullable=False)
    start_time = Column(Time,        nullable=False, default=FIXED_START_TIME)
    end_time   = Column(Time,        nullable=False, default=FIXED_END_TIME)
    status     = Column(String(20),  nullable=False, default="ACTIVE",
                        comment="ACTIVE or CANCELLED")
    created_at = Column(DateTime,    nullable=False, default=datetime.utcnow)
    created_by = Column(String(100), nullable=True)

    slots = relationship(
        "ReferralSlot",
        back_populates="availability",
        cascade="all, delete-orphan",
        order_by="ReferralSlot.slot_number",
    )

    __table_args__ = (
        UniqueConstraint("date", name="uq_referral_date"),
        Index("ix_referral_availability_date", "date"),
    )


class ReferralSlot(Base):
    """
    One 30-minute referral slot.

    status:
      AVAILABLE — accepting bookings (booked_count < max_capacity)
      FULL      — naturally full OR admin-closed
      BLOCKED   — admin blocked this slot
    """
    __tablename__ = "referral_slots"

    id              = Column(Integer,    primary_key=True, autoincrement=True)
    availability_id = Column(Integer,    ForeignKey("referral_availability.id", ondelete="CASCADE"), nullable=False)
    slot_number     = Column(Integer,    nullable=False, comment="1-4")
    start_time      = Column(Time,       nullable=False)
    end_time        = Column(Time,       nullable=False)
    status          = Column(String(20), nullable=False, default="AVAILABLE",
                             comment="AVAILABLE | FULL | BLOCKED")
    max_capacity    = Column(Integer,    nullable=False, default=MAX_CAPACITY)
    booked_count    = Column(Integer,    nullable=False, default=0,
                             comment="Total PERSONS booked (sum of num_persons), not booking rows")
    created_at      = Column(DateTime,   nullable=False, default=datetime.utcnow)

    availability = relationship("ReferralAvailability", back_populates="slots")
    bookings     = relationship(
        "ReferralBooking",
        back_populates="slot",
        cascade="all, delete-orphan",
    )

    __table_args__ = (
        Index("ix_referral_slots_availability", "availability_id"),
        Index("ix_referral_slots_status",       "status"),
    )


class ReferralBooking(Base):
    """One referral booking against a slot."""
    __tablename__ = "referral_bookings"

    id                   = Column(Integer,    primary_key=True, autoincrement=True)
    slot_id              = Column(Integer,    ForeignKey("referral_slots.id", ondelete="CASCADE"), nullable=False)
    token_number         = Column(BigInteger, nullable=False, comment="Daily sequential token, e.g. 2026062900001 — needs BIGINT (exceeds int32)")
    name                 = Column(Text,        nullable=False, comment="Fernet-encrypted name (see src.core.crypto)")
    mobile               = Column(String(512), nullable=True,  comment="Fernet-encrypted mobile (see src.core.crypto)")
    num_persons          = Column(Integer,    nullable=False, default=1, comment="1-3 persons")
    referred_by          = Column(String(200), nullable=False)
    reason               = Column(String(500), nullable=False, comment="Reason for the meeting")
    status               = Column(String(12),  nullable=False, default="PENDING",
                                  comment="Floor attendance: PENDING / CAME / NOT_CAME")
    scheduled_date       = Column(Date,        nullable=False)
    scheduled_start_time = Column(Time,        nullable=False)
    scheduled_end_time   = Column(Time,        nullable=False)
    created_at           = Column(DateTime,    nullable=False, default=datetime.utcnow)

    slot = relationship("ReferralSlot", back_populates="bookings")

    __table_args__ = (
        Index("ix_referral_bookings_slot_id", "slot_id"),
        Index("ix_referral_bookings_date",    "scheduled_date"),
        Index("ix_referral_bookings_token",   "token_number", unique=True),
    )
