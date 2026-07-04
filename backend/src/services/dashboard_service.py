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
from src.models.grievance_summary_record import GrievanceSummaryRecord
from src.models.grievance_summary import CATEGORY_DISPLAY, DEPARTMENT_DISPLAY
from src.services.v2_helpers import v2


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
    # SCHEDULED status — a "meeting request" is one with a booked slot.
    return "Scheduled" if appt.slot_id else "Reviewed"


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
            clauses.append(Appointment.created_at >= datetime.strptime(date_from, "%Y-%m-%d"))
        if date_to:
            clauses.append(Appointment.created_at <= datetime.strptime(date_to + " 23:59:59", "%Y-%m-%d %H:%M:%S"))
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
        Appointment.slot_id.isnot(None),
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

    urgency_rows = await db.execute(
        select(GrievanceSummaryRecord.urgency, func.count(GrievanceSummaryRecord.id))
        .where(*gsr_filter)
        .group_by(GrievanceSummaryRecord.urgency)
    )
    urgency = {r[0]: r[1] for r in urgency_rows}

    # Primary department breakdown — drives the routing KPI for the Minister.
    dept_rows = await db.execute(
        select(GrievanceSummaryRecord.department, func.count(GrievanceSummaryRecord.id))
        .where(*gsr_filter)
        .group_by(GrievanceSummaryRecord.department)
        .order_by(func.count(GrievanceSummaryRecord.id).desc())
        .limit(10)
    )
    from src.models.grievance_summary import DEPARTMENT_DISPLAY
    departments = [
        {"label": DEPARTMENT_DISPLAY.get(r[0], r[0]), "count": r[1]} for r in dept_rows
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
        Appointment.slot_id.isnot(None),
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
        start_dt = datetime.strptime(date_from, "%Y-%m-%d")
        end_dt = datetime.strptime(date_to + " 23:59:59", "%Y-%m-%d %H:%M:%S")
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
        forwarded_q = forwarded_q.where(Ticket.created_at >= datetime.strptime(date_from, "%Y-%m-%d"))
    if date_to:
        forwarded_q = forwarded_q.where(Ticket.created_at <= datetime.strptime(date_to + " 23:59:59", "%Y-%m-%d %H:%M:%S"))
    forwarded_rows = await db.execute(forwarded_q)
    from src.models.grievance_summary import DEPARTMENT_DISPLAY as _DEPT_DISP
    forwarded_departments = [
        {"label": _DEPT_DISP.get(r[0], r[0]), "count": r[1]} for r in forwarded_rows
    ]
    total_forwarded = sum(d["count"] for d in forwarded_departments)

    # SLA bucket health by priority — actionable tickets only
    sla_targets_days = {"P0": 3, "P1": 7, "P2": 14, "P3": 28}
    sla_buckets = []
    for prio, target in sla_targets_days.items():
        threshold = now - timedelta(days=target)
        on_track = await db.scalar(
            select(func.count(Ticket.id))
            .where(Ticket.priority == prio,
                   Ticket.status.in_(actionable_statuses),
                   Ticket.created_at > threshold)
        ) or 0
        breached = await db.scalar(
            select(func.count(Ticket.id))
            .where(Ticket.priority == prio,
                   Ticket.status.in_(actionable_statuses),
                   Ticket.created_at <= threshold)
        ) or 0
        sla_buckets.append({"priority": prio, "on_track": on_track, "breached": breached, "target_days": target})

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
        "departments":       departments,
        "urgency":           urgency,
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
        "forwarded_departments": forwarded_departments,
        "total_forwarded":   total_forwarded,
    }


