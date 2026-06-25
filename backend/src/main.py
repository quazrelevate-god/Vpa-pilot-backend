"""
Main FastAPI application entry point.
Configures middleware, CORS, and routes for the citizen scheduler API.
"""
import sys
import asyncio
from pathlib import Path
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from src.core.config import settings
from src.api.v1 import qr, form, appointments, dashboard, scheduling, display, scan_petition

# Import all ORM models so SQLAlchemy can resolve cross-model relationships
# (e.g. Appointment → GrievanceSummaryRecord) before the mapper is configured.
import src.models.grievance_summary_record  # noqa: F401
import src.models.scheduling_models  # noqa: F401

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


app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Configure appropriately for production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


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


@app.get("/health", tags=["Health Check"])
async def health_check():
    """Health check endpoint for load balancers and monitoring."""
    return {
        "status": "healthy",
        "app_name": settings.APP_NAME,
        "version": settings.APP_VERSION
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "src.main:app",
        host="0.0.0.0",
        port=8000,
        reload=settings.DEBUG
    )
