"""
DB queries for the staff dashboard — stats aggregates and appointment list.
"""
from __future__ import annotations

import base64
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any, Dict, List, Optional

from sqlalchemy import func, select, or_, and_, case
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from src.core.utils import utc_iso
from src.models.appointment_models import Appointment, Citizen, AppointmentAttachment
from src.models.activity_models import Activity
from src.models.scheduling_models import AppointmentSlot, MLADailyAvailability
from src.services.scheduling_service import scheduling_service
from src.services.notification_service import notify as _notify
from src.models.grievance_summary_record import GrievanceSummaryRecord
from src.models.grievance_summary import CATEGORY_DISPLAY, DISTRICT_DISPLAY, MINISTRY_DISPLAY
from src.services.v2_helpers import v2


_IST = timedelta(hours=5, minutes=30)


def _ist_start(date_str: str) -> datetime:
    """Interpret date_str as IST midnight and return the equivalent UTC datetime."""
    return datetime.strptime(date_str, "%Y-%m-%d") - _IST


def _ist_end(date_str: str) -> datetime:
    """Interpret date_str as IST end-of-day (23:59:59.999…) → UTC datetime."""
    return datetime.strptime(date_str, "%Y-%m-%d") + timedelta(days=1) - _IST


def _category_label(value: Optional[str]) -> str:
    """Map a snake_case category to its human-readable form."""
    if not value:
        return "—"
    return CATEGORY_DISPLAY.get(value, value.replace("_", " ").title())


def _log_appt_event(db: AsyncSession, appointment_id: int, event_type: str, actor: str = "pa_admin",
                     note: Optional[str] = None, payload: Optional[dict] = None) -> None:
    """Append an activity audit row (v2 unified log)."""
    # v2: single Activity row replaces separate AppointmentEvent/TicketEvent tables.
    # Structured payload stays a JSONB column so the PA portal renders arrows.
    db.add(Activity(
        appointment_id=appointment_id,
        user=actor,
        action_type=event_type,
        message=note,
        payload=payload,
    ))


# DB status → display label
_STATUS_DISPLAY = {
    "RESCHEDULED":     "Rescheduled",
    "WAITING":         "Waiting",
    "IN_PROGRESS":     "Waiting",
    "AWAITING_REVIEW": "Awaiting Review",
    "REVIEWED":        "Reviewed",
    "SCHEDULED":       "Scheduled",
    "NOT_CAME":        "Not Came",
    # Terminal state for invitation/greetings visitors who came in person to
    # hand over the card/message — no review, no ticket, nothing pending.
    "COURTESY_DONE":   "Courtesy Done",
    # PA marked reviewed without creating a ticket (see _DISPLAY_TO_DB_STATUS).
    "DISMISSED":       "Dismissed",
}


def _resolve_display_status(appt) -> str:
    """
    Awaiting Review → direct-submit petition pending PA review (AWAITING_REVIEW)
    Reviewed        → PA has reviewed it (REVIEWED, schedule_meeting=False)
    Scheduled       → citizen requested a meeting (schedule_meeting=True + SCHEDULED)
    """
    override = _STATUS_DISPLAY.get(appt.status)
    if override:
        return override
    # SCHEDULED status — meeting requests only (persistent intent flag).
    return "Scheduled" if appt.schedule_meeting else "Reviewed"


def _decode(value: str) -> str:
    """Decrypt a PII field (Fernet, with legacy-base64 fallback). See src.core.crypto."""
    from src.core import crypto
    return crypto.decrypt(value) if value is not None else value


