"""
FastAPI routes for citizen form submission.
Handles form display and data collection after QR verification.
"""
from pathlib import Path

from urllib.parse import urlencode

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.templating import Jinja2Templates
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from datetime import datetime

from src.core.database import get_db
from src.core.utils import generate_device_fingerprint
from src.core.config import settings
from src.models.qr_models import GatekeeperSession
from src.services.admin_lookup import admin

_TEMPLATES_DIR = Path(__file__).resolve().parent.parent.parent.parent / "templates"
templates = Jinja2Templates(directory=str(_TEMPLATES_DIR))


router = APIRouter(
    prefix="/form",
    tags=["Form Management"]
)


@router.get(
    "",
    response_class=HTMLResponse,
    summary="Display Citizen Form",
    description="Display form for citizen data collection after QR verification"
)
async def display_form(
    request: Request,
    token: str = Query(
        ...,
        description="Session token from QR verification",
        example="550e8400-e29b-41d4-a716-446655440000"
    ),
    db: AsyncSession = Depends(get_db)
) -> HTMLResponse:
    """
    Display citizen information form after successful QR verification.
    
    Process Flow:
        1. Generate device fingerprint from current request
        2. Validate session token exists in database
        3. Verify device fingerprint matches the one that created the session
        4. Check token hasn't expired
        5. Check token hasn't been used already
        6. Display HTML form for data collection
    
    Args:
        request: FastAPI Request object (for device fingerprint validation)
        token: UUID session token from gatekeeper_sessions table
        db: Injected database session from dependency
    
    Returns:
        HTMLResponse: Rendered HTML form page
    
    Raises:
        HTTPException 400: Invalid or expired token
        HTTPException 403: Token already used or device fingerprint mismatch
        HTTPException 404: Token not found
    
    Security:
        - Token must exist in gatekeeper_sessions table
        - Device fingerprint must match the one that verified the QR
        - Token must not be expired
        - Token must not be marked as used (is_used=False)
        - Prevents URL sharing across different browsers/devices
    """
    try:
        # Step 1: Generate device fingerprint from current request
        current_fingerprint = generate_device_fingerprint(request)
        
        # Step 2: Validate session token
        stmt = select(GatekeeperSession).where(
            GatekeeperSession.session_token == token
        )
        result = await db.execute(stmt)
        session = result.scalar_one_or_none()
        
        if not session:
            return RedirectResponse(
                url="/form/error?" + urlencode({"type": "session_not_found"}),
                status_code=302,
            )

        # Step 3: Verify device fingerprint matches
        if session.device_fingerprint != current_fingerprint:
            return RedirectResponse(
                url="/form/error?" + urlencode({"type": "device_mismatch"}),
                status_code=302,
            )

        # Step 4: Check if token has expired
        current_time = datetime.utcnow()
        if session.expires_at < current_time:
            return RedirectResponse(
                url="/form/error?" + urlencode({"type": "session_expired"}),
                status_code=302,
            )

        # Step 5: Check if token has already been used
        if session.is_used:
            return RedirectResponse(
                url="/form/error?" + urlencode({"type": "session_used"}),
                status_code=302,
            )
        
        # Categories from admin lookup cache — reflect any admin-table changes
        # without redeploying. Tamil labels stay in the template JS dictionary;
        # unknown keys fall back to the English name.
        if not admin.is_loaded:
            await admin.load(db)
        category_keys = admin.names_for("category")

        # Render HTML form from template
        response = templates.TemplateResponse(
            "form.jinja2",
            {
                "request": request,
                "session_token": token,
                "audio_min_seconds": settings.AUDIO_MIN_DURATION_SECONDS,
                "audio_max_seconds": settings.AUDIO_MAX_DURATION_SECONDS,
                "max_file_size_mb": settings.MAX_FILE_SIZE_MB,
                "allowed_file_extensions": settings.ALLOWED_FILE_EXTENSIONS,
                "category_keys": category_keys,
            },
        )
        # Prevent browser from caching the form page — so back-button
        # after submission triggers a fresh server request instead of
        # loading a stale cached page.
        response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
        return response

    
    except HTTPException:
        raise
    except Exception as e:
        return RedirectResponse(
            url="/form/error?" + urlencode({"type": "unknown"}),
            status_code=302,
        )


@router.get("/error", include_in_schema=False)
async def error_page(request: Request) -> HTMLResponse:
    return templates.TemplateResponse("error.jinja2", {"request": request})


@router.get("/success", include_in_schema=False)
async def success_page(request: Request) -> HTMLResponse:
    return templates.TemplateResponse("success.jinja2", {"request": request})
