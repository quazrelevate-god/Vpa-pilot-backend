"""
Staff dashboard routes — login, chart stats, appointments table, status updates.
All page routes require cookie-based auth. API routes (/api/*) also require auth.
"""
from fastapi import APIRouter, Depends, Form, Request
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse
from fastapi.templating import Jinja2Templates
from sqlalchemy.ext.asyncio import AsyncSession
from pathlib import Path

from src.core.database import get_db
from src.core.config import settings
from src.core.dash_auth import create_session_cookie, require_auth
from src.services import dashboard_service

router = APIRouter(prefix="/dashboard", tags=["Dashboard"])

_TMPL_DIR = Path(__file__).resolve().parents[3] / "templates" / "dashboard"
templates = Jinja2Templates(directory=str(_TMPL_DIR))


# ── Auth ──────────────────────────────────────────────────────────────────────

@router.get("/login", include_in_schema=False)
async def login_page(request: Request) -> HTMLResponse:
    return templates.TemplateResponse("login.jinja2", {"request": request, "error": None})


@router.post("/login", include_in_schema=False)
async def login_submit(request: Request, username: str = Form(...), password: str = Form(...)):
    if username == settings.DASHBOARD_USERNAME and password == settings.DASHBOARD_PASSWORD:
        response = RedirectResponse(url="/dashboard/appointments", status_code=302)
        create_session_cookie(response, username)
        return response
    return templates.TemplateResponse(
        "login.jinja2",
        {"request": request, "error": "Invalid username or password."},
        status_code=401,
    )


@router.get("/logout", include_in_schema=False)
async def logout():
    response = RedirectResponse(url="/dashboard/login", status_code=302)
    response.delete_cookie("dash_session")
    return response


# ── Pages ─────────────────────────────────────────────────────────────────────

@router.get("/", include_in_schema=False)
async def root_redirect():
    return RedirectResponse(url="/dashboard/appointments", status_code=302)


@router.get("/overview", include_in_schema=False)
async def dashboard_page(request: Request, user: str = Depends(require_auth)) -> HTMLResponse:
    return templates.TemplateResponse("dashboard.jinja2", {"request": request, "user": user})


@router.get("/appointments", include_in_schema=False)
async def appointments_page(request: Request, user: str = Depends(require_auth)) -> HTMLResponse:
    return templates.TemplateResponse("appointments.jinja2", {"request": request, "user": user})


# ── Data APIs (used by page JS via fetch) ─────────────────────────────────────

@router.get("/api/stats")
async def api_stats(
    request: Request,
    date_from: str = "",
    date_to: str = "",
    db: AsyncSession = Depends(get_db),
    user: str = Depends(require_auth),
):
    data = await dashboard_service.get_stats(db, date_from=date_from or None, date_to=date_to or None)
    return JSONResponse(data)


@router.get("/api/appointments")
async def api_appointments(
    request: Request,
    status: str = "All",
    search: str = "",
    date_from: str = "",
    date_to: str = "",
    page: int = 1,
    db: AsyncSession = Depends(get_db),
    user: str = Depends(require_auth),
):
    data = await dashboard_service.get_appointments(
        db,
        status_filter=status,
        search=search or None,
        date_from=date_from or None,
        date_to=date_to or None,
        page=page,
    )
    return JSONResponse(data)


@router.patch("/api/appointments/{appointment_id}/status")
async def api_update_status(
    appointment_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: str = Depends(require_auth),
):
    import asyncio
    from src.services.appointment_service import appointment_service
    
    body = await request.json()
    new_status = body.get("status", "")
    result = await dashboard_service.update_appointment_status(db, appointment_id, new_status)
    
    if not result.get("success"):
        return JSONResponse({"error": "Appointment not found"}, status_code=404)
    
    # Fire-and-forget SMS notification
    if result.get("mobile") and result.get("name"):
        asyncio.create_task(appointment_service.send_status_update_sms(
            mobile_number=result["mobile"],
            token_number=result["token"],
            citizen_name=result["name"],
            new_status=result["status"],
        ))
    
    return JSONResponse({"ok": True})
