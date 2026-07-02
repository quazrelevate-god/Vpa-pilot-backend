"""
Department ticketing workflow — the state machine + activity log.

PA (monitoring) actions:  route_to_department, forward_external, close, reopen
Department actions:       accept, forward, progress, resolve

Every action appends a TicketEvent (actor + timestamp + remarks) so the PA
portal can render a complete "who did what when" timeline. Department actions
verify the acting department owns the ticket.
"""
from datetime import datetime
from typing import Any, Dict, List, Optional

from fastapi import HTTPException
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from src.core import crypto
from src.models.appointment_models import Appointment, Citizen
from src.models.ticket_models import (
    Ticket, TicketEvent, TicketAttachment, TicketStatus, TicketEventType,
)
from src.models.grievance_summary_record import GrievanceSummaryRecord
from src.models.school_department import SchoolDepartment, department_label
from src.core.utils import utc_iso


# ── Internal helpers ──────────────────────────────────────────────────────────

async def _get(db: AsyncSession, ticket_id: int) -> Ticket:
    t = await db.get(Ticket, ticket_id)
    if t is None:
        raise HTTPException(status_code=404, detail="Ticket not found.")
    return t


def _event(db: AsyncSession, ticket_id: int, event_type: str, actor: str,
           note: Optional[str] = None, payload: Optional[dict] = None) -> None:
    db.add(TicketEvent(
        ticket_id=ticket_id, event_type=event_type, actor=actor,
        note=note, payload=payload,
    ))


def _valid_department(value: str) -> str:
    try:
        return SchoolDepartment(value).value
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Unknown department '{value}'.")


# ── PA (monitoring) actions ───────────────────────────────────────────────────

async def route_to_department(db: AsyncSession, ticket_id: int, department: str,
                              actor: str, note: Optional[str] = None) -> dict:
    """PA assigns the ticket to a school department (assign = select dept)."""
    dept = _valid_department(department)
    t = await _get(db, ticket_id)
    prev = t.department
    t.department = dept
    t.status = TicketStatus.AWAITING_DEPARTMENT.value
    t.accepted_at = None
    t.accepted_by = None
    _event(db, ticket_id, TicketEventType.ROUTED_TO_DEPARTMENT.value, actor,
           note=note, payload={"from": prev, "to": dept})
    await db.commit()
    return {"status": t.status, "department": dept}


async def forward_external(db: AsyncSession, ticket_id: int, ministry: str,
                          reason: str, actor: str) -> dict:
    """Non-school ticket — forwarded out to another ministry. Terminal state."""
    if not (reason or "").strip():
        raise HTTPException(status_code=400, detail="A reason is required to forward.")
    t = await _get(db, ticket_id)
    t.status = TicketStatus.FORWARDED_TO_DEPT.value
    t.forwarded_to_dept = ministry
    t.forwarded_at = datetime.utcnow()
    t.forwarded_by = actor
    t.forwarded_notes = reason
    _event(db, ticket_id, TicketEventType.FORWARDED_TO_DEPT.value, actor,
           note=reason, payload={"ministry": ministry})
    await db.commit()
    return {"status": t.status}


async def close_ticket(db: AsyncSession, ticket_id: int, actor: str,
                      closure_reason: Optional[str] = None, note: Optional[str] = None) -> dict:
    """PA closes a resolved ticket."""
    t = await _get(db, ticket_id)
    if t.status not in (TicketStatus.RESOLVED.value, TicketStatus.FORWARDED_TO_DEPT.value):
        raise HTTPException(status_code=409, detail="Only resolved/forwarded tickets can be closed.")
    t.status = TicketStatus.CLOSED.value
    t.closed_at = datetime.utcnow()
    t.closure_reason = closure_reason
    _event(db, ticket_id, TicketEventType.CLOSED.value, actor,
           note=note, payload={"closure_reason": closure_reason})
    await db.commit()
    return {"status": t.status}


async def reopen_ticket(db: AsyncSession, ticket_id: int, actor: str,
                       note: Optional[str] = None) -> dict:
    """PA reopens a closed/resolved ticket — back to the owning department."""
    t = await _get(db, ticket_id)
    t.status = (TicketStatus.IN_PROGRESS.value if t.department
                else TicketStatus.OPEN.value)
    t.reopened_at = datetime.utcnow()
    t.reopen_count = (t.reopen_count or 0) + 1
    t.closed_at = None
    _event(db, ticket_id, TicketEventType.REOPENED.value, actor, note=note)
    await db.commit()
    return {"status": t.status}