async def get_stats(
    db: AsyncSession,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
) -> Dict[str, Any]:
    """Full stats payload for the dashboard — cards, charts, trends."""
    from datetime import date as date_type, timedelta, datetime
    from sqlalchemy import cast, Date as SADate, and_

    def _df(extra=None):
        """Build WHERE clause list scoped to Appointment.created_at."""
        clauses = []
        if date_from:
            clauses.append(Appointment.created_at >= _ist_start(date_from))
        if date_to:
            clauses.append(Appointment.created_at < _ist_end(date_to))
        if extra:
            clauses.extend(extra if isinstance(extra, list) else [extra])
        return clauses

    def _count(extra=None):
        clauses = _df(extra)
        q = select(func.count(Appointment.id)).select_from(Appointment)
        if clauses:
            q = q.where(and_(*clauses))
        return q

    total      = await db.scalar(_count()) or 0
    scheduled  = await db.scalar(_count([
        Appointment.schedule_meeting == True,   # noqa: E712
        Appointment.status == "SCHEDULED",
    ])) or 0
    reviewed   = await db.scalar(_count([
        Appointment.status == "REVIEWED",
    ])) or 0
    awaiting_review = await db.scalar(_count([
        Appointment.status == "AWAITING_REVIEW",
    ])) or 0
    waiting    = await db.scalar(_count([
        Appointment.status.in_(["WAITING", "IN_PROGRESS"]),
    ])) or 0
    rescheduled = await db.scalar(_count([Appointment.status == "RESCHEDULED"])) or 0

    resolution_rate = round((reviewed / total * 100) if total else 0, 1)

    # Category breakdown
    cat_q = (
        select(Appointment.grievance_category, func.count(Appointment.id).label("cnt"))
        .select_from(Appointment)
        .where(Appointment.grievance_category.isnot(None))
        .group_by(Appointment.grievance_category)
        .order_by(func.count(Appointment.id).desc())
        .limit(8)
    )
    if _df():
        cat_q = cat_q.where(and_(*_df()))
    cat_rows  = await db.execute(cat_q)
    categories = [{"label": _category_label(r[0]), "count": r[1]} for r in cat_rows]

    # Appointments in range → used to filter GSR
    appt_ids_in_range = (
        select(Appointment.id).select_from(Appointment)
    )
    if _df():
        appt_ids_in_range = appt_ids_in_range.where(and_(*_df()))

    gsr_filter = [
        GrievanceSummaryRecord.is_latest == True,
        GrievanceSummaryRecord.appointment_id.in_(appt_ids_in_range),
    ]

    priority_rows = await db.execute(
        select(GrievanceSummaryRecord.priority, func.count(GrievanceSummaryRecord.id))
        .where(*gsr_filter)
        .group_by(GrievanceSummaryRecord.priority)
    )
    priority = {r[0]: r[1] for r in priority_rows}

    # Ministry breakdown — drives the routing KPI for the Minister.
    ministry_rows = await db.execute(
        select(GrievanceSummaryRecord.ministry, func.count(GrievanceSummaryRecord.id))
        .where(*gsr_filter)
        .group_by(GrievanceSummaryRecord.ministry)
        .order_by(func.count(GrievanceSummaryRecord.id).desc())
        .limit(10)
    )
    ministries = [
        {"label": MINISTRY_DISPLAY.get(r[0], r[0]), "count": r[1]} for r in ministry_rows
    ]

    # Trend — day-by-day within the selected range (or last 14 days)
    if date_from and date_to:
        start = datetime.strptime(date_from, "%Y-%m-%d").date()
        end   = datetime.strptime(date_to,   "%Y-%m-%d").date()
        delta = (end - start).days + 1
        days  = [start + timedelta(days=i) for i in range(min(delta, 60))]
    else:
        today = date_type.today()
        days  = [today - timedelta(days=i) for i in range(13, -1, -1)]

    day_labels, day_counts = [], []
    for d in days:
        cnt = await db.scalar(
            select(func.count(Appointment.id))
            .select_from(Appointment)
            .where(cast(Appointment.created_at, SADate) == d)
        ) or 0
        day_labels.append(d.strftime("%d %b"))
        day_counts.append(cnt)

    # AI coverage
    ai_covered = await db.scalar(
        select(func.count(func.distinct(GrievanceSummaryRecord.appointment_id)))
        .where(GrievanceSummaryRecord.is_latest == True,
               GrievanceSummaryRecord.appointment_id.in_(appt_ids_in_range))
    ) or 0
    ai_coverage = round((ai_covered / total * 100) if total else 0, 1)

    # ── Political-grade KPIs ───────────────────────────────────────────────

    # Unique citizens served (distinct citizen_id)
    citizens_q = (
        select(func.count(func.distinct(Appointment.citizen_id)))
        .select_from(Appointment)
    )
    if _df():
        citizens_q = citizens_q.where(and_(*_df()))
    unique_citizens = await db.scalar(citizens_q) or 0

    # Meetings held — scheduled appointments whose slot end has passed
    now = datetime.utcnow()
    meetings_held_q = _count([
        Appointment.schedule_meeting == True,   # noqa: E712
        Appointment.created_at.isnot(None),
        Appointment.created_at <= now.date(),
        Appointment.status == "SCHEDULED",
    ])
    meetings_held = await db.scalar(meetings_held_q) or 0

    # Active cases — open ticket statuses (excludes resolved/closed/triaged/reopened)
    from src.models.ticket_models import Ticket, TicketStatus
    actionable_statuses = [
        TicketStatus.OPEN.value,
        TicketStatus.ASSIGNED.value,
        TicketStatus.IN_PROGRESS.value,
        TicketStatus.FORWARDED_TO_DEPT.value,
        TicketStatus.PENDING_CITIZEN.value,
    ]
    active_cases = await db.scalar(
        select(func.count(Ticket.id)).where(Ticket.status.in_(actionable_statuses))
    ) or 0

    # Average response time (hours) — resolved tickets within window
    closed_statuses = [TicketStatus.RESOLVED.value, TicketStatus.CLOSED.value]
    avg_resolved_q = (
        select(func.avg(func.extract("epoch", Ticket.updated_at - Ticket.created_at)))
        .where(Ticket.status.in_(closed_statuses))
    )
    avg_response_seconds = await db.scalar(avg_resolved_q)
    avg_response_hours = round(float(avg_response_seconds) / 3600, 1) if avg_response_seconds else 0

    # Period-over-period — same window length, immediately prior
    growth_pct = None
    if date_from and date_to:
        start_dt = _ist_start(date_from)
        end_dt = _ist_end(date_to)
        window = end_dt - start_dt
        prior_start = start_dt - window - timedelta(seconds=1)
        prior_end = start_dt - timedelta(seconds=1)
        prior_total = await db.scalar(
            select(func.count(Appointment.id))
            .where(Appointment.created_at >= prior_start, Appointment.created_at <= prior_end)
        ) or 0
        if prior_total:
            growth_pct = round((total - prior_total) / prior_total * 100, 1)

    # Resolved-per-day trend (parallel to day_counts) for the dual-line chart
    resolved_counts = []
    for d in days:
        cnt = await db.scalar(
            select(func.count(Ticket.id))
            .where(cast(Ticket.updated_at, SADate) == d,
                   Ticket.status.in_(closed_statuses))
        ) or 0
        resolved_counts.append(cnt)

    # Forwarded-to-department breakdown — where the Education team is
    # routing cases externally. This replaces the AI "primary department"
    # widget since the deployment is scoped to a single department.
    forwarded_q = (
        select(Ticket.forwarded_to_dept, func.count(Ticket.id).label("cnt"))
        .where(Ticket.forwarded_to_dept.isnot(None))
        .group_by(Ticket.forwarded_to_dept)
        .order_by(func.count(Ticket.id).desc())
        .limit(10)
    )
    # Apply same date window if provided
    if date_from:
        forwarded_q = forwarded_q.where(Ticket.created_at >= _ist_start(date_from))
    if date_to:
        forwarded_q = forwarded_q.where(Ticket.created_at < _ist_end(date_to))
    forwarded_rows = await db.execute(forwarded_q)
    forwarded_ministries = [
        {"label": MINISTRY_DISPLAY.get(r[0], r[0]), "count": r[1]} for r in forwarded_rows
    ]
    total_forwarded = sum(m["count"] for m in forwarded_ministries)

    # SLA bucket health by priority (from the AI review) — actionable tickets only.
    sla_targets_days = {"critical": 3, "high": 7, "medium": 14, "low": 28}
    gsr_prio = (
        select(GrievanceSummaryRecord.appointment_id, GrievanceSummaryRecord.priority)
        .where(GrievanceSummaryRecord.is_latest == True)  # noqa: E712
        .subquery()
    )
    sla_buckets = []
    for level, target in sla_targets_days.items():
        threshold = now - timedelta(days=target)
        base = (
            select(func.count(Ticket.id))
            .select_from(Ticket)
            .join(gsr_prio, gsr_prio.c.appointment_id == Ticket.appointment_id)
            .where(gsr_prio.c.priority == level,
                   Ticket.status.in_(actionable_statuses))
        )
        on_track = await db.scalar(base.where(Ticket.created_at > threshold)) or 0
        breached = await db.scalar(base.where(Ticket.created_at <= threshold)) or 0
        sla_buckets.append({"priority": level, "on_track": on_track, "breached": breached, "target_days": target})

    return {
        "total":             total,
        "scheduled":         scheduled,
        "reviewed":          reviewed,
        "awaiting_review":   awaiting_review,
        "waiting":           waiting,
        "rescheduled":       rescheduled,
        "resolution_rate":   resolution_rate,
        "ai_coverage":       ai_coverage,
        "categories":        categories,
        "ministries":        ministries,
        "priority":           priority,
        "trend_labels":      day_labels,
        "trend_counts":      day_counts,
        # New political/operational KPIs
        "unique_citizens":   unique_citizens,
        "meetings_held":     meetings_held,
        "active_cases":      active_cases,
        "avg_response_hours": avg_response_hours,
        "growth_pct":        growth_pct,
        "trend_resolved":    resolved_counts,
        "sla_buckets":       sla_buckets,
        "forwarded_ministries": forwarded_ministries,
        "total_forwarded":   total_forwarded,
    }


