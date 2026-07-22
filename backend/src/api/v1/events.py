"""
Events (invitation calendar) API — shared team calendar + JSON auth.

The UI is a Next.js PWA served by the PA portal (route group /events). This
module only exposes /events/api/* : session auth (JSON, never a redirect),
calendar range queries, photographed-invitation upload (extraction runs in
the background — see event_service), edit/delete/retry, and authenticated
image serving. Everything is scoped to the events_session cookie.
"""
from datetime import date
from typing import Optional

from fastapi import APIRouter, Body, Depends, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.config import settings
from src.core.database import get_db
from src.core.events_auth import (
    create_events_cookie, clear_events_cookie, get_events_user, require_events_api,
)
from src.core.rate_limit import limiter
from src.services import event_service

router = APIRouter(prefix="/events", tags=["Events Calendar"])

_LABEL = "Events Desk"
_MAX_RANGE_DAYS = 62


# ── Auth (JSON — consumed by the Next.js /events app) ───────────────────────────

@router.post("/api/login")
@limiter.limit("5/minute")
async def events_login(request: Request, username: str = Form(...), password: str = Form(...)):
    """Validate events credentials, set the events_session cookie. 200 or 401."""
    if username == settings.EVENTS_USERNAME and password == settings.EVENTS_PASSWORD:
        response = JSONResponse({"ok": True, "label": _LABEL})
        create_events_cookie(response, username)
        return response
    return JSONResponse({"error": "Invalid username or password."}, status_code=401)


@router.post("/api/logout")
async def events_logout():
    response = JSONResponse({"ok": True})
    clear_events_cookie(response)
    return response


@router.get("/api/session")
async def events_session(request: Request):
    """Return {label} for an authenticated events session, else 401 (JSON)."""
    user = get_events_user(request)
    if not user:
        return JSONResponse({"error": "Not authenticated"}, status_code=401)
    return JSONResponse({"user": user, "label": _LABEL})


# ── Overview stats ──────────────────────────────────────────────────────────────

@router.get("/api/overview")
async def overview(
    db: AsyncSession = Depends(get_db),
    user: str = Depends(require_events_api),
):
    """Office-wide counts for the Overview tab.

    Read-only aggregates over the existing petition/ticket tables:
      totals  — all tickets (excl. reverted), all appointments, and meetings
                (appointments actually booked into a slot)
      today   — tickets raised today, appointments whose booked slot is today,
                petitions received today (appointment rows created today)
      departments — open ticket load per routed department (chart)
    """
    from datetime import date as _date, datetime as _dt, time as _time
    from sqlalchemy import func, select as _select
    from src.models.appointment_models import Appointment
    from src.models.scheduling_models import AppointmentSlot, MLADailyAvailability
    from src.models.ticket_models import Ticket, TicketStatus

    today = _date.today()
    day_start = _dt.combine(today, _time.min)
    day_end = _dt.combine(today, _time.max)

    async def _count(stmt) -> int:
        return int((await db.execute(stmt)).scalar() or 0)

    total_tickets = await _count(
        _select(func.count(Ticket.id)).where(Ticket.status != TicketStatus.REVERTED.value)
    )
    total_appointments = await _count(_select(func.count(Appointment.id)))
    total_meetings = await _count(
        _select(func.count(Appointment.id)).where(Appointment.slot_id.isnot(None))
    )

    # Petition breakdown: Received = all appointments; Awaiting Review / Reviewed by status.
    _REVIEWED_STATUSES = ("REVIEWED", "DISMISSED", "COURTESY_DONE")
    total_petitions_received = total_appointments
    total_petitions_awaiting = await _count(
        _select(func.count(Appointment.id)).where(Appointment.status == "AWAITING_REVIEW")
    )
    total_petitions_reviewed = await _count(
        _select(func.count(Appointment.id)).where(Appointment.status.in_(_REVIEWED_STATUSES))
    )

    today_tickets = await _count(
        _select(func.count(Ticket.id)).where(
            Ticket.created_at >= day_start, Ticket.created_at <= day_end,
            Ticket.status != TicketStatus.REVERTED.value,
        )
    )
    today_appointments = await _count(
        _select(func.count(Appointment.id))
        .join(AppointmentSlot, AppointmentSlot.id == Appointment.slot_id)
        .join(MLADailyAvailability, MLADailyAvailability.id == AppointmentSlot.availability_id)
        .where(MLADailyAvailability.date == today)
    )
    today_petitions_received = await _count(
        _select(func.count(Appointment.id)).where(
            Appointment.created_at >= day_start, Appointment.created_at <= day_end,
        )
    )
    today_petitions_awaiting = await _count(
        _select(func.count(Appointment.id)).where(
            Appointment.created_at >= day_start, Appointment.created_at <= day_end,
            Appointment.status == "AWAITING_REVIEW",
        )
    )
    today_petitions_reviewed = await _count(
        _select(func.count(Appointment.id)).where(
            Appointment.created_at >= day_start, Appointment.created_at <= day_end,
            Appointment.status.in_(_REVIEWED_STATUSES),
        )
    )

    dept_rows = (await db.execute(
        _select(Ticket.department, func.count(Ticket.id))
        .where(Ticket.department.isnot(None),
               Ticket.status != TicketStatus.REVERTED.value)
        .group_by(Ticket.department)
        .order_by(func.count(Ticket.id).desc())
    )).all()

    return {
        "totals": {
            "tickets": total_tickets,
            "appointments": total_appointments,
            "meetings": total_meetings,
            "petitions_received": total_petitions_received,
            "petitions_awaiting": total_petitions_awaiting,
            "petitions_reviewed": total_petitions_reviewed,
        },
        "today": {
            "tickets": today_tickets,
            "appointments": today_appointments,
            "petitions_received": today_petitions_received,
            "petitions_awaiting": today_petitions_awaiting,
            "petitions_reviewed": today_petitions_reviewed,
        },
        "departments": [
            {"name": name, "count": int(cnt)} for name, cnt in dept_rows
        ],
    }


