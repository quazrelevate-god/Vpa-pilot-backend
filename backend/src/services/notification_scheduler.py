"""Background scheduler that dispatches event reminders via web-push.

Three windows per event, all in IST (the office's local clock):
  • Night before at 21:00 (default) — prior day, once per event
  • Morning at 09:00 (default)      — day of, once per event
  • T-60 min before start_time      — day of, once per event

Idempotency is stored on the event row itself (notified_night_before /
notified_morning / notified_1h). A tick that crashes mid-fan-out cannot
cause duplicates: the flag flips inside the same DB tx that dispatches
the pushes for that event.

The loop runs every EVENTS_REMINDER_TICK_SECONDS (60s default) — small
enough that a 60-min-before reminder never drifts more than a minute past
its target. Silent no-op when VAPID isn't configured (feature-flagged off).

Recipients: every ACTIVE push_subscription whose owning Login has the
event_reviewer capability role. Non-reviewers never get pushed — even if
they somehow subscribed via a stale bookmark, the join excludes them.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import date, datetime, time as dtime, timedelta, timezone
from typing import Iterable

from sqlalchemy import and_, select
from sqlalchemy.orm import selectinload

from src.core.config import settings
from src.core.database import AsyncSessionLocal
from src.models.event_models import InvitationEvent, STATUS_READY
from src.models.login_models import Login, UserRole, ROLE_EVENT_REVIEWER
from src.models.push_models import PushSubscription
from src.services.push_service import send_to_many, vapid_configured

logger = logging.getLogger(__name__)

# IST — the schedule times are IST-local (the office's clock). The server
# runs UTC, so we anchor every comparison to IST explicitly.
_IST_TZ = timezone(timedelta(hours=5, minutes=30))


def _ist_now() -> datetime:
    return datetime.now(_IST_TZ)


async def _load_active_reviewer_subscriptions(db) -> list[PushSubscription]:
    """Active subscriptions whose owner still has the event_reviewer role.

    Joined via UserRole so a role-revoke on the login is honoured immediately
    — no cache. Cheap: the join is over at most ~dozens of reviewer rows.
    """
    rows = (await db.execute(
        select(PushSubscription)
        .join(Login, Login.id == PushSubscription.login_id)
        .join(UserRole, UserRole.login_id == Login.id)
        .where(
            PushSubscription.is_active == True,   # noqa: E712
            Login.is_active == True,              # noqa: E712
            UserRole.role == ROLE_EVENT_REVIEWER,
        )
    )).scalars().unique().all()
    return list(rows)


def _fmt_time(t: dtime | None) -> str:
    if t is None:
        return "--:--"
    h = t.hour
    m = t.minute
    ampm = "AM" if h < 12 else "PM"
    h12 = h % 12 or 12
    return f"{h12}:{m:02d} {ampm}"


def _event_display_title(e: InvitationEvent) -> str:
    """What to show in the notification title. Priority: note (PA's own
    annotation) → English title → Tamil title → fallback."""
    return (e.note or e.title_en or e.title_ta or e.title or "Event").strip()


def _payload_for_event(e: InvitationEvent, kind: str) -> dict:
    """Compose the push payload the service-worker handler will render.

    `kind` drives the title copy — the body is the venue + time so the
    reader has actionable context without opening the app."""
    when = _fmt_time(e.start_time)
    venue_bits = [x for x in (e.venue_en or e.venue_ta or e.venue or "").splitlines() if x.strip()]
    venue = venue_bits[0][:80] if venue_bits else ""

    if kind == "night_before":
        title = f"Tomorrow: {_event_display_title(e)}"
        body_prefix = f"At {when}"
    elif kind == "morning":
        title = f"Today: {_event_display_title(e)}"
        body_prefix = f"At {when}"
    elif kind == "one_hour":
        title = f"In 1 hour: {_event_display_title(e)}"
        body_prefix = f"Starts {when}"
    else:
        title = _event_display_title(e)
        body_prefix = f"At {when}"

    body = f"{body_prefix} · {venue}" if venue else body_prefix
    return {
        "title": title,
        "body": body,
        "tag": f"event-{e.id}-{kind}",  # coalesce dupes on same device
        "event_id": e.id,
        "url": f"/events?event={e.id}",
    }


async def _dispatch_and_flag(
    db,
    event: InvitationEvent,
    subs: list[PushSubscription],
    kind: str,
    flag_col: str,
) -> tuple[int, int]:
    """Flip the notified_* flag BEFORE sending, so a crash mid-send never
    re-fans-out.

    Previous ordering was send → flip flag. send_to_many commits its own tx;
    if the process died between that commit and the flag flip, the next
    60-second tick re-selected the same event and re-blasted the reminder
    to every subscription. Trade-off flipped: we now risk MISSING a reminder
    on a crash between flag and send, which is much less bad than firing
    N duplicates to every subscriber. If send_to_many raises, an outer
    handler can decide whether to reset the flag.
    """
    # Atomic conditional flag flip: only proceed if the flag was still False
    # (races with a concurrent tick lose here — rowcount 0 → no dispatch).
    from sqlalchemy import update as _sa_update
    flip = await db.execute(
        _sa_update(InvitationEvent)
        .where(InvitationEvent.id == event.id,
               getattr(InvitationEvent, flag_col) == False)  # noqa: E712
        .values({flag_col: True})
    )
    await db.commit()
    if (flip.rowcount or 0) == 0:
        # Another tick beat us to it — skip the send entirely.
        return 0, 0

    payload = _payload_for_event(event, kind)
    try:
        ok, fail = await send_to_many(db, subs, payload)   # commits its own tx
    except Exception:
        # Send blew up AFTER we claimed the flag. Reset it so the next tick
        # can retry (better a duplicate later than a permanently-missed
        # reminder). If the reset itself fails, log and give up — the flag
        # stays True and this event's reminder is lost.
        try:
            await db.execute(
                _sa_update(InvitationEvent)
                .where(InvitationEvent.id == event.id)
                .values({flag_col: False})
            )
            await db.commit()
        except Exception:
            logger.exception("reminder: failed to reset %s flag on event %d after send failure",
                             flag_col, event.id)
        raise
    logger.info(
        "reminder: event=%d kind=%s recipients=%d ok=%d fail=%d",
        event.id, kind, len(subs), ok, fail,
    )
    return ok, fail


async def _sweep_once() -> None:
    """One pass of all three windows. Uses a single DB session per pass."""
    now_ist = _ist_now()
    today   = now_ist.date()
    tomorrow = today + timedelta(days=1)

    async with AsyncSessionLocal() as db:
        subs = await _load_active_reviewer_subscriptions(db)
        # No point querying events if nobody is listening.
        if not subs:
            return

        # ── 1) Night-before at 21:00 IST — for events dated TOMORROW ──────
        # Fires on any tick that lands in the [21:00, 21:00+tick] window
        # to be robust to server jitter / tick spacing.
        night_hour = settings.EVENTS_REMINDER_NIGHT_BEFORE_HOUR_IST
        tick_s     = settings.EVENTS_REMINDER_TICK_SECONDS
        # `is_approved` is required across all three reminder branches: only
        # events the reviewer has explicitly confirmed with the Minister
        # should ping the office. Unapproved events are still waiting in the
        # Needs Review queue — pushing reminders for those would prompt the
        # team to attend an unconfirmed maybe, which the whole approval-gate
        # was designed to prevent.
        if _in_hour_window(now_ist, night_hour, tick_s):
            rows = (await db.execute(
                select(InvitationEvent).where(
                    InvitationEvent.event_date == tomorrow,
                    InvitationEvent.status == STATUS_READY,
                    InvitationEvent.is_approved == True,  # noqa: E712
                    InvitationEvent.notified_night_before == False,  # noqa: E712
                )
            )).scalars().all()
            for e in rows:
                await _dispatch_and_flag(db, e, subs, "night_before", "notified_night_before")

        # ── 2) Morning at 09:00 IST — for events dated TODAY ──────────────
        morning_hour = settings.EVENTS_REMINDER_MORNING_HOUR_IST
        if _in_hour_window(now_ist, morning_hour, tick_s):
            rows = (await db.execute(
                select(InvitationEvent).where(
                    InvitationEvent.event_date == today,
                    InvitationEvent.status == STATUS_READY,
                    InvitationEvent.is_approved == True,  # noqa: E712
                    InvitationEvent.notified_morning == False,  # noqa: E712
                )
            )).scalars().all()
            for e in rows:
                await _dispatch_and_flag(db, e, subs, "morning", "notified_morning")

        # ── 3) T-60 min — for TODAY's events starting within 60±tick min ──
        pre_min = settings.EVENTS_REMINDER_PRE_EVENT_MINUTES
        rows = (await db.execute(
            select(InvitationEvent).where(
                InvitationEvent.event_date == today,
                InvitationEvent.status == STATUS_READY,
                InvitationEvent.is_approved == True,  # noqa: E712
                InvitationEvent.start_time.isnot(None),
                InvitationEvent.notified_1h == False,  # noqa: E712
            )
        )).scalars().all()
        for e in rows:
            # start_time is a naive time; combine with today's IST date.
            start_dt = datetime.combine(today, e.start_time, tzinfo=_IST_TZ)
            delta_min = (start_dt - now_ist).total_seconds() / 60.0
            # Fire if the event starts within [pre_min - tick_min, pre_min] window.
            # (We only want to fire ONCE and only when the window opens.)
            tick_min = max(1, tick_s // 60)
            if (pre_min - tick_min) <= delta_min <= pre_min:
                await _dispatch_and_flag(db, e, subs, "one_hour", "notified_1h")


def _in_hour_window(now_ist: datetime, target_hour: int, tick_s: int) -> bool:
    """True when `now_ist` is inside [HH:00, HH:00 + tick_s) window.

    Prevents a tick that lands one second past 21:00:00 from missing the
    reminder — we only fire during the first `tick_s` seconds of the hour."""
    if now_ist.hour != target_hour:
        return False
    seconds_into_hour = now_ist.minute * 60 + now_ist.second
    return seconds_into_hour < tick_s


async def scheduler_loop(stop_event: asyncio.Event) -> None:
    """Long-running task started on app startup. Ticks every
    EVENTS_REMINDER_TICK_SECONDS until stop_event is set."""
    tick_s = settings.EVENTS_REMINDER_TICK_SECONDS
    logger.info(
        "reminder scheduler starting — tick=%ds, night=%d:00 IST, morning=%d:00 IST, pre=%dmin",
        tick_s, settings.EVENTS_REMINDER_NIGHT_BEFORE_HOUR_IST,
        settings.EVENTS_REMINDER_MORNING_HOUR_IST,
        settings.EVENTS_REMINDER_PRE_EVENT_MINUTES,
    )
    while not stop_event.is_set():
        try:
            await _sweep_once()
        except Exception:
            # Never break the loop — a bad row or transient DB error must
            # not stop the whole scheduler; log and try again next tick.
            logger.exception("reminder scheduler tick failed")
        try:
            await asyncio.wait_for(stop_event.wait(), timeout=tick_s)
        except asyncio.TimeoutError:
            pass


async def start() -> asyncio.Task | None:
    """Called from app startup. Returns the task handle so shutdown can
    signal it to stop. Returns None (silent no-op) when VAPID isn't
    configured, so `alembic upgrade` and dev environments without keys
    don't spam warnings.
    """
    if not vapid_configured():
        logger.info("reminder scheduler skipped — VAPID keys not configured")
        return None
    stop = asyncio.Event()
    task = asyncio.create_task(scheduler_loop(stop))
    task._stop_event = stop   # type: ignore[attr-defined]
    return task
