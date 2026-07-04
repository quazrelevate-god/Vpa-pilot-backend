"""
Crowd Management API — floor-operator data + JSON auth.

The UI is a Next.js PWA served by the PA portal (route group /crowd). This
module only exposes /crowd/api/* : session auth (JSON, never a redirect),
today's appointments + referrals, attendance write-backs, and unified walk-in
intake. Everything is scoped to the display_session cookie.
"""
from datetime import date
from typing import List, Optional

from fastapi import APIRouter, Depends, File, Form, Request
from fastapi.responses import JSONResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from fastapi import Body, UploadFile

from src.core.database import get_db
from src.core.config import settings
from src.core.display_auth import (
    create_display_cookie, clear_display_cookie, get_display_user, require_display_api,
)
from src.core.rate_limit import limiter
from src.models.appointment_models import Appointment
from src.services.dashboard_service import (
    _decode, _resolve_display_status, _category_label, set_floor_attendance,
)
from src.services.referral_service import referral_service
from src.services.scheduling_service import _decrypt

router = APIRouter(prefix="/crowd", tags=["Crowd Management"])

_FLOOR_LABEL = "Floor Operator"


# ── Auth (JSON — consumed by the Next.js /crowd app) ────────────────────────────

@router.post("/api/login")
@limiter.limit("5/minute")
async def crowd_login(request: Request, username: str = Form(...), password: str = Form(...)):
    """Validate floor credentials, set the display_session cookie. 200 or 401."""
    if username == settings.DISPLAY_USERNAME and password == settings.DISPLAY_PASSWORD:
        response = JSONResponse({"ok": True, "label": _FLOOR_LABEL})
        create_display_cookie(response, username)
        return response
    return JSONResponse({"error": "Invalid username or password."}, status_code=401)


@router.post("/api/logout")
async def crowd_logout():
    response = JSONResponse({"ok": True})
    clear_display_cookie(response)
    return response


@router.get("/api/session")
async def crowd_session(request: Request):
    """Return {label} for an authenticated floor session, else 401 (JSON)."""
    user = get_display_user(request)
    if not user:
        return JSONResponse({"error": "Not authenticated"}, status_code=401)
    return JSONResponse({"user": user, "label": _FLOOR_LABEL})


# ── Today's feeds ───────────────────────────────────────────────────────────────

@router.get("/api/today")
async def display_today_api(
    search: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    user: str = Depends(require_display_api),
):
    """Return today's scheduled + rescheduled appointments, optionally filtered by search."""
    today = date.today()

    # v2: scheduled date/time live on the joined slot + availability.
    # Floor board wants today's meeting visitors + their post-arrival states.
    from src.models.scheduling_models import AppointmentSlot, MLADailyAvailability
    stmt = (
        select(Appointment)
        .options(
            selectinload(Appointment.citizen),
            selectinload(Appointment.grievance_summary),
            selectinload(Appointment.scheduled_slot).selectinload(AppointmentSlot.availability),
        )
        .join(AppointmentSlot, AppointmentSlot.id == Appointment.slot_id)
        .join(MLADailyAvailability, MLADailyAvailability.id == AppointmentSlot.availability_id)
        .where(MLADailyAvailability.date == today)
        .where(Appointment.status.in_(
            ["SCHEDULED", "RESCHEDULED", "AWAITING_REVIEW", "NOT_CAME"]))
        .order_by(AppointmentSlot.start_time)
    )

    result = await db.execute(stmt)
    appointments = result.scalars().all()

    items = []
    for appt in appointments:
        citizen = appt.citizen
        name = _decrypt(citizen.encrypted_name) if citizen and citizen.encrypted_name else "—"
        mobile = _decrypt(citizen.encrypted_mobile) if citizen and citizen.encrypted_mobile else "—"

        if search:
            q = search.lower().strip()
            if q not in name.lower() and q not in mobile and q not in str(appt.token_assigned):
                continue

        time_str = ""
        slot_start = appt.scheduled_slot.start_time if appt.scheduled_slot else None
        if slot_start:
            hour = slot_start.hour
            minute = slot_start.minute
            ampm = "AM" if hour < 12 else "PM"
            display_hour = hour if hour <= 12 else hour - 12
            if display_hour == 0:
                display_hour = 12
            time_str = f"{display_hour:02d}:{minute:02d} {ampm}"

        summary_rec = next((s for s in (appt.grievance_summary or []) if s.is_latest), None)
        headline = (summary_rec.headline if summary_rec else None)
        items.append({
            "id": appt.id,
            "token": f"TKN{appt.token_assigned}",
            "name": name,
            "mobile": mobile,
            "num_persons": appt.num_persons or 1,
            "category": _category_label(appt.grievance_category),
            "reason": headline or _category_label(appt.grievance_category),
            "status": _resolve_display_status(appt),
            "status_db": appt.status,
            "time": time_str,
        })

    return JSONResponse({
        "items": items,
        "total": len(items),
        "expected": sum(1 for i in items if i["status_db"] in ("SCHEDULED", "RESCHEDULED")),
        "present": sum(1 for i in items if i["status_db"] == "AWAITING_REVIEW"),
        "not_came": sum(1 for i in items if i["status_db"] == "NOT_CAME"),
        "date": today.strftime("%d %b %Y"),
    })


