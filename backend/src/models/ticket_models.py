"""
Ticketing system for PA-team case management.

Every appointment becomes a ticket (1:1). The `tickets` table tracks the
case-management lifecycle: who is handling it, what stage it is in, when it
was forwarded to another department, when it was resolved, etc.

This is operated EXCLUSIVELY by the PA team — no citizen ever writes here.
Citizens just submit petitions; the PA team triages and tracks them through
this table.

Design notes
------------
- One ticket per appointment (`appointment_id` is unique).
- `status` is the case-management state, distinct from `Appointment.status`
  (which is the queue/visit state — SCHEDULED, REVIEWED, etc.).
- Priority is auto-suggested from the AI urgency on first summarisation,
  but PA can manually override any time. SLA hours / due_date are manual —
  no auto-deadline.
- Forwarding is first-class because the initial deployment is the Education
  Minister's office. Petitions outside Education are forwarded to the
  correct department and tracked via FORWARDED_TO_DEPT status.
- `ticket_events` is the audit log — every state change writes one row so
  we always know who did what and when.

Tables
------
- tickets
- ticket_events
"""
from __future__ import annotations

from datetime import datetime
from enum import Enum

from sqlalchemy import (
    BigInteger,
    Column,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Text,
    VARCHAR,
)
from sqlalchemy.orm import relationship

from src.core.database import Base


# ── Lifecycle enums (kept as plain str so they serialize cleanly) ─────────────

class TicketStatus(str, Enum):
    """
    Case-management lifecycle states.

    Typical flow:
        OPEN → TRIAGED → ASSIGNED → IN_PROGRESS → (FORWARDED_TO_DEPT |
        PENDING_CITIZEN) → IN_PROGRESS → RESOLVED → CLOSED

    REOPENED is set when the citizen comes back about the same case after
    CLOSED — the ticket goes back into the queue with reopen_count incremented.
    """
    OPEN               = "open"                  # just created, awaiting PA review
    TRIAGED            = "triaged"               # PA has reviewed; dept identified
    ASSIGNED           = "assigned"              # owner PA is set
    IN_PROGRESS        = "in_progress"           # PA actively working
    FORWARDED_TO_DEPT  = "forwarded_to_dept"     # sent to govt dept, awaiting reply
    PENDING_CITIZEN    = "pending_citizen"       # waiting on more info from petitioner
    RESOLVED           = "resolved"              # action taken, case complete
    CLOSED             = "closed"                # no further action needed
    REOPENED           = "reopened"              # citizen escalated post-close


class TicketPriority(str, Enum):
    """
    Manual priority slots. Auto-suggested from AI urgency on first
    summarisation; PA can override any time.

    Suggested mapping (initial set only, PA decides final):
        critical urgency → P0
        high urgency     → P1
        medium urgency   → P2
        low urgency      → P3
    """
    P0 = "P0"   # urgent — minister/safety/legal
    P1 = "P1"   # important
    P2 = "P2"   # normal
    P3 = "P3"   # low


class ClosureReason(str, Enum):
    """Why a ticket was closed."""
    ACTION_TAKEN              = "action_taken"
    NOT_ACTIONABLE            = "not_actionable"
    DUPLICATE                 = "duplicate"
    RESOLVED_BY_DEPT          = "resolved_by_dept"
    NO_RESPONSE_FROM_CITIZEN  = "no_response_from_citizen"
    OUT_OF_SCOPE              = "out_of_scope"


# Suggested initial priority based on AI-assigned urgency.
URGENCY_TO_PRIORITY: dict[str, str] = {
    "critical": TicketPriority.P0.value,
    "high":     TicketPriority.P1.value,
    "medium":   TicketPriority.P2.value,
    "low":      TicketPriority.P3.value,
}


# ── Tables ────────────────────────────────────────────────────────────────────

