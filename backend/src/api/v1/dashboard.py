"""
Staff dashboard routes — login, chart stats, appointments table, status updates.
All page routes require cookie-based auth. API routes (/api/*) also require auth.
"""
from fastapi import APIRouter, Body, Depends, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, RedirectResponse, Response
from fastapi.templating import Jinja2Templates
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pathlib import Path

from src.core.database import get_db
from src.core.config import check_env_credentials, settings
from src.core.dash_auth import create_session_cookie, require_auth
from src.core.rate_limit import limiter
from src.core.rbac import get_current_login
from src.models.login_models import Login, ROLE_DEPT_OFFICER
from src.services import dashboard_service

router = APIRouter(prefix="/dashboard", tags=["Dashboard"])


async def _no_dept_officer(current: Login = Depends(get_current_login)) -> None:
    """Deny dept_officer sessions. Attached to every /api/appointments/* route
    so a compromised or misused dept_officer credential can't read or mutate
    the PA's appointments queue.

    Domain rationale: appointments are the PA's workspace; dept_officers work
    from Tickets (their department-scoped surface). The frontend already
    redirects dept_officers away from /appointments to /tickets on login
    (see the api_login handler), so this is closing a gap between UI intent
    and API enforcement — every other role (super_admin, pa, petition_reviewer,
    auditor) continues to pass through untouched.
    """
    if current.role == ROLE_DEPT_OFFICER:
        raise HTTPException(
            status_code=403,
            detail="Dept officers cannot access appointments. Use Tickets instead.",
        )

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


@router.get("/api/analytics/tickets")
async def api_analytics_tickets(
    date_from: str = None, date_to: str = None, category: str = None, priority: str = None,
    ministry: str = None, channel: str = None, status: str = None, district: str = None,
    db: AsyncSession = Depends(get_db), user: str = Depends(require_auth),
):
    """Ticket-only KPIs for the PA team's Ticket Insights room: status mix, SLA
    health, priority split, per-department performance and a raised-vs-resolved
    trend. No district breakdown — that stays on the petition overview."""
    from src.services.analytics_service import analytics_service
    f = _analytics_filters(date_from, date_to, category, priority, ministry, channel, status, district)
    return JSONResponse(await analytics_service.get_ticket_dashboard(db, f))


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


@router.get("/api/petitions/inbox")
async def api_petitions_inbox(
    request: Request,
    page: int = 1,
    page_size: int = 25,
    status: str = "",
    q: str = "",
    category: str = "",
    priority: str = "",
    source: str = "",
    batch_id: str = "",
    from_date: str = "",
    to_date: str = "",
    sort: str = "submitted_desc",
    db: AsyncSession = Depends(get_db),
    user: str = Depends(require_auth),
):
    """Unified AI-review inbox — one server-paginated feed combining
    `ai_uploads` and citizen-submitted petitions. Replaces the frontend's old
    ai-uploads + fetchAppointments(pageSize=2000) merge, whose 500-row upload
    cap made the "showing N of M" total drift from the true tab count."""
    from src.services.petition_inbox_service import petition_inbox_service
    data = await petition_inbox_service.list_inbox(
        db,
        page=page, page_size=page_size,
        status=status or None, q=q or None, category=category or None,
        priority=priority or None, source=source or None,
        batch_id=batch_id or None, from_date=from_date or None, to_date=to_date or None,
        sort=sort or "submitted_desc",
    )
    return JSONResponse(data)


@router.get("/api/petitions/inbox/facets")
async def api_petitions_inbox_facets(
    request: Request,
    status: str = "",
    q: str = "",
    category: str = "",
    priority: str = "",
    source: str = "",
    batch_id: str = "",
    from_date: str = "",
    to_date: str = "",
    db: AsyncSession = Depends(get_db),
    user: str = Depends(require_auth),
):
    """Tab counts + category distribution across BOTH tables. Replaces the
    frontend's old bulk `fetchAppointments(pageSize=2000)` + client-side
    aggregation, which silently truncated past 2000 rows and mixed status
    scopes so the chart total (141) disagreed with the tab count (133).

    `status` is asymmetric on purpose: `counts_by_status` ignores it (so each
    tab shows what it WOULD have if clicked), but `distribution` applies it
    (so the chart reflects the CURRENT tab and its total equals the tab's
    count)."""
    from src.services.petition_inbox_service import petition_inbox_service
    data = await petition_inbox_service.facets(
        db,
        status=status or None,
        q=q or None, category=category or None,
        priority=priority or None, source=source or None,
        batch_id=batch_id or None, from_date=from_date or None, to_date=to_date or None,
    )
    return JSONResponse(data)


