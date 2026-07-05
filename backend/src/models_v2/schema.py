"""
Redesigned ("v2") database schema — see docs/db-redesign.md.

Single-office (no tenant_id yet). Statuses / priority / category / ministry /
department are normalised into one `admin` lookup table. Citizen PII stays
Fernet-encrypted with an HMAC blind index for the (name, mobile) uniqueness.

Uses its own declarative Base so the new schema can be created and seeded
independently of the legacy models in src/models/ (which still back the running
app until the service/API refactor lands).

Tables:
  admin, login, qr_logs, verification, gatekeeper, citizens, mla, availability,
  slots, appointment, attachments, activity, ticket
"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import (
    BigInteger, Boolean, Column, Date, DateTime, ForeignKey, Index, Integer,
    String, Text, Time, UniqueConstraint, text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import declarative_base

# Isolated metadata — does NOT share the legacy src.core.database.Base.
Base = declarative_base()


# ── Lookup ────────────────────────────────────────────────────────────────────
class Admin(Base):
    """Generic lookup: statuses, priority, category, ministry, department.

    `entity` names the group:
      appointment | ticket | priority | category | ministry | department
    """
    __tablename__ = "admin"

    id         = Column(BigInteger, primary_key=True, autoincrement=True)
    entity     = Column(String(30), nullable=False, comment="lookup group")
    name       = Column(String(100), nullable=False, comment="value label")
    sort_order = Column(Integer, nullable=False, server_default="0")
    is_active  = Column(Boolean, nullable=False, server_default=text("true"))

    __table_args__ = (
        UniqueConstraint("entity", "name", name="uq_admin_entity_name"),
        Index("ix_admin_entity", "entity"),
    )


# ── Users / RBAC ──────────────────────────────────────────────────────────────
class Login(Base):
    __tablename__ = "login"

    id         = Column(BigInteger, primary_key=True, autoincrement=True)
    login_name = Column(String(100), nullable=False, unique=True)
    password   = Column(String(255), nullable=False, comment="argon2/bcrypt hash")
    scope      = Column(JSONB, nullable=False, server_default="{}",
                        comment="permissions / roles object")
    is_active  = Column(Boolean, nullable=False, server_default=text("true"))
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)


# ── QR / access ───────────────────────────────────────────────────────────────
class QrLog(Base):
    __tablename__ = "qr_logs"

    id                 = Column(BigInteger, primary_key=True, autoincrement=True)
    venue_id           = Column(String(100), nullable=False)
    qr_signature_hash  = Column(String(255), nullable=False, unique=True, index=True)
    created_at         = Column(DateTime, nullable=False, default=datetime.utcnow)
    expires_at         = Column(DateTime, nullable=False, index=True)

    __table_args__ = (
        Index("ix_qr_venue_expires", "venue_id", "expires_at"),
    )


class Verification(Base):
    """OTP verification (was otp_verifications)."""
    __tablename__ = "verification"

    id            = Column(BigInteger, primary_key=True, autoincrement=True)
    session_token = Column(UUID(as_uuid=True), nullable=False,
                           server_default=text("gen_random_uuid()"))
    mobile_number = Column(String(15), nullable=False, index=True)
    hashed_otp    = Column(String(64), nullable=False, comment="SHA-256")
    attempts      = Column(Integer, nullable=False, server_default="0")
    is_verified   = Column(Boolean, nullable=False, server_default=text("false"))
    created_at    = Column(DateTime, nullable=False, default=datetime.utcnow)
    expires_at    = Column(DateTime, nullable=False)


class Gatekeeper(Base):
    """Single-use session after QR verification (was gatekeeper_sessions)."""
    __tablename__ = "gatekeeper"

    id                 = Column(BigInteger, primary_key=True, autoincrement=True)
    session_token      = Column(UUID(as_uuid=True), nullable=False, unique=True,
                                server_default=text("gen_random_uuid()"))
    venue_id           = Column(String(100), nullable=False,
                                comment="carried from QR → appointment.venue on submit")
    device_fingerprint = Column(String(255), nullable=False)
    qr_signature_hash  = Column(String(255), nullable=True,
                                comment="prevents same QR re-scan on same device")
    is_used            = Column(Boolean, nullable=False, server_default=text("false"))
    created_at         = Column(DateTime, nullable=False, default=datetime.utcnow)
    expires_at         = Column(DateTime, nullable=False, index=True)

    __table_args__ = (
        Index("ix_gk_fingerprint_created", "device_fingerprint", "created_at"),
        Index("ix_gk_qr_device", "qr_signature_hash", "device_fingerprint"),
    )


# ── Citizen ───────────────────────────────────────────────────────────────────
class Citizen(Base):
    __tablename__ = "citizens"

    id               = Column(Integer, primary_key=True, autoincrement=True)
    encrypted_name   = Column(Text, nullable=False, comment="Fernet")
    encrypted_mobile = Column(String(512), nullable=False, comment="Fernet")
    identity_index   = Column(String(64), nullable=False, unique=True,
                              comment="HMAC of normalised name|mobile — (name,mobile) uniqueness")
    created_at       = Column(DateTime, nullable=False, default=datetime.utcnow)


# ── Scheduling ────────────────────────────────────────────────────────────────
class Mla(Base):
    __tablename__ = "mla"

    id        = Column(Integer, primary_key=True, autoincrement=True)
    name      = Column(String(200), nullable=False)
    is_active = Column(Boolean, nullable=False, server_default=text("true"))


class Availability(Base):
    __tablename__ = "availability"

    id      = Column(Integer, primary_key=True, autoincrement=True)
    mla_id  = Column(Integer, ForeignKey("mla.id", ondelete="CASCADE"), nullable=False)
    date    = Column(Date, nullable=False)
    is_open = Column(Boolean, nullable=False, server_default=text("true"))

    __table_args__ = (
        UniqueConstraint("mla_id", "date", name="uq_availability_mla_date"),
    )


class Slot(Base):
    __tablename__ = "slots"

    id              = Column(Integer, primary_key=True, autoincrement=True)
    availability_id = Column(Integer, ForeignKey("availability.id", ondelete="CASCADE"),
                             nullable=False, index=True)
    start_time      = Column(Time, nullable=False)
    end_time        = Column(Time, nullable=False)
    total_slots     = Column(Integer, nullable=False, comment="capacity")
    slots_booked    = Column(Integer, nullable=False, server_default="0")


# ── Appointment ───────────────────────────────────────────────────────────────
class Appointment(Base):
    __tablename__ = "appointment"

    id           = Column(BigInteger, primary_key=True, autoincrement=True)
    token_number = Column(BigInteger, nullable=False, unique=True)
    citizen_id   = Column(Integer, ForeignKey("citizens.id", ondelete="CASCADE"),
                          nullable=False, index=True)
    slot_id      = Column(Integer, ForeignKey("slots.id", ondelete="SET NULL"), nullable=True)
    status_id    = Column(BigInteger, ForeignKey("admin.id"), nullable=False, index=True)
    priority_id  = Column(BigInteger, ForeignKey("admin.id"), nullable=True)
    venue        = Column(String(100), nullable=True)
    num_persons  = Column(Integer, nullable=False, server_default="1")
    category     = Column(String(50), nullable=True, comment="denormalised quick-filter")
    created_at   = Column(DateTime, nullable=False, default=datetime.utcnow, index=True)


# ── Ticket ────────────────────────────────────────────────────────────────────
class Ticket(Base):
    __tablename__ = "ticket"

    id             = Column(BigInteger, primary_key=True, autoincrement=True)
    ticket_number  = Column(String(20), nullable=False, unique=True)
    appointment_id = Column(BigInteger, ForeignKey("appointment.id", ondelete="CASCADE"),
                            nullable=False, unique=True)
    status_id      = Column(BigInteger, ForeignKey("admin.id"), nullable=False, index=True)
    priority_id    = Column(BigInteger, ForeignKey("admin.id"), nullable=True)
    assigned_to    = Column(BigInteger, ForeignKey("login.id", ondelete="SET NULL"),
                            nullable=True, index=True)
    forwarded_to   = Column(String(60), nullable=True, comment="ministry/department value")
    notes          = Column(Text, nullable=True)
    reopen_count   = Column(Integer, nullable=False, server_default="0")
    created_at     = Column(DateTime, nullable=False, default=datetime.utcnow)


# ── Shared: attachments + activity (span appointment and ticket) ──────────────
class Attachment(Base):
    __tablename__ = "attachments"

    id             = Column(BigInteger, primary_key=True, autoincrement=True)
    url            = Column(Text, nullable=False, comment="storage key/path")
    type           = Column(String(20), nullable=False, comment="AUDIO|IMAGE|DOCUMENT|VIDEO")
    appointment_id = Column(BigInteger, ForeignKey("appointment.id", ondelete="CASCADE"),
                            nullable=True, index=True)
    ticket_id      = Column(BigInteger, ForeignKey("ticket.id", ondelete="CASCADE"),
                            nullable=True, index=True)
    file_size      = Column(Integer, nullable=True, comment="bytes")


class Activity(Base):
    """Unified audit log (replaces appointment_events + ticket_events + reschedule_logs)."""
    __tablename__ = "activity"

    id             = Column(BigInteger, primary_key=True, autoincrement=True)
    appointment_id = Column(BigInteger, ForeignKey("appointment.id", ondelete="CASCADE"),
                            nullable=True)
    ticket_id      = Column(BigInteger, ForeignKey("ticket.id", ondelete="CASCADE"),
                            nullable=True)
    user           = Column(String(100), nullable=False, comment="login_name or 'system'")
    action_type    = Column(String(40), nullable=False)
    message        = Column(Text, nullable=True)
    created_at     = Column(DateTime, nullable=False, default=datetime.utcnow)

    __table_args__ = (
        Index("ix_activity_appt_created", "appointment_id", "created_at"),
        Index("ix_activity_ticket_created", "ticket_id", "created_at"),
    )
