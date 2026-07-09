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
from src.models.grievance_summary import (
    CATEGORY_DISPLAY, DISTRICT_DISPLAY, District, MINISTRY_DISPLAY,
)
from src.models.school_department import department_label as school_department_label
from src.models.ticket_models import (
    Ticket,
    TicketStatus,
)
from src.models.activity_models import Activity
from src.services.v2_helpers import v2


# v2: TicketEventType enum removed — action_type strings are now free-form
# on Activity. Keep the constants here so callers keep working.
class _EventType:
    STATUS_CHANGED    = "status_changed"
    PRIORITY_CHANGED  = "priority_changed"
    DISTRICT_CHANGED  = "district_changed"
    ASSIGNED          = "assigned"
    UNASSIGNED        = "unassigned"
    DUE_DATE_SET      = "due_date_set"
    COMMENT_ADDED     = "comment_added"
    FORWARDED_TO_DEPT = "forwarded_to_dept"
    RESOLVED          = "resolved"
    CLOSED            = "closed"
    REOPENED          = "reopened"


def _decode(value: Optional[str]) -> Optional[str]:
    """Decrypt a PII field (Fernet, with legacy-base64 fallback). See src.core.crypto."""
    if not value:
        return None
    from src.core import crypto
    return crypto.decrypt(value)


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
        "token":           f"TKN{appt.token_assigned}" if appt else None,
        "appointment_id":  t.appointment_id,
        "citizen_name":    name,
        "citizen_mobile":  mobile,
        "status":          t.status,
        # Priority is driven by the AI review (no manual P0-P3 override).
        "priority":        summary_rec.priority if summary_rec else None,
        "assigned_to_pa":  t.assigned_to_pa,
        "due_date":        utc_iso(t.due_date),
        "forwarded_to_dept": t.forwarded_to_dept,
        "forwarded_to_dept_label": (
            MINISTRY_DISPLAY.get(t.forwarded_to_dept) if t.forwarded_to_dept else None
        ),
        "reopen_count":    t.reopen_count,
        "created_at":      utc_iso(t.created_at),
        "updated_at":      utc_iso(t.updated_at),
        # AI-derived fields for the list view
        "category":        summary_rec.category if summary_rec else None,
        "category_label":  CATEGORY_DISPLAY.get(summary_rec.category) if summary_rec else None,
        "ministry":        summary_rec.ministry if summary_rec else None,
        "ministry_label": (
            MINISTRY_DISPLAY.get(summary_rec.ministry) if summary_rec else None
        ),
        "district":        (summary_rec.district if summary_rec else None),
        "district_label":  (
            DISTRICT_DISPLAY.get(summary_rec.district)
            if (summary_rec and summary_rec.district) else None
        ),
        "citizen_ask":     summary_rec.citizen_ask if summary_rec else None,
    }


def _serialize_event(e: Activity) -> Dict[str, Any]:
    """v2: Activity row replaces TicketEvent. Shape kept for the timeline UI."""
    return {
        "id":         e.id,
        "event_type": e.action_type,
        "actor":      e.user,
        "note":       e.message,
        "payload":    e.payload,
        "created_at": utc_iso(e.created_at),
    }