async def _attach_venue_labels(db: AsyncSession, items: list) -> None:
    """Fill each row's `venue_label` (friendly name) from the venue registry —
    one query for the whole page. Rows with no venue stay None."""
    keys = {it.get("venue") for it in items if it.get("venue")}
    if not keys:
        return
    from src.models.registry_models import VenueRegistry
    rows = (await db.execute(
        select(VenueRegistry.key, VenueRegistry.display_en).where(VenueRegistry.key.in_(keys))
    )).all()
    label_map = {k: v for k, v in rows}
    for it in items:
        v = it.get("venue")
        if v:
            it["venue_label"] = label_map.get(v)


async def get_appointments(
    db: AsyncSession,
    status_filter: Optional[str] = None,
    search: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    appt_date_from: Optional[str] = None,
    appt_date_to: Optional[str] = None,
    priority: Optional[str] = None,
    ministry: Optional[str] = None,
    category: Optional[str] = None,
    kind: Optional[str] = None,
    sort: Optional[str] = None,
    page: int = 1,
    page_size: int = 25,
) -> Dict[str, Any]:
    """
    Paginated appointment list with citizen name, summary, and attachments.
    Returns dict with `items` list and `total` count.

    `kind`: "meeting" → only meeting requests (schedule_meeting=True);
            "petition" → only direct petitions (schedule_meeting=False);
            None/other → both (legacy behaviour).
    `sort`: "priority" → Critical→High→Medium→Low (then newest); else newest first.
    """
    from datetime import datetime as dt
    is_scheduled_tab = status_filter == "Scheduled"
    stmt = (
        select(Appointment)
        .options(
            selectinload(Appointment.citizen),
            selectinload(Appointment.attachments),
            selectinload(Appointment.grievance_summary),
            # v2: scheduled date/time derived from slot + availability. Eager-load
            # both to avoid lazy IO in the sync serializer.
            selectinload(Appointment.scheduled_slot).selectinload(AppointmentSlot.availability),
        )
    )

    # Kind: meeting requests vs direct petitions (ordering is applied later).
    # v2: schedule_meeting is the persistent citizen-intent flag (survives
    # slot release when the appointment lands in the waiting queue).
    if kind == "meeting":
        stmt = stmt.where(Appointment.schedule_meeting == True)   # noqa: E712
    elif kind == "petition":
        stmt = stmt.where(Appointment.schedule_meeting == False)  # noqa: E712

    # Submission date filter (when citizen submitted the form) — dates are IST
    if date_from:
        stmt = stmt.where(Appointment.created_at >= _ist_start(date_from))
    if date_to:
        stmt = stmt.where(Appointment.created_at < _ist_end(date_to))

    # Appointment date filter (the scheduled MEETING date). This lives on the
    # booked slot's availability, NOT created_at — filtering created_at made the
    # Today/Tomorrow chips match the SUBMISSION date, so "tomorrow" was always
    # empty. Filter by slot membership so the main query's eager-loads are
    # untouched; rows with no booked slot are correctly excluded.
    if appt_date_from or appt_date_to:
        _appt_slot_ids = (
            select(AppointmentSlot.id)
            .join(MLADailyAvailability, AppointmentSlot.availability_id == MLADailyAvailability.id)
        )
        if appt_date_from:
            _appt_slot_ids = _appt_slot_ids.where(MLADailyAvailability.date >= dt.strptime(appt_date_from, "%Y-%m-%d").date())
        if appt_date_to:
            _appt_slot_ids = _appt_slot_ids.where(MLADailyAvailability.date <= dt.strptime(appt_date_to, "%Y-%m-%d").date())
        stmt = stmt.where(Appointment.slot_id.in_(_appt_slot_ids))

    if status_filter and status_filter != "All":
        if status_filter == "Scheduled":
            stmt = stmt.where(
                Appointment.schedule_meeting == True,   # noqa: E712
                Appointment.status == "SCHEDULED"
            )
        elif status_filter == "Reviewed":
            stmt = stmt.where(Appointment.status == "REVIEWED")
        elif status_filter == "Awaiting Review":
            stmt = stmt.where(Appointment.status == "AWAITING_REVIEW")
        elif status_filter == "Rescheduled":
            stmt = stmt.where(Appointment.status == "RESCHEDULED")
        elif status_filter == "Waiting":
            stmt = stmt.where(Appointment.status.in_(["WAITING", "IN_PROGRESS"]))

    # AI-derived filters: priority + department live only on GrievanceSummaryRecord.
    # Category also falls back to Appointment.grievance_category for petitions
    # that haven't been AI-summarised yet (AWAITING_REVIEW with form-selected category).
    if priority or ministry or category:
        gsr_sub = (
            select(GrievanceSummaryRecord.appointment_id)
            .where(GrievanceSummaryRecord.is_latest == True)  # noqa: E712
        )
        if priority:
            gsr_sub = gsr_sub.where(GrievanceSummaryRecord.priority == priority)
        if ministry:
            gsr_sub = gsr_sub.where(GrievanceSummaryRecord.ministry == ministry)
        if category:
            gsr_sub = gsr_sub.where(GrievanceSummaryRecord.category == category)

        if category:
            # Also match appointments where citizen selected the category in the form
            # (Appointment.grievance_category) and AI hasn't processed yet.
            from sqlalchemy import or_
            appt_cat_sub = select(Appointment.id).where(
                Appointment.grievance_category == category
            )
            stmt = stmt.where(
                or_(
                    Appointment.id.in_(gsr_sub),
                    Appointment.id.in_(appt_cat_sub),
                )
            )
        else:
            stmt = stmt.where(Appointment.id.in_(gsr_sub))

    # ── Ordering ────────────────────────────────────────────────────────────────
    if sort == "priority":
        # Critical → High → Medium → Low (then newest). Priority lives on the latest
        # AI summary, so join it just for the sort key.
        priority_rank = case(
            (GrievanceSummaryRecord.priority == "critical", 0),
            (GrievanceSummaryRecord.priority == "high", 1),
            (GrievanceSummaryRecord.priority == "medium", 2),
            (GrievanceSummaryRecord.priority == "low", 3),
            else_=4,
        )
        stmt = stmt.outerjoin(
            GrievanceSummaryRecord,
            and_(
                GrievanceSummaryRecord.appointment_id == Appointment.id,
                GrievanceSummaryRecord.is_latest == True,  # noqa: E712
            ),
        ).order_by(priority_rank.asc(), Appointment.created_at.desc())
    elif sort == "appt_date_asc":
        stmt = stmt.order_by(
            Appointment.created_at.asc().nullslast(),
            Appointment.created_at.asc(),
        )
    elif sort == "appt_date_desc":
        stmt = stmt.order_by(
            Appointment.created_at.desc().nullslast(),
            Appointment.created_at.desc(),
        )
    else:
        # Default: put today's meetings first, then upcoming days ascending, then
        # yesterday-and-earlier at the bottom (most-recent past first). Rows with
        # no booked slot (petitions / waiting) fall after all dated rows, newest-
        # first. This matches how a PA scans the day: "who's coming today, then
        # this week, then what's overdue — and let me see recent petitions after".
        # v2: the meeting date lives on the joined slot → availability.
        from datetime import date as _date_type
        today = _date_type.today()
        _slot_date = MLADailyAvailability.date
        stmt = stmt.outerjoin(
            AppointmentSlot, AppointmentSlot.id == Appointment.slot_id
        ).outerjoin(
            MLADailyAvailability, MLADailyAvailability.id == AppointmentSlot.availability_id
        )
        bucket = case(
            (_slot_date == None, 3),                # no date last  # noqa: E711
            (_slot_date == today, 0),               # today first
            (_slot_date > today, 1),                # upcoming
            else_=2,                                 # past
        )
        # Two disjoint keys so upcoming sorts ascending and past sorts descending.
        upcoming_asc = case((_slot_date >= today, _slot_date), else_=None)
        past_desc = case((_slot_date < today, _slot_date), else_=None)
        stmt = stmt.order_by(
            bucket.asc(),
            upcoming_asc.asc().nullslast(),
            past_desc.desc().nullslast(),
            AppointmentSlot.start_time.asc().nullslast(),
            Appointment.created_at.desc(),
        )

    # ── Search path ───────────────────────────────────────────────────────────
    # Name and mobile are encrypted, so they can't be matched in SQL. Decrypt-and-
    # match across the FULL filtered set, then paginate in Python — otherwise a
    # match on page 3 would never be found (the old code filtered only the current
    # 25-row window, and `total` ignored the filter entirely).
    if search and search.strip():
        q = search.strip().lower()
        all_rows = (await db.execute(stmt)).scalars().all()
        matched = []
        for appt in all_rows:
            citizen = appt.citizen
            name = _decode(citizen.encrypted_name) if citizen else ""
            mobile = _decode(citizen.encrypted_mobile) if citizen else ""
            if (
                q in name.lower()
                or q in (mobile or "")
                or q in str(appt.token_assigned)
                or q in f"tkn{appt.token_assigned}"
            ):
                matched.append(appt)
        total = len(matched)
        start = (page - 1) * page_size
        page_rows = matched[start:start + page_size]
        items = [build_appointment_row(appt) for appt in page_rows]
        await _attach_venue_labels(db, items)
        return {"items": items, "total": total, "page": page, "page_size": page_size}

    # ── No-search path: efficient DB-side count + pagination ────────────────────
    count_stmt = select(func.count()).select_from(stmt.subquery())
    total = await db.scalar(count_stmt) or 0

    stmt = stmt.offset((page - 1) * page_size).limit(page_size)
    result = await db.execute(stmt)
    appointments = result.scalars().all()

    items = [build_appointment_row(appt) for appt in appointments]
    await _attach_venue_labels(db, items)
    return {"items": items, "total": total, "page": page, "page_size": page_size}


