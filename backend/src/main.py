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

from src.core.config import settings
from src.core.logging_config import setup_logging, init_sentry

setup_logging()
init_sentry()

from src.api.v1 import qr, form, appointments, dashboard, scheduling, display, scan_petition, referral, ai_uploads

# Import all ORM models so SQLAlchemy can resolve cross-model relationships
# (e.g. Appointment → GrievanceSummaryRecord) before the mapper is configured.
import src.models.grievance_summary_record  # noqa: F401
import src.models.scheduling_models  # noqa: F401
import src.models.referral_models  # noqa: F401
import src.models.ai_upload_models  # noqa: F401

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


@app.middleware("http")
async def _security_headers(request, call_next):
    resp = await call_next(request)
    resp.headers["X-Content-Type-Options"] = "nosniff"
    # Authenticated attachment endpoint is embedded as <iframe> in the PA portal,
    # which runs on a different origin. Skip the frame-block header there.
    # if not request.url.path.startswith("/dashboard/api/files/"):
    #     resp.headers["X-Frame-Options"] = "SAMEORIGIN"
    resp.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    if settings.COOKIE_SECURE:  # only meaningful over HTTPS
        resp.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    return resp


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


@app.on_event("startup")
async def _recover_ai_uploads():
    """After a restart, re-queue any AI uploads left mid-processing and resume."""
    try:
        from src.services.ai_upload_service import ai_upload_service
        await ai_upload_service.recover_stale(max_minutes=0)
        await ai_upload_service._ensure_worker()   # drain anything still QUEUED
    except Exception as e:  # never block startup
        logging.getLogger("ai_upload").warning("startup recovery skipped: %s", e)


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
