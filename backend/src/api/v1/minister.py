"""
Minister PWA API — read-only overview aggregates for the Minister's PA.

Everything here is isolated behind the `minister_session` cookie (see
core/minister_auth). Each data route is a GET that re-serves an EXISTING
analytics service function — there are NO write routes, so a Minister
credential is read-only by construction and can never mutate anything.

Consumed by the Next.js PWA at route group /minister. JSON auth (401, never a
302) so the app's fetch() gets JSON rather than login HTML.
"""
from datetime import date, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, Form, HTTPException, Request
from fastapi.responses import JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.database import get_db
from src.core.minister_auth import (
    clear_minister_cookie,
    create_minister_cookie,
    get_minister_login,
    require_minister,
    verify_minister_credentials,
)
from src.core.rate_limit import limiter
from src.models.login_models import Login
from src.services import dashboard_service, event_service, ticket_service
from src.services.analytics_service import AnalyticsService, Filters, analytics_service
from src.services.association_analytics import get_association_analytics
from src.services.proposal_analytics import get_proposal_analytics

router = APIRouter(prefix="/minister", tags=["Minister PWA (read-only)"])

_LABEL = "Minister's Desk"
_MAX_RANGE_DAYS = 62
_analytics = AnalyticsService()  # stateless

# Staff file URLs are same-origin `/api/files/...`, authorised by the dash
# session. The Minister session can't reach those, so every detail payload has
# its file URLs re-pointed at the minister passthrough (which streams the same
# bytes, gated by minister_session instead).
_STAFF_FILES = "/api/files/"
_MIN_FILES = "/minister/api/files/"