async def get_appointment_counts(
    db: AsyncSession,
    search: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    appt_date_from: Optional[str] = None,
    appt_date_to: Optional[str] = None,
    priority: Optional[str] = None,
    ministry: Optional[str] = None,
    category: Optional[str] = None,
    kind: Optional[str] = None,
) -> Dict[str, int]:
    """
    Per-tab counts (Scheduled / Waiting / Rescheduled / All) honouring the same
    secondary filters as `get_appointments`. Replaces 4 parallel list calls with
    a single aggregate query — search falls back to a decrypt-bucket pass.
    """
    from datetime import datetime as dt

    # v2: schedule_meeting is the persistent citizen-intent flag (survives
    # slot release when moved to waiting queue).
    base = select(Appointment.id, Appointment.status, Appointment.schedule_meeting)

    if kind == "meeting":
        base = base.where(Appointment.schedule_meeting == True)   # noqa: E712
    elif kind == "petition":
        base = base.where(Appointment.schedule_meeting == False)  # noqa: E712

    if date_from:
        base = base.where(Appointment.created_at >= _ist_start(date_from))
    if date_to:
        base = base.where(Appointment.created_at < _ist_end(date_to))
    # Appointment-date chips filter the scheduled MEETING date (slot availability),
    # not created_at — keep in lock-step with get_appointments so the tab counts
    # match the list.
    if appt_date_from or appt_date_to:
        _cnt_slot_ids = (
            select(AppointmentSlot.id)
            .join(MLADailyAvailability, AppointmentSlot.availability_id == MLADailyAvailability.id)
        )
        if appt_date_from:
            _cnt_slot_ids = _cnt_slot_ids.where(MLADailyAvailability.date >= dt.strptime(appt_date_from, "%Y-%m-%d").date())
        if appt_date_to:
            _cnt_slot_ids = _cnt_slot_ids.where(MLADailyAvailability.date <= dt.strptime(appt_date_to, "%Y-%m-%d").date())
        base = base.where(Appointment.slot_id.in_(_cnt_slot_ids))

    if priority or ministry or category:
        gsr_sub = (
            select(GrievanceSummaryRecord.appointment_id)
            .where(GrievanceSummaryRecord.is_latest == True)  # noqa: E712
        )
        if priority:
            gsr_sub = gsr_sub.where(GrievanceSummaryRecord.priority == priority)
        if ministry:
            gsr_sub = gsr_sub.where(GrievanceSummaryRecord.ministry == ministry)
        if category:
            gsr_sub = gsr_sub.where(GrievanceSummaryRecord.category == category)
        if category:
            appt_cat_sub = select(Appointment.id).where(Appointment.grievance_category == category)
            base = base.where(or_(Appointment.id.in_(gsr_sub), Appointment.id.in_(appt_cat_sub)))
        else:
            base = base.where(Appointment.id.in_(gsr_sub))

    # ── Search path: decrypt-and-bucket (matches list endpoint's semantics) ──
    if search and search.strip():
        q = search.strip().lower()
        # Load citizen alongside for decrypt lookup
        stmt = (
            select(Appointment)
            .options(selectinload(Appointment.citizen))
        )
        # Re-apply the same WHERE conditions on the ORM-level statement
        if kind == "meeting":
            stmt = stmt.where(Appointment.schedule_meeting == True)   # noqa: E712
        elif kind == "petition":
            stmt = stmt.where(Appointment.schedule_meeting == False)  # noqa: E712
        if date_from:
            stmt = stmt.where(Appointment.created_at >= _ist_start(date_from))
        if date_to:
            stmt = stmt.where(Appointment.created_at < _ist_end(date_to))
        if appt_date_from:
            stmt = stmt.where(Appointment.created_at >= _ist_start(appt_date_from))
        if appt_date_to:
            stmt = stmt.where(Appointment.created_at < _ist_end(appt_date_to))
        if priority or ministry or category:
            gsr_sub = (
                select(GrievanceSummaryRecord.appointment_id)
                .where(GrievanceSummaryRecord.is_latest == True)  # noqa: E712
            )
            if priority:
                gsr_sub = gsr_sub.where(GrievanceSummaryRecord.priority == priority)
            if ministry:
                gsr_sub = gsr_sub.where(GrievanceSummaryRecord.ministry == ministry)
            if category:
                gsr_sub = gsr_sub.where(GrievanceSummaryRecord.category == category)
            if category:
                appt_cat_sub = select(Appointment.id).where(Appointment.grievance_category == category)
                stmt = stmt.where(or_(Appointment.id.in_(gsr_sub), Appointment.id.in_(appt_cat_sub)))
            else:
                stmt = stmt.where(Appointment.id.in_(gsr_sub))

        rows = (await db.execute(stmt)).scalars().all()
        scheduled = waiting = rescheduled = all_count = 0
        for appt in rows:
            citizen = appt.citizen
            name = _decode(citizen.encrypted_name) if citizen else ""
            mobile = _decode(citizen.encrypted_mobile) if citizen else ""
            if not (
                q in name.lower()
                or q in (mobile or "")
                or q in str(appt.token_assigned)
                or q in f"tkn{appt.token_assigned}"
            ):
                continue
            all_count += 1
            if appt.status == "SCHEDULED" and appt.schedule_meeting:
                scheduled += 1
            elif appt.status in ("WAITING", "IN_PROGRESS"):
                waiting += 1
            elif appt.status == "RESCHEDULED":
                rescheduled += 1
        return {
            "Scheduled": scheduled,
            "Waiting": waiting,
            "Rescheduled": rescheduled,
            "All": all_count,
        }

    # ── No-search: single aggregate query with FILTER clauses ──
    sub = base.subquery()
    agg = select(
        func.count().label("all_count"),
        func.count().filter(
            and_(sub.c.status == "SCHEDULED", sub.c.schedule_meeting == True)  # noqa: E712
        ).label("scheduled"),
        func.count().filter(sub.c.status.in_(["WAITING", "IN_PROGRESS"])).label("waiting"),
        func.count().filter(sub.c.status == "RESCHEDULED").label("rescheduled"),
    ).select_from(sub)
    row = (await db.execute(agg)).one()
    return {
        "Scheduled": row.scheduled or 0,
        "Waiting": row.waiting or 0,
        "Rescheduled": row.rescheduled or 0,
        "All": row.all_count or 0,
    }