@router.get("/api/analytics/export")
async def api_analytics_export(
    date_from: str = None, date_to: str = None, category: str = None, priority: str = None,
    ministry: str = None, channel: str = None, status: str = None, district: str = None,
    db: AsyncSession = Depends(get_db), user: str = Depends(require_auth),
):
    import csv, io
    from datetime import datetime, timezone, timedelta
    from src.services.analytics_service import analytics_service
    f = _analytics_filters(date_from, date_to, category, priority, ministry, channel, status, district)
    # Same filters + service as the list view — the export mirrors exactly what
    # the on-screen table would show for the active filter set (just un-paginated).
    data = await analytics_service.get_petitions(db, f, page=1, page_size=5000)

    IST = timezone(timedelta(hours=5, minutes=30))

    def _title(s: str | None) -> str:
        return (s or "").replace("_", " ").title()

    def _ist(iso: str | None) -> str:
        # created_at arrives as a UTC ISO string; render it in IST for the office.
        if not iso:
            return ""
        try:
            return datetime.fromisoformat(iso).astimezone(IST).strftime("%Y-%m-%d %H:%M")
        except (ValueError, TypeError):
            return iso

    buf = io.StringIO()
    w = csv.writer(buf)
    # Columns mirror the list view (Citizen · Ask · Category) plus the identifying
    # and triage fields. "Channel" is dropped — it's a removed v2 column that only
    # ever exported "—". csv.writer quotes the free-text Citizen Ask automatically.
    w.writerow(["Token", "Name", "Mobile", "Category", "Priority", "Status",
                "Citizen Ask", "Meeting", "Created (IST)"])
    for r in data["items"]:
        w.writerow([
            r["token"], r["name"], r["mobile"], r["category_label"],
            _title(r["priority"]), _title(r["status"]),
            r.get("citizen_ask") or "",
            "Yes" if r["schedule_meeting"] else "No",
            _ist(r["created_at"]),
        ])
    return Response(
        content=buf.getvalue(), media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=petitions.csv"},
    )


@router.get("/api/venues")
async def api_venues(
    db: AsyncSession = Depends(get_db),
    user: str = Depends(require_auth),
):
    """Venue registry for filter dropdowns on the dashboard pages.

    Same shape the super_admin /api/v1/admin/venues returns, minus the
    super_admin gate — a regular PA / petition_reviewer / auditor needs the
    list to render the "Filter by venue" dropdown on the appointments page.
    Returns ALL rows (active + inactive) so historical scans from a
    since-deactivated venue remain filterable; the client tags the inactive
    ones in the label. Sorted built-in first, then alphabetically by
    display_en — the same order the admin endpoint uses.
    """
    from src.models.registry_models import VenueRegistry
    rows = (await db.execute(
        select(VenueRegistry).order_by(
            VenueRegistry.is_builtin.desc(), VenueRegistry.display_en,
        )
    )).scalars().all()
    payload = [
        {
            "key":        r.key,
            "display_en": r.display_en,
            "display_ta": r.display_ta,
            "is_active":  bool(r.is_active),
        }
        for r in rows
    ]
    # Venue registry changes rarely (super_admin action); every appointments-
    # page mount was re-scanning venue_registry because the client sent
    # cache: 'no-store'. private + short max-age + stale-while-revalidate
    # keeps the picker snappy without ever showing >5min-stale data, and
    # `private` blocks any shared cache from serving it cross-user.
    return JSONResponse(
        payload,
        headers={"Cache-Control": "private, max-age=300, stale-while-revalidate=60"},
    )


