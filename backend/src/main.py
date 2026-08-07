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

from src.core.config import settings, assert_production_ready
from src.core.logging_config import setup_logging, init_sentry
from src.core.request_context import request_id_var, new_request_id, incoming_request_id

setup_logging()
init_sentry()

from src.api.v1 import qr, form, appointments, dashboard, scheduling, display, scan_petition, referral, ai_uploads, events, proposal, proposal_review, proposal_documents, association_review, minister

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
import src.models.proposal_models  # noqa: F401  — /proposal intake submissions
import src.models.association_models  # noqa: F401  — association/union submissions
import src.models.petition_group  # noqa: F401  — signature-petition merging (v054)

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

        # Correlate the request across its log lines. Honour an inbound
        # X-Request-ID (e.g. stamped by nginx) or mint one; expose it on the
        # response and in every log record for this request (see request_context).
        rid = incoming_request_id(scope) or new_request_id()
        request_id_var.set(rid)

        async def send_wrapper(message):
            if message["type"] == "http.response.start":
                headers = MutableHeaders(scope=message)
                headers["X-Content-Type-Options"] = "nosniff"
                headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
                headers["X-Request-ID"] = rid
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
app.include_router(minister.router)   # /minister/api/* — read-only Minister PWA (minister_session)
app.include_router(proposal.router)   # /api/v1/proposal/otp/* + /submit — public proposal form
app.include_router(proposal_review.router)   # /api/v1/admin/proposals/* — super_admin review
app.include_router(proposal_documents.router)   # /api/v1/admin/proposals/{id}/documents/* — manifest + thumbs
app.include_router(association_review.router)   # /api/v1/admin/associations/* — super_admin review

from src.api.v1 import ticketing  # noqa: E402
app.include_router(ticketing.dept_router)
app.include_router(ticketing.pa_router)

from src.api.v1 import admin as admin_v1  # noqa: E402
app.include_router(admin_v1.public_router)   # /api/v1/me + /api/v1/features (auth only)
app.include_router(admin_v1.router)          # /api/v1/admin/* (super_admin + feature flag)


@app.on_event("startup")
async def _production_preflight():
    """Fail fast in prod if required secrets are unset/default. This lives at
    startup (not in Settings construction) so `alembic upgrade` and one-off
    scripts — which only need DATABASE_URL — aren't blocked by the app's runtime
    secrets. See config.assert_production_ready."""
    assert_production_ready(settings)


@app.on_event("startup")
async def _verify_crypto():
    """Prove the PII encryption key works before serving any traffic. Unlike the
    other startup hooks this deliberately does NOT swallow errors — a broken or
    missing key must stop the boot, not degrade silently (see P0-4)."""
    from src.core.crypto import verify_crypto
    verify_crypto()
    logging.getLogger("startup").info("crypto self-test passed")


@app.on_event("startup")
async def _ensure_storage_bucket():
    """Ensure the MinIO bucket exists once at boot (T-2) instead of on every
    write. Logs loudly on failure but does not block startup — read paths that
    don't touch storage should still serve while MinIO recovers."""
    import asyncio as _asyncio
    from src.services import storage_service
    try:
        await _asyncio.to_thread(storage_service.ensure_bucket)
    except Exception as e:  # noqa: BLE001
        logging.getLogger("startup").error("storage bucket check failed at boot: %s", repr(e))


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
async def _recover_proposals():
    """After a restart, re-queue any proposal extractions left mid-processing and resume."""
    try:
        from src.services.proposal_service import proposal_service
        await proposal_service.recover_stale(max_minutes=0)
        await proposal_service._ensure_worker()   # drain anything still QUEUED
    except Exception as e:  # never block startup
        logging.getLogger("proposal").warning("startup recovery skipped: %s", e)


# Kept as a module-level singleton so shutdown can await/cancel it cleanly.
_reminder_task = None


@app.on_event("startup")
async def _start_event_reminder_scheduler():
    """Background loop that fires web-push reminders for upcoming events.

    Silent no-op when VAPID keys aren't configured (see push_service
    `vapid_configured`), so dev environments without keys don't warn.
    """
    global _reminder_task
    try:
        from src.services import notification_scheduler
        _reminder_task = await notification_scheduler.start()
    except Exception as e:
        logging.getLogger("events").warning("reminder scheduler startup skipped: %s", e)


@app.on_event("shutdown")
async def _stop_event_reminder_scheduler():
    """Signal the reminder loop to exit + await it briefly."""
    global _reminder_task
    if _reminder_task is None:
        return
    try:
        stop = getattr(_reminder_task, "_stop_event", None)
        if stop is not None:
            stop.set()
        # Give the loop up to a tick to finish its current pass.
        import asyncio
        try:
            await asyncio.wait_for(_reminder_task, timeout=5)
        except asyncio.TimeoutError:
            _reminder_task.cancel()
    except Exception:
        logging.getLogger("events").exception("reminder scheduler shutdown noisy")
    finally:
        _reminder_task = None


# Module-level handles + stop signals so shutdown can drain these loops cleanly
# instead of letting SIGTERM cancel them mid-sleep (which leaks the open DB
# session and spews CancelledError). Mirrors _reminder_task above.
_auto_reschedule_task = None
_auto_reschedule_stop = None
_courtesy_stt_task = None
_courtesy_stt_stop = None


