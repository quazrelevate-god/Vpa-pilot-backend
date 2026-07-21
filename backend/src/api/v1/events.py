"""
Events (invitation calendar) API — shared team calendar + JSON auth.

The UI is a Next.js PWA served by the PA portal (route group /events). This
module only exposes /events/api/* : session auth (JSON, never a redirect),
calendar range queries, photographed-invitation upload (extraction runs in
the background — see event_service), edit/delete/retry, and authenticated
image serving. Everything is scoped to the events_session cookie.
"""
from datetime import date

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


# ── Upload ──────────────────────────────────────────────────────────────────────

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