@router.get("/api/appointments/counts", dependencies=[Depends(_no_dept_officer)])
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
    venue: str = "",
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
        venue=venue or None,
        kind=kind or None,
    )
    return JSONResponse(data)


@router.get("/api/appointments/{appointment_id}", dependencies=[Depends(_no_dept_officer)])
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
    if check_env_credentials(username, password, settings.DASHBOARD_USERNAME, settings.DASHBOARD_PASSWORD):
        from src.core.rbac import ensure_env_admin_seeded
        await ensure_env_admin_seeded(db, username)
        response = RedirectResponse(url="/appointments", status_code=302)
        create_session_cookie(response, username)
        return response

    # Non-env users: check the `login` table.
    from src.models.login_models import Login, verify_password, needs_rehash, hash_password
    row = (await db.execute(
        select(Login).where(Login.login_name == username, Login.is_active == True)  # noqa: E712
    )).scalar_one_or_none()
    # Always call verify_password (even with None) so unknown-username and
    # wrong-password branches take the same time — see the dummy-hash path
    # in src/core/passwords.py:verify_password.
    if verify_password(password, row.password if row else None) and row:
        if needs_rehash(row.password):        # migrate legacy hash → PBKDF2
            row.password = hash_password(password)
            await db.commit()
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
    from src.models.login_models import (
        Login, ROLE_MINISTER, verify_password as verify_staff, needs_rehash, hash_password,
    )
    staff_ok = False
    staff_role = "pa"
    if check_env_credentials(uname, password, settings.DASHBOARD_USERNAME, settings.DASHBOARD_PASSWORD):
        from src.core.rbac import ensure_env_admin_seeded
        await ensure_env_admin_seeded(db, uname)
        staff_ok = True
        staff_role = "super_admin"
    else:
        row = (await db.execute(
            select(Login).where(Login.login_name == uname, Login.is_active == True)  # noqa: E712
        )).scalar_one_or_none()
        # Always call verify_staff (even with None) so the "user not found"
        # branch takes the same time as "wrong password".
        if verify_staff(password, row.password if row else None) and row:
            # Isolation: a Minister account (role=minister) must NEVER receive a
            # dash_session. It's a read-only credential for the /minister PWA and
            # has no business on the staff portal. Refuse it here even with the
            # right password, and point the caller at the right app.
            if row.role == ROLE_MINISTER:
                return JSONResponse(
                    {"error": "This is a Minister account — please sign in from the Minister app."},
                    status_code=403,
                )
            if needs_rehash(row.password):        # migrate legacy hash → PBKDF2
                row.password = hash_password(password)
                await db.commit()
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
    from src.models.department_account import (
        DepartmentAccount, verify_password as verify_dept,
        needs_rehash as dept_needs_rehash, hash_password as dept_hash,
    )
    from src.core.dept_auth import create_dept_session_cookie
    acct = (await db.execute(
        select(DepartmentAccount).where(DepartmentAccount.username == uname)
    )).scalar_one_or_none()
    if verify_dept(password, acct.password_hash if acct else None) and acct:
        if dept_needs_rehash(acct.password_hash):   # migrate legacy hash → PBKDF2
            acct.password_hash = dept_hash(password)
            await db.commit()
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


@router.get("/api/appointments", dependencies=[Depends(_no_dept_officer)])
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
    venue: str = "",
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
        venue=venue or None,
        kind=kind or None,
        sort=sort or None,
        page=page,
        page_size=min(page_size, 5000),  # cap at 5000 for export safety
    )
    return JSONResponse(data)


@router.patch("/api/appointments/{appointment_id}/details", dependencies=[Depends(_no_dept_officer)])
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


@router.patch("/api/appointments/{appointment_id}/status", dependencies=[Depends(_no_dept_officer)])
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


