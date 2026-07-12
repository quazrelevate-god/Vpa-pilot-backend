"""
Staff dashboard routes — login, chart stats, appointments table, status updates.
All page routes require cookie-based auth. API routes (/api/*) also require auth.
"""
from fastapi import APIRouter, Depends, File, Form, Request, UploadFile
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, RedirectResponse, Response
from fastapi.templating import Jinja2Templates
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pathlib import Path

from src.core.database import get_db
from src.core.config import settings
from src.core.dash_auth import create_session_cookie, require_auth
from src.core.rate_limit import limiter
from src.services import dashboard_service

router = APIRouter(prefix="/dashboard", tags=["Dashboard"])

_TMPL_DIR = Path(__file__).resolve().parents[3] / "templates" / "dashboard"
templates = Jinja2Templates(directory=str(_TMPL_DIR))


@router.get("/api/display-qr")
async def display_qr_info(request: Request, user: str = Depends(require_auth)):
    """Public URL of the crowd-management board — the PA portal renders this as a
    QR the floor team scans to open + install the PWA (and a link to re-share)."""
    if settings.SERVER_BASE_URL and settings.SERVER_BASE_URL != "http://localhost:8000":
        base = settings.SERVER_BASE_URL.rstrip("/")
    else:
        base = str(request.base_url).rstrip("/")
    return JSONResponse({"board_url": f"{base}/crowd", "login_url": f"{base}/crowd/login"})


# ── Analytics dashboard ─────────────────────────────────────────────────────────
def _analytics_filters(date_from, date_to, category, priority, ministry, channel, status, district=None):
    from src.services.analytics_service import Filters
    return Filters(date_from=date_from, date_to=date_to, category=category,
                   priority=priority, ministry=ministry, channel=channel, status=status,
                   district=district)


@router.get("/api/analytics")
async def api_analytics(
    date_from: str = None, date_to: str = None, category: str = None, priority: str = None,
    ministry: str = None, channel: str = None, status: str = None, district: str = None,
    db: AsyncSession = Depends(get_db), user: str = Depends(require_auth),
):
    from src.services.analytics_service import analytics_service
    f = _analytics_filters(date_from, date_to, category, priority, ministry, channel, status, district)
    return JSONResponse(await analytics_service.get_analytics(db, f))


@router.get("/api/analytics/operations")
async def api_analytics_operations(
    date_from: str = None, date_to: str = None, category: str = None, priority: str = None,
    ministry: str = None, channel: str = None, status: str = None, district: str = None,
    db: AsyncSession = Depends(get_db), user: str = Depends(require_auth),
):
    """Department performance and district breakdown for the lower half of the
    overview dashboard."""
    from src.services.analytics_service import analytics_service
    f = _analytics_filters(date_from, date_to, category, priority, ministry, channel, status, district)
    return JSONResponse(await analytics_service.get_operations(db, f))


@router.get("/api/analytics/petitions")
async def api_analytics_petitions(
    date_from: str = None, date_to: str = None, category: str = None, priority: str = None,
    ministry: str = None, channel: str = None, status: str = None, district: str = None,
    page: int = 1, page_size: int = 50, sort: str = "created_at", direction: str = "desc",
    db: AsyncSession = Depends(get_db), user: str = Depends(require_auth),
):
    from src.services.analytics_service import analytics_service
    f = _analytics_filters(date_from, date_to, category, priority, ministry, channel, status, district)
    return JSONResponse(await analytics_service.get_petitions(db, f, page, page_size, sort, direction))


@router.get("/api/analytics/export")
async def api_analytics_export(
    date_from: str = None, date_to: str = None, category: str = None, priority: str = None,
    ministry: str = None, channel: str = None, status: str = None, district: str = None,
    db: AsyncSession = Depends(get_db), user: str = Depends(require_auth),
):
    import csv, io
    from src.services.analytics_service import analytics_service
    f = _analytics_filters(date_from, date_to, category, priority, ministry, channel, status, district)
    data = await analytics_service.get_petitions(db, f, page=1, page_size=5000)
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["Token", "Name", "Mobile", "Category", "Priority", "Status", "Channel", "Meeting", "Created"])
    for r in data["items"]:
        w.writerow([r["token"], r["name"], r["mobile"], r["category_label"], r["priority"] or "",
                    r["status"], r["source_label"], "Yes" if r["schedule_meeting"] else "No", r["created_at"] or ""])
    return Response(
        content=buf.getvalue(), media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=petitions.csv"},
    )