class Ticket(Base):
    """
    Case-management record. 1:1 with Appointment.

    Created the moment an appointment is committed (no AI summary required).
    PA team mutates this through the /dashboard/api/tickets endpoints; every
    mutation appends a row to ticket_events.
    """

    __tablename__ = "ticket"

    # ── Primary key ────────────────────────────────────────────────────────────
    id = Column(
        BigInteger,
        primary_key=True,
        autoincrement=True,
    )

    # ── Foreign key (one ticket per appointment) ───────────────────────────────
    appointment_id = Column(
        Integer,
        ForeignKey("appointment.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
        comment="One-to-one link back to the originating appointment",
    )

    # ── Human-readable ticket number (e.g., TKT-2026-00001) ────────────────────
    ticket_number = Column(
        VARCHAR(20),
        nullable=False,
        unique=True,
        comment="Display id, e.g., TKT-2026-00001. Year-prefixed sequence.",
    )

    # ── Lifecycle ──────────────────────────────────────────────────────────────
    status = Column(
        VARCHAR(30),
        nullable=False,
        default=TicketStatus.OPEN.value,
        server_default=TicketStatus.OPEN.value,
        comment="TicketStatus enum value",
    )

    priority = Column(
        VARCHAR(5),
        nullable=True,
        comment="TicketPriority enum (P0/P1/P2/P3). Auto-suggested from AI urgency, PA can override.",
    )

    status_id = Column(
        BigInteger,
        nullable=True,
        comment="FK to admin.id (entity=ticket) — v2 normalised status",
    )

    priority_id = Column(
        BigInteger,
        nullable=True,
        comment="FK to admin.id (entity=priority) — v2 normalised priority",
    )

    # v2 FK to login table (integer)
    assigned_to = Column(
        BigInteger,
        ForeignKey("login.id", ondelete="SET NULL"),
        nullable=True,
    )

    # Bridge: v1 services still write PA username string
    assigned_to_pa = Column(
        VARCHAR(100),
        nullable=True,
    )

    due_date = Column(
        DateTime,
        nullable=True,
        comment="Manual SLA deadline set by PA. NULL = no deadline.",
    )

    notes = Column(
        Text,
        nullable=True,
    )

    # ── Forwarding (first-class because we deploy for Education Minister) ─────
    forwarded_to_dept = Column(
        VARCHAR(60),
        nullable=True,
        comment="Department enum value the ticket was forwarded to (if any)",
    )

    forwarded_at = Column(
        DateTime,
        nullable=True,
        comment="When the ticket was forwarded to another dept",
    )

    forwarded_by = Column(
        VARCHAR(100),
        nullable=True,
        comment="PA username who forwarded the ticket",
    )

    forwarded_notes = Column(
        Text,
        nullable=True,
        comment="Free-text note: what was sent, contact person, ref no., etc.",
    )

    # ── Resolution / closure ───────────────────────────────────────────────────
    resolution_notes = Column(
        Text,
        nullable=True,
        comment="What action was taken to resolve the case",
    )

    closure_reason = Column(
        VARCHAR(40),
        nullable=True,
        comment="ClosureReason enum value",
    )

    resolved_at = Column(
        DateTime,
        nullable=True,
        comment="When RESOLVED status was set",
    )

    closed_at = Column(
        DateTime,
        nullable=True,
        comment="When CLOSED status was set",
    )

    # ── Reopen tracking ────────────────────────────────────────────────────────
    reopened_at = Column(
        DateTime,
        nullable=True,
        comment="When the ticket was last reopened",
    )

    reopen_count = Column(
        Integer,
        nullable=False,
        default=0,
        server_default="0",
        comment="Number of times this ticket has been reopened",
    )

    # ── Timestamps ─────────────────────────────────────────────────────────────
    created_at = Column(
        DateTime,
        nullable=False,
        default=datetime.utcnow,
    )

    updated_at = Column(
        DateTime,
        nullable=False,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
    )

    # ── Relationships ──────────────────────────────────────────────────────────
    appointment = relationship(
        "Appointment",
        back_populates="ticket",
    )

    # ── Indexes (filter/sort surfaces in the PA portal) ────────────────────────
    __table_args__ = (
        Index("ix_tickets_status", "status"),
        Index("ix_tickets_priority", "priority"),
        Index("ix_tickets_assigned_to", "assigned_to_pa"),
        Index("ix_tickets_created_at", "created_at"),
        Index("ix_tickets_forwarded_to_dept", "forwarded_to_dept"),
        Index("ix_tickets_due_date", "due_date"),
    )


# ── Ticket number generator helper ────────────────────────────────────────────

def generate_ticket_number(year: int, sequence: int) -> str:
    """
    Format a ticket number as TKT-YYYY-NNNNN.

    >>> generate_ticket_number(2026, 1)
    'TKT-2026-00001'
    >>> generate_ticket_number(2026, 12345)
    'TKT-2026-12345'
    """
    return f"TKT-{year:04d}-{sequence:05d}"
