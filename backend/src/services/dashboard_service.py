"""
DB queries for the staff dashboard — stats aggregates and appointment list.
"""
from __future__ import annotations

import base64
from datetime import date, datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

from sqlalchemy import func, select, or_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from src.core.utils import utc_iso
from src.models.appointment_models import Appointment, Citizen, AppointmentAttachment
from src.services.scheduling_service import scheduling_service
from src.models.grievance_summary_record import GrievanceSummaryRecord
from src.models.grievance_summary import CATEGORY_DISPLAY, DEPARTMENT_DISPLAY


def _category_label(value: Optional[str]) -> str:
    """Map a snake_case category to its human-readable form."""
    if not value:
        return "—"
    return CATEGORY_DISPLAY.get(value, value.replace("_", " ").title())


# DB status → display label
_STATUS_DISPLAY = {
    "CANCELLED":       "Closed",
    "RESCHEDULED":     "Rescheduled",
    "WAITING":         "Waiting",
    "IN_PROGRESS":     "Waiting",
    "AWAITING_REVIEW": "Awaiting Review",
    "COMPLETED":       "Reviewed",
}


def _resolve_display_status(appt) -> str:
    """
    Awaiting Review → direct-submit petition pending PA review (AWAITING_REVIEW)
    Reviewed        → PA has reviewed it (COMPLETED, schedule_meeting=False)
    Scheduled       → citizen requested a meeting (schedule_meeting=True + SCHEDULED)
    """
    override = _STATUS_DISPLAY.get(appt.status)
    if override:
        return override
    # SCHEDULED status — meeting requests only
    return "Scheduled" if appt.schedule_meeting else "Reviewed"


def _decode(value: str) -> str:
    """Base64-decode a PII field."""
    try:
        return base64.b64decode(value.encode()).decode("utf-8")
    except Exception:
        return value


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
        Appointment.schedule_meeting == True,
        Appointment.status.notin_(["CANCELLED", "RESCHEDULED"]),
    ])) or 0
    # "Reviewed" = COMPLETED petitions (PA has reviewed them)
    submitted  = await db.scalar(_count([
        Appointment.status == "COMPLETED",
    ])) or 0
    awaiting_review = await db.scalar(_count([
        Appointment.status == "AWAITING_REVIEW",
    ])) or 0
    closed     = await db.scalar(_count([Appointment.status == "CANCELLED"])) or 0
    rescheduled = await db.scalar(_count([Appointment.status == "RESCHEDULED"])) or 0

    resolution_rate = round((submitted / total * 100) if total else 0, 1)

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
        Appointment.schedule_meeting == True,
        Appointment.scheduled_date.isnot(None),
        Appointment.scheduled_date <= now.date(),
        Appointment.status.notin_(["CANCELLED", "RESCHEDULED"]),
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
    avg_response_hours = round(avg_response_seconds / 3600, 1) if avg_response_seconds else 0

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
        "submitted":         submitted,
        "closed":            closed,
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
    urgency: Optional[str] = None,
    department: Optional[str] = None,
    category: Optional[str] = None,
    page: int = 1,
    page_size: int = 25,
) -> Dict[str, Any]:
    """
    Paginated appointment list with citizen name, summary, and attachments.
    Returns dict with `items` list and `total` count.
    """
    from datetime import datetime as dt
    stmt = (
        select(Appointment)
        .options(
            selectinload(Appointment.citizen),
            selectinload(Appointment.attachments),
            selectinload(Appointment.grievance_summary),
        )
        .order_by(Appointment.created_at.desc())
    )

    if date_from:
        stmt = stmt.where(Appointment.created_at >= dt.strptime(date_from, "%Y-%m-%d"))
    if date_to:
        stmt = stmt.where(Appointment.created_at <= dt.strptime(date_to + " 23:59:59", "%Y-%m-%d %H:%M:%S"))

    if status_filter and status_filter != "All":
        if status_filter == "Scheduled":
            stmt = stmt.where(
                Appointment.schedule_meeting == True,
                Appointment.status.notin_(["CANCELLED", "RESCHEDULED"])
            )
        elif status_filter in ("Reviewed", "Submitted"):
            # "Reviewed" is the new name; keep "Submitted" as an alias for
            # backwards-compatibility with any cached frontend state.
            stmt = stmt.where(Appointment.status == "COMPLETED")
        elif status_filter == "Awaiting Review":
            stmt = stmt.where(Appointment.status == "AWAITING_REVIEW")
        elif status_filter == "Rescheduled":
            stmt = stmt.where(Appointment.status == "RESCHEDULED")
        elif status_filter == "Waiting":
            stmt = stmt.where(Appointment.status.in_(["WAITING", "IN_PROGRESS"]))

    # AI-derived filters (urgency / dept / category) live on GrievanceSummaryRecord.
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
        stmt = stmt.where(Appointment.id.in_(gsr_sub))

    # Count before pagination
    count_stmt = select(func.count()).select_from(stmt.subquery())
    total = await db.scalar(count_stmt) or 0

    stmt = stmt.offset((page - 1) * page_size).limit(page_size)
    result = await db.execute(stmt)
    appointments = result.scalars().all()

    items = []
    for appt in appointments:
        citizen = appt.citizen
        name = _decode(citizen.encrypted_name) if citizen else "—"
        mobile = _decode(citizen.encrypted_mobile) if citizen else "—"

        # Search filter (applied post-decode so name/mobile can be matched)
        if search:
            q = search.lower()
            if q not in name.lower() and q not in mobile and q not in str(appt.token_assigned):
                continue

        summary_rec: Optional[GrievanceSummaryRecord] = next(
            (s for s in appt.grievance_summary if s.is_latest), None
        )

        def _attachment_url(a) -> str:
            # storage_url is relative to backend/ e.g. "uploads/attachments/11/file.jpg"
            # normalise separators and strip any leading path components before "uploads/"
            p = a.storage_url.replace("\\", "/")
            idx = p.find("uploads/")
            return "/static/" + p[idx:] if idx != -1 else "/static/" + p

        attachments_data = [
            {
                "url": _attachment_url(a),
                "type": a.attachment_type,
                "mime": a.mime_type,
                "name": Path(a.storage_url).name,
            }
            for a in appt.attachments
        ]

        # Add audio recording URL if available
        audio_url = None
        if appt.audio_recording_url:
            p = appt.audio_recording_url.replace("\\", "/")
            idx = p.find("uploads/")
            audio_url = "/static/" + p[idx:] if idx != -1 else "/static/" + p
        
        items.append({
            "id": appt.id,
            "token": f"TKN{appt.token_assigned:05d}",
            "name": name,
            "mobile": mobile,
            "category": _category_label(appt.grievance_category),
            "department": (summary_rec.department if summary_rec else None),
            "secondary_departments": (summary_rec.secondary_departments if summary_rec else []) or [],
            "status_db": appt.status,
            "status": _resolve_display_status(appt),
            "created_at": utc_iso(appt.created_at),
            "appointment_time": (
                datetime.combine(appt.scheduled_date, appt.scheduled_start_time).isoformat()
                if appt.scheduled_date and appt.scheduled_start_time else None
            ),
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
        })

    return {"items": items, "total": total, "page": page, "page_size": page_size}


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
        appt.grievance_category = category or None

    summary = await db.scalar(
        select(GrievanceSummaryRecord)
        .where(GrievanceSummaryRecord.appointment_id == appointment_id)
        .order_by(GrievanceSummaryRecord.created_at.desc())
        .limit(1)
    )
    if summary:
        if urgency is not None:
            summary.urgency = urgency or None
        if department is not None:
            summary.department = department or None

    await db.commit()
    return {"success": True}