@router.post("/api/appointments/{appointment_id}/approve", dependencies=[Depends(_no_dept_officer)])
async def api_approve_petition(
    appointment_id: int,
    db: AsyncSession = Depends(get_db),
    user: str = Depends(require_auth),
):
    """Approve a QR/staff petition from the unified review drawer — creates the
    ticket (School → open) or forwards it out (non-school ministry)."""
    try:
        result = await dashboard_service.approve_petition(db, appointment_id, actor=user)
    except ValueError as e:
        # Business rule refusal (e.g. audio-only petition) — the drawer renders
        # `error`, so surface it as a readable 400 instead of a bare 500.
        await db.rollback()
        return JSONResponse({"error": str(e)}, status_code=400)
    return JSONResponse(result)


# ── Signature-petition merging (v054) ────────────────────────────────────────
@router.get("/api/appointments/{appointment_id}/similar", dependencies=[Depends(_no_dept_officer)])
async def api_find_similar_petitions(
    appointment_id: int,
    db: AsyncSession = Depends(get_db),
    user: str = Depends(require_auth),
):
    """Read-only: list candidate petitions that look like duplicates of this
    one — used by the review drawer's Find similar button. Same-status only
    (AWAITING_REVIEW), blocked by category + district, scored by normalized-
    ask trigram similarity."""
    from src.services.petition_merge_service import find_similar
    return JSONResponse(await find_similar(db, appointment_id))


@router.post("/api/appointments/{appointment_id}/approve-with-signatories", dependencies=[Depends(_no_dept_officer)])
async def api_approve_with_signatories(
    appointment_id: int,
    payload: dict = Body(...),
    db: AsyncSession = Depends(get_db),
    user: str = Depends(require_auth),
):
    """Approve a petition together with signatories that a reviewer curated
    in the drawer. One ticket is created — the primary's — and every signatory
    is flipped to REVIEWED and attached to the group as a co-signatory (no
    ticket of their own). Signatories that fail validation are skipped."""
    from src.services.petition_merge_service import approve_with_signatories
    raw_ids = payload.get("signatory_ids") or []
    if not isinstance(raw_ids, list):
        return JSONResponse({"error": "signatory_ids must be a list."}, status_code=400)
    try:
        sids = [int(x) for x in raw_ids]
    except (TypeError, ValueError):
        return JSONResponse({"error": "signatory_ids must be integers."}, status_code=400)
    try:
        result = await approve_with_signatories(db, appointment_id, sids, actor=user)
        return JSONResponse(result)
    except HTTPException as e:  # noqa: F821 (imported below)
        await db.rollback()
        return JSONResponse({"error": e.detail}, status_code=e.status_code)
    except ValueError as e:
        # e.g. audio-only petition refusal — surfaced from approve_petition
        await db.rollback()
        return JSONResponse({"error": str(e)}, status_code=400)


@router.post("/api/tickets/{ticket_id}/split-signatory", dependencies=[Depends(_no_dept_officer)])
async def api_split_signatory(
    ticket_id: int,
    payload: dict = Body(...),
    db: AsyncSession = Depends(get_db),
    user: str = Depends(require_auth),
):
    """Split one signatory off a merged ticket — that petition goes back to
    AWAITING_REVIEW as its own standalone petition. Only allowed while the
    ticket is still OPEN or TRIAGED (once forwarded, the department has already
    received the roster and pulling one out afterward would desync).

    Gated with _no_dept_officer: splitting a signatory drops that petition
    back to AWAITING_REVIEW cross-department, so a dept_officer scoped to
    a single department can't be trusted to make that call."""
    from src.services.petition_merge_service import split_signatory
    try:
        appt_id = int(payload.get("appointment_id"))
    except (TypeError, ValueError):
        return JSONResponse({"error": "appointment_id is required."}, status_code=400)
    try:
        result = await split_signatory(db, ticket_id, appt_id, actor=user)
        return JSONResponse(result)
    except HTTPException as e:  # noqa: F821
        await db.rollback()
        return JSONResponse({"error": e.detail}, status_code=e.status_code)


@router.get("/api/tickets/{ticket_id}/signatories", dependencies=[Depends(_no_dept_officer)])
async def api_ticket_signatories(
    ticket_id: int,
    db: AsyncSession = Depends(get_db),
    user: str = Depends(require_auth),
):
    """Return the ticket's roster: the primary + every co-signatory, with
    name (decrypted), masked mobile, source, token, and per-row is_primary.

    Gated with _no_dept_officer: the roster contains cross-department PII
    (co-signatory names / mobiles from any petition merged into this ticket),
    beyond a dept_officer's need-to-know."""
    from src.services.petition_merge_service import roster_for_ticket
    return JSONResponse(await roster_for_ticket(db, ticket_id))


