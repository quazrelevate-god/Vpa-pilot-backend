"""
Admin-table lookup utility — resolve (entity, name) ↔ admin.id.

The admin table is a small, rarely-changing lookup (statuses, priorities,
categories, ministries, departments). This class loads it once per process
and exposes fast, sync-safe helpers so any service can convert raw strings
into FK ids without a DB round-trip.

Usage (anywhere in a service):
    from src.services.admin_lookup import admin

    # First call in the process (e.g. app startup / first request):
    await admin.load(db)

    # Then use helpers — no await needed, everything is cached:
    status_id   = admin.appointment_status("SCHEDULED")
    priority_id = admin.priority("P1")
    category_id = admin.category("action_required")
    ministry_id = admin.ministry("school_education_tamil_dev_info_publicity")
    dept_id     = admin.department("Elementary Education")
    ticket_id   = admin.ticket_status("open")
    upload_id   = admin.ai_upload_status("QUEUED")

    # Reverse (id → display name):
    entity, name = admin.name_of(status_id)

    # Validate before insert:
    if not admin.is_valid("appointment", user_input):
        raise ValueError(...)
"""
from __future__ import annotations

import logging
from typing import Dict, List, Optional, Tuple

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.models_v2.schema import Admin

logger = logging.getLogger(__name__)


class AdminLookup:
    """Cached (entity, name) ↔ id map backed by the admin table."""

    def __init__(self) -> None:
        self._by_key: Dict[Tuple[str, str], int] = {}
        self._by_id: Dict[int, Tuple[str, str]] = {}
        self._loaded = False

    # ═══════════════════════════════════════════════════════════════════════
    #  Lifecycle
    # ═══════════════════════════════════════════════════════════════════════

    async def load(self, db: AsyncSession, *, force: bool = False) -> None:
        """Load all active admin rows into memory. Idempotent unless force=True."""
        if self._loaded and not force:
            return

        stmt = select(Admin.id, Admin.entity, Admin.name).where(
            Admin.is_active == True  # noqa: E712
        )
        result = await db.execute(stmt)
        rows = result.all()

        self._by_key.clear()
        self._by_id.clear()
        for admin_id, entity, name in rows:
            key = (entity.lower(), name.lower())
            self._by_key[key] = admin_id
            self._by_id[admin_id] = (entity, name)

        self._loaded = True
        logger.info(
            "admin_lookup: cached %d entries across %d entities",
            len(self._by_key),
            len({k[0] for k in self._by_key}),
        )

    def invalidate(self) -> None:
        """Clear the cache so the next load() re-reads from DB."""
        self._by_key.clear()
        self._by_id.clear()
        self._loaded = False

    @property
    def is_loaded(self) -> bool:
        return self._loaded

    # ═══════════════════════════════════════════════════════════════════════
    #  Generic helpers
    # ═══════════════════════════════════════════════════════════════════════

    def resolve(self, entity: str, name: str) -> int:
        """Return admin.id or raise ValueError with valid names listed."""
        key = (entity.lower(), name.lower())
        admin_id = self._by_key.get(key)
        if admin_id is None:
            raise ValueError(
                f"admin lookup failed: entity={entity!r}, name={name!r}. "
                f"Valid: {self.names_for(entity)}"
            )
        return admin_id

    def get(self, entity: str, name: str) -> Optional[int]:
        """Return admin.id or None (no exception)."""
        return self._by_key.get((entity.lower(), name.lower()))

    def name_of(self, admin_id: int) -> Tuple[str, str]:
        """Reverse: id → (entity, name). Raises KeyError if unknown."""
        return self._by_id[admin_id]

    def display_name(self, admin_id: int) -> str:
        """Reverse: id → name string only."""
        return self._by_id[admin_id][1]

    def names_for(self, entity: str) -> List[str]:
        """All valid names for an entity (original case from DB)."""
        e = entity.lower()
        return [
            self._by_id[aid][1]
            for (ent, _), aid in self._by_key.items()
            if ent == e
        ]

    def is_valid(self, entity: str, name: str) -> bool:
        """Check whether (entity, name) exists in the lookup."""
        return (entity.lower(), name.lower()) in self._by_key

    # ═══════════════════════════════════════════════════════════════════════
    #  Domain shortcuts — one-liner access for every entity group
    # ═══════════════════════════════════════════════════════════════════════

    # ── Appointment statuses ────────────────────────────────────────────
    def appointment_status(self, name: str) -> int:
        """SCHEDULED | WAITING | RESCHEDULED | AWAITING_REVIEW | REVIEWED | NOT_CAME"""
        return self.resolve("appointment", name)

    def appointment_status_or_none(self, name: Optional[str]) -> Optional[int]:
        return self.get("appointment", name) if name else None

    # ── Ticket statuses ─────────────────────────────────────────────────
    def ticket_status(self, name: str) -> int:
        """open | triaged | assigned | in_progress | forwarded_to_dept | pending_citizen | resolved | closed | reopened"""
        return self.resolve("ticket", name)

    def ticket_status_or_none(self, name: Optional[str]) -> Optional[int]:
        return self.get("ticket", name) if name else None

    # ── AI upload statuses ──────────────────────────────────────────────
    def ai_upload_status(self, name: str) -> int:
        """QUEUED | PROCESSING | AWAITING_REVIEW | REVIEWED | FAILED"""
        return self.resolve("ai_upload", name)

    # ── Priority ────────────────────────────────────────────────────────
    def priority(self, name: str) -> int:
        """P0 | P1 | P2 | P3"""
        return self.resolve("priority", name)

    def priority_or_none(self, name: Optional[str]) -> Optional[int]:
        return self.get("priority", name) if name else None

    # ── Category ────────────────────────────────────────────────────────
    def category(self, name: str) -> int:
        """action_required | proposals | transfer_requests | pension_requests | ..."""
        return self.resolve("category", name)

    def category_or_none(self, name: Optional[str]) -> Optional[int]:
        return self.get("category", name) if name else None

    # ── Ministry ────────────────────────────────────────────────────────
    def ministry(self, name: str) -> int:
        return self.resolve("ministry", name)

    def ministry_or_none(self, name: Optional[str]) -> Optional[int]:
        return self.get("ministry", name) if name else None

    # ── Department ──────────────────────────────────────────────────────
    def department(self, name: str) -> int:
        return self.resolve("department", name)

    def department_or_none(self, name: Optional[str]) -> Optional[int]:
        return self.get("department", name) if name else None


# ═══════════════════════════════════════════════════════════════════════════
#  Module-level singleton — import and use everywhere
# ═══════════════════════════════════════════════════════════════════════════
admin = AdminLookup()
