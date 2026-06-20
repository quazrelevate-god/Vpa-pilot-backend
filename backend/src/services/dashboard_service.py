"""
DB queries for the staff dashboard — stats aggregates and appointment list.
"""
from __future__ import annotations

import base64
from pathlib import Path
from typing import Any, Dict, List, Optional

from sqlalchemy import func, select, or_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from src.models.appointment_models import Appointment, Citizen, AppointmentAttachment
from src.models.grievance_summary_record import GrievanceSummaryRecord


# DB status → display label (used only for non-appointment-type statuses like Closed/Rescheduled)
_STATUS_DISPLAY = {
    "CANCELLED":   "Closed",
    "RESCHEDULED": "Rescheduled",
    "WAITING":     "Waiting",
    "IN_PROGRESS": "Waiting",
}


def _resolve_display_status(appt) -> str:
    """
    Scheduled  → citizen requested a meeting (schedule_meeting=True)
    Submitted  → citizen submitted a written petition (schedule_meeting=False)
    Other DB statuses (CANCELLED, RESCHEDULED, WAITING) pass through _STATUS_DISPLAY.
    """
    override = _STATUS_DISPLAY.get(appt.status)
    if override:
        return override
    return "Scheduled" if appt.schedule_meeting else "Submitted"


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
    submitted  = await db.scalar(_count([
        Appointment.schedule_meeting == False,
        Appointment.status.notin_(["CANCELLED", "RESCHEDULED"]),
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
    categories = [{"label": r[0].replace("_", " ").title(), "count": r[1]} for r in cat_rows]

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

    sentiment_rows = await db.execute(
        select(GrievanceSummaryRecord.sentiment, func.count(GrievanceSummaryRecord.id))
        .where(*gsr_filter)
        .group_by(GrievanceSummaryRecord.sentiment)
    )
    sentiment = {r[0]: r[1] for r in sentiment_rows}

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

    return {
        "total":           total,
        "scheduled":       scheduled,
        "submitted":       submitted,
        "closed":          closed,
        "rescheduled":     rescheduled,
        "resolution_rate": resolution_rate,
        "ai_coverage":     ai_coverage,
        "categories":      categories,
        "urgency":         urgency,
        "sentiment":       sentiment,
        "trend_labels":    day_labels,
        "trend_counts":    day_counts,
    }


async def get_appointments(
    db: AsyncSession,
    status_filter: Optional[str] = None,
    search: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
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
        elif status_filter == "Submitted":
            stmt = stmt.where(
                Appointment.schedule_meeting == False,
                Appointment.status.notin_(["CANCELLED", "RESCHEDULED"])
            )
        elif status_filter == "Closed":
            stmt = stmt.where(Appointment.status == "CANCELLED")
        elif status_filter == "Rescheduled":
            stmt = stmt.where(Appointment.status == "RESCHEDULED")
        elif status_filter == "Waiting":
            stmt = stmt.where(Appointment.status.in_(["WAITING", "IN_PROGRESS"]))

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
            "category": (appt.grievance_category or "—").replace("_", " ").title(),
            "status_db": appt.status,
            "status": _resolve_display_status(appt),
            "created_at": appt.created_at.strftime("%d %b %Y, %I:%M %p"),
            "appointment_time": appt.created_at.strftime("%d %b %Y, %I:%M %p") if appt.schedule_meeting else None,
            "description": _decode(appt.encrypted_grievance) if appt.encrypted_grievance else None,
            "audio_url": audio_url,
            "headline": summary_rec.headline if summary_rec else None,
            "headline_ta": summary_rec.headline_ta if summary_rec else None,
            "summary": summary_rec.summary if summary_rec else None,
            "citizen_ask": summary_rec.citizen_ask if summary_rec else None,
            "urgency": summary_rec.urgency if summary_rec else None,
            "key_details": summary_rec.key_details if summary_rec else [],
            "attachments": attachments_data,
        })

    return {"items": items, "total": total, "page": page, "page_size": page_size}


_DISPLAY_TO_DB_STATUS = {
    "Scheduled":   "SCHEDULED",
    "Submitted":   "COMPLETED",
    "Waiting":     "WAITING",
    "Rescheduled": "RESCHEDULED",
    "Closed":      "CANCELLED",
}

async def update_appointment_status(db: AsyncSession, appointment_id: int, new_status: str) -> dict:
    """
    Update appointment status and return appointment details for SMS notification.
    
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
    
    db_status = _DISPLAY_TO_DB_STATUS.get(new_status, new_status.upper())
    appt.status = db_status
    # If switching to Scheduled, ensure schedule_meeting flag is set accordingly
    if new_status == "Scheduled":
        appt.schedule_meeting = True
    elif new_status == "Submitted":
        appt.schedule_meeting = False
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