@router.post("/api/appointments/{appointment_id}/dismiss", dependencies=[Depends(_no_dept_officer)])
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


@router.post("/api/appointments/{appointment_id}/restore", dependencies=[Depends(_no_dept_officer)])
async def api_restore_petition(
    appointment_id: int,
    db: AsyncSession = Depends(get_db),
    user: str = Depends(require_auth),
):
    """Undo a dismissal — send a DISMISSED petition back to AWAITING_REVIEW."""
    try:
        result = await dashboard_service.restore_petition(db, appointment_id, actor=user)
        return JSONResponse(result)
    except ValueError as e:
        await db.rollback()
        return JSONResponse({"error": str(e)}, status_code=400)


@router.post("/api/appointments/{appointment_id}/attachment", dependencies=[Depends(_no_dept_officer)])
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
            actor=user,
        )
    except ValueError as e:
        await db.rollback()
        return JSONResponse({"error": str(e)}, status_code=400)
    if result is None:
        return JSONResponse({"error": "Not found"}, status_code=404)
    return JSONResponse(result)


@router.post("/api/appointments/{appointment_id}/comment", dependencies=[Depends(_no_dept_officer)])
async def api_add_appointment_comment(
    appointment_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: str = Depends(require_auth),
):
    """PA-authored note on a petition/appointment. Logs one Activity row
    (event_type=comment_added) so the timeline shows who left the note and
    when. Called alongside attachment uploads by the "Save" step of the new
    upload dialog."""
    body = await request.json()
    try:
        result = await dashboard_service.add_appointment_comment(
            db, appointment_id, actor=user, text=body.get("text", ""),
        )
    except ValueError as e:
        await db.rollback()
        return JSONResponse({"error": str(e)}, status_code=400)
    if result is None:
        return JSONResponse({"error": "Not found"}, status_code=404)
    return JSONResponse(result)


@router.get("/api/appointments/{appointment_id}/activity", dependencies=[Depends(_no_dept_officer)])
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


def _effective_department(current: Login, requested: str) -> str | None:
    """A dept officer is always pinned to their own scope — their request
    parameter is ignored. Full-access roles (PA / auditor / super_admin) can
    pass a `department` query param to filter by the routed school
    department; empty means no filter."""
    officer = _officer_dept(current)
    if officer is not None:
        return officer
    return requested or None


@router.get("/api/tickets")
async def api_tickets_list(
    request: Request,
    status: str = "",
    priority: str = "",
    ministry: str = "",
    category: str = "",
    assigned_to: str = "",
    forwarded_to_dept: str = "",
    department: str = "",
    source: str = "",
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
        department=_effective_department(current, department),
        source=source or None,
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
    department: str = "",
    source: str = "",
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
        department=_effective_department(current, department),
        source=source or None,
        search=search or None,
        date_from=date_from or None,
        date_to=date_to or None,
    )
    return JSONResponse(data)


@router.get("/api/tickets/breach_count")
async def api_ticket_breach_count(
    search: str = "",
    date_from: str = "",
    date_to: str = "",
    department: str = "",
    priority: str = "",
    ministry: str = "",
    category: str = "",
    assigned_to: str = "",
    forwarded_to_dept: str = "",
    source: str = "",
    status: str = "",
    db: AsyncSession = Depends(get_db),
    current: Login = Depends(get_current_login),
):
    """Server-side SLA-breach count for the tickets header badge.

    Filter-aware: honours the same axes as list_tickets so the badge count
    always matches the current view (WYSIWYG). Chip greys out on 0 in the
    frontend. Must be declared BEFORE /{ticket_id} or FastAPI fails to
    parse "breach_count" as int.
    """
    count = await ticket_service.get_ticket_breach_count(
        db,
        search=search or None,
        date_from=date_from or None,
        date_to=date_to or None,
        department=_effective_department(current, department),
        priority=priority or None,
        ministry=ministry or None,
        category=category or None,
        assigned_to=assigned_to or None,
        forwarded_to_dept=forwarded_to_dept or None,
        source=source or None,
        status=status or None,
    )
    return JSONResponse({"breached": count})


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
            actor=current.login_name, ticket_id=ticket_id,
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