@router.get("/api/referral/today")
async def display_referral_today_api(
    search: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    user: str = Depends(require_display_api),
):
    """Today's referral bookings for the floor board (name, count, reason, status)."""
    today = date.today()
    bookings = await referral_service.get_bookings(db, today)

    if search:
        q = search.lower().strip()
        bookings = [
            b for b in bookings
            if q in (b["name"] or "").lower()
            or q in (b["mobile"] or "")
            or q in (b["token"] or "").lower()
        ]

    return JSONResponse({
        "items": bookings,
        "total": len(bookings),
        "expected": sum(1 for b in bookings if b["status"] == "PENDING"),
        "present": sum(1 for b in bookings if b["status"] == "CAME"),
        "not_came": sum(1 for b in bookings if b["status"] == "NOT_CAME"),
        "date": today.strftime("%d %b %Y"),
    })


# ── Write-back: attendance toggles ──────────────────────────────────────────────

@router.patch("/api/appointments/{appointment_id}/status")
async def display_set_appointment_status(
    appointment_id: int,
    payload: dict = Body(...),
    db: AsyncSession = Depends(get_db),
    user: str = Depends(require_display_api),
):
    """Floor board: mark a meeting visitor Came / Not Came, or Reset (undo)."""
    action = str(payload.get("status", "")).strip().lower().replace(" ", "_")
    if action not in ("came", "not_came", "reset"):
        return JSONResponse({"error": "status must be Came, Not Came or Reset"}, status_code=400)
    result = await set_floor_attendance(db, appointment_id, action)
    if not result.get("success"):
        return JSONResponse({"error": result.get("error", "Appointment not found")}, status_code=404)
    return JSONResponse(result)


@router.patch("/api/referral/{booking_id}/status")
async def display_set_referral_status(
    booking_id: int,
    payload: dict = Body(...),
    db: AsyncSession = Depends(get_db),
    user: str = Depends(require_display_api),
):
    """Floor board: mark a referral visitor CAME or NOT_CAME."""
    raw = str(payload.get("status", "")).strip().upper().replace(" ", "_")
    if raw not in ("CAME", "NOT_CAME", "PENDING"):
        return JSONResponse({"error": "status must be CAME, NOT_CAME or PENDING"}, status_code=400)
    try:
        result = await referral_service.update_booking_status(db, booking_id, raw)
        return JSONResponse(result)
    except ValueError as e:
        await db.rollback()
        return JSONResponse({"error": str(e)}, status_code=404)


# ── Walk-in intake: petition + appointment booking (floor team) ──────────────────

@router.post("/api/intake")
async def display_add_intake(
    name: str = Form(...),
    mobile: str = Form(default=""),
    description: str = Form(default=""),
    category: str = Form(...),
    slot_id: Optional[int] = Form(default=None),
    num_persons: int = Form(default=1),
    schedule_meeting: bool = Form(default=False),
    files: List[UploadFile] = File(default=[]),
    db: AsyncSession = Depends(get_db),
    user: str = Depends(require_display_api),
):
    """Unified walk-in intake from the crowd PWA (for phone-less / illiterate
    citizens): write the grievance + optional photo + optionally book a live
    meeting slot. No OTP — scoped to the display session. Books the slot
    (SCHEDULED), falls back to the WAITING queue, or lands in Petition Review
    (AWAITING_REVIEW) when no meeting is requested."""
    from src.services.appointment_service import appointment_service
    result = await appointment_service.process_floor_intake(
        name=name.strip(),
        mobile=(mobile or "").strip(),
        description=(description or "").strip(),
        grievance_category=category,
        db=db,
        slot_id=slot_id,
        num_persons=num_persons,
        schedule_meeting=schedule_meeting,
        files=files,
        submitted_by=f"floor:{user}",
    )
    return JSONResponse(result, status_code=201)
