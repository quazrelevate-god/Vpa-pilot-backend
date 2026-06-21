"""
Ticket case-management service — operated by the PA team only.

Every mutating operation logs a TicketEvent so we have a complete audit trail
for "who did what when". This is critical: a Minister's PA office is a
politically sensitive environment and the timeline of decisions matters.
"""
from __future__ import annotations

import base64
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

from sqlalchemy import and_, func, select, or_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from src.core.utils import utc_iso
from src.models.appointment_models import Appointment, Citizen
from src.models.grievance_summary_record import GrievanceSummaryRecord
from src.models.grievance_summary import CATEGORY_DISPLAY, DEPARTMENT_DISPLAY
from src.models.ticket_models import (
    Ticket,
    TicketEvent,
    TicketEventType,
    TicketStatus,
)


def _decode(value: Optional[str]) -> Optional[str]:
    """Decode base64 PII (mirrors dashboard_service helper)."""
    if not value:
        return None
    try:
        return base64.b64decode(value.encode()).decode("utf-8")
    except Exception:
        return value


def _serialize_ticket_row(t: Ticket) -> Dict[str, Any]:
    """Compact row shape for the /tickets table — no nested events here."""
    appt = t.appointment
    citizen = appt.citizen if appt else None
    summary_rec: Optional[GrievanceSummaryRecord] = next(
        (s for s in (appt.grievance_summary if appt else []) if s.is_latest), None
    )
    name = _decode(citizen.encrypted_name) if citizen else None
    mobile = _decode(citizen.encrypted_mobile) if citizen else None

    return {
        "id":              t.id,
        "ticket_number":   t.ticket_number,
        "token":           f"TKN{appt.token_assigned:05d}" if appt else None,
        "appointment_id":  t.appointment_id,
        "citizen_name":    name,
        "citizen_mobile":  mobile,
        "status":          t.status,
        "priority":        t.priority,
        "assigned_to_pa":  t.assigned_to_pa,
        "due_date":        utc_iso(t.due_date),
        "forwarded_to_dept": t.forwarded_to_dept,
        "forwarded_to_dept_label": (
            DEPARTMENT_DISPLAY.get(t.forwarded_to_dept) if t.forwarded_to_dept else None
        ),
        "reopen_count":    t.reopen_count,
        "created_at":      utc_iso(t.created_at),
        "updated_at":      utc_iso(t.updated_at),
        # AI-derived fields for the list view
        "urgency":         summary_rec.urgency if summary_rec else None,
        "category":        summary_rec.category if summary_rec else None,
        "category_label":  CATEGORY_DISPLAY.get(summary_rec.category) if summary_rec else None,
        "department":      summary_rec.department if summary_rec else None,
        "department_label": (
            DEPARTMENT_DISPLAY.get(summary_rec.department) if summary_rec else None
        ),
        "headline":        summary_rec.headline if summary_rec else None,
    }


def _serialize_event(e: TicketEvent) -> Dict[str, Any]:
    return {
        "id":         e.id,
        "event_type": e.event_type,
        "actor":      e.actor,
        "note":       e.note,
        "payload":    e.payload,
        "created_at": utc_iso(e.created_at),
    }


def _serialize_ticket_detail(t: Ticket) -> Dict[str, Any]:
    """Full detail shape for the modal — includes events + summary + attachments."""
    row = _serialize_ticket_row(t)
    appt = t.appointment
    summary_rec: Optional[GrievanceSummaryRecord] = next(
        (s for s in (appt.grievance_summary if appt else []) if s.is_latest), None
    )

    attachments = []
    if appt:
        for a in appt.attachments:
            p = (a.storage_url or "").replace("\\", "/")
            idx = p.find("uploads/")
            url = "/static/" + p[idx:] if idx != -1 else "/static/" + p
            attachments.append({
                "url":  url,
                "type": a.attachment_type,
                "mime": a.mime_type,
                "name": Path(a.storage_url).name if a.storage_url else "",
            })

    row.update({
        "description": _decode(appt.encrypted_grievance) if (appt and appt.encrypted_grievance) else None,
        "summary":            summary_rec.summary if summary_rec else None,
        "summary_ta":         summary_rec.summary_ta if summary_rec else None,
        "headline_ta":        summary_rec.headline_ta if summary_rec else None,
        "citizen_ask":        summary_rec.citizen_ask if summary_rec else None,
        "citizen_ask_ta":     summary_rec.citizen_ask_ta if summary_rec else None,
        "key_details":        summary_rec.key_details if summary_rec else [],
        "key_details_ta":     summary_rec.key_details_ta if summary_rec else [],
        "audio_transcript":   summary_rec.audio_transcript if summary_rec else None,
        "secondary_departments": (summary_rec.secondary_departments if summary_rec else []) or [],
        "resolution_notes":   t.resolution_notes,
        "closure_reason":     t.closure_reason,
        "resolved_at":        utc_iso(t.resolved_at),
        "closed_at":          utc_iso(t.closed_at),
        "reopened_at":        utc_iso(t.reopened_at),
        "forwarded_at":       utc_iso(t.forwarded_at),
        "forwarded_by":       t.forwarded_by,
        "forwarded_notes":    t.forwarded_notes,
        "attachments":        attachments,
        "events":             [_serialize_event(e) for e in t.events],
    })
    return row