@router.post("/api/tickets/{ticket_id}/revert")
async def api_ticket_revert(
    ticket_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current: Login = Depends(get_current_login),
):
    """Revert an OPEN ticket back to Petition Review.

    Only allowed while the ticket is still in `open`. Anything past that
    already has a department's work invested. The revert is soft — the
    ticket row and its audit trail are preserved — and the linked
    appointment moves back to AWAITING_REVIEW so the PA can dismiss it,
    correct it, or re-approve it from the review queue.

    On re-approve, the same ticket row is reused (see
    dashboard_service.update_appointment_status) so ticket numbers never
    duplicate across revert/re-approve cycles.
    """
    if not await _ticket_in_scope(db, ticket_id, current):
        return JSONResponse({"error": "Ticket not found"}, status_code=404)
    body = await request.json() if await request.body() else {}
    reason = (body or {}).get("reason", "")
    try:
        data = await ticket_service.revert_ticket(
            db, ticket_id, actor=current.login_name, reason=reason,
        )
    except ValueError as e:
        await db.rollback()
        return JSONResponse({"error": str(e)}, status_code=400)
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
    # Empty object: any byte range is technically "unsatisfiable", but 416 on
    # a zero-length file breaks browsers that were probing for size (they
    # abandon the request and log the error). Return None so the caller
    # sends a plain 200 with an empty body — RFC 7233 permits either, and
    # 200-empty is the friendlier of the two.
    if total <= 0:
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