def build_appointment_row(appt) -> Dict[str, Any]:
    """Build the rich appointment row (citizen + AI summary + attachments) used by
    the appointments table AND the dashboard detail drawer."""
    from src.services.storage_service import get_file_url
    citizen = appt.citizen
    name = _decode(citizen.encrypted_name) if citizen else "—"
    mobile = _decode(citizen.encrypted_mobile) if citizen else "—"
    summary_rec: Optional[GrievanceSummaryRecord] = next(
        (s for s in appt.grievance_summary if s.is_latest), None
    )
    attachments_data = [
        {"url": get_file_url(a.storage_url), "type": a.attachment_type, "mime": a.mime_type, "name": Path(a.storage_url).name}
        for a in appt.attachments
    ]
    # v2: audio lives in attachments (type='AUDIO'), no dedicated column
    audio_url = next(
        (get_file_url(a.storage_url) for a in appt.attachments if a.attachment_type == "AUDIO"),
        None,
    )
    # v2: scheduled date/time derived from the booked slot (populated by caller
    # via selectinload of Appointment → scheduled_slot when needed).
    slot_obj = getattr(appt, "scheduled_slot", None)
    slot_date = getattr(getattr(slot_obj, "availability", None), "date", None) if slot_obj else None
    slot_start = slot_obj.start_time if slot_obj else None
    slot_end = slot_obj.end_time if slot_obj else None
    return {
        "id": appt.id,
        "token": f"TKN{appt.token_assigned}",
        "name": name,
        "name_ta": _decode(appt.encrypted_name_ta) if appt.encrypted_name_ta else None,
        "mobile": mobile,
        "category": _category_label(appt.grievance_category),
        "ministry": (summary_rec.ministry if summary_rec else None),
        "status_db": appt.status,
        "status": _resolve_display_status(appt),
        "source": appt.source or "qr_citizen",
        "venue": appt.venue_id,  # physical location / event where the QR was scanned
        "venue_label": None,     # filled from the venue registry by _attach_venue_labels
        "created_at": utc_iso(appt.created_at),
        "scheduled_date": (slot_date.isoformat() if slot_date else None),
        "appointment_time": (
            datetime.combine(slot_date, slot_start).isoformat()
            if slot_date and slot_start else None
        ),
        "appointment_slot_end": (slot_end.strftime("%H:%M") if slot_end else None),
        "slot_window": (
            f"{slot_start.strftime('%H:%M')} – {slot_end.strftime('%H:%M')}"
            if slot_start and slot_end else None
        ),
        "num_persons": appt.num_persons,
        "description": _decode(appt.encrypted_grievance) if appt.encrypted_grievance else None,
        "audio_url": audio_url,
        "summary": summary_rec.summary if summary_rec else None,
        "summary_ta": summary_rec.summary_ta if summary_rec else None,
        "citizen_ask": summary_rec.citizen_ask if summary_rec else None,
        "citizen_ask_ta": summary_rec.citizen_ask_ta if summary_rec else None,
        "priority": summary_rec.priority if summary_rec else None,
        "key_details": summary_rec.key_details if summary_rec else [],
        "key_details_ta": summary_rec.key_details_ta if summary_rec else [],
        "ai_name_en": summary_rec.name_en if summary_rec else None,
        "ai_name_ta": summary_rec.name_ta if summary_rec else None,
        "audio_transcript": summary_rec.audio_transcript if summary_rec else None,
        # Standalone STT transcript populated for courtesy submissions
        # (invitation/greetings) that skip the AI summary pipeline.
        "transcript": _decode(appt.encrypted_transcript) if appt.encrypted_transcript else None,
        # Lets the UI decide whether "Summary is being prepared" is honest.
        "summary_status": appt.summary_status,
        "category_label": _category_label(appt.grievance_category),
        "ministry_label": (MINISTRY_DISPLAY.get(summary_rec.ministry, summary_rec.ministry) if summary_rec and summary_rec.ministry else None),
        "district": (summary_rec.district if summary_rec else None),
        "district_label": (
            DISTRICT_DISPLAY.get(summary_rec.district, summary_rec.district)
            if summary_rec and summary_rec.district else None
        ),
        "attachments": attachments_data,
    }


async def get_appointment_detail(db: AsyncSession, appointment_id: int) -> Optional[Dict[str, Any]]:
    """Single rich appointment row for the detail drawer (summary + attachments)."""
    stmt = (
        select(Appointment)
        .options(
            selectinload(Appointment.citizen),
            selectinload(Appointment.attachments),
            selectinload(Appointment.grievance_summary),
            selectinload(Appointment.scheduled_slot).selectinload(AppointmentSlot.availability),
        )
        .where(Appointment.id == appointment_id)
    )
    appt = (await db.execute(stmt)).scalar_one_or_none()
    return build_appointment_row(appt) if appt else None


# ── PA-added attachments (petition review + ticket detail) ────────────────────
_ATTACH_ALLOWED_MIMES = {"image/jpeg", "image/png", "image/webp", "application/pdf"}
_ATTACH_MAX_BYTES = 5 * 1024 * 1024   # 5 MB