def _rewrite_files(obj):
    """Deep-rewrite every `/api/files/...` string to `/minister/api/files/...`
    so uploaded documents/attachments load under the minister session. Walks
    dicts / lists / strings; leaves everything else untouched."""
    if isinstance(obj, str):
        return obj.replace(_STAFF_FILES, _MIN_FILES) if _STAFF_FILES in obj else obj
    if isinstance(obj, dict):
        return {k: _rewrite_files(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_rewrite_files(v) for v in obj]
    return obj


# ── Auth (JSON — consumed by the Next.js /minister app) ─────────────────────────

@router.post("/api/login")
@limiter.limit("5/minute")
async def minister_login(
    request: Request,
    username: str = Form(...),
    password: str = Form(...),
    db: AsyncSession = Depends(get_db),
):
    """Validate the Minister credential (env bootstrap or a role=minister row),
    set the minister_session cookie. 200 or 401 — one generic message either
    way so a caller can't probe for account existence."""
    login = await verify_minister_credentials(db, username, password)
    if login is None:
        return JSONResponse({"error": "Invalid username or password."}, status_code=401)
    response = JSONResponse({"ok": True, "label": _LABEL, "user": login.login_name})
    create_minister_cookie(response, login.id)
    return response


@router.post("/api/logout")
async def minister_logout():
    response = JSONResponse({"ok": True})
    clear_minister_cookie(response)
    return response


@router.get("/api/session")
async def minister_session(login: Optional[Login] = Depends(get_minister_login)):
    """Return {user, label} for an authenticated minister session, else 401."""
    if login is None:
        return JSONResponse({"error": "Not authenticated"}, status_code=401)
    return JSONResponse({"user": login.login_name, "label": _LABEL})


# ── Read-only overview aggregates ───────────────────────────────────────────────
# Each endpoint re-serves an existing service function, unfiltered (all-time),
# so the Minister sees the same numbers the super-admin dashboards compute.

def _petition_filters(
    date_from: Optional[str], date_to: Optional[str], category: Optional[str],
    priority: Optional[str], ministry: Optional[str], district: Optional[str],
    channel: Optional[str],
) -> Filters:
    """Build the same Filters the staff overview uses, so the Minister Home can
    cross-filter server-side (click a chart → refetch with the dim set)."""
    return Filters(
        date_from=date_from, date_to=date_to, category=category,
        priority=priority, ministry=ministry, district=district, channel=channel,
    )


@router.get("/api/overview/dashboard")
async def overview_dashboard(
    date_from: Optional[str] = None, date_to: Optional[str] = None,
    category: Optional[str] = None, priority: Optional[str] = None,
    ministry: Optional[str] = None, district: Optional[str] = None,
    channel: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    login: Login = Depends(require_minister),
):
    """Office-wide petition analytics (received / citizens / urgent / meetings /
    resolution + category / ministry / priority / trend). Accepts the same
    cross-filter query params as the staff overview."""
    f = _petition_filters(date_from, date_to, category, priority, ministry, district, channel)
    return await _analytics.get_analytics(db, f)


@router.get("/api/overview/operations")
async def overview_operations(
    date_from: Optional[str] = None, date_to: Optional[str] = None,
    category: Optional[str] = None, priority: Optional[str] = None,
    ministry: Optional[str] = None, district: Optional[str] = None,
    channel: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    login: Login = Depends(require_minister),
):
    """Department + district splits (companion to the dashboard overview)."""
    f = _petition_filters(date_from, date_to, category, priority, ministry, district, channel)
    return await _analytics.get_operations(db, f)


@router.get("/api/overview/tickets")
async def overview_tickets(
    db: AsyncSession = Depends(get_db),
    login: Login = Depends(require_minister),
):
    """Ticket KPIs + status/priority/department/trend."""
    return await _analytics.get_ticket_dashboard(db, Filters())


@router.get("/api/overview/proposals")
async def overview_proposals(
    db: AsyncSession = Depends(get_db),
    login: Login = Depends(require_minister),
):
    return await get_proposal_analytics(db)


@router.get("/api/overview/associations")
async def overview_associations(
    db: AsyncSession = Depends(get_db),
    login: Login = Depends(require_minister),
):
    return await get_association_analytics(db)


@router.get("/api/overview/events")
async def overview_events(
    db: AsyncSession = Depends(get_db),
    login: Login = Depends(require_minister),
):
    """Event KPIs (today / this-week / upcoming / attendance / by-type / volume
    + next-5 cards)."""
    return await event_service.overview_events(db)


@router.get("/api/events/timeline")
async def events_timeline(
    start: Optional[str] = None,
    end: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    login: Login = Depends(require_minister),
):
    """Approved events in [start, end], date-ordered. Defaults to today..+60d —
    the Minister's upcoming diary. Media URLs are re-pointed at the minister
    file passthrough so photos/audio load under the minister session."""
    today = date.today()
    try:
        s = date.fromisoformat(start) if start else today
        e = date.fromisoformat(end) if end else today + timedelta(days=60)
    except ValueError:
        raise HTTPException(400, "start / end must be YYYY-MM-DD")
    if e < s:
        raise HTTPException(400, "end must be on or after start")
    if (e - s).days > _MAX_RANGE_DAYS:
        e = s + timedelta(days=_MAX_RANGE_DAYS)

    items = await event_service.list_events(db, s, e)
    out = []
    for ev in items:
        d = event_service.serialize(ev)
        # serialize() points media at /events/api/files/* (events_session only).
        # Re-point to the minister passthrough so it loads under minister_session.
        for k in ("image_url", "audio_url"):
            if d.get(k):
                d[k] = d[k].replace("/events/api/files/", "/minister/api/files/", 1)
        out.append(d)
    return {"items": out}


# ── Read-only lists (feed the detail tables at the bottom of each screen) ──────
# These wrap the existing services / list endpoints verbatim — they're already
# paginated + return the same shapes the staff portal uses, so the Minister
# tables render identically.

@router.get("/api/list/petitions")
async def list_petitions(
    date_from: Optional[str] = None, date_to: Optional[str] = None,
    category: Optional[str] = None, priority: Optional[str] = None,
    ministry: Optional[str] = None, status: Optional[str] = None,
    district: Optional[str] = None,
    page: int = 1, page_size: int = 25, sort: str = "created_at", direction: str = "desc",
    db: AsyncSession = Depends(get_db),
    login: Login = Depends(require_minister),
):
    """Petition rows for the Home table — reuses analytics_service.get_petitions."""
    f = Filters(date_from=date_from, date_to=date_to, category=category,
                priority=priority, ministry=ministry, status=status, district=district)
    return await analytics_service.get_petitions(db, f, page, page_size, sort, direction)


@router.get("/api/list/proposals")
async def list_proposals(
    status: Optional[str] = None, q: Optional[str] = None,
    limit: int = 50, offset: int = 0,
    db: AsyncSession = Depends(get_db),
    login: Login = Depends(require_minister),
):
    """Delegate to the super-admin list_proposals — same row shape.

    NB: _lp is a FastAPI route handler; its unpassed params default to the
    `Query(...)` marker OBJECTS (not None) when it's called directly like
    this, so EVERY filter it defines must be passed explicitly as None or
    those Query objects leak into the filter logic (e.g. strptime(Query) →
    TypeError 500). Keep this in sync if list_proposals gains a param.
    """
    from src.api.v1.proposal_review import list_proposals as _lp
    return await _lp(
        status=status, q=q,
        category=None, recommendation=None,
        date_from=None, date_to=None, batch_id=None,
        limit=limit, offset=offset, db=db,
    )


@router.get("/api/list/associations")
async def list_associations(
    status: Optional[str] = None, q: Optional[str] = None,
    name: Optional[str] = None,
    limit: int = 50, offset: int = 0,
    db: AsyncSession = Depends(get_db),
    login: Login = Depends(require_minister),
):
    """Delegate to the super-admin list_associations — same row shape.

    NB: _la is a FastAPI route handler; its unpassed params default to the
    `Query(...)` marker OBJECTS (not None) when called directly, so EVERY
    filter it defines must be passed explicitly as None — otherwise those
    Query objects reach the filter logic (strptime(Query) → TypeError 500,
    the reported bug). Keep this in sync if list_associations gains a param.
    """
    from src.api.v1.association_review import list_associations as _la
    return await _la(
        status=status, q=q, name=name,
        category=None, urgency=None, district=None, ministry=None,
        recommendation=None, date_from=None, date_to=None, batch_id=None,
        limit=limit, offset=offset, db=db,
    )


@router.get("/api/list/tickets")
async def list_tickets(
    status: Optional[str] = None, priority: Optional[str] = None,
    ministry: Optional[str] = None, category: Optional[str] = None,
    department: Optional[str] = None,
    search: Optional[str] = None,
    date_from: Optional[str] = None, date_to: Optional[str] = None,
    page: int = 1, page_size: int = 25,
    db: AsyncSession = Depends(get_db),
    login: Login = Depends(require_minister),
):
    """Wrap ticket_service.list_tickets (filters + pagination). Accepts the
    cross-filter dims the Tickets screen clicks set (status / priority /
    department / category)."""
    return await ticket_service.list_tickets(
        db,
        status=status, priority=priority, ministry=ministry, category=category,
        department=department, search=search, date_from=date_from, date_to=date_to,
        page=page, page_size=page_size,
    )


# ── Read-only detail (feed the row-click drawers on each screen) ────────────────
# Each re-serves the same detail the staff drawer uses, then re-points every
# `/api/files/...` URL at the minister passthrough so uploads load read-only.

@router.get("/api/detail/proposals/{proposal_id}")
async def detail_proposal(
    proposal_id: int,
    db: AsyncSession = Depends(get_db),
    login: Login = Depends(require_minister),
):
    """Full proposal detail + AI brief — same shape the ProposalDrawer renders."""
    from src.api.v1.proposal_review import get_proposal as _gp
    detail = await _gp(proposal_id=proposal_id, db=db)
    return _rewrite_files(detail.model_dump())


@router.get("/api/detail/associations/{association_id}")
async def detail_association(
    association_id: int,
    db: AsyncSession = Depends(get_db),
    login: Login = Depends(require_minister),
):
    """Full association detail + brief — same shape the AssociationDrawer renders."""
    from src.api.v1.association_review import get_association as _ga
    detail = await _ga(assoc_id=association_id, db=db)
    payload = detail.model_dump() if hasattr(detail, "model_dump") else detail
    return _rewrite_files(payload)


@router.get("/api/detail/appointments/{appointment_id}")
async def detail_appointment(
    appointment_id: int,
    db: AsyncSession = Depends(get_db),
    login: Login = Depends(require_minister),
):
    """Full petition/appointment detail (summary + citizen uploads) — same shape
    the staff AppointmentDetailDrawer renders, read-only."""
    row = await dashboard_service.get_appointment_detail(db, appointment_id)
    if row is None:
        return JSONResponse({"error": "Not found"}, status_code=404)
    return _rewrite_files(row)


@router.get("/api/detail/tickets/{ticket_id}")
async def detail_ticket(
    ticket_id: int,
    db: AsyncSession = Depends(get_db),
    login: Login = Depends(require_minister),
):
    """Full ticket detail (timeline + attachments) — same shape the staff
    TicketDetailDrawer renders, read-only."""
    data = await ticket_service.get_ticket(db, ticket_id)
    if data is None:
        return JSONResponse({"error": "Ticket not found"}, status_code=404)
    return _rewrite_files(data)


# ── Media passthrough (read-only, minister-scoped) ──────────────────────────────

@router.get("/api/files/{file_path:path}")
async def minister_serve_file(
    file_path: str,
    request: Request,
    login: Login = Depends(require_minister),
):
    """Serve a stored file (event photo/audio, or a petition / proposal /
    association upload) scoped by the minister session. The Minister app is a
    read-only mirror of the staff desk, so it may view the same documents the
    desk shows — the only guard is against path traversal. Delegates to the
    shared streamer for Range/ETag/caching."""
    normalized = file_path.replace("\\", "/").lstrip("/")
    if ".." in normalized or not normalized:
        raise HTTPException(404, "File not found")
    from src.api.v1.dashboard import serve_stored_file
    return await serve_stored_file(normalized, request)