@router.get("/api/appointments/counts")
async def api_appointment_counts(
    request: Request,
    search: str = "",
    date_from: str = "",
    date_to: str = "",
    appt_date_from: str = "",
    appt_date_to: str = "",
    priority: str = "",
    ministry: str = "",
    category: str = "",
    kind: str = "",
    db: AsyncSession = Depends(get_db),
    user: str = Depends(require_auth),
):
    """Single-call per-tab counts honouring secondary filters.
    Must be declared BEFORE the int-typed /{appointment_id} detail route, or
    FastAPI matches "counts" against that route and 422s on the int parse."""
    data = await dashboard_service.get_appointment_counts(
        db,
        search=search or None,
        date_from=date_from or None,
        date_to=date_to or None,
        appt_date_from=appt_date_from or None,
        appt_date_to=appt_date_to or None,
        priority=priority or None,
        ministry=ministry or None,
        category=category or None,
        kind=kind or None,
    )
    return JSONResponse(data)


@router.get("/api/appointments/{appointment_id}")
async def api_appointment_detail(
    appointment_id: int, db: AsyncSession = Depends(get_db), user: str = Depends(require_auth),
):
    """Full appointment detail (summary + attachments) for the dashboard drawer."""
    row = await dashboard_service.get_appointment_detail(db, appointment_id)
    if row is None:
        return JSONResponse({"error": "Not found"}, status_code=404)
    return JSONResponse(row)


# ── Auth ──────────────────────────────────────────────────────────────────────

@router.get("/login", include_in_schema=False)
async def login_page(request: Request) -> HTMLResponse:
    return templates.TemplateResponse("login.jinja2", {"request": request, "error": None})


@router.post("/login", include_in_schema=False)
@limiter.limit("5/minute")
async def login_submit(
    request: Request,
    username: str = Form(...),
    password: str = Form(...),
    db: AsyncSession = Depends(get_db),
):
    # Env admin is the fallback super-admin credential — always valid so the
    # office team can never get locked out of the platform even if the
    # `login` table gets wiped. On success, upsert the DB row so downstream
    # audit + RBAC see a real user_id.
    if username == settings.DASHBOARD_USERNAME and password == settings.DASHBOARD_PASSWORD:
        from src.core.rbac import ensure_env_admin_seeded
        await ensure_env_admin_seeded(db, username)
        response = RedirectResponse(url="/appointments", status_code=302)
        create_session_cookie(response, username)
        return response

    # Non-env users: check the `login` table.
    from src.models.login_models import Login, verify_password
    row = (await db.execute(
        select(Login).where(Login.login_name == username, Login.is_active == True)  # noqa: E712
    )).scalar_one_or_none()
    if row and verify_password(password, row.password):
        response = RedirectResponse(url="/appointments", status_code=302)
        create_session_cookie(response, username)
        return response

    return templates.TemplateResponse(
        "login.jinja2",
        {"request": request, "error": "Invalid username or password."},
        status_code=401,
    )