# ── Department actions (scoped to the acting department) ──────────────────────

async def _get_owned(db: AsyncSession, ticket_id: int, department: str) -> Ticket:
    t = await _get(db, ticket_id)
    if t.department != department:
        raise HTTPException(status_code=403, detail="This ticket is not assigned to your department.")
    return t


async def dept_accept(db: AsyncSession, ticket_id: int, department: str) -> dict:
    t = await _get_owned(db, ticket_id, department)
    if t.status != TicketStatus.AWAITING_DEPARTMENT.value:
        raise HTTPException(status_code=409, detail="Only tickets awaiting acceptance can be accepted.")
    t.status = TicketStatus.IN_PROGRESS.value
    t.accepted_at = datetime.utcnow()
    t.accepted_by = department
    _event(db, ticket_id, TicketEventType.DEPARTMENT_ACCEPTED.value, department)
    await db.commit()
    return {"status": t.status}


async def dept_forward(db: AsyncSession, ticket_id: int, department: str,
                      to_department: str, reason: str) -> dict:
    """Department forwards to another department — must re-accept there."""
    if not (reason or "").strip():
        raise HTTPException(status_code=400, detail="A reason is required to forward.")
    to_dept = _valid_department(to_department)
    if to_dept == department:
        raise HTTPException(status_code=400, detail="Cannot forward to the same department.")
    t = await _get_owned(db, ticket_id, department)
    t.department = to_dept
    t.status = TicketStatus.AWAITING_DEPARTMENT.value
    t.accepted_at = None
    t.accepted_by = None
    _event(db, ticket_id, TicketEventType.DEPARTMENT_FORWARDED.value, department,
           note=reason, payload={"from": department, "to": to_dept})
    await db.commit()
    return {"status": t.status, "department": to_dept}


async def dept_progress(db: AsyncSession, ticket_id: int, department: str,
                       note: str, progress_pct: Optional[int] = None) -> dict:
    t = await _get_owned(db, ticket_id, department)
    if t.status != TicketStatus.IN_PROGRESS.value:
        raise HTTPException(status_code=409, detail="Accept the ticket before posting progress.")
    if progress_pct is not None:
        t.progress_pct = max(0, min(99, int(progress_pct)))
    _event(db, ticket_id, TicketEventType.PROGRESS_UPDATE.value, department,
           note=note, payload={"progress_pct": t.progress_pct})
    await db.commit()
    return {"progress_pct": t.progress_pct}


async def dept_resolve(db: AsyncSession, ticket_id: int, department: str,
                      remarks: str, attachments: List[Dict[str, Any]]) -> dict:
    """Resolve — mandatory remarks + at least one proof attachment."""
    if not (remarks or "").strip():
        raise HTTPException(status_code=400, detail="Resolution remarks are required.")
    if not attachments:
        raise HTTPException(status_code=400, detail="At least one proof attachment is required to resolve.")
    t = await _get_owned(db, ticket_id, department)
    if t.status != TicketStatus.IN_PROGRESS.value:
        raise HTTPException(status_code=409, detail="Accept the ticket before resolving.")
    for a in attachments:
        db.add(TicketAttachment(
            ticket_id=ticket_id, kind="resolution",
            storage_url=a["storage_url"], mime_type=a["mime_type"],
            file_size_bytes=a.get("file_size_bytes", 0),
            original_filename=a.get("original_filename"), uploaded_by=department,
        ))
    t.status = TicketStatus.RESOLVED.value
    t.resolved_at = datetime.utcnow()
    t.resolution_notes = remarks
    t.progress_pct = 100
    _event(db, ticket_id, TicketEventType.RESOLVED.value, department,
           note=remarks, payload={"attachments": len(attachments)})
    await db.commit()
    return {"status": t.status}


# ── Read: department-scoped list + detail ─────────────────────────────────────

def _decode(v):
    return crypto.decrypt(v) if v is not None else v