def _serialize_ticket_detail(t: Ticket, events: Optional[List[Activity]] = None) -> Dict[str, Any]:
    """Full detail shape for the modal — includes events + summary + attachments.

    `events` is the list of Activity rows for this ticket, fetched by the
    caller (v2: no Ticket.events relationship). Falls back to empty.
    """
    db_events = events or []
    row = _serialize_ticket_row(t)
    appt = t.appointment
    summary_rec: Optional[GrievanceSummaryRecord] = next(
        (s for s in (appt.grievance_summary if appt else []) if s.is_latest), None
    )

    from src.services.storage_service import get_file_url

    attachments = []
    audio_url = None
    if appt:
        for a in appt.attachments:
            attachments.append({
                "url":  get_file_url(a.storage_url),
                "type": a.attachment_type,
                "mime": a.mime_type,
                "name": Path(a.storage_url).name if a.storage_url else "",
            })
        # v2: audio lives in attachments (type='AUDIO')
        audio_url = next(
            (get_file_url(a.storage_url) for a in appt.attachments
             if a.attachment_type == "AUDIO"),
            None,
        )

    # Resolution proofs uploaded by the department when they close out the ticket
    # (separate from the citizen's own petition uploads above).
    resolution_attachments = [
        {
            "url":  get_file_url(a.storage_url),
            "mime": a.mime_type,
            "name": a.original_filename or (Path(a.storage_url).name if a.storage_url else ""),
            "kind": a.kind,
            "by":   a.uploaded_by,
            "at":   utc_iso(a.created_at),
        }
        for a in t.attachments
    ]

    # Timeline: real DB events + two synthetic anchors so every ticket shows the
    # full lifecycle — when the citizen submitted, and when the ticket was opened.
    # v2: events come from the `activity` table, loaded by the caller.
    events = [_serialize_event(e) for e in db_events]
    if appt and appt.created_at:
        events.append({
            "id":         f"submitted-{t.id}",
            "event_type": "petition_submitted",
            "actor":      row.get("citizen_name") or "Citizen",
            "note":       None,
            "payload":    {"token": row.get("token")},
            "created_at": utc_iso(appt.created_at),
        })
    if not any(e["event_type"] == "created" for e in events):
        events.append({
            "id":         f"created-{t.id}",
            "event_type": "created",
            "actor":      "pa_admin",
            "note":       None,
            "payload":    None,
            "created_at": utc_iso(t.created_at),
        })
    events.sort(key=lambda e: e["created_at"] or "", reverse=True)

    row.update({
        "description": _decode(appt.encrypted_grievance) if (appt and appt.encrypted_grievance) else None,
        "summary":            summary_rec.summary if summary_rec else None,
        "summary_ta":         summary_rec.summary_ta if summary_rec else None,
        "citizen_ask_ta":     summary_rec.citizen_ask_ta if summary_rec else None,
        "key_details":        summary_rec.key_details if summary_rec else [],
        "key_details_ta":     summary_rec.key_details_ta if summary_rec else [],
        "ai_name_en":         summary_rec.name_en if summary_rec else None,
        "ai_name_ta":         summary_rec.name_ta if summary_rec else None,
        "audio_transcript":   summary_rec.audio_transcript if summary_rec else None,
        # Routed school department (Ticket.department) — distinct from the AI
        # ministry above. Drives the drawer's "Assign" control. Once a department
        # accepts (accepted_at set), re-assignment is locked.
        "assigned_department":       t.department,
        "assigned_department_label": school_department_label(t.department) if t.department else None,
        "accepted_at":        utc_iso(t.accepted_at),
        "accepted_by":        t.accepted_by,
        "resolution_notes":   t.resolution_notes,
        "closure_reason":     t.closure_reason,
        "resolved_at":        utc_iso(t.resolved_at),
        "closed_at":          utc_iso(t.closed_at),
        "reopened_at":        utc_iso(t.reopened_at),
        "forwarded_at":       utc_iso(t.forwarded_at),
        "forwarded_by":       t.forwarded_by,
        "forwarded_notes":    t.forwarded_notes,
        "attachments":        attachments,
        "resolution_attachments": resolution_attachments,
        "audio_url":          audio_url,
        "events":             events,
    })
    return row


# ── Queries ───────────────────────────────────────────────────────────────────

async def list_tickets(
    db: AsyncSession,
    status: Optional[str] = None,
    priority: Optional[str] = None,   # AI-review priority (low|medium|high|critical)
    ministry: Optional[str] = None,
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
                row.get("citizen_ask"), row.get("category_label"),
                row.get("ministry_label"),
            ])).lower()
            if q not in haystack:
                continue
        items.append(row)

    return {"items": items, "total": total, "page": page, "page_size": page_size}


async def get_ticket_counts(
    db: AsyncSession,
    priority: Optional[str] = None,   # AI-review priority (low|medium|high|critical)
    ministry: Optional[str] = None,
    category: Optional[str] = None,
    assigned_to: Optional[str] = None,
    forwarded_to_dept: Optional[str] = None,
    search: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
) -> Dict[str, int]:
    """Per-segment ticket counts honouring the same secondary filters as
    `list_tickets`. Replaces the old 6× parallel call pattern."""
    base = select(Ticket.id, Ticket.status)

    clauses = []
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
        clauses.append(Ticket.appointment_id.in_(gsr_sub))

    if clauses:
        base = base.where(and_(*clauses))

    # ── Search: decrypt-and-bucket (mirrors list semantics) ──
    if search and search.strip():
        q = search.strip().lower()
        stmt = (
            select(Ticket)
            .options(
                selectinload(Ticket.appointment).selectinload(Appointment.citizen),
                selectinload(Ticket.appointment).selectinload(Appointment.grievance_summary),
            )
        )
        if clauses:
            stmt = stmt.where(and_(*clauses))
        tickets = (await db.execute(stmt)).scalars().all()
        out: Dict[str, int] = {
            "": 0, "open": 0, "in_progress": 0,
            "forwarded_to_dept": 0, "resolved": 0, "closed": 0,
        }
        for t in tickets:
            row = _serialize_ticket_row(t)
            haystack = " ".join(filter(None, [
                row.get("ticket_number"), row.get("token"),
                row.get("citizen_name"), row.get("citizen_mobile"),
                row.get("citizen_ask"), row.get("category_label"),
                row.get("ministry_label"),
            ])).lower()
            if q not in haystack:
                continue
            out[""] += 1
            if t.status in out:
                out[t.status] += 1
        return out

    sub = base.subquery()
    agg = select(
        func.count().label("all_count"),
        func.count().filter(sub.c.status == "open").label("open"),
        func.count().filter(sub.c.status == "in_progress").label("in_progress"),
        func.count().filter(sub.c.status == "forwarded_to_dept").label("forwarded_to_dept"),
        func.count().filter(sub.c.status == "resolved").label("resolved"),
        func.count().filter(sub.c.status == "closed").label("closed"),
    ).select_from(sub)
    row = (await db.execute(agg)).one()
    return {
        "": row.all_count or 0,
        "open": row.open or 0,
        "in_progress": row.in_progress or 0,
        "forwarded_to_dept": row.forwarded_to_dept or 0,
        "resolved": row.resolved or 0,
        "closed": row.closed or 0,
    }


