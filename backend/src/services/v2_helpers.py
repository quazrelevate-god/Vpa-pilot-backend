"""
v2 transition helpers — bridge between raw-string services and FK-based v2 models.

Every service that creates or updates appointments/tickets currently writes raw
status strings ("SCHEDULED", "open", "P1", etc.). In v2 those columns are FKs
to the admin table.  These helpers centralise the conversion so each service
has a single call site to change when we cut over.

Usage:
    from src.services.v2_helpers import v2

    # On app startup (once):
    await v2.init(db)

    # In appointment_service — citizen form submit:
    ids = v2.new_appointment_ids(
        status="SCHEDULED",
        category="action_required",
        priority="P1",          # optional
    )
    appointment = Appointment(
        status_id=ids["status_id"],
        priority_id=ids["priority_id"],
        category=ids["category_name"],   # denormalised quick-filter stays a string
        ...
    )

    # In dashboard_service — status flip:
    appointment.status_id = v2.appointment_status_id("REVIEWED")

    # In ticket creation:
    ticket = Ticket(
        status_id=v2.ticket_status_id("open"),
        priority_id=v2.priority_id("P1"),
        ...
    )

    # In ai_upload_service — approve flow:
    ids = v2.new_appointment_ids(status="AWAITING_REVIEW", category=extraction.category.value)

    # Reverse (for API responses / display):
    status_name = v2.status_name(appointment.status_id)   # → "SCHEDULED"
    priority_name = v2.priority_name(ticket.priority_id)  # → "P1"
"""
from __future__ import annotations

from typing import Any, Dict, Optional

from sqlalchemy.ext.asyncio import AsyncSession

from src.services.admin_lookup import admin, AdminLookup


class V2Helpers:
    """Thin wrapper over AdminLookup with domain-specific convenience methods."""

    async def init(self, db: AsyncSession, *, force: bool = False) -> None:
        """Load the admin lookup cache. Call once on startup."""
        await admin.load(db, force=force)

    @property
    def lookup(self) -> AdminLookup:
        return admin

    # ═══════════════════════════════════════════════════════════════════════
    #  Appointment
    # ═══════════════════════════════════════════════════════════════════════

    def new_appointment_ids(
        self,
        status: str,
        category: Optional[str] = None,
        priority: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Return a dict of resolved FK ids + denormalised fields for Appointment()."""
        return {
            "status_id":     admin.appointment_status(status),
            "priority_id":   admin.priority_or_none(priority),
            "category_id":   admin.category_or_none(category),
            "category_name": category,
        }

    def appointment_status_id(self, name: str) -> int:
        return admin.appointment_status(name)

    def appointment_status_id_or_none(self, name: Optional[str]) -> Optional[int]:
        return admin.appointment_status_or_none(name)

    # ═══════════════════════════════════════════════════════════════════════
    #  Ticket
    # ═══════════════════════════════════════════════════════════════════════

    def new_ticket_ids(
        self,
        status: str,
        priority: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Return resolved FK ids for Ticket()."""
        return {
            "status_id":   admin.ticket_status(status),
            "priority_id": admin.priority_or_none(priority),
        }

    def ticket_status_id(self, name: str) -> int:
        return admin.ticket_status(name)

    def ticket_status_id_or_none(self, name: Optional[str]) -> Optional[int]:
        return admin.ticket_status_or_none(name)

    # ═══════════════════════════════════════════════════════════════════════
    #  AI Upload
    # ═══════════════════════════════════════════════════════════════════════

    def ai_upload_status_id(self, name: str) -> int:
        return admin.ai_upload_status(name)

    # ═══════════════════════════════════════════════════════════════════════
    #  Priority / Category / Ministry / Department
    # ═══════════════════════════════════════════════════════════════════════

    def priority_id(self, name: str) -> int:
        return admin.priority(name)

    def priority_id_or_none(self, name: Optional[str]) -> Optional[int]:
        return admin.priority_or_none(name)

    def category_id(self, name: str) -> int:
        return admin.category(name)

    def category_id_or_none(self, name: Optional[str]) -> Optional[int]:
        return admin.category_or_none(name)

    def ministry_id(self, name: str) -> int:
        return admin.ministry(name)

    def ministry_id_or_none(self, name: Optional[str]) -> Optional[int]:
        return admin.ministry_or_none(name)

    def department_id(self, name: str) -> int:
        return admin.department(name)

    def department_id_or_none(self, name: Optional[str]) -> Optional[int]:
        return admin.department_or_none(name)

    # ═══════════════════════════════════════════════════════════════════════
    #  Reverse — id → display name (for API responses)
    # ═══════════════════════════════════════════════════════════════════════

    def status_name(self, admin_id: Optional[int]) -> Optional[str]:
        """Given a status_id (appointment or ticket), return the name string."""
        if admin_id is None:
            return None
        return admin.display_name(admin_id)

    def priority_name(self, admin_id: Optional[int]) -> Optional[str]:
        if admin_id is None:
            return None
        return admin.display_name(admin_id)

    def category_name(self, admin_id: Optional[int]) -> Optional[str]:
        if admin_id is None:
            return None
        return admin.display_name(admin_id)

    # ═══════════════════════════════════════════════════════════════════════
    #  Validation
    # ═══════════════════════════════════════════════════════════════════════

    def validate_appointment_status(self, name: str) -> bool:
        return admin.is_valid("appointment", name)

    def validate_ticket_status(self, name: str) -> bool:
        return admin.is_valid("ticket", name)

    def validate_priority(self, name: str) -> bool:
        return admin.is_valid("priority", name)

    def validate_category(self, name: str) -> bool:
        return admin.is_valid("category", name)


# Module-level singleton
v2 = V2Helpers()