_DISPLAY_TO_DB_STATUS = {
    "Scheduled":       "SCHEDULED",
    "Reviewed":        "COMPLETED",
    "Submitted":       "COMPLETED",   # legacy alias
    "Waiting":         "WAITING",
    "Rescheduled":     "RESCHEDULED",
    "Awaiting Review": "AWAITING_REVIEW",
    "Closed":          "CANCELLED",
}

async def update_appointment_status(db: AsyncSession, appointment_id: int, new_status: str) -> dict:
    """
    Update appointment status and return appointment details for SMS notification.

    Handles slot release/queueing for Waiting/Rescheduled/Closed and attempts to
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

    if new_status in ("Waiting", "Rescheduled"):
        await scheduling_service.release_appointment_slot(db, appt, commit=False)
        await scheduling_service.move_to_waiting_queue(
            db, appt, "MANUAL_RESCHEDULE", commit=False
        )
        appt.schedule_meeting = True
    elif new_status == "Scheduled":
        appt.schedule_meeting = True
        if not appt.appointment_slot_id:
            windows_data = await scheduling_service.get_available_time_windows(db, date.today())
            if windows_data.get("available") and windows_data.get("windows"):
                chosen_window = windows_data["windows"][0]["id"]
                try:
                    await scheduling_service.book_appointment_with_window(
                        db, appt, chosen_window, "", "", commit=False
                    )
                except ValueError:
                    await scheduling_service.move_to_waiting_queue(
                        db, appt, "NO_AVAILABLE_SLOT", commit=False
                    )
            else:
                await scheduling_service.move_to_waiting_queue(
                    db, appt, "NO_AVAILABILITY_TODAY", commit=False
                )
    elif new_status in ("Reviewed", "Submitted"):
        # PA marks petition as reviewed — slot is released if any was held.
        await scheduling_service.release_appointment_slot(db, appt, commit=False)
        appt.status = "COMPLETED"
        appt.schedule_meeting = False
    elif new_status == "Awaiting Review":
        # Allow moving a record back into the review queue (PA correction).
        appt.status = "AWAITING_REVIEW"
        appt.schedule_meeting = False
    else:
        appt.status = _DISPLAY_TO_DB_STATUS.get(new_status, new_status.upper())

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
