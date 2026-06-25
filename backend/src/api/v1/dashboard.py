"""
Staff dashboard routes — login, chart stats, appointments table, status updates.
All page routes require cookie-based auth. API routes (/api/*) also require auth.
"""
from fastapi import APIRouter, Depends, Form, Request
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse, Response
from fastapi.templating import Jinja2Templates
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
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
        response = RedirectResponse(url="/appointments", status_code=302)
        create_session_cookie(response, username)
        return response
    return templates.TemplateResponse(
        "login.jinja2",
        {"request": request, "error": "Invalid username or password."},
        status_code=401,
    )


@router.get("/logout", include_in_schema=False)
async def logout():
    response = RedirectResponse(url="/auth/login", status_code=302)
    response.delete_cookie("dash_session")
    return response


# ── Pages ─────────────────────────────────────────────────────────────────────

@router.get("/", include_in_schema=False)
async def root_redirect():
    return RedirectResponse(url="/appointments", status_code=302)


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
    urgency: str = "",
    department: str = "",
    category: str = "",
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
        urgency=urgency or None,
        department=department or None,
        category=category or None,
        page=page,
    )
    return JSONResponse(data)


@router.patch("/api/appointments/{appointment_id}/details")
async def api_update_appointment_details(
    appointment_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: str = Depends(require_auth),
):
    """
    PA-admin override for AI-derived urgency / category / department.

    Body: { "urgency": "low|medium|high|critical" | null,
            "category": "<key>" | null,
            "department": "<key>" | null }

    Any field omitted is left unchanged. Pass null to clear.
    """
    body = await request.json()
    result = await dashboard_service.update_appointment_derived_fields(
        db,
        appointment_id,
        urgency=body.get("urgency") if "urgency" in body else None,
        category=body.get("category") if "category" in body else None,
        department=body.get("department") if "department" in body else None,
    )
    if not result.get("success"):
        return JSONResponse({"error": "Appointment not found"}, status_code=404)
    return JSONResponse({"ok": True})


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
    
    # SMS notification disabled — only OTP SMS is sent
    # if result.get("mobile") and result.get("name"):
    #     asyncio.create_task(appointment_service.send_status_update_sms(
    #         mobile_number=result["mobile"],
    #         token_number=result["token"],
    #         citizen_name=result["name"],
    #         new_status=result["status"],
    #     ))

    return JSONResponse({"ok": True})


@router.get("/api/appointments/{appointment_id}/activity")
async def api_appointment_activity(
    appointment_id: int,
    db: AsyncSession = Depends(get_db),
    user: str = Depends(require_auth),
):
    """Return the activity timeline for an appointment."""
    from src.models.appointment_models import AppointmentEvent
    result = await db.execute(
        select(AppointmentEvent)
        .where(AppointmentEvent.appointment_id == appointment_id)
        .order_by(AppointmentEvent.created_at.desc())
    )
    events = result.scalars().all()
    return JSONResponse({
        "items": [
            {
                "id": e.id,
                "event_type": e.event_type,
                "actor": e.actor,
                "note": e.note,
                "payload": e.payload,
                "created_at": e.created_at.isoformat() + "Z" if e.created_at else None,
            }
            for e in events
        ],
        "total": len(events),
    })


# ══ Ticketing endpoints — PA team only ════════════════════════════════════════
# All routes require auth and write a TicketEvent for every mutation.

from src.services import ticket_service  # noqa: E402


@router.get("/api/tickets/open_count")
async def api_tickets_open_count(
    db: AsyncSession = Depends(get_db),
    user: str = Depends(require_auth),
):
    """Feeds the sidebar badge."""
    return JSONResponse({"open": await ticket_service.get_open_count(db)})


@router.get("/api/tickets")
async def api_tickets_list(
    request: Request,
    status: str = "",
    priority: str = "",
    urgency: str = "",
    department: str = "",
    category: str = "",
    assigned_to: str = "",
    forwarded_to_dept: str = "",
    search: str = "",
    date_from: str = "",
    date_to: str = "",
    page: int = 1,
    db: AsyncSession = Depends(get_db),
    user: str = Depends(require_auth),
):
    data = await ticket_service.list_tickets(
        db,
        status=status or None,
        priority=priority or None,
        urgency=urgency or None,
        department=department or None,
        category=category or None,
        assigned_to=assigned_to or None,
        forwarded_to_dept=forwarded_to_dept or None,
        search=search or None,
        date_from=date_from or None,
        date_to=date_to or None,
        page=page,
    )
    return JSONResponse(data)