# ── Queries ───────────────────────────────────────────────────────────────────

async def list_tickets(
    db: AsyncSession,
    status: Optional[str] = None,
    priority: Optional[str] = None,
    urgency: Optional[str] = None,
    department: Optional[str] = None,
    category: Optional[str] = None,
    assigned_to: Optional[str] = None,
    forwarded_to_dept: Optional[str] = None,
    search: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    page: int = 1,
    page_size: int = 25,
) -> Dict[str, Any]:
    """Filtered, paginated ticket list for the PA portal."""
    stmt = (
        select(Ticket)
        .options(
            selectinload(Ticket.appointment).selectinload(Appointment.citizen),
            selectinload(Ticket.appointment).selectinload(Appointment.attachments),
            selectinload(Ticket.appointment).selectinload(Appointment.grievance_summary),
        )
        .order_by(Ticket.created_at.desc())
    )

    clauses = []
    if status:
        clauses.append(Ticket.status == status)
    if priority:
        clauses.append(Ticket.priority == priority)
    if assigned_to:
        clauses.append(Ticket.assigned_to_pa == assigned_to)
    if forwarded_to_dept:
        clauses.append(Ticket.forwarded_to_dept == forwarded_to_dept)
    if date_from:
        clauses.append(Ticket.created_at >= datetime.strptime(date_from, "%Y-%m-%d"))
    if date_to:
        clauses.append(
            Ticket.created_at <= datetime.strptime(date_to + " 23:59:59", "%Y-%m-%d %H:%M:%S")
        )

    # AI-derived filters live on GrievanceSummaryRecord — join when needed
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
        clauses.append(Ticket.appointment_id.in_(gsr_sub))

    if clauses:
        stmt = stmt.where(and_(*clauses))

    count_stmt = select(func.count()).select_from(stmt.subquery())
    total = await db.scalar(count_stmt) or 0

    stmt = stmt.offset((page - 1) * page_size).limit(page_size)
    result = await db.execute(stmt)
    tickets = result.scalars().all()

    # Post-decode search (name/mobile/token/ticket# all base64-or-plain)
    items: List[Dict[str, Any]] = []
    q = search.lower() if search else None
    for t in tickets:
        row = _serialize_ticket_row(t)
        if q:
            haystack = " ".join(filter(None, [
                row.get("ticket_number"), row.get("token"),
                row.get("citizen_name"), row.get("citizen_mobile"),
                row.get("headline"), row.get("category_label"),
                row.get("department_label"),
            ])).lower()
            if q not in haystack:
                continue
        items.append(row)

    return {"items": items, "total": total, "page": page, "page_size": page_size}


async def get_ticket(db: AsyncSession, ticket_id: int) -> Optional[Dict[str, Any]]:
    """Full ticket detail + events timeline + summary + attachments."""
    result = await db.execute(
        select(Ticket)
        .options(
            selectinload(Ticket.appointment).selectinload(Appointment.citizen),
            selectinload(Ticket.appointment).selectinload(Appointment.attachments),
            selectinload(Ticket.appointment).selectinload(Appointment.grievance_summary),
            selectinload(Ticket.events),
        )
        .where(Ticket.id == ticket_id)
    )
    t = result.scalar_one_or_none()
    if t is None:
        return None
    return _serialize_ticket_detail(t)


# ── Mutations (always log an event) ───────────────────────────────────────────

async def _load(db: AsyncSession, ticket_id: int) -> Optional[Ticket]:
    res = await db.execute(
        select(Ticket).options(selectinload(Ticket.events)).where(Ticket.id == ticket_id)
    )
    return res.scalar_one_or_none()


def _log(db: AsyncSession, ticket_id: int, event_type: str, actor: str,
         note: Optional[str] = None, payload: Optional[dict] = None) -> None:
    db.add(TicketEvent(
        ticket_id=ticket_id,
        event_type=event_type,
        actor=actor,
        note=note,
        payload=payload,
    ))