async def _authorize_file_access(
    file_path: str,
    current: Login,
    db: AsyncSession,
) -> None:
    """Row-level authorization for the /dashboard/api/files/* endpoint.

    Before: any authenticated staff could fetch any storage key they could
    name — a classic IDOR. The MinIO branch of serve_stored_file passed the
    incoming path straight to boto3 without ever asking whether the caller
    was allowed to see the referenced object, so a leaked URL (screenshot,
    log, browser history) worked for every staff account forever.

    Now: the key's namespace prefix picks an owning table, one indexed
    lookup confirms the key is referenced by a real row, and a role/dept
    check gates access to that row. Unknown prefixes fail-closed so a new
    upload namespace can't sneak into "wide open" territory by omission —
    add a mapping branch below when a new namespace is introduced.

    Raises HTTPException(403) on any failure. Callers do NOT distinguish
    "orphan key" from "not your row" in the error — the file server must
    not reveal which storage keys exist to a caller who isn't authorized
    for them.
    """
    from sqlalchemy import func, text
    from src.models.appointment_models import AppointmentAttachment
    from src.models.ai_upload_models import AiUpload
    from src.models.ticket_models import TicketAttachment
    from src.models.login_models import ROLE_SUPER_ADMIN

    _deny = HTTPException(status_code=403, detail="Not authorized to access this file.")
    role = current.role

    # ── super_admin bypass ────────────────────────────────────────────────────
    # super_admin is the "see everything" role by contract, so the file server
    # trusts them for any storage key — including orphaned rows (dangling
    # files from cleanup runs) and legacy/unknown prefixes that predate the
    # mapping below. Without this, the per-prefix existence checks and the
    # fail-closed fallback would 403 super_admin on files they are supposed
    # to see, breaking the invariant the role is defined by.
    if role == ROLE_SUPER_ADMIN:
        return

    # ── attachments/… — citizen submission uploads on an Appointment ──────────
    if file_path.startswith("attachments/"):
        appt_id = (await db.execute(
            select(AppointmentAttachment.appointment_id)
            .where(AppointmentAttachment.storage_url == file_path)
            .limit(1)
        )).scalar_one_or_none()
        if appt_id is None:
            raise _deny
        # Full-access roles: no further scoping — they can see any appointment.
        # dept_officer is the exception: allowed only if a Ticket for this
        # appointment is routed to their department, matching the /api/tickets
        # scope rule already enforced by _officer_dept + _ticket_in_scope.
        if role != ROLE_DEPT_OFFICER:
            return
        dept = _officer_dept(current)
        allowed = await db.scalar(
            select(func.count(_Ticket.id))
            .where(_Ticket.appointment_id == appt_id)
            .where(_Ticket.department == dept)
        )
        if not allowed:
            raise _deny
        return

    # ── ticket_attachments/… — files uploaded to a Ticket (comments, etc.) ────
    if file_path.startswith("ticket_attachments/"):
        ticket_id = (await db.execute(
            select(TicketAttachment.ticket_id)
            .where(TicketAttachment.storage_url == file_path)
            .limit(1)
        )).scalar_one_or_none()
        if ticket_id is None:
            raise _deny
        if role != ROLE_DEPT_OFFICER:
            return
        t = await db.get(_Ticket, ticket_id)
        if t is None or t.department != _officer_dept(current):
            raise _deny
        return

    # ── ai_uploads/… — AI-scan batch uploads (petition-review surface) ────────
    if file_path.startswith("ai_uploads/"):
        # dept_officer never works from the AI-scan queue — mirrors the H1
        # pattern that denies them on /api/appointments/* wholesale.
        if role == ROLE_DEPT_OFFICER:
            raise _deny
        exists = await db.scalar(
            select(func.count(AiUpload.id))
            .where(AiUpload.storage_url == file_path)
        )
        if not exists:
            raise _deny
        return

    # ── proposals/… — proposal-review documents (super_admin surface) ─────────
    #    Keeps the file server in lockstep with the review page's role gate.
    if file_path.startswith("proposals/"):
        if role != ROLE_SUPER_ADMIN:
            raise _deny
        exists = await db.scalar(text("""
            SELECT 1 FROM proposal_submissions
             WHERE documents IS NOT NULL
               AND EXISTS (
                 SELECT 1 FROM jsonb_array_elements(documents) doc
                  WHERE doc->>'storage_url' = :key
               )
             LIMIT 1
        """).bindparams(key=file_path))
        if not exists:
            raise _deny
        return

    # ── associations/… — association-review documents (super_admin) ───────────
    if file_path.startswith("associations/"):
        if role != ROLE_SUPER_ADMIN:
            raise _deny
        exists = await db.scalar(text("""
            SELECT 1 FROM association_submissions
             WHERE documents IS NOT NULL
               AND EXISTS (
                 SELECT 1 FROM jsonb_array_elements(documents) doc
                  WHERE doc->>'storage_url' = :key
               )
             LIMIT 1
        """).bindparams(key=file_path))
        if not exists:
            raise _deny
        return

    # ── Unknown namespace — fail-closed. New upload paths must be added to
    #    the mapping above; the file server refuses everything else so a new
    #    intake path can never accidentally ship wide open.
    raise _deny