async def _stoppable_shutdown(task, stop, log_name):
    """Signal a loop to exit, await it briefly, cancel if it overruns."""
    import asyncio as _asyncio
    if stop is not None:
        stop.set()
    if task is not None:
        try:
            await _asyncio.wait_for(task, timeout=5)
        except _asyncio.TimeoutError:
            task.cancel()
        except Exception:
            logging.getLogger(log_name).exception("%s shutdown noisy", log_name)


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
    global _auto_reschedule_task, _auto_reschedule_stop
    _auto_reschedule_stop = _asyncio.Event()
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
        while not _auto_reschedule_stop.is_set():
            now = datetime.now()
            # Next fire: 00:05 tomorrow. Sleep on the stop event so shutdown
            # wakes us immediately instead of after the (up to 24h) delay.
            target = (now + timedelta(days=1)).replace(hour=0, minute=5, second=0, microsecond=0)
            delay = max(60, (target - now).total_seconds())
            try:
                await _asyncio.wait_for(_auto_reschedule_stop.wait(), timeout=delay)
                break  # stop signalled
            except _asyncio.TimeoutError:
                await _sweep_once()

    _auto_reschedule_task = _asyncio.create_task(_loop())


@app.on_event("shutdown")
async def _stop_auto_reschedule_loop():
    global _auto_reschedule_task
    await _stoppable_shutdown(_auto_reschedule_task, _auto_reschedule_stop, "auto_reschedule")
    _auto_reschedule_task = None


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
    global _courtesy_stt_task, _courtesy_stt_stop
    _courtesy_stt_stop = _asyncio.Event()
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
        while not _courtesy_stt_stop.is_set():
            try:
                await _asyncio.wait_for(_courtesy_stt_stop.wait(), timeout=5 * 60)
                break  # stop signalled
            except _asyncio.TimeoutError:
                await _drain_once()

    _courtesy_stt_task = _asyncio.create_task(_loop())


@app.on_event("shutdown")
async def _stop_courtesy_transcript_loop():
    global _courtesy_stt_task
    await _stoppable_shutdown(_courtesy_stt_task, _courtesy_stt_stop, "courtesy_stt")
    _courtesy_stt_task = None


@app.get("/health", tags=["Health Check"])
async def health_check():
    """Liveness — process is up. Cheap, no dependencies."""
    return {"status": "healthy", "app_name": settings.APP_NAME, "version": settings.APP_VERSION}


@app.get("/health/ready", tags=["Health Check"])
async def readiness_check():
    """Readiness — verifies DB connectivity. Use this for the load balancer probe.

    Deliberately DB-only: readiness gates whether the LB routes traffic here, and
    a Gemini/MinIO blip should NOT pull every pod (most endpoints don't need
    them). Dependency visibility lives in /health/deps below, which is
    informational and does not gate the LB.
    """
    from fastapi.responses import JSONResponse
    from sqlalchemy import text
    from src.core.database import AsyncSessionLocal
    try:
        async with AsyncSessionLocal() as db:
            await db.execute(text("SELECT 1"))
        return {"status": "ready", "db": "ok"}
    except Exception as e:
        return JSONResponse({"status": "not_ready", "db": "error", "detail": str(e)[:200]}, status_code=503)


@app.get("/health/deps", tags=["Health Check"])
async def dependencies_check():
    """Informational dependency snapshot for ops dashboards/alerts (P2-4).

    Reports DB + storage reachability and whether the external API keys are
    configured. NON-gating — always returns 200 so it can't accidentally be
    wired to the LB and take the service down on a third-party outage. Alert on
    the JSON body, not the status code. Gemini/Sarvam/APM are reported as
    configured-or-not rather than live-called (a probe must stay cheap).
    """
    import asyncio as _asyncio
    from sqlalchemy import text
    from src.core.database import AsyncSessionLocal
    from src.services import storage_service

    deps: dict = {}

    try:
        async with AsyncSessionLocal() as db:
            await db.execute(text("SELECT 1"))
        deps["db"] = {"ok": True}
    except Exception as e:
        deps["db"] = {"ok": False, "detail": str(e)[:160]}

    try:
        ok, detail = await _asyncio.wait_for(_asyncio.to_thread(storage_service.healthcheck), timeout=3)
        deps["storage"] = {"ok": ok, "detail": detail}
    except Exception as e:
        deps["storage"] = {"ok": False, "detail": f"timeout/error: {str(e)[:120]}"}

    # Configured-or-not (cheap). Not a liveness call to the vendor.
    deps["gemini"] = {"configured": bool(settings.GEMINI_API_KEY)}
    deps["sarvam"] = {"configured": bool(settings.SARVAM_API_KEY)}
    deps["apm_sms"] = {"configured": bool(settings.APM_SMS_API_KEY)}

    overall = all(deps[k].get("ok", True) for k in ("db", "storage"))
    return {"status": "ok" if overall else "degraded", "deps": deps}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "src.main:app",
        host="0.0.0.0",
        port=8000,
        reload=settings.DEBUG
    )