async def get_ticket(db: AsyncSession, ticket_id: int) -> Optional[Dict[str, Any]]:
    """Full ticket detail + events timeline + summary + attachments."""
    result = await db.execute(
        select(Ticket)
        .options(
            selectinload(Ticket.appointment).selectinload(Appointment.citizen),
            selectinload(Ticket.appointment).selectinload(Appointment.attachments),
            selectinload(Ticket.appointment).selectinload(Appointment.grievance_summary),
            selectinload(Ticket.attachments),
        )
        .where(Ticket.id == ticket_id)
    )
    t = result.scalar_one_or_none()
    if t is None:
        return None
    # v2: events come from the unified activity table
    events_res = await db.execute(
        select(Activity)
        .where(Activity.ticket_id == ticket_id)
        .order_by(Activity.created_at.desc())
    )
    events = list(events_res.scalars().all())
    return _serialize_ticket_detail(t, events=events)


# ── Mutations (always log an event) ───────────────────────────────────────────

async def _load(db: AsyncSession, ticket_id: int) -> Optional[Ticket]:
    res = await db.execute(
        select(Ticket).where(Ticket.id == ticket_id)
    )
    return res.scalar_one_or_none()


def _log(db: AsyncSession, ticket_id: int, event_type: str, actor: str,
         note: Optional[str] = None, payload: Optional[dict] = None) -> None:
    """v2: Activity row keeps structured payload for the PA portal timeline."""
    db.add(Activity(
        ticket_id=ticket_id,
        user=actor,
        action_type=event_type,
        message=note,
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
    district: Optional[str] = None,   # "" clears; a value must be a District enum member
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
        _log(db, t.id, _EventType.STATUS_CHANGED, actor,
             payload={"from": t.status, "to": status})
        t.status = status
        t.status_id = v2.ticket_status_id(status)

    if priority is not None and priority != t.priority:
        _log(db, t.id, _EventType.PRIORITY_CHANGED, actor,
             payload={"from": t.priority, "to": priority})
        t.priority = priority
        t.priority_id = v2.priority_id_or_none(priority)

    if assigned_to_pa is not None and assigned_to_pa != t.assigned_to_pa:
        if assigned_to_pa == "":
            _log(db, t.id, _EventType.UNASSIGNED, actor,
                 payload={"from": t.assigned_to_pa})
            t.assigned_to_pa = None
        else:
            _log(db, t.id, _EventType.ASSIGNED, actor,
                 payload={"from": t.assigned_to_pa, "to": assigned_to_pa})
            t.assigned_to_pa = assigned_to_pa

    if due_date is not None:
        dd = datetime.fromisoformat(due_date) if due_date else None
        if dd != t.due_date:
            _log(db, t.id, _EventType.DUE_DATE_SET, actor,
                 payload={"due_date": dd.isoformat() if dd else None})
            t.due_date = dd

    if district is not None:
        # Empty string clears the district back to NULL; anything else must
        # be a valid District enum member. We never store the sentinel
        # "unknown" — it maps to NULL like the empty case.
        new_district = None if district in ("", "unknown") else district
        if new_district is not None:
            try:
                District(new_district)  # validate enum membership
            except ValueError:
                raise ValueError(f"Invalid district: {district!r}")
        appt = t.appointment
        summary_rec = next(
            (s for s in (appt.grievance_summary if appt else []) if s.is_latest),
            None,
        )
        if summary_rec and summary_rec.district != new_district:
            _log(db, t.id, _EventType.DISTRICT_CHANGED, actor,
                 payload={"from": summary_rec.district, "to": new_district})
            summary_rec.district = new_district

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
    t.status_id = v2.ticket_status_id(TicketStatus.FORWARDED_TO_DEPT.value)
    t.forwarded_to_dept = department
    t.forwarded_at = now
    t.forwarded_by = actor
    t.forwarded_notes = notes
    _log(db, t.id, _EventType.FORWARDED_TO_DEPT, actor,
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
    _log(db, t.id, _EventType.COMMENT_ADDED, actor, note=text.strip())
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
    t.status_id = v2.ticket_status_id(TicketStatus.RESOLVED.value)
    t.resolution_notes = resolution_notes.strip()
    t.resolved_at = now
    _log(db, t.id, _EventType.RESOLVED, actor, note=resolution_notes.strip())
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
    t.status_id = v2.ticket_status_id(TicketStatus.CLOSED.value)
    t.closure_reason = closure_reason
    t.closed_at = now
    if notes:
        t.resolution_notes = ((t.resolution_notes or "") + "\n" + notes).strip()
    _log(db, t.id, _EventType.CLOSED, actor,
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
    t.status_id = v2.ticket_status_id(TicketStatus.REOPENED.value)
    t.reopened_at = now
    t.reopen_count = (t.reopen_count or 0) + 1
    t.closed_at = None
    t.closure_reason = None
    _log(db, t.id, _EventType.REOPENED, actor,
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
