"""
Citizen notification adapter.

Single choke point for every message we send a citizen about their appointment.
Right now every kind is a no-op that just logs — SMS/WhatsApp integration is a
one-line swap here later. Kept dead-simple on purpose: the value is having ONE
place to wire the provider, not the abstraction itself.

Kinds:
    reschedule_cancel   — "Don't come today, your appointment has been
                          cancelled. We'll let you know a new time."
    convert_to_petition — "Your petition is being processed. You won't be
                          meeting the Minister in person for this request."
    reschedule_rebook   — "Your appointment has been rescheduled to {date} at
                          {time}. Token: {token}."

Callers pass a `ctx` dict with any variables the future template will need
(new_date, new_time, token, actor). We log everything so the eventual
integration can just render + send.
"""
from __future__ import annotations

import logging
from typing import Any, Dict, Optional

from src.core.database import AsyncSessionLocal
from src.models.appointment_models import Appointment, Citizen
from sqlalchemy import select
from sqlalchemy.orm import selectinload

logger = logging.getLogger("citizen_notify")


VALID_KINDS = frozenset({
    "reschedule_cancel",
    "convert_to_petition",
    "reschedule_rebook",
})


async def notify(kind: str, appointment_id: int, ctx: Optional[Dict[str, Any]] = None) -> None:
    """Fire a notification for `kind` about `appointment_id`. No-op today.

    This is a fire-and-forget helper: it never raises to callers, because a
    failed SMS should never fail the underlying appointment operation.
    """
    if kind not in VALID_KINDS:
        logger.warning("notify: unknown kind %r for appointment_id=%s", kind, appointment_id)
        return

    ctx = ctx or {}
    try:
        async with AsyncSessionLocal() as session:
            appt = (await session.execute(
                select(Appointment)
                .options(selectinload(Appointment.citizen))
                .where(Appointment.id == appointment_id)
            )).scalar_one_or_none()
            if not appt:
                logger.info("notify: appointment %s vanished before send (kind=%s)", appointment_id, kind)
                return
            citizen: Optional[Citizen] = appt.citizen
            # Decrypt mobile only if we have one — floor walk-ins may have none.
            mobile_ct = citizen.encrypted_mobile if citizen else None
            has_mobile = bool(mobile_ct)

        # No provider wired yet — log the intent so we can audit and hook up
        # SMS/WhatsApp later without touching the callsites.
        logger.info(
            "[CITIZEN NOTIFY placeholder] kind=%s appt=%s token=%s has_mobile=%s ctx=%s",
            kind, appointment_id, appt.token_assigned, has_mobile, ctx,
        )

    except Exception as e:
        # Notifications are best-effort. Never fail the parent flow.
        logger.warning("notify: send failed for appt=%s kind=%s: %s",
                       appointment_id, kind, e)
