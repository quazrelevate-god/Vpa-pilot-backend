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

from src.core.database import get_db
from src.core.config import settings
from src.core.display_auth import create_display_cookie, require_display_auth
from src.models.appointment_models import Appointment
from src.services.dashboard_service import _decode, _resolve_display_status, _category_label
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
        .where(Appointment.status.in_(["SCHEDULED", "RESCHEDULED"]))
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
            "category": _category_label(appt.grievance_category),
            "status": _resolve_display_status(appt),
            "time": time_str,
        })

    return JSONResponse({
        "items": items,
        "total": len(items),
        "scheduled": sum(1 for i in items if i["status"] == "Scheduled"),
        "rescheduled": sum(1 for i in items if i["status"] == "Rescheduled"),
        "date": today.strftime("%d %b %Y"),
    })
