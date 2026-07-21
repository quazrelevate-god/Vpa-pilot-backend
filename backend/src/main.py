"""
Main FastAPI application entry point.
Configures middleware, CORS, and routes for the citizen scheduler API.
"""
import sys
import asyncio
import logging
from pathlib import Path
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from starlette.datastructures import MutableHeaders

from src.core.config import settings
from src.core.logging_config import setup_logging, init_sentry

setup_logging()
init_sentry()

from src.api.v1 import qr, form, appointments, dashboard, scheduling, display, scan_petition, referral, ai_uploads, events

# Import all ORM models so SQLAlchemy can resolve cross-model relationships
# (e.g. Appointment → GrievanceSummaryRecord) before the mapper is configured.
import src.models.grievance_summary_record  # noqa: F401
import src.models.scheduling_models  # noqa: F401
import src.models.referral_models  # noqa: F401
import src.models.ai_upload_models  # noqa: F401
import src.models.ticket_models  # noqa: F401
import src.models.login_models  # noqa: F401  — ticket.assigned_to → login.id
import src.models.activity_models  # noqa: F401  — unified audit log
import src.models.department_account  # noqa: F401  — ticket routing/accept
import src.models.event_models  # noqa: F401  — /events invitation calendar

# Fix for Windows: psycopg requires SelectorEventLoop
if sys.platform == 'win32':
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())


app = FastAPI(
    title=settings.APP_NAME,
    version=settings.APP_VERSION,
    description="High-traffic citizen scheduler with QR-based access control",
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    openapi_url="/api/openapi.json"
)


# ── Rate limiting (shared limiter, registered so @limiter.limit actually fires) ──
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware
from src.core.rate_limit import limiter


async def _rate_limit_exceeded_handler(request, exc):
    # Return JSON (not slowapi's default plain text) with a `detail` the citizen
    # form can parse — otherwise the form fails to read the body and shows a
    # misleading "network error" instead of a clear "too many attempts".
    from fastapi.responses import JSONResponse
    return JSONResponse(
        status_code=429,
        content={"detail": "Too many attempts. Please wait a minute and try again."},
    )


app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(SlowAPIMiddleware)


# CORS — locked to configured origins (the PA portal is same-origin in prod;
# this is mainly for the split dev setup). Never "*" with credentials.
_cors_origins = [o.strip() for o in settings.CORS_ORIGINS.split(",") if o.strip()]
if settings.SERVER_BASE_URL and settings.SERVER_BASE_URL not in _cors_origins:
    _cors_origins.append(settings.SERVER_BASE_URL)
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class _SecurityHeadersMiddleware:
    """Pure-ASGI security-header injector.

    Deliberately NOT a BaseHTTPMiddleware (`@app.middleware("http")`): that
    wrapper runs the endpoint as a child task and raises
    `RuntimeError: No response returned.` on any cancellation race — e.g. a
    citizen's walk-in submit where the crowd PWA aborts (or re-fires) the
    upload — turning a benign client disconnect into a 500 traceback and, in
    the racy case, dropping a response the endpoint actually produced. A pure
    ASGI middleware passes send/receive straight through, so the real response
    reaches the client and disconnects propagate cleanly.
    """
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        async def send_wrapper(message):
            if message["type"] == "http.response.start":
                headers = MutableHeaders(scope=message)
                headers["X-Content-Type-Options"] = "nosniff"
                headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
                if settings.COOKIE_SECURE:  # only meaningful over HTTPS
                    headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
            await send(message)

        await self.app(scope, receive, send_wrapper)


app.add_middleware(_SecurityHeadersMiddleware)


_ASSETS_DIR = Path(__file__).resolve().parent.parent / "assets"
app.mount("/static/assets", StaticFiles(directory=str(_ASSETS_DIR)), name="assets")

_UPLOADS_DIR = Path(__file__).resolve().parent.parent / "uploads"
_UPLOADS_DIR.mkdir(exist_ok=True)
# NOTE: uploads/ is NOT mounted as public static — served via authenticated
# /dashboard/api/files/{path} endpoint to prevent unauthenticated access.

app.include_router(qr.router)
app.include_router(form.router)
app.include_router(appointments.router)
app.include_router(dashboard.router)
app.include_router(scheduling.router)
app.include_router(display.router)
app.include_router(scan_petition.router)
app.include_router(referral.router)
app.include_router(referral.page_router)
app.include_router(ai_uploads.router)
app.include_router(events.router)

from src.api.v1 import ticketing  # noqa: E402
app.include_router(ticketing.dept_router)
app.include_router(ticketing.pa_router)