def _ticket_row(t: Ticket, appt: Optional[Appointment], citizen: Optional[Citizen],
                summary: Optional[GrievanceSummaryRecord]) -> dict:
    name = _decode(appt.encrypted_name) if (appt and appt.encrypted_name) else \
        (_decode(citizen.encrypted_name) if citizen else "—")
    mobile = _decode(citizen.encrypted_mobile) if citizen else "—"
    return {
        "id": t.id,
        "ticket_number": t.ticket_number,
        "status": t.status,
        "department": t.department,
        "department_label": department_label(t.department) if t.department else None,
        "progress_pct": t.progress_pct,
        "citizen_name": name,
        "citizen_mobile": mobile,
        "token": f"TKN{appt.token_assigned}" if appt else None,
        "headline": summary.headline if summary else None,
        "priority": summary.priority if summary else None,
        "created_at": utc_iso(t.created_at),
        "accepted_at": utc_iso(t.accepted_at) if t.accepted_at else None,
        "resolved_at": utc_iso(t.resolved_at) if t.resolved_at else None,
    }


async def list_for_department(db: AsyncSession, department: str,
                              status_filter: Optional[str] = None) -> List[dict]:
    stmt = (
        select(Ticket)
        .where(Ticket.department == department)
        .order_by(Ticket.created_at.desc())
    )
    if status_filter:
        stmt = stmt.where(Ticket.status == status_filter)
    tickets = (await db.execute(stmt)).scalars().all()
    if not tickets:
        return []
    appt_ids = [t.appointment_id for t in tickets]
    appts = {a.id: a for a in (await db.execute(
        select(Appointment).options(selectinload(Appointment.citizen)).where(Appointment.id.in_(appt_ids))
    )).scalars().all()}
    summaries = {s.appointment_id: s for s in (await db.execute(
        select(GrievanceSummaryRecord).where(
            GrievanceSummaryRecord.appointment_id.in_(appt_ids),
            GrievanceSummaryRecord.is_latest == True,  # noqa: E712
        )
    )).scalars().all()}
    out = []
    for t in tickets:
        a = appts.get(t.appointment_id)
        out.append(_ticket_row(t, a, a.citizen if a else None, summaries.get(t.appointment_id)))
    return out


async def get_detail(db: AsyncSession, ticket_id: int,
                     department: Optional[str] = None) -> dict:
    """Full ticket detail: row + petition context + activity timeline + attachments.
    If `department` is given, verify ownership (department view)."""
    t = (await db.execute(
        select(Ticket)
        .options(selectinload(Ticket.events), selectinload(Ticket.attachments))
        .where(Ticket.id == ticket_id)
    )).scalar_one_or_none()
    if t is None:
        raise HTTPException(status_code=404, detail="Ticket not found.")
    if department is not None and t.department != department:
        raise HTTPException(status_code=403, detail="Not assigned to your department.")

    appt = (await db.execute(
        select(Appointment).options(selectinload(Appointment.citizen)).where(Appointment.id == t.appointment_id)
    )).scalar_one_or_none()
    summary = (await db.execute(
        select(GrievanceSummaryRecord).where(
            GrievanceSummaryRecord.appointment_id == t.appointment_id,
            GrievanceSummaryRecord.is_latest == True,  # noqa: E712
        )
    )).scalar_one_or_none()

    from src.services.storage_service import get_file_url
    row = _ticket_row(t, appt, appt.citizen if appt else None, summary)
    row.update({
        "description": _decode(appt.encrypted_grievance) if (appt and appt.encrypted_grievance) else None,
        "summary": summary.summary if summary else None,
        "summary_ta": summary.summary_ta if summary else None,
        "citizen_ask": summary.citizen_ask if summary else None,
        "key_details": (summary.key_details if summary else []) or [],
        "resolution_notes": t.resolution_notes,
        "forwarded_notes": t.forwarded_notes,
        "events": [
            {"type": e.event_type, "actor": e.actor, "note": e.note,
             "payload": e.payload, "at": utc_iso(e.created_at)}
            for e in sorted(t.events, key=lambda x: x.created_at)
        ],
        "attachments": [
            {"url": get_file_url(a.storage_url), "mime": a.mime_type,
             "name": a.original_filename, "kind": a.kind, "by": a.uploaded_by,
             "at": utc_iso(a.created_at)}
            for a in t.attachments
        ],
    })
    return row


async def department_counts(db: AsyncSession, department: str) -> Dict[str, int]:
    rows = await db.execute(
        select(Ticket.status, func.count(Ticket.id))
        .where(Ticket.department == department)
        .group_by(Ticket.status)
    )
    return {status: n for status, n in rows}