async def appointment_id_for_ticket(db: AsyncSession, ticket_id: int) -> Optional[int]:
    """Resolve a ticket to its underlying appointment (tickets are 1:1 with appointments)."""
    from src.models.ticket_models import Ticket
    return await db.scalar(select(Ticket.appointment_id).where(Ticket.id == ticket_id))


async def add_case_attachment(
    db: AsyncSession, appointment_id: int, filename: str, raw: bytes, mime: str,
) -> Optional[Dict[str, Any]]:
    """Attach a PA-uploaded file (≤5 MB, image/PDF) to a case's appointment.

    Stored in the same per-token folder as the citizen's own media so the
    petition review and the ticket detail both surface it. Raises ValueError on
    a bad type/size; returns None if the appointment doesn't exist.
    """
    import asyncio
    import re
    import secrets
    from pathlib import Path
    from datetime import datetime as _dt
    from src.services.storage_service import save_file, get_file_url

    if mime not in _ATTACH_ALLOWED_MIMES:
        raise ValueError(f"Unsupported file type '{mime}'. Allowed: JPG, PNG, WEBP, PDF.")
    if len(raw) > _ATTACH_MAX_BYTES:
        raise ValueError("File exceeds the 5 MB limit.")

    appt = await db.get(Appointment, appointment_id)
    if appt is None:
        return None

    attachment_type = "IMAGE" if mime.startswith("image/") else "DOCUMENT"
    safe = re.sub(r"[^A-Za-z0-9._-]", "_", filename or "file")
    ts = _dt.utcnow().strftime("%Y%m%d_%H%M%S")
    # Same unified folder as citizen uploads: attachments/{token}/...
    rel = f"attachments/{appt.token_assigned}/pa_{ts}_{secrets.token_hex(6)}_{safe}"
    storage_url = await asyncio.to_thread(save_file, raw, rel, mime)

    att = AppointmentAttachment(
        appointment_id=appt.id,
        attachment_type=attachment_type,
        storage_url=storage_url,
        file_size_bytes=len(raw),
        mime_type=mime,
    )
    db.add(att)
    await db.commit()
    return {
        "url": get_file_url(storage_url),
        "type": attachment_type,
        "mime": mime,
        "name": Path(storage_url).name,
    }


async def update_appointment_derived_fields(
    db: AsyncSession,
    appointment_id: int,
    priority: Optional[str] = None,
    category: Optional[str] = None,
    ministry: Optional[str] = None,
    district: Optional[str] = None,
    name: Optional[str] = None,
    name_ta: Optional[str] = None,
    summary_text: Optional[str] = None,
) -> dict:
    """
    PA override for a petition/appointment from the unified review drawer:
    name + Tamil name (on the Appointment, Fernet-encrypted), the AI summary
    (on GrievanceSummaryRecord), and the classification (category/priority/
    ministry). Any field left as None is unchanged.

    Returns:
        {"success": True} on success, {"success": False} if no record found.
    """
    from src.core import crypto
    # priority lives on GrievanceSummaryRecord; category lives on Appointment.
    appt = await db.scalar(
        select(Appointment)
        .options(selectinload(Appointment.citizen))
        .where(Appointment.id == appointment_id)
    )
    if not appt:
        return {"success": False}

    if name is not None and name.strip():
        # v2: the English name lives on the Citizen record (no per-appointment copy).
        if appt.citizen:
            appt.citizen.encrypted_name = crypto.encrypt(name.strip())
    if name_ta is not None:
        appt.encrypted_name_ta = crypto.encrypt(name_ta.strip()) if name_ta.strip() else None

    if category is not None:
        old_category = appt.grievance_category
        appt.grievance_category = category or None
        if old_category != appt.grievance_category:
            _log_appt_event(db, appointment_id, "category_changed",
                            payload={"from": old_category, "to": appt.grievance_category})

    summary_rec = await db.scalar(
        select(GrievanceSummaryRecord)
        .where(GrievanceSummaryRecord.appointment_id == appointment_id)
        .order_by(GrievanceSummaryRecord.created_at.desc())
        .limit(1)
    )
    if summary_rec:
        if priority is not None:
            old_priority = summary_rec.priority
            summary_rec.priority = priority or None
            if old_priority != summary_rec.priority:
                _log_appt_event(db, appointment_id, "priority_changed",
                                payload={"from": old_priority, "to": summary_rec.priority})
        if ministry is not None:
            old_ministry = summary_rec.ministry
            summary_rec.ministry = ministry or None
            if old_ministry != summary_rec.ministry:
                _log_appt_event(db, appointment_id, "ministry_changed",
                                payload={"from": old_ministry, "to": summary_rec.ministry})
        if district is not None:
            # Empty string / "unknown" → NULL (matches the persist convention
            # used elsewhere so downstream can just check truthiness).
            new_district = None if district in ("", "unknown") else district
            old_district = summary_rec.district
            summary_rec.district = new_district
            if old_district != new_district:
                _log_appt_event(db, appointment_id, "district_changed",
                                payload={"from": old_district, "to": new_district})
        if summary_text is not None:
            summary_rec.summary = summary_text

    await db.commit()
    return {"success": True}


_DISPLAY_TO_DB_STATUS = {
    "Scheduled":       "SCHEDULED",
    "Reviewed":        "REVIEWED",
    "Waiting":         "WAITING",
    "Rescheduled":     "RESCHEDULED",
    "Awaiting Review": "AWAITING_REVIEW",
    "Courtesy Done":   "COURTESY_DONE",
    # PA marked reviewed WITHOUT creating a ticket — courtesy audio, blank
    # postal envelope, obvious duplicate. Row stays in the "All" list but
    # hides from Awaiting / Reviewed for queue cleanliness.
    "Dismissed":       "DISMISSED",
}