@router.post("/api/login")
@limiter.limit("5/minute")
async def unified_login(
    request: Request,
    username: str = Form(...),
    password: str = Form(...),
    db: AsyncSession = Depends(get_db),
):
    """Single sign-in for both the PA portal and department workspaces.

    Resolves the role straight from the credentials, sets the matching session
    cookie, and returns where the client should land — one round-trip, and
    neither side consumes the other's rate-limited attempt.
    """
    uname = username.strip()

    # 1) PA staff — env super-admin fallback, then the `login` table.
    from src.models.login_models import Login, verify_password as verify_staff
    staff_ok = False
    staff_role = "pa"
    if uname == settings.DASHBOARD_USERNAME and password == settings.DASHBOARD_PASSWORD:
        from src.core.rbac import ensure_env_admin_seeded
        await ensure_env_admin_seeded(db, uname)
        staff_ok = True
        staff_role = "super_admin"
    else:
        row = (await db.execute(
            select(Login).where(Login.login_name == uname, Login.is_active == True)  # noqa: E712
        )).scalar_one_or_none()
        if row and verify_staff(password, row.password):
            staff_ok = True
            staff_role = row.role
    if staff_ok:
        # Department officers are scoped to tickets — land them there, not on
        # the (unscoped) appointments board.
        redirect = "/tickets" if staff_role == ROLE_DEPT_OFFICER else "/appointments"
        resp = JSONResponse({"ok": True, "role": staff_role, "redirect": redirect})
        create_session_cookie(resp, uname)
        resp.delete_cookie("dept_session", path="/", httponly=True, samesite="lax")
        return resp

    # 2) Department shared account.
    from src.models.department_account import DepartmentAccount, verify_password as verify_dept
    from src.core.dept_auth import create_dept_session_cookie
    acct = (await db.execute(
        select(DepartmentAccount).where(DepartmentAccount.username == uname)
    )).scalar_one_or_none()
    if acct and verify_dept(password, acct.password_hash):
        resp = JSONResponse({"ok": True, "role": "department", "redirect": "/department"})
        create_dept_session_cookie(resp, acct.department)
        resp.delete_cookie("dash_session", path="/", httponly=True, samesite="lax")
        return resp

    return JSONResponse({"error": "Invalid username or password."}, status_code=401)


@router.get("/logout", include_in_schema=False)
async def logout():
    # Redirect to Next.js login page (not the Jinja2 /auth/login backend page)
    response = RedirectResponse(url="/login", status_code=302)
    # Attributes must exactly match how the cookie was set, or browsers won't clear it
    response.delete_cookie("dash_session", path="/", httponly=True, samesite="lax")
    return response


# ── Pages ─────────────────────────────────────────────────────────────────────