@router.get("/api/files/{file_path:path}")
async def serve_upload(
    file_path: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: str = Depends(require_auth),
    current: Login = Depends(get_current_login),
):
    """Serve uploaded files — requires dashboard auth AND row-level
    authorization on the specific storage key (see _authorize_file_access).

    Prevents the IDOR class of bug the H2 report flagged: even with a
    leaked URL, only staff with legitimate access to the owning row
    (appointment, ticket, ai_upload, proposal, association) can fetch
    the bytes. Fail-closed on unknown namespaces.

    Supports HTTP Range requests so audio/video is seekable and browsers can
    discover the true duration of header-less WebM/Opus clips (recorded by the
    citizen-intake MediaRecorder). Without Range support such clips report an
    Infinity duration and the player shows a bogus "0:01".

    Handles both storage backends transparently:
      - MinIO configured  → head for size, fetch the requested byte range.
      - No FILE_STORAGE_ENDPOINT → serve from local uploads/ via FileResponse,
        which handles Range/Accept-Ranges/206 natively.
    """
    await _authorize_file_access(file_path, current, db)
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
        get_file_bytes, get_file_size, get_file_range_bytes, get_file_content_type,
        get_file_metadata,
    )
    from pathlib import PurePosixPath
    from urllib.parse import quote

    filename = PurePosixPath(file_path).name or "file"
    mime, _ = mimetypes.guess_type(filename)
    typed_by_fallback = False
    if mime is None:
        # No usable extension on the key. Older uploads whose filename stem was
        # entirely non-ASCII (Tamil) were sanitised down to a bare "pdf"/"png",
        # so guessing fails and octet-stream would make the browser download the
        # file instead of previewing it. The object's stored ContentType is
        # authoritative — only consulted here, so well-named files cost nothing.
        mime = await asyncio.to_thread(get_file_content_type, file_path)
        typed_by_fallback = mime is not None
    media_type = mime or "application/octet-stream"
    # The stored MIME (from get_file_content_type, ultimately the client's
    # upload-time content_type) becomes the Content-Type header. A value with
    # non-latin-1 chars would 500 on header serialization, and one containing
    # CR/LF is a header-injection vector. Fall back to octet-stream if it isn't a
    # clean, header-safe token.
    if ("\r" in media_type or "\n" in media_type
            or not media_type.isascii() or not media_type.strip()):
        media_type = "application/octet-stream"
    # HTTP header values must be latin-1-encodable. A non-ASCII filename (e.g. a
    # Tamil "மனு.pdf" key) raises UnicodeEncodeError when Starlette serializes the
    # response headers → HTTP 500. RFC 5987: send an ASCII-safe `filename=`
    # fallback plus a UTF-8 `filename*` that modern browsers prefer and render
    # correctly. Keeps the header pure-ASCII so encoding can never throw.
    ascii_name = filename.encode("ascii", "ignore").decode().strip() or "file"
    disposition = "inline; filename=\"%s\"; filename*=UTF-8''%s" % (ascii_name, quote(filename))

    # Cache policy. Well-named files are immutable (unique token_hex names), so
    # they keep the year-long hard cache. Files typed via the fallback must NOT
    # be `immutable`: browsers that already cached them as octet-stream would
    # never revalidate, so the corrected Content-Type could never reach them and
    # the PDF would keep downloading. Give those a short, revalidating cache.
    cache_control = (
        "private, max-age=300, must-revalidate" if typed_by_fallback
        else "private, max-age=31536000, immutable"
    )
    range_header = request.headers.get("range")

    endpoint = getattr(settings, "FILE_STORAGE_ENDPOINT", None)
    if endpoint:
        # MinIO: the key is the incoming path as-is. Storage helpers strip a
        # leading "uploads/" defensively if callers still pass one.
        # boto3 is blocking — run every storage call in a worker thread so it
        # never stalls the async event loop (one slow fetch used to freeze the
        # whole portal).
        # ONE head_object via get_file_metadata gets size + last_modified in
        # a single round trip; the ETag then binds to (file_path + size +
        # last_modified + media_type) so a same-key overwrite invalidates the
        # cache instead of a stale 304. Previously only (size) was in the
        # hash — a same-size overwrite silently served the old bytes.
        meta = await asyncio.to_thread(get_file_metadata, file_path)
        if meta is None:
            return JSONResponse({"error": "Not found"}, status_code=404)
        total = int(meta["size"])
        last_modified = meta.get("last_modified") or ""

        # Attachments have unique, immutable filenames (token_hex), so the
        # browser can cache them hard and skip the re-fetch that made repeat
        # views + audio seeks slow. `private` keeps them out of shared/CDN
        # caches — they're auth-gated citizen PII. A stable ETag lets a repeat
        # request 304 without ever touching MinIO.
        # media_type is part of the ETag: the same bytes served under a corrected
        # Content-Type must invalidate, or a cached octet-stream copy would 304
        # forever and keep downloading instead of previewing.
        etag = '"%s"' % hashlib.md5(
            ("%s:%d:%s:%s" % (file_path, total, last_modified, media_type)).encode()
        ).hexdigest()
        cache_headers = {
            "Cache-Control": cache_control,
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
            "Cache-Control": cache_control,
        },
    )