async def update_appointment_status(db: AsyncSession, appointment_id: int, new_status: str) -> dict:
    """
    Update appointment status and return appointment details for SMS notification.

    Handles slot release/queueing for Waiting/Rescheduled and attempts to
    re-book a slot for Scheduled when availability exists.

    Returns:
        dict with keys: success (bool), mobile (str), token (int), name (str), status (str)
        Returns {"success": False} if appointment not found.
    """
    from sqlalchemy.orm import selectinload

    result = await db.execute(
        select(Appointment)
        .options(selectinload(Appointment.citizen))
        .where(Appointment.id == appointment_id)
    )
    appt = result.scalar_one_or_none()
    if not appt:
        return {"success": False}

    old_status = appt.status

    if new_status == "Waiting":
        # Move to the waiting queue: release slot and set status=WAITING via
        # the scheduling service so queue_position/waiting_since stay coherent.
        # Preserve schedule_meeting intent — waiting meetings are still meetings.
        await scheduling_service.release_slot(db, appt, commit=False)
        await scheduling_service.move_to_waiting_queue(
            db, appt, "MANUAL_WAITING", commit=False
        )
        appt.schedule_meeting = True
    elif new_status == "Rescheduled":
        # Manual reschedule: PA is calling / messaging the citizen. The row
        # belongs on the Rescheduled tab (not Waiting) so the PA can act on it
        # from there — either pick a new slot (→ Scheduled) or convert to
        # petition (→ Awaiting Review).
        #
        # Release the slot booking (frees the seat + nulls the day/time), then
        # set RESCHEDULED explicitly. (v2: no pre_floor_status column to clear.)
        await scheduling_service.release_slot(db, appt, commit=False)
        appt.status = "RESCHEDULED"
        appt.status_id = v2.appointment_status_id("RESCHEDULED")
        appt.schedule_meeting = True
        # Notify the citizen the appointment is cancelled — new time TBD.
        import asyncio as _asyncio
        _asyncio.create_task(_notify(kind="reschedule_cancel", appointment_id=appointment_id, ctx={"actor": "pa"}))
    elif new_status == "Scheduled":
        # PA manually marks as Scheduled — slot assignment handled separately
        # via the scheduling page reschedule flow.
        appt.status = "SCHEDULED"
        appt.status_id = v2.appointment_status_id("SCHEDULED")
        appt.schedule_meeting = True
    elif new_status == "Reviewed":
        # PA marks petition as reviewed — release slot only if the meeting
        # hasn't started yet (v2: check slot start_time via AppointmentSlot).
        if appt.slot_id:
            slot_obj = await db.get(AppointmentSlot, appt.slot_id)
            if slot_obj:
                avail = await db.get(MLADailyAvailability, slot_obj.availability_id)
                slot_dt = datetime.combine(avail.date, slot_obj.start_time) if avail else None
                if slot_dt and slot_dt > datetime.utcnow():
                    await scheduling_service.release_slot(db, appt, commit=False)
        appt.status = "REVIEWED"
        appt.status_id = v2.appointment_status_id("REVIEWED")
        appt.schedule_meeting = False

        # Create ticket when petition is reviewed (if not already exists)
        from src.models.ticket_models import (
            Ticket, TicketStatus, generate_ticket_number,
        )
        from sqlalchemy import func as sa_func

        # Ticket-per-appointment is unique. Three cases to handle:
        #   1. No ticket   → mint one.
        #   2. Ticket in REVERTED state (PA sent it back to review earlier)
        #      → reuse the same row: flip status back to OPEN, clear the
        #        revert-* audit fields, log a "reapproved" event.
        #      Reusing keeps the ticket number stable across revert / re-approve
        #      cycles, so the citizen and audit trail don't see phantom
        #      duplicate ticket numbers.
        #   3. Ticket already alive in any other state → no-op (this path
        #      shouldn't fire normally; approve_petition only runs from
        #      Awaiting Review).
        current_time = datetime.utcnow()
        existing_ticket = (await db.execute(
            select(Ticket).where(Ticket.appointment_id == appointment_id)
        )).scalar_one_or_none()

        if existing_ticket is None:
            # Case 1 — mint a fresh ticket. Sequence = MAX existing suffix
            # for the year + 1. Advisory xact-lock keyed on year serialises
            # concurrent creations.
            from sqlalchemy import text as _sa_text
            year = current_time.year
            await db.execute(_sa_text("SELECT pg_advisory_xact_lock(:k)"), {"k": 880000 + year})
            max_tn = await db.scalar(
                select(sa_func.max(Ticket.ticket_number))
                .where(Ticket.ticket_number.like(f"TKT-{year}-%"))
            )
            year_count = (int(max_tn.split("-")[-1]) if max_tn else 0) + 1

            ticket_ids = v2.new_ticket_ids(status="open")
            new_ticket = Ticket(
                appointment_id=appointment_id,
                ticket_number=generate_ticket_number(year, year_count),
                status=TicketStatus.OPEN.value,
                status_id=ticket_ids["status_id"],
                priority_id=ticket_ids["priority_id"],
                created_at=current_time,
                updated_at=current_time,
            )
            db.add(new_ticket)
            await db.flush()  # get ticket.id for the activity row

            # v2: single Activity row instead of separate TicketEvent
            db.add(Activity(
                ticket_id=new_ticket.id,
                user="pa_admin",
                action_type="created",
                message=f"Ticket created after PA review (token {appt.token_assigned})",
                payload={"token": appt.token_assigned, "appointment_id": appointment_id},
            ))
        elif existing_ticket.status == TicketStatus.REVERTED.value:
            # Case 2 — reuse the reverted row. The revert action set status,
            # cleared department/due_date, and stamped revert_*; undo all of
            # that but preserve the ticket number, history, attachments, and
            # activity trail. Log a distinct "reapproved" event so the log
            # reads: created → reverted → reapproved.
            prev_reason = existing_ticket.revert_reason
            existing_ticket.status = TicketStatus.OPEN.value
            existing_ticket.status_id = v2.ticket_status_id(TicketStatus.OPEN.value)
            existing_ticket.reverted_at = None
            existing_ticket.reverted_by = None
            existing_ticket.revert_reason = None
            existing_ticket.updated_at = current_time
            db.add(Activity(
                ticket_id=existing_ticket.id,
                user="pa_admin",
                action_type="reapproved",
                message=f"Ticket re-approved after revert (token {appt.token_assigned})",
                payload={
                    "token": appt.token_assigned,
                    "appointment_id": appointment_id,
                    "previous_revert_reason": prev_reason,
                },
            ))
    elif new_status == "Awaiting Review":
        # Allow moving a record back into the review queue (PA correction).
        if appt.slot_id:
            slot_obj = await db.get(AppointmentSlot, appt.slot_id)
            if slot_obj:
                avail = await db.get(MLADailyAvailability, slot_obj.availability_id)
                slot_dt = datetime.combine(avail.date, slot_obj.start_time) if avail else None
                if slot_dt and slot_dt > datetime.utcnow():
                    await scheduling_service.release_slot(db, appt, commit=False)
        appt.schedule_meeting = False
        appt.status = "AWAITING_REVIEW"
        appt.status_id = v2.appointment_status_id("AWAITING_REVIEW")
        # A rescheduled row converting to a petition (citizen agreed to just
        # submit): notify them the petition is now under review.
        if old_status == "RESCHEDULED":
            import asyncio as _asyncio
            _asyncio.create_task(_notify(kind="convert_to_petition",
                                         appointment_id=appointment_id,
                                         ctx={"actor": "pa"}))
    else:
        resolved_status = _DISPLAY_TO_DB_STATUS.get(new_status, new_status.upper())
        appt.status = resolved_status
        appt.status_id = v2.appointment_status_id_or_none(resolved_status)

    # Log the status change
    if old_status != appt.status:
        _log_appt_event(db, appointment_id, "status_changed",
                        payload={"from": old_status, "to": appt.status})

    await db.commit()

    # Return appointment details for SMS notification
    citizen = appt.citizen
    mobile = _decode(citizen.encrypted_mobile) if citizen else None
    name = _decode(citizen.encrypted_name) if citizen else None

    return {
        "success": True,
        "mobile": mobile,
        "token": appt.token_assigned,
        "name": name,
        "status": new_status,
    }


