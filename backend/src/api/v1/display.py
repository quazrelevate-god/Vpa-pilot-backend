"""
Display board routes — separate login, shows today's scheduled & rescheduled appointments.
"""
from datetime import date, datetime
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, Form, Request
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse
from fastapi.templating import Jinja2Templates
from sqlalchemy import select, func, or_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from fastapi import Body
from fastapi.responses import Response

from src.core.database import get_db
from src.core.config import settings
from src.core.display_auth import create_display_cookie, require_display_auth
from src.models.appointment_models import Appointment
from src.services.dashboard_service import (
    _decode, _resolve_display_status, _category_label, set_floor_attendance,
)
from src.services.referral_service import referral_service
from src.services.scheduling_service import _decrypt
from src.core.utils import utc_iso

router = APIRouter(prefix="/display", tags=["Display Board"])

_TMPL_DIR = Path(__file__).resolve().parents[3] / "templates" / "display"
templates = Jinja2Templates(directory=str(_TMPL_DIR))


# ── Auth ──────────────────────────────────────────────────────────────────────

@router.get("/login", include_in_schema=False)
async def display_login_page(request: Request) -> HTMLResponse:
    return templates.TemplateResponse("display_login.jinja2", {"request": request, "error": None})


@router.post("/login", include_in_schema=False)
async def display_login_submit(request: Request, username: str = Form(...), password: str = Form(...)):
    if username == settings.DISPLAY_USERNAME and password == settings.DISPLAY_PASSWORD:
        response = RedirectResponse(url="/display", status_code=302)
        create_display_cookie(response, username)
        return response
    return templates.TemplateResponse(
        "display_login.jinja2",
        {"request": request, "error": "Invalid username or password."},
        status_code=401,
    )


@router.get("/logout", include_in_schema=False)
async def display_logout():
    response = RedirectResponse(url="/display/login", status_code=302)
    response.delete_cookie("display_session")
    return response


# ── Page ──────────────────────────────────────────────────────────────────────

@router.get("/", include_in_schema=False)
async def display_page(request: Request, user: str = Depends(require_display_auth)) -> HTMLResponse:
    return templates.TemplateResponse("display.jinja2", {"request": request, "user": user})


# ── API ───────────────────────────────────────────────────────────────────────

@router.get("/api/today")
async def display_today_api(
    search: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    user: str = Depends(require_display_auth),
):
    """Return today's scheduled + rescheduled appointments, optionally filtered by search."""
    today = date.today()

    stmt = (
        select(Appointment)
        .options(
            selectinload(Appointment.citizen),
            selectinload(Appointment.grievance_summary),
        )
        .where(Appointment.scheduled_date == today)
        # Floor board: meeting visitors for today, plus their post-arrival states
        # (Came -> AWAITING_REVIEW, no-show -> NOT_CAME) so rows stay visible
        # after the team toggles them. Direct-submit petitions have no
        # scheduled_date, so they are naturally excluded.
        .where(Appointment.status.in_(
            ["SCHEDULED", "RESCHEDULED", "AWAITING_REVIEW", "NOT_CAME"]))
        .order_by(Appointment.scheduled_start_time)
    )

    result = await db.execute(stmt)
    appointments = result.scalars().all()

    items = []
    for appt in appointments:
        citizen = appt.citizen
        name = _decode(appt.encrypted_name) if appt.encrypted_name else (
            _decrypt(citizen.encrypted_name) if citizen and citizen.encrypted_name else "—"
        )
        mobile = _decrypt(citizen.encrypted_mobile) if citizen and citizen.encrypted_mobile else "—"

        if search:
            q = search.lower().strip()
            if q not in name.lower() and q not in mobile and q not in str(appt.token_assigned):
                continue

        time_str = ""
        if appt.scheduled_start_time:
            t = appt.scheduled_start_time
            hour = t.hour
            minute = t.minute
            ampm = "AM" if hour < 12 else "PM"
            display_hour = hour if hour <= 12 else hour - 12
            if display_hour == 0:
                display_hour = 12
            time_str = f"{display_hour:02d}:{minute:02d} {ampm}"

        items.append({
            "id": appt.id,
            "token": f"TKN{appt.token_assigned}",
            "name": name,
            "mobile": mobile,
            "num_persons": appt.num_persons or 1,
            "category": _category_label(appt.grievance_category),
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
    user: str = Depends(require_display_auth),
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
    user: str = Depends(require_display_auth),
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
    user: str = Depends(require_display_auth),
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


# ── PWA assets (served from /display/ so the service worker scope covers the app) ─

@router.get("/manifest.webmanifest", include_in_schema=False)
async def display_manifest():
    path = _TMPL_DIR / "manifest.webmanifest"
    return Response(
        content=path.read_text(encoding="utf-8"),
        media_type="application/manifest+json",
        headers={"Cache-Control": "no-cache"},
    )


@router.get("/service-worker.js", include_in_schema=False)
async def display_service_worker():
    path = _TMPL_DIR / "service-worker.js"
    return Response(
        content=path.read_text(encoding="utf-8"),
        media_type="application/javascript",
        headers={
            "Cache-Control": "no-cache",
            "Service-Worker-Allowed": "/display/",
        },
    )