async def update_ticket_fields(
    db: AsyncSession,
    ticket_id: int,
    actor: str,
    *,
    status: Optional[str] = None,
    priority: Optional[str] = None,
    assigned_to_pa: Optional[str] = None,
    due_date: Optional[str] = None,   # ISO date or datetime string
) -> Optional[Dict[str, Any]]:
    """Generic patch — applies whichever fields are provided, logs one event per change."""
    t = await _load(db, ticket_id)
    if t is None:
        return None

    if status is not None and status != t.status:
        try:
            TicketStatus(status)  # validate enum membership
        except ValueError:
            raise ValueError(f"Invalid ticket status: {status!r}")
        _log(db, t.id, TicketEventType.STATUS_CHANGED.value, actor,
             payload={"from": t.status, "to": status})
        t.status = status

    if priority is not None and priority != t.priority:
        _log(db, t.id, TicketEventType.PRIORITY_CHANGED.value, actor,
             payload={"from": t.priority, "to": priority})
        t.priority = priority

    if assigned_to_pa is not None and assigned_to_pa != t.assigned_to_pa:
        if assigned_to_pa == "":
            _log(db, t.id, TicketEventType.UNASSIGNED.value, actor,
                 payload={"from": t.assigned_to_pa})
            t.assigned_to_pa = None
        else:
            _log(db, t.id, TicketEventType.ASSIGNED.value, actor,
                 payload={"from": t.assigned_to_pa, "to": assigned_to_pa})
            t.assigned_to_pa = assigned_to_pa

    if due_date is not None:
        dd = datetime.fromisoformat(due_date) if due_date else None
        if dd != t.due_date:
            _log(db, t.id, TicketEventType.DUE_DATE_SET.value, actor,
                 payload={"due_date": dd.isoformat() if dd else None})
            t.due_date = dd

    await db.commit()
    return await get_ticket(db, ticket_id)


async def forward_to_dept(
    db: AsyncSession,
    ticket_id: int,
    actor: str,
    *,
    department: str,
    notes: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    t = await _load(db, ticket_id)
    if t is None:
        return None
    now = datetime.utcnow()
    t.status = TicketStatus.FORWARDED_TO_DEPT.value
    t.forwarded_to_dept = department
    t.forwarded_at = now
    t.forwarded_by = actor
    t.forwarded_notes = notes
    _log(db, t.id, TicketEventType.FORWARDED_TO_DEPT.value, actor,
         note=notes,
         payload={"department": department})
    await db.commit()
    return await get_ticket(db, ticket_id)


async def add_comment(
    db: AsyncSession,
    ticket_id: int,
    actor: str,
    *,
    text: str,
) -> Optional[Dict[str, Any]]:
    if not text or not text.strip():
        raise ValueError("Comment text is required.")
    t = await _load(db, ticket_id)
    if t is None:
        return None
    _log(db, t.id, TicketEventType.COMMENT_ADDED.value, actor, note=text.strip())
    await db.commit()
    return await get_ticket(db, ticket_id)


async def mark_resolved(
    db: AsyncSession,
    ticket_id: int,
    actor: str,
    *,
    resolution_notes: str,
) -> Optional[Dict[str, Any]]:
    if not resolution_notes or not resolution_notes.strip():
        raise ValueError("Resolution notes are required.")
    t = await _load(db, ticket_id)
    if t is None:
        return None
    now = datetime.utcnow()
    t.status = TicketStatus.RESOLVED.value
    t.resolution_notes = resolution_notes.strip()
    t.resolved_at = now
    _log(db, t.id, TicketEventType.RESOLVED.value, actor, note=resolution_notes.strip())
    await db.commit()
    return await get_ticket(db, ticket_id)


async def mark_closed(
    db: AsyncSession,
    ticket_id: int,
    actor: str,
    *,
    closure_reason: str,
    notes: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    t = await _load(db, ticket_id)
    if t is None:
        return None
    now = datetime.utcnow()
    t.status = TicketStatus.CLOSED.value
    t.closure_reason = closure_reason
    t.closed_at = now
    if notes:
        t.resolution_notes = ((t.resolution_notes or "") + "\n" + notes).strip()
    _log(db, t.id, TicketEventType.CLOSED.value, actor,
         note=notes, payload={"closure_reason": closure_reason})
    await db.commit()
    return await get_ticket(db, ticket_id)


async def reopen(
    db: AsyncSession,
    ticket_id: int,
    actor: str,
    *,
    reason: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    t = await _load(db, ticket_id)
    if t is None:
        return None
    now = datetime.utcnow()
    t.status = TicketStatus.REOPENED.value
    t.reopened_at = now
    t.reopen_count = (t.reopen_count or 0) + 1
    t.closed_at = None
    t.closure_reason = None
    _log(db, t.id, TicketEventType.REOPENED.value, actor,
         note=reason, payload={"reopen_count": t.reopen_count})
    await db.commit()
    return await get_ticket(db, ticket_id)


# ── Dashboard helpers (counts for nav badge) ──────────────────────────────────

async def get_open_count(db: AsyncSession) -> int:
    """
    Count tickets that need PA attention — feeds the sidebar badge.

    Whitelist (not a blacklist) so the count stays meaningful even as new
    statuses are added later. Explicitly excludes triaged / resolved /
    closed / reopened — reopened tickets re-enter `open` on the next
    status transition anyway.
    """
    actionable = [
        TicketStatus.OPEN.value,
        TicketStatus.ASSIGNED.value,
        TicketStatus.IN_PROGRESS.value,
        TicketStatus.FORWARDED_TO_DEPT.value,
        TicketStatus.PENDING_CITIZEN.value,
    ]
    return await db.scalar(
        select(func.count(Ticket.id)).where(Ticket.status.in_(actionable))
    ) or 0