async def get_appointments(
    db: AsyncSession,
    status_filter: Optional[str] = None,
    search: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    appt_date_from: Optional[str] = None,
    appt_date_to: Optional[str] = None,
    urgency: Optional[str] = None,
    department: Optional[str] = None,
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
    `sort`: "urgency" → Critical→High→Medium→Low (then newest); else newest first.
    """
    from datetime import datetime as dt
    is_scheduled_tab = status_filter == "Scheduled"
    stmt = (
        select(Appointment)
        .options(
            selectinload(Appointment.citizen),
            selectinload(Appointment.attachments),
            selectinload(Appointment.grievance_summary),
        )
    )

    # Kind: meeting requests vs direct petitions (ordering is applied later).
    if kind == "meeting":
        stmt = stmt.where(Appointment.slot_id.isnot(None))   # noqa: E712
    elif kind == "petition":
        stmt = stmt.where(Appointment.slot_id.is_(None))  # noqa: E712

    # Submission date filter (when citizen submitted the form)
    if date_from:
        stmt = stmt.where(Appointment.created_at >= dt.strptime(date_from, "%Y-%m-%d"))
    if date_to:
        stmt = stmt.where(Appointment.created_at <= dt.strptime(date_to + " 23:59:59", "%Y-%m-%d %H:%M:%S"))

    # Appointment date filter (when the meeting slot is scheduled)
    from datetime import date as date_type
    if appt_date_from:
        stmt = stmt.where(Appointment.created_at >= dt.strptime(appt_date_from, "%Y-%m-%d").date())
    if appt_date_to:
        stmt = stmt.where(Appointment.created_at <= dt.strptime(appt_date_to, "%Y-%m-%d").date())

    if status_filter and status_filter != "All":
        if status_filter == "Scheduled":
            stmt = stmt.where(
                Appointment.slot_id.isnot(None),
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

    # AI-derived filters: urgency + department live only on GrievanceSummaryRecord.
    # Category also falls back to Appointment.grievance_category for petitions
    # that haven't been AI-summarised yet (AWAITING_REVIEW with form-selected category).
    if urgency or department or category:
        gsr_sub = (
            select(GrievanceSummaryRecord.appointment_id)
            .where(GrievanceSummaryRecord.is_latest == True)  # noqa: E712
        )
        if urgency:
            gsr_sub = gsr_sub.where(GrievanceSummaryRecord.urgency == urgency)
        if department:
            gsr_sub = gsr_sub.where(GrievanceSummaryRecord.department == department)
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
    if sort == "urgency":
        # Critical → High → Medium → Low (then newest). Urgency lives on the latest
        # AI summary, so join it just for the sort key.
        urgency_rank = case(
            (GrievanceSummaryRecord.urgency == "critical", 0),
            (GrievanceSummaryRecord.urgency == "high", 1),
            (GrievanceSummaryRecord.urgency == "medium", 2),
            (GrievanceSummaryRecord.urgency == "low", 3),
            else_=4,
        )
        stmt = stmt.outerjoin(
            GrievanceSummaryRecord,
            and_(
                GrievanceSummaryRecord.appointment_id == Appointment.id,
                GrievanceSummaryRecord.is_latest == True,  # noqa: E712
            ),
        ).order_by(urgency_rank.asc(), Appointment.created_at.desc())
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
        # Default across all tabs (including Scheduled): newest submissions first,
        # so recent petitions surface immediately. PAs can opt into appt-date
        # ordering via the appt_date_asc / appt_date_desc sort options.
        stmt = stmt.order_by(Appointment.created_at.desc())

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
        return {"items": items, "total": total, "page": page, "page_size": page_size}

    # ── No-search path: efficient DB-side count + pagination ────────────────────
    count_stmt = select(func.count()).select_from(stmt.subquery())
    total = await db.scalar(count_stmt) or 0

    stmt = stmt.offset((page - 1) * page_size).limit(page_size)
    result = await db.execute(stmt)
    appointments = result.scalars().all()

    items = [build_appointment_row(appt) for appt in appointments]
    return {"items": items, "total": total, "page": page, "page_size": page_size}


async def get_appointment_counts(
    db: AsyncSession,
    search: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    appt_date_from: Optional[str] = None,
    appt_date_to: Optional[str] = None,
    urgency: Optional[str] = None,
    department: Optional[str] = None,
    category: Optional[str] = None,
    kind: Optional[str] = None,
) -> Dict[str, int]:
    """
    Per-tab counts (Scheduled / Waiting / Rescheduled / All) honouring the same
    secondary filters as `get_appointments`. Replaces 4 parallel list calls with
    a single aggregate query — search falls back to a decrypt-bucket pass.
    """
    from datetime import datetime as dt

    # v2: use slot_id as the "is-a-meeting-request" flag (non-null ⇒ meeting)
    base = select(Appointment.id, Appointment.status, Appointment.slot_id)

    if kind == "meeting":
        base = base.where(Appointment.slot_id.isnot(None))   # noqa: E712
    elif kind == "petition":
        base = base.where(Appointment.slot_id.is_(None))  # noqa: E712

    if date_from:
        base = base.where(Appointment.created_at >= dt.strptime(date_from, "%Y-%m-%d"))
    if date_to:
        base = base.where(Appointment.created_at <= dt.strptime(date_to + " 23:59:59", "%Y-%m-%d %H:%M:%S"))
    if appt_date_from:
        base = base.where(Appointment.created_at >= dt.strptime(appt_date_from, "%Y-%m-%d").date())
    if appt_date_to:
        base = base.where(Appointment.created_at <= dt.strptime(appt_date_to, "%Y-%m-%d").date())

    if urgency or department or category:
        gsr_sub = (
            select(GrievanceSummaryRecord.appointment_id)
            .where(GrievanceSummaryRecord.is_latest == True)  # noqa: E712
        )
        if urgency:
            gsr_sub = gsr_sub.where(GrievanceSummaryRecord.urgency == urgency)
        if department:
            gsr_sub = gsr_sub.where(GrievanceSummaryRecord.department == department)
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
            stmt = stmt.where(Appointment.slot_id.isnot(None))   # noqa: E712
        elif kind == "petition":
            stmt = stmt.where(Appointment.slot_id.is_(None))  # noqa: E712
        if date_from:
            stmt = stmt.where(Appointment.created_at >= dt.strptime(date_from, "%Y-%m-%d"))
        if date_to:
            stmt = stmt.where(Appointment.created_at <= dt.strptime(date_to + " 23:59:59", "%Y-%m-%d %H:%M:%S"))
        if appt_date_from:
            stmt = stmt.where(Appointment.created_at >= dt.strptime(appt_date_from, "%Y-%m-%d").date())
        if appt_date_to:
            stmt = stmt.where(Appointment.created_at <= dt.strptime(appt_date_to, "%Y-%m-%d").date())
        if urgency or department or category:
            gsr_sub = (
                select(GrievanceSummaryRecord.appointment_id)
                .where(GrievanceSummaryRecord.is_latest == True)  # noqa: E712
            )
            if urgency:
                gsr_sub = gsr_sub.where(GrievanceSummaryRecord.urgency == urgency)
            if department:
                gsr_sub = gsr_sub.where(GrievanceSummaryRecord.department == department)
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
            if appt.status == "SCHEDULED" and appt.slot_id is not None:
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
            and_(sub.c.status == "SCHEDULED", sub.c.slot_id.isnot(None))
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
        "mobile": mobile,
        "category": _category_label(appt.grievance_category),
        "department": (summary_rec.department if summary_rec else None),
        "secondary_departments": (summary_rec.secondary_departments if summary_rec else []) or [],
        "status_db": appt.status,
        "status": _resolve_display_status(appt),
        "source": "qr_citizen",  # v2: source column removed; default for now
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
        "headline": summary_rec.headline if summary_rec else None,
        "headline_ta": summary_rec.headline_ta if summary_rec else None,
        "summary": summary_rec.summary if summary_rec else None,
        "summary_ta": summary_rec.summary_ta if summary_rec else None,
        "citizen_ask": summary_rec.citizen_ask if summary_rec else None,
        "citizen_ask_ta": summary_rec.citizen_ask_ta if summary_rec else None,
        "urgency": summary_rec.urgency if summary_rec else None,
        "key_details": summary_rec.key_details if summary_rec else [],
        "key_details_ta": summary_rec.key_details_ta if summary_rec else [],
        "audio_transcript": summary_rec.audio_transcript if summary_rec else None,
        "category_label": _category_label(appt.grievance_category),
        "department_label": (DEPARTMENT_DISPLAY.get(summary_rec.department, summary_rec.department) if summary_rec and summary_rec.department else None),
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
        )
        .where(Appointment.id == appointment_id)
    )
    appt = (await db.execute(stmt)).scalar_one_or_none()
    return build_appointment_row(appt) if appt else None


async def update_appointment_derived_fields(
    db: AsyncSession,
    appointment_id: int,
    urgency: Optional[str] = None,
    category: Optional[str] = None,
    department: Optional[str] = None,
) -> dict:
    """
    Override AI-derived urgency / category / department on the linked
    GrievanceSummaryRecord. Used when the PA disagrees with the AI's
    classification.

    Returns:
        {"success": True} on success, {"success": False} if no record found.
    """
    # urgency lives on GrievanceSummaryRecord; category lives on Appointment.
    appt = await db.scalar(select(Appointment).where(Appointment.id == appointment_id))
    if not appt:
        return {"success": False}

    if category is not None:
        old_category = appt.grievance_category
        appt.grievance_category = category or None
        if old_category != appt.grievance_category:
            _log_appt_event(db, appointment_id, "category_changed",
                            payload={"from": old_category, "to": appt.grievance_category})

    summary = await db.scalar(
        select(GrievanceSummaryRecord)
        .where(GrievanceSummaryRecord.appointment_id == appointment_id)
        .order_by(GrievanceSummaryRecord.created_at.desc())
        .limit(1)
    )
    if summary:
        if urgency is not None:
            old_urgency = summary.urgency
            summary.urgency = urgency or None
            if old_urgency != summary.urgency:
                _log_appt_event(db, appointment_id, "urgency_changed",
                                payload={"from": old_urgency, "to": summary.urgency})
        if department is not None:
            old_dept = summary.department
            summary.department = department or None
            if old_dept != summary.department:
                _log_appt_event(db, appointment_id, "department_changed",
                                payload={"from": old_dept, "to": summary.department})

    await db.commit()
    return {"success": True}


_DISPLAY_TO_DB_STATUS = {
    "Scheduled":       "SCHEDULED",
    "Reviewed":        "REVIEWED",
    "Waiting":         "WAITING",
    "Rescheduled":     "RESCHEDULED",
    "Awaiting Review": "AWAITING_REVIEW",
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

    if new_status in ("Waiting", "Rescheduled"):
        # Release the slot booking and move to waiting queue
        await scheduling_service.release_slot(db, appt, commit=False)
        await scheduling_service.move_to_waiting_queue(
            db, appt, "MANUAL_RESCHEDULE", commit=False
        )
        # v2: schedule_meeting flag removed — slot_id presence conveys it.
    elif new_status == "Scheduled":
        # PA manually marks as Scheduled — slot assignment handled separately
        # via the scheduling page reschedule flow.
        appt.status = "SCHEDULED"
        appt.status_id = v2.appointment_status_id("SCHEDULED")
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

        # Create ticket when petition is reviewed (if not already exists)
        from src.models.ticket_models import (
            Ticket, TicketStatus, generate_ticket_number,
        )
        from sqlalchemy import func as sa_func

        # Check if ticket already exists for this appointment
        existing_ticket = await db.execute(
            select(Ticket).where(Ticket.appointment_id == appointment_id)
        )
        if not existing_ticket.scalar_one_or_none():
            # Create new ticket. Sequence = MAX existing suffix for the year + 1.
            # Advisory xact-lock keyed on year serialises concurrent creations.
            from sqlalchemy import text as _sa_text
            year = datetime.utcnow().year
            await db.execute(_sa_text("SELECT pg_advisory_xact_lock(:k)"), {"k": 880000 + year})
            max_tn = await db.scalar(
                select(sa_func.max(Ticket.ticket_number))
                .where(Ticket.ticket_number.like(f"TKT-{year}-%"))
            )
            year_count = (int(max_tn.split("-")[-1]) if max_tn else 0) + 1
            current_time = datetime.utcnow()

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
    elif new_status == "Awaiting Review":
        # Allow moving a record back into the review queue (PA correction).
        if appt.slot_id:
            slot_obj = await db.get(AppointmentSlot, appt.slot_id)
            if slot_obj:
                avail = await db.get(MLADailyAvailability, slot_obj.availability_id)
                slot_dt = datetime.combine(avail.date, slot_obj.start_time) if avail else None
                if slot_dt and slot_dt > datetime.utcnow():
                    await scheduling_service.release_slot(db, appt, commit=False)
        appt.status = "AWAITING_REVIEW"
        appt.status_id = v2.appointment_status_id("AWAITING_REVIEW")
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


async def set_floor_attendance(db: AsyncSession, appointment_id: int, action: str) -> dict:
    """
    Floor-board attendance toggle used by the crowd-management PWA.

    Deliberately side-effect-free vs update_appointment_status: it only flips the
    status field and logs the change. It does NOT release the slot — releasing
    nulls scheduled_date, which would drop the row off today's board, and freeing
    capacity on a same-day passed slot is pointless.

      action="came"     -> AWAITING_REVIEW (visitor showed up, enters PA review)
      action="not_came" -> NOT_CAME        (no-show)
      action="reset"    -> restore the original scheduling status (undo a mistake)

    The first time the board marks a row, the original status is saved in
    pre_floor_status so 'reset' restores SCHEDULED vs RESCHEDULED exactly.
    """
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

    if action == "reset":
        # v2: pre_floor_status column removed — reset always goes to
        # SCHEDULED (if there's still a booked slot) or AWAITING_REVIEW otherwise.
        # This loses the SCHEDULED vs RESCHEDULED distinction on undo but keeps
        # the floor-board workflow functional.
        reset_status = "SCHEDULED" if appt.slot_id else "AWAITING_REVIEW"
        appt.status = reset_status
        appt.status_id = v2.appointment_status_id(reset_status)
    else:
        floor_status = "AWAITING_REVIEW" if action == "came" else "NOT_CAME"
        appt.status = floor_status
        appt.status_id = v2.appointment_status_id(floor_status)

    if old_status != appt.status:
        _log_appt_event(db, appointment_id, "status_changed",
                        payload={"from": old_status, "to": appt.status, "via": "floor_board"})

    await db.commit()
    return {"success": True, "status": _STATUS_DISPLAY.get(appt.status, appt.status)}