async def dismiss_petition(db: AsyncSession, appointment_id: int, actor: str = "pa_admin") -> dict:
    """Mark an AWAITING_REVIEW petition Dismissed — reviewed by the PA with
    no ticket / department routing. Used for courtesy audio, blank postal
    envelopes, or obvious duplicates that the PA doesn't want to spawn a
    ticket for. The row stays visible in "All" only.

    Refuses if the petition is already past AWAITING_REVIEW so we don't
    accidentally reopen or double-count anything.
    """
    appt = await db.get(Appointment, appointment_id)
    if appt is None:
        raise ValueError("Petition not found.")
    if appt.status != "AWAITING_REVIEW":
        raise ValueError("Only awaiting-review petitions can be dismissed.")
    old_status = appt.status
    appt.status = "DISMISSED"
    appt.status_id = v2.appointment_status_id_or_none("DISMISSED")
    _log_appt_event(db, appointment_id, "status_changed",
                    payload={"from": old_status, "to": "DISMISSED", "via": "pa_dismiss", "actor": actor})
    await db.commit()
    return {"status": "Dismissed", "appointment_id": appointment_id}


async def approve_petition(db: AsyncSession, appointment_id: int, actor: str = "pa_admin") -> dict:
    """Approve a QR/staff petition (appointment in AWAITING_REVIEW): flip to
    Reviewed — which creates the ticket — then forward out if the AI ministry is
    non-school. Mirrors the scanned-upload approve so every source behaves the
    same (School → Accept/open, other ministry → Forward)."""
    from src.models.ticket_models import Ticket
    from src.models.appointment_models import AppointmentAttachment

    # An audio-only petition can't be approved into a ticket. The recording is
    # not readable evidence on its own — the department receiving the ticket
    # needs the written grievance or a scanned/photographed document to act on.
    # A petition with no attachments at all is fine (it carries a typed
    # description); this blocks only the "audio, and nothing else" case.
    types = set((await db.execute(
        select(AppointmentAttachment.attachment_type)
        .where(AppointmentAttachment.appointment_id == appointment_id)
    )).scalars().all())
    if "AUDIO" in types and not (types & {"IMAGE", "DOCUMENT"}):
        raise ValueError(
            "This petition has only a voice recording. Add a photo or document "
            "of the grievance before approving it into a ticket."
        )

    result = await update_appointment_status(db, appointment_id, "Reviewed")
    ticket = await db.scalar(select(Ticket).where(Ticket.appointment_id == appointment_id))
    summary = await db.scalar(
        select(GrievanceSummaryRecord).where(
            GrievanceSummaryRecord.appointment_id == appointment_id,
            GrievanceSummaryRecord.is_latest == True,  # noqa: E712
        )
    )
    forwarded = False
    if ticket:
        from src.services import department_service
        forwarded = await department_service.forward_if_non_school(
            db, ticket.id, summary.ministry if summary else None, actor)
    return {
        "status": result.get("status"),
        "ticket_number": ticket.ticket_number if ticket else None,
        "forwarded": forwarded,
    }


async def auto_reschedule_stale_scheduled(db: AsyncSession) -> int:
    """
    Flip any SCHEDULED appointment whose day has already passed to RESCHEDULED,
    unless the floor already marked them (AWAITING_REVIEW / NOT_CAME / COURTESY_DONE).

    Runs at startup and again just after midnight so the Scheduled tab never
    accumulates yesterday's rows the PA forgot to cancel. Returns the row count
    for the log line.
    """
    from datetime import date as _date_type
    today = _date_type.today()
    # v2: meeting date lives on slot → availability.
    stmt = (
        select(Appointment)
        .join(AppointmentSlot, AppointmentSlot.id == Appointment.slot_id)
        .join(MLADailyAvailability, MLADailyAvailability.id == AppointmentSlot.availability_id)
        .where(
            Appointment.status == "SCHEDULED",
            MLADailyAvailability.date < today,
        )
    )
    rows = (await db.execute(stmt)).scalars().all()
    if not rows:
        return 0
    for appt in rows:
        appt.status = "RESCHEDULED"
        appt.status_id = v2.appointment_status_id("RESCHEDULED")
        _log_appt_event(db, appt.id, "status_changed",
                        payload={"from": "SCHEDULED", "to": "RESCHEDULED", "via": "auto_reschedule"})
    await db.commit()
    return len(rows)


async def set_floor_attendance(db: AsyncSession, appointment_id: int, action: str) -> dict:
    """
    Floor-board attendance toggle used by the crowd-management PWA.

    Deliberately side-effect-free vs update_appointment_status: it only flips the
    status field and logs the change. It does NOT release the slot — releasing
    nulls scheduled_date, which would drop the row off today's board, and freeing
    capacity on a same-day passed slot is pointless.

      action="came"     -> AWAITING_REVIEW (regular petitioner enters PA review)
                           -> COURTESY_DONE  (invitation/greetings — nothing to review)
      action="not_came" -> NOT_CAME         (no-show)
      action="reset"    -> restore the original scheduling status (undo a mistake)

    v2: no pre_floor_status column — 'reset' derives the restore state from
    whether the row still holds a booked slot (SCHEDULED vs AWAITING_REVIEW).
    """
    from src.services.appointment_service import COURTESY_CATEGORIES

    action = (action or "").strip().lower().replace(" ", "_")
    if action not in ("came", "not_came", "reset"):
        return {"success": False, "error": "invalid action"}

    result = await db.execute(
        select(Appointment).where(Appointment.id == appointment_id)
    )
    appt = result.scalar_one_or_none()
    if not appt:
        return {"success": False}

    old_status = appt.status
    is_courtesy = (appt.grievance_category or "").lower() in COURTESY_CATEGORIES

    if action == "reset":
        # v2: pre_floor_status column removed — reset always goes to
        # SCHEDULED (if there's still a booked slot) or AWAITING_REVIEW otherwise.
        # This loses the SCHEDULED vs RESCHEDULED distinction on undo but keeps
        # the floor-board workflow functional.
        reset_status = "SCHEDULED" if appt.slot_id else "AWAITING_REVIEW"
        appt.status = reset_status
        appt.status_id = v2.appointment_status_id(reset_status)
    else:
        # v2: no pre_floor_status capture (column removed).
        if action == "came":
            # Courtesy visitors have nothing to review — they handed over an
            # invitation card or wished the Minister well. Terminal status.
            floor_status = "COURTESY_DONE" if is_courtesy else "AWAITING_REVIEW"
        else:
            floor_status = "NOT_CAME"
        appt.status = floor_status
        appt.status_id = v2.appointment_status_id(floor_status)

    if old_status != appt.status:
        _log_appt_event(db, appointment_id, "status_changed",
                        payload={"from": old_status, "to": appt.status, "via": "floor_board"})

    await db.commit()
    return {"success": True, "status": _STATUS_DISPLAY.get(appt.status, appt.status)}
