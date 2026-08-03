"""Web-push dispatch for the events PWA.

Thin wrapper around pywebpush that:
  * refuses to send when VAPID is unconfigured (feature-flagged off),
  * runs the blocking send in a worker thread so the async event loop
    isn't stalled,
  * marks a subscription inactive on 404 / 410 (browser told us the
    endpoint is dead) so the scheduler stops trying it,
  * never raises out of send() — dispatch failure logs but doesn't
    crash the sweep for other subscriptions.

Payload shape (JSON, decoded by the service-worker `push` handler):
    { title, body, tag, url?, event_id?, icon?, badge? }
"""
from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime
from typing import Any, Optional

from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.config import settings
from src.models.push_models import PushSubscription

logger = logging.getLogger(__name__)


def vapid_configured() -> bool:
    """True when VAPID keys are present. Callers should refuse to expose
    the subscribe endpoint / start the scheduler when this is False."""
    return bool(settings.VAPID_PRIVATE_KEY and settings.VAPID_PUBLIC_KEY)


def _vapid_claims() -> dict:
    """Minimal VAPID claims — the `sub` (contact URL) is required by
    push services; `aud` is filled in per-endpoint by pywebpush."""
    return {"sub": settings.VAPID_SUBJECT}


async def send_push(
    db: AsyncSession,
    subscription: PushSubscription,
    payload: dict[str, Any],
    *,
    ttl: int = 24 * 3600,
) -> bool:
    """Dispatch one payload to one subscription. Returns True on success.

    Non-fatal — logs and returns False on any failure so the caller's
    loop can continue. On 404 / 410 the subscription is marked inactive
    inside the DB session the caller passed us; the caller commits.
    """
    if not vapid_configured():
        return False

    subscription_info = {
        "endpoint": subscription.endpoint,
        "keys": {"p256dh": subscription.p256dh, "auth": subscription.auth},
    }

    def _blocking_send() -> tuple[bool, Optional[int]]:
        """Runs in a worker thread — pywebpush is synchronous."""
        from pywebpush import WebPushException, webpush
        try:
            webpush(
                subscription_info=subscription_info,
                data=json.dumps(payload, ensure_ascii=False),
                vapid_private_key=settings.VAPID_PRIVATE_KEY,
                vapid_claims=_vapid_claims(),
                ttl=ttl,
            )
            return True, None
        except WebPushException as exc:
            # exc.response is only present when the push service returned
            # HTTP — network errors don't have it.
            status = getattr(exc.response, "status_code", None)
            return False, status

    ok, status = await asyncio.to_thread(_blocking_send)

    if ok:
        subscription.last_seen_at = datetime.utcnow()
        return True

    # Dead endpoint — stop trying. Mark inactive; caller commits so this
    # sticks even if a later send in the same fan-out crashes.
    if status in (404, 410):
        subscription.is_active = False
        logger.info(
            "push: endpoint dead (status=%s) — marking subscription %d inactive",
            status, subscription.id,
        )
    else:
        logger.warning(
            "push: send failed (status=%s) for subscription %d",
            status, subscription.id,
        )
    return False


async def send_to_many(
    db: AsyncSession,
    subscriptions: list[PushSubscription],
    payload: dict[str, Any],
) -> tuple[int, int]:
    """Dispatch the same payload to every subscription. Returns
    (successful, failed). Commits inactive-flips at the end."""
    ok = fail = 0
    for sub in subscriptions:
        if await send_push(db, sub, payload):
            ok += 1
        else:
            fail += 1
    # Persist any last_seen_at bumps + inactive flips.
    await db.commit()
    return ok, fail