@router.get("/api/tickets/{ticket_id}")
async def api_ticket_detail(
    ticket_id: int,
    db: AsyncSession = Depends(get_db),
    user: str = Depends(require_auth),
):
    data = await ticket_service.get_ticket(db, ticket_id)
    if data is None:
        return JSONResponse({"error": "Ticket not found"}, status_code=404)
    return JSONResponse(data)


@router.patch("/api/tickets/{ticket_id}")
async def api_ticket_patch(
    ticket_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: str = Depends(require_auth),
):
    """Update any subset of {status, priority, assigned_to_pa, due_date}."""
    body = await request.json()
    try:
        data = await ticket_service.update_ticket_fields(
            db, ticket_id, actor=user,
            status=body.get("status"),
            priority=body.get("priority"),
            assigned_to_pa=body.get("assigned_to_pa"),
            due_date=body.get("due_date"),
        )
    except ValueError as e:
        await db.rollback()
        return JSONResponse({"error": str(e)}, status_code=400)
    if data is None:
        return JSONResponse({"error": "Ticket not found"}, status_code=404)
    return JSONResponse(data)


@router.post("/api/tickets/{ticket_id}/forward")
async def api_ticket_forward(
    ticket_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: str = Depends(require_auth),
):
    body = await request.json()
    dept = body.get("department")
    if not dept:
        return JSONResponse({"error": "department is required"}, status_code=400)
    data = await ticket_service.forward_to_dept(
        db, ticket_id, actor=user, department=dept, notes=body.get("notes"),
    )
    if data is None:
        return JSONResponse({"error": "Ticket not found"}, status_code=404)
    return JSONResponse(data)


@router.post("/api/tickets/{ticket_id}/comment")
async def api_ticket_comment(
    ticket_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: str = Depends(require_auth),
):
    body = await request.json()
    try:
        data = await ticket_service.add_comment(
            db, ticket_id, actor=user, text=body.get("text", ""),
        )
    except ValueError as e:
        await db.rollback()
        return JSONResponse({"error": str(e)}, status_code=400)
    if data is None:
        return JSONResponse({"error": "Ticket not found"}, status_code=404)
    return JSONResponse(data)


@router.post("/api/tickets/{ticket_id}/resolve")
async def api_ticket_resolve(
    ticket_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: str = Depends(require_auth),
):
    body = await request.json()
    try:
        data = await ticket_service.mark_resolved(
            db, ticket_id, actor=user,
            resolution_notes=body.get("resolution_notes", ""),
        )
    except ValueError as e:
        await db.rollback()
        return JSONResponse({"error": str(e)}, status_code=400)
    if data is None:
        return JSONResponse({"error": "Ticket not found"}, status_code=404)
    return JSONResponse(data)


@router.post("/api/tickets/{ticket_id}/close")
async def api_ticket_close(
    ticket_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: str = Depends(require_auth),
):
    body = await request.json()
    reason = body.get("closure_reason")
    if not reason:
        return JSONResponse({"error": "closure_reason is required"}, status_code=400)
    data = await ticket_service.mark_closed(
        db, ticket_id, actor=user,
        closure_reason=reason, notes=body.get("notes"),
    )
    if data is None:
        return JSONResponse({"error": "Ticket not found"}, status_code=404)
    return JSONResponse(data)


@router.post("/api/tickets/{ticket_id}/reopen")
async def api_ticket_reopen(
    ticket_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: str = Depends(require_auth),
):
    body = await request.json()
    data = await ticket_service.reopen(
        db, ticket_id, actor=user, reason=body.get("reason"),
    )
    if data is None:
        return JSONResponse({"error": "Ticket not found"}, status_code=404)
    return JSONResponse(data)


_UPLOADS_ROOT = Path(__file__).resolve().parent.parent.parent.parent / "uploads"


@router.get("/api/files/{file_path:path}")
async def serve_upload(
    file_path: str,
    user: str = Depends(require_auth),
):
    """Serve uploaded files — requires dashboard auth. Prevents public access."""
    import mimetypes
    try:
        full_path = (_UPLOADS_ROOT / file_path).resolve()
        full_path.relative_to(_UPLOADS_ROOT.resolve())
    except Exception:
        return JSONResponse({"error": "Not found"}, status_code=404)

    if not full_path.exists() or not full_path.is_file():
        return JSONResponse({"error": "Not found"}, status_code=404)

    mime, _ = mimetypes.guess_type(str(full_path))
    return Response(
        content=full_path.read_bytes(),
        media_type=mime or "application/octet-stream",
        headers={"Content-Disposition": f'inline; filename="{full_path.name}"'},
    )