# ── Calendar queries ────────────────────────────────────────────────────────────

@router.get("/api/events")
async def list_events(
    start: date,
    end: date,
    db: AsyncSession = Depends(get_db),
    user: str = Depends(require_events_api),
):
    """Events with a date inside [start, end] (inclusive), for the visible span."""
    if end < start:
        raise HTTPException(400, "end must be on or after start")
    if (end - start).days > _MAX_RANGE_DAYS:
        raise HTTPException(400, f"Range too large (max {_MAX_RANGE_DAYS} days)")
    items = await event_service.list_events(db, start, end)
    return {"items": [event_service.serialize(e) for e in items]}


@router.get("/api/events/needs-review")
async def needs_review(
    db: AsyncSession = Depends(get_db),
    user: str = Depends(require_events_api),
):
    """Failed / still-processing / undated events, newest first."""
    items = await event_service.list_needs_review(db)
    return {"items": [event_service.serialize(e) for e in items], "count": len(items)}


# ── Upload (OCR flow) ───────────────────────────────────────────────────────────

@router.post("/api/events", status_code=201)
async def create_event(
    file: UploadFile = File(...),
    note: str = Form(default=""),
    db: AsyncSession = Depends(get_db),
    user: str = Depends(require_events_api),
):
    """Store the photographed invitation + optional note; extraction runs async."""
    file_bytes = await file.read()
    event = await event_service.create_event(
        db,
        file_bytes=file_bytes,
        mime_type=file.content_type or "",
        note=note,
        created_by=user,
    )
    return {"id": event.id, "status": event.status}


# ── Manual creation (all fields supplied by the user, no OCR) ──────────────────

@router.post("/api/events/manual", status_code=201)
async def create_manual_event(
    title: str = Form(...),
    venue: str = Form(...),
    event_type: str = Form(...),
    event_date: str = Form(...),
    start_time: str = Form(...),
    end_time: str = Form(default=""),
    note: str = Form(default=""),
    file: Optional[UploadFile] = File(default=None),
    db: AsyncSession = Depends(get_db),
    user: str = Depends(require_events_api),
):
    """Create an event with all fields provided manually. Photo is optional.
    Saved immediately as READY — no background extraction is triggered."""
    file_bytes: Optional[bytes] = None
    mime_type = ""
    if file and file.filename:
        file_bytes = await file.read()
        mime_type = file.content_type or ""

    event = await event_service.create_manual_event(
        db,
        title=title,
        venue=venue,
        event_type=event_type,
        event_date=event_date,
        start_time=start_time,
        end_time=end_time,
        note=note,
        file_bytes=file_bytes,
        mime_type=mime_type,
        created_by=user,
    )
    return event_service.serialize(event)


# ── Single event ────────────────────────────────────────────────────────────────

@router.get("/api/events/{event_id}")
async def get_event(
    event_id: int,
    db: AsyncSession = Depends(get_db),
    user: str = Depends(require_events_api),
):
    event = await event_service.get_event(db, event_id)
    return event_service.serialize(event)


@router.patch("/api/events/{event_id}")
async def update_event(
    event_id: int,
    payload: dict = Body(...),
    db: AsyncSession = Depends(get_db),
    user: str = Depends(require_events_api),
):
    event = await event_service.update_event(db, event_id, payload)
    return event_service.serialize(event)


@router.post("/api/events/{event_id}/retry")
async def retry_event(
    event_id: int,
    db: AsyncSession = Depends(get_db),
    user: str = Depends(require_events_api),
):
    event = await event_service.retry_event(db, event_id)
    return event_service.serialize(event)


@router.delete("/api/events/{event_id}")
async def delete_event(
    event_id: int,
    db: AsyncSession = Depends(get_db),
    user: str = Depends(require_events_api),
):
    await event_service.delete_event(db, event_id)
    return {"ok": True}


# ── Image serving ───────────────────────────────────────────────────────────────

@router.get("/api/files/{file_path:path}")
async def events_serve_file(
    file_path: str,
    request: Request,
    user: str = Depends(require_events_api),
):
    """Serve a stored invitation photo scoped by the events session cookie.

    Only keys under events/ are reachable — the shared events credential must
    never be able to read petition uploads (PII) through this route. Delegates
    to the shared streamer for Range/ETag/caching behaviour.
    """
    normalized = file_path.replace("\\", "/").lstrip("/")
    if not normalized.startswith("events/") or ".." in normalized:
        raise HTTPException(404, "File not found")

    from src.api.v1.dashboard import serve_stored_file

    return await serve_stored_file(normalized, request)