from src.api.v1 import admin as admin_v1  # noqa: E402
app.include_router(admin_v1.public_router)   # /api/v1/me + /api/v1/features (auth only)
app.include_router(admin_v1.router)          # /api/v1/admin/* (super_admin + feature flag)


@app.on_event("startup")
async def _load_admin_lookup():
    """Pre-warm the admin lookup cache so every service can resolve FK ids."""
    from src.core.database import AsyncSessionLocal
    from src.services.v2_helpers import v2
    try:
        async with AsyncSessionLocal() as db:
            await v2.init(db)
    except Exception as e:
        logging.getLogger("startup").warning("admin lookup load skipped: %s", e)


@app.on_event("startup")
async def _recover_ai_uploads():
    """After a restart, re-queue any AI uploads left mid-processing and resume."""
    try:
        from src.services.ai_upload_service import ai_upload_service
        await ai_upload_service.recover_stale(max_minutes=0)
        await ai_upload_service._ensure_worker()   # drain anything still QUEUED
    except Exception as e:  # never block startup
        logging.getLogger("ai_upload").warning("startup recovery skipped: %s", e)


@app.on_event("startup")
async def _recover_invitation_events():
    """After a restart, re-spawn extraction for invitation photos left mid-processing."""
    try:
        from src.services import event_service
        await event_service.recover_stale()
    except Exception as e:  # never block startup
        logging.getLogger("events").warning("startup recovery skipped: %s", e)


@app.on_event("startup")
async def _start_auto_reschedule_loop():
    """
    Housekeeping: flip past-day SCHEDULED rows to RESCHEDULED so the Scheduled
    tab isn't full of yesterday's forgotten meetings. Runs once at startup, then
    every day at 00:05 local time. Failures never crash the process.
    """
    from src.core.database import AsyncSessionLocal
    from src.services.dashboard_service import auto_reschedule_stale_scheduled
    from datetime import datetime, timedelta
    import asyncio as _asyncio
    log = logging.getLogger("auto_reschedule")

    async def _sweep_once():
        try:
            async with AsyncSessionLocal() as db:
                n = await auto_reschedule_stale_scheduled(db)
            if n:
                log.info("auto_reschedule: flipped %d SCHEDULED → RESCHEDULED", n)
        except Exception as e:
            log.warning("auto_reschedule sweep failed: %s", e)

    async def _loop():
        # Immediate sweep on boot — a crash right after midnight would otherwise
        # leave yesterday's rows sitting on the Scheduled tab until tomorrow.
        await _sweep_once()
        while True:
            now = datetime.now()
            # Next fire: 00:05 tomorrow.
            target = (now + timedelta(days=1)).replace(hour=0, minute=5, second=0, microsecond=0)
            await _asyncio.sleep(max(60, (target - now).total_seconds()))
            await _sweep_once()

    _asyncio.create_task(_loop())


@app.on_event("startup")
async def _start_courtesy_transcript_loop():
    """
    Durable retry for courtesy-audio transcription (invitation/greetings).

    On a Sarvam/Gemini outage the initial fire-and-forget attempt at submission
    time leaves the row marked transcript_status='PENDING'. This loop drains
    those rows every 5 minutes so a temporary outage doesn't strand the
    transcript on the floor.
    """
    from src.services.appointment_service import appointment_service
    import asyncio as _asyncio
    log = logging.getLogger("courtesy_stt")

    async def _drain_once():
        try:
            n = await appointment_service.drain_pending_transcripts(limit=25)
            if n:
                log.info("courtesy_stt drain: transcribed %d PENDING rows", n)
        except Exception as e:
            log.warning("courtesy_stt drain failed: %s", e)

    async def _loop():
        # Immediate sweep on boot so a crash mid-transcription doesn't wait
        # 5 minutes to recover.
        await _drain_once()
        while True:
            await _asyncio.sleep(5 * 60)
            await _drain_once()

    _asyncio.create_task(_loop())


@app.get("/health", tags=["Health Check"])
async def health_check():
    """Liveness — process is up. Cheap, no dependencies."""
    return {"status": "healthy", "app_name": settings.APP_NAME, "version": settings.APP_VERSION}


@app.get("/health/ready", tags=["Health Check"])
async def readiness_check():
    """Readiness — verifies DB connectivity. Use this for the load balancer probe."""
    from fastapi.responses import JSONResponse
    from sqlalchemy import text
    from src.core.database import AsyncSessionLocal
    try:
        async with AsyncSessionLocal() as db:
            await db.execute(text("SELECT 1"))
        return {"status": "ready", "db": "ok"}
    except Exception as e:
        return JSONResponse({"status": "not_ready", "db": "error", "detail": str(e)[:200]}, status_code=503)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "src.main:app",
        host="0.0.0.0",
        port=8000,
        reload=settings.DEBUG
    )