@router.get("/", include_in_schema=False)
async def root_redirect():
    # Redirect anyone hitting the raw FastAPI dashboard root to the appointments page.
    # In production this goes through Next.js which applies the auth middleware.
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
    appt_date_from: str = "",
    appt_date_to: str = "",
    priority: str = "",
    ministry: str = "",
    category: str = "",
    kind: str = "",
    sort: str = "",
    page: int = 1,
    page_size: int = 25,
    db: AsyncSession = Depends(get_db),
    user: str = Depends(require_auth),
):
    data = await dashboard_service.get_appointments(
        db,
        status_filter=status,
        search=search or None,
        date_from=date_from or None,
        date_to=date_to or None,
        appt_date_from=appt_date_from or None,
        appt_date_to=appt_date_to or None,
        priority=priority or None,
        ministry=ministry or None,
        category=category or None,
        kind=kind or None,
        sort=sort or None,
        page=page,
        page_size=min(page_size, 5000),  # cap at 5000 for export safety
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
    PA-admin override for AI-derived priority / category / ministry.

    Body: { "priority": "low|medium|high|critical" | null,
            "category": "<key>" | null,
            "ministry": "<key>" | null }

    Any field omitted is left unchanged. Pass null to clear.
    """
    body = await request.json()
    result = await dashboard_service.update_appointment_derived_fields(
        db,
        appointment_id,
        priority=body.get("priority") if "priority" in body else None,
        category=body.get("category") if "category" in body else None,
        ministry=body.get("ministry") if "ministry" in body else None,
        district=body.get("district") if "district" in body else None,
        name=body.get("name") if "name" in body else None,
        name_ta=body.get("name_ta") if "name_ta" in body else None,
        summary_text=body.get("summary") if "summary" in body else None,
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


@router.post("/api/appointments/{appointment_id}/approve")
async def api_approve_petition(
    appointment_id: int,
    db: AsyncSession = Depends(get_db),
    user: str = Depends(require_auth),
):
    """Approve a QR/staff petition from the unified review drawer — creates the
    ticket (School → open) or forwards it out (non-school ministry)."""
    result = await dashboard_service.approve_petition(db, appointment_id, actor=user)
    return JSONResponse(result)


@router.post("/api/appointments/{appointment_id}/dismiss")
async def api_dismiss_petition(
    appointment_id: int,
    db: AsyncSession = Depends(get_db),
    user: str = Depends(require_auth),
):
    """Dismiss a QR/staff/postal petition — mark it reviewed WITHOUT creating a
    ticket / department routing. Used for courtesy audio, blank envelopes,
    obvious duplicates. Row stays visible in the "All" segment only."""
    try:
        result = await dashboard_service.dismiss_petition(db, appointment_id, actor=user)
        return JSONResponse(result)
    except ValueError as e:
        await db.rollback()
        return JSONResponse({"error": str(e)}, status_code=400)


@router.post("/api/appointments/{appointment_id}/attachment")
async def api_add_appointment_attachment(
    appointment_id: int,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    user: str = Depends(require_auth),
):
    """Attach a PA-uploaded file (≤5 MB, image/PDF) to a petition from the review drawer."""
    raw = await file.read()
    try:
        result = await dashboard_service.add_case_attachment(
            db, appointment_id, file.filename or "file", raw,
            file.content_type or "application/octet-stream",
        )
    except ValueError as e:
        await db.rollback()
        return JSONResponse({"error": str(e)}, status_code=400)
    if result is None:
        return JSONResponse({"error": "Not found"}, status_code=404)
    return JSONResponse(result)


@router.get("/api/appointments/{appointment_id}/activity")
async def api_appointment_activity(
    appointment_id: int,
    db: AsyncSession = Depends(get_db),
    user: str = Depends(require_auth),
):
    """Return the activity timeline for an appointment (v2: unified activity table)."""
    from src.models.activity_models import Activity
    result = await db.execute(
        select(Activity)
        .where(Activity.appointment_id == appointment_id)
        .order_by(Activity.created_at.desc())
    )
    events = result.scalars().all()
    return JSONResponse({
        "items": [
            {
                "id": e.id,
                "event_type": e.action_type,
                "actor": e.user,
                "note": e.message,
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
from src.core.rbac import get_current_login  # noqa: E402
from src.models.login_models import Login, ROLE_DEPT_OFFICER  # noqa: E402
from src.models.ticket_models import Ticket as _Ticket  # noqa: E402


def _officer_dept(current: Login) -> str | None:
    """Department a dept_officer is pinned to. Fail-closed to a no-match
    sentinel when a dept_officer has no department set, so they see nothing
    rather than everything. Returns None for full-access roles (super_admin /
    pa / auditor), which applies no department filter."""
    if current.role == ROLE_DEPT_OFFICER:
        return (current.scope or {}).get("department") or "__none__"
    return None


async def _ticket_in_scope(db, ticket_id: int, current: Login) -> bool:
    """A dept officer may only act on tickets routed to their own department."""
    dept = _officer_dept(current)
    if dept is None:
        return True
    t = await db.get(_Ticket, ticket_id)
    return bool(t is not None and t.department == dept)


@router.get("/api/tickets/open_count")
async def api_tickets_open_count(
    db: AsyncSession = Depends(get_db),
    current: Login = Depends(get_current_login),
):
    """Feeds the sidebar badge."""
    return JSONResponse({"open": await ticket_service.get_open_count(db, department=_officer_dept(current))})


@router.get("/api/tickets")
async def api_tickets_list(
    request: Request,
    status: str = "",
    priority: str = "",
    ministry: str = "",
    category: str = "",
    assigned_to: str = "",
    forwarded_to_dept: str = "",
    search: str = "",
    date_from: str = "",
    date_to: str = "",
    page: int = 1,
    db: AsyncSession = Depends(get_db),
    current: Login = Depends(get_current_login),
):
    data = await ticket_service.list_tickets(
        db,
        status=status or None,
        priority=priority or None,
        ministry=ministry or None,
        category=category or None,
        assigned_to=assigned_to or None,
        forwarded_to_dept=forwarded_to_dept or None,
        department=_officer_dept(current),
        search=search or None,
        date_from=date_from or None,
        date_to=date_to or None,
        page=page,
    )
    return JSONResponse(data)


@router.get("/api/tickets/counts")
async def api_ticket_counts(
    request: Request,
    priority: str = "",
    ministry: str = "",
    category: str = "",
    assigned_to: str = "",
    forwarded_to_dept: str = "",
    search: str = "",
    date_from: str = "",
    date_to: str = "",
    db: AsyncSession = Depends(get_db),
    current: Login = Depends(get_current_login),
):
    """Single-call per-segment counts (All/Open/In progress/Forwarded/Resolved/Closed).
    Replaces the 6× parallel list-call pattern. Must be declared BEFORE the
    int-typed /{ticket_id} detail route or FastAPI fails to parse "counts" as int."""
    data = await ticket_service.get_ticket_counts(
        db,
        priority=priority or None,
        ministry=ministry or None,
        category=category or None,
        assigned_to=assigned_to or None,
        forwarded_to_dept=forwarded_to_dept or None,
        department=_officer_dept(current),
        search=search or None,
        date_from=date_from or None,
        date_to=date_to or None,
    )
    return JSONResponse(data)


@router.get("/api/tickets/{ticket_id}")
async def api_ticket_detail(
    ticket_id: int,
    db: AsyncSession = Depends(get_db),
    current: Login = Depends(get_current_login),
):
    data = await ticket_service.get_ticket(db, ticket_id)
    if data is None:
        return JSONResponse({"error": "Ticket not found"}, status_code=404)
    dept = _officer_dept(current)
    if dept is not None and data.get("assigned_department") != dept:
        return JSONResponse({"error": "Ticket not found"}, status_code=404)
    return JSONResponse(data)


@router.patch("/api/tickets/{ticket_id}")
async def api_ticket_patch(
    ticket_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current: Login = Depends(get_current_login),
):
    """Update any subset of {status, priority, assigned_to_pa, due_date, district}."""
    if not await _ticket_in_scope(db, ticket_id, current):
        return JSONResponse({"error": "Ticket not found"}, status_code=404)
    body = await request.json()
    try:
        data = await ticket_service.update_ticket_fields(
            db, ticket_id, actor=current.login_name,
            status=body.get("status"),
            priority=body.get("priority"),
            assigned_to_pa=body.get("assigned_to_pa"),
            due_date=body.get("due_date"),
            district=body.get("district"),
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
    current: Login = Depends(get_current_login),
):
    if not await _ticket_in_scope(db, ticket_id, current):
        return JSONResponse({"error": "Ticket not found"}, status_code=404)
    body = await request.json()
    dept = body.get("department")
    if not dept:
        return JSONResponse({"error": "department is required"}, status_code=400)
    data = await ticket_service.forward_to_dept(
        db, ticket_id, actor=current.login_name, department=dept, notes=body.get("notes"),
    )
    if data is None:
        return JSONResponse({"error": "Ticket not found"}, status_code=404)
    return JSONResponse(data)


@router.post("/api/tickets/{ticket_id}/comment")
async def api_ticket_comment(
    ticket_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current: Login = Depends(get_current_login),
):
    if not await _ticket_in_scope(db, ticket_id, current):
        return JSONResponse({"error": "Ticket not found"}, status_code=404)
    body = await request.json()
    try:
        data = await ticket_service.add_comment(
            db, ticket_id, actor=current.login_name, text=body.get("text", ""),
        )
    except ValueError as e:
        await db.rollback()
        return JSONResponse({"error": str(e)}, status_code=400)
    if data is None:
        return JSONResponse({"error": "Ticket not found"}, status_code=404)
    return JSONResponse(data)


@router.post("/api/tickets/{ticket_id}/attachment")
async def api_add_ticket_attachment(
    ticket_id: int,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    current: Login = Depends(get_current_login),
):
    """Attach a PA-uploaded file (≤5 MB, image/PDF) to a ticket's case, from the ticket drawer."""
    if not await _ticket_in_scope(db, ticket_id, current):
        return JSONResponse({"error": "Ticket not found"}, status_code=404)
    appointment_id = await dashboard_service.appointment_id_for_ticket(db, ticket_id)
    if appointment_id is None:
        return JSONResponse({"error": "Ticket not found"}, status_code=404)
    raw = await file.read()
    try:
        result = await dashboard_service.add_case_attachment(
            db, appointment_id, file.filename or "file", raw,
            file.content_type or "application/octet-stream",
        )
    except ValueError as e:
        await db.rollback()
        return JSONResponse({"error": str(e)}, status_code=400)
    if result is None:
        return JSONResponse({"error": "Not found"}, status_code=404)
    return JSONResponse(result)


@router.post("/api/tickets/{ticket_id}/resolve")
async def api_ticket_resolve(
    ticket_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current: Login = Depends(get_current_login),
):
    if not await _ticket_in_scope(db, ticket_id, current):
        return JSONResponse({"error": "Ticket not found"}, status_code=404)
    body = await request.json()
    try:
        data = await ticket_service.mark_resolved(
            db, ticket_id, actor=current.login_name,
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
    current: Login = Depends(get_current_login),
):
    if not await _ticket_in_scope(db, ticket_id, current):
        return JSONResponse({"error": "Ticket not found"}, status_code=404)
    body = await request.json()
    reason = body.get("closure_reason")
    if not reason:
        return JSONResponse({"error": "closure_reason is required"}, status_code=400)
    data = await ticket_service.mark_closed(
        db, ticket_id, actor=current.login_name,
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
    current: Login = Depends(get_current_login),
):
    if not await _ticket_in_scope(db, ticket_id, current):
        return JSONResponse({"error": "Ticket not found"}, status_code=404)
    body = await request.json()
    data = await ticket_service.reopen(
        db, ticket_id, actor=current.login_name, reason=body.get("reason"),
    )
    if data is None:
        return JSONResponse({"error": "Ticket not found"}, status_code=404)
    return JSONResponse(data)


# save_file in storage_service writes CWD-relative to "uploads/". Point the
# read side at the same directory so serve and save always agree, regardless
# of which uvicorn --app-dir the deployment used.
_UPLOADS_ROOT = (Path.cwd() / "uploads").resolve()


def _parse_range(range_header: str, total: int):
    """Parse a single-range 'bytes=start-end' header against a known total size.

    Returns (start, end) inclusive, or None if the header is absent/unsatisfiable
    so the caller can fall back to a full 200 (absent) or emit a 416 (bad range).
    Only the first range of a multi-range request is honoured — enough for media
    seeking, which never sends multi-range."""
    if not range_header or not range_header.startswith("bytes="):
        return None
    spec = range_header[len("bytes="):].split(",")[0].strip()
    start_s, _, end_s = spec.partition("-")
    try:
        if start_s == "":
            # Suffix range: last N bytes.
            length = int(end_s)
            if length <= 0:
                return False
            start = max(0, total - length)
            end = total - 1
        else:
            start = int(start_s)
            end = int(end_s) if end_s else total - 1
    except ValueError:
        return False
    end = min(end, total - 1)
    if start > end or start >= total:
        return False
    return start, end


@router.get("/api/files/{file_path:path}")
async def serve_upload(
    file_path: str,
    request: Request,
    user: str = Depends(require_auth),
):
    """Serve uploaded files — requires dashboard auth. Prevents public access.

    Supports HTTP Range requests so audio/video is seekable and browsers can
    discover the true duration of header-less WebM/Opus clips (recorded by the
    citizen-intake MediaRecorder). Without Range support such clips report an
    Infinity duration and the player shows a bogus "0:01".

    Handles both storage backends transparently:
      - MinIO configured  → head for size, fetch the requested byte range.
      - No FILE_STORAGE_ENDPOINT → serve from local uploads/ via FileResponse,
        which handles Range/Accept-Ranges/206 natively.
    """
    return await serve_stored_file(file_path, request)


async def serve_stored_file(file_path: str, request: Request) -> Response:
    """Shared, auth-agnostic file streamer for the /dashboard and /department
    `/api/files` routes — each caller enforces its own auth before delegating.

    - MinIO: size / range / full fetch, each offloaded to a worker thread
      (boto3 is blocking); hard browser caching with an ETag 304 short-circuit.
    - Local disk: traversal-safe FileResponse (native Range / ETag / 304).
    """
    import asyncio
    import hashlib
    import mimetypes
    from src.services.storage_service import (
        get_file_bytes, get_file_size, get_file_range_bytes,
    )
    from pathlib import PurePosixPath

    filename = PurePosixPath(file_path).name or "file"
    mime, _ = mimetypes.guess_type(filename)
    media_type = mime or "application/octet-stream"
    disposition = f'inline; filename="{filename}"'
    range_header = request.headers.get("range")

    endpoint = getattr(settings, "FILE_STORAGE_ENDPOINT", None)
    if endpoint:
        # MinIO: the key is the incoming path as-is. Storage helpers strip a
        # leading "uploads/" defensively if callers still pass one.
        # boto3 is blocking — run every storage call in a worker thread so it
        # never stalls the async event loop (one slow fetch used to freeze the
        # whole portal).
        total = await asyncio.to_thread(get_file_size, file_path)
        if total is None:
            return JSONResponse({"error": "Not found"}, status_code=404)

        # Attachments have unique, immutable filenames (token_hex), so the
        # browser can cache them hard and skip the re-fetch that made repeat
        # views + audio seeks slow. `private` keeps them out of shared/CDN
        # caches — they're auth-gated citizen PII. A stable ETag lets a repeat
        # request 304 without ever touching MinIO.
        etag = '"%s"' % hashlib.md5(("%s:%d" % (file_path, total)).encode()).hexdigest()
        cache_headers = {
            "Cache-Control": "private, max-age=31536000, immutable",
            "ETag": etag,
        }
        if request.headers.get("if-none-match") == etag:
            return Response(status_code=304, headers=cache_headers)

        base_headers = {
            "Content-Disposition": disposition, "Accept-Ranges": "bytes", **cache_headers,
        }
        parsed = _parse_range(range_header, total) if range_header else None
        if parsed is False:
            return Response(
                status_code=416,
                headers={**base_headers, "Content-Range": f"bytes */{total}"},
            )
        if parsed:
            start, end = parsed
            data = await asyncio.to_thread(get_file_range_bytes, file_path, start, end)
            if data is None:
                return JSONResponse({"error": "Not found"}, status_code=404)
            return Response(
                content=data,
                status_code=206,
                media_type=media_type,
                headers={
                    **base_headers,
                    "Content-Range": f"bytes {start}-{end}/{total}",
                    "Content-Length": str(end - start + 1),
                },
            )
        data = await asyncio.to_thread(get_file_bytes, file_path)
        if data is None:
            return JSONResponse({"error": "Not found"}, status_code=404)
        return Response(
            content=data,
            media_type=media_type,
            headers={**base_headers, "Content-Length": str(total)},
        )

    # Local disk: keep the traversal-safe path resolution. FileResponse handles
    # Range requests, Accept-Ranges and 206 partial responses on its own.
    try:
        full_path = (_UPLOADS_ROOT / file_path).resolve()
        full_path.relative_to(_UPLOADS_ROOT.resolve())
    except Exception:
        return JSONResponse({"error": "Not found"}, status_code=404)

    if not full_path.exists() or not full_path.is_file():
        return JSONResponse({"error": "Not found"}, status_code=404)

    return FileResponse(
        path=str(full_path),
        media_type=media_type,
        headers={
            "Content-Disposition": disposition,
            # FileResponse already sends ETag/Last-Modified and handles
            # If-None-Match / Range / 304 itself; just make it cacheable.
            "Cache-Control": "private, max-age=31536000, immutable",
        },
    )
