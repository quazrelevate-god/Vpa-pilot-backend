"""
FastAPI routes for QR code generation and verification.
Implements RESTful endpoints with proper HTTP status codes and error handling.
"""
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import RedirectResponse
from fastapi.templating import Jinja2Templates
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Dict, Any

from src.core.database import get_db
from src.core.config import settings
from src.core.utils import generate_device_fingerprint
from src.services.qr_service import qr_service

# Templates dir: backend/templates/
_TEMPLATES_DIR = Path(__file__).resolve().parent.parent.parent.parent / "templates"
templates = Jinja2Templates(directory=str(_TEMPLATES_DIR))


router = APIRouter(
    prefix="/api/v1/qr",
    tags=["QR Code Management"]
)


@router.get("/display", include_in_schema=False)
async def display_qr(
    request: Request,
    venue_id: str = Query(
        default="main_office",
        description="Venue identifier shown on the display screen",
        min_length=1,
        max_length=100,
    ),
    db: AsyncSession = Depends(get_db),
):
    """
    Venue display screen — renders qr_display.jinja2 with an initial QR code.
    The page JS auto-rotates the QR before expiry.
    """
    qr_data = await qr_service.generate_rotating_qr(venue_id, db)
    base_url = settings.SERVER_BASE_URL.rstrip("/")
    qr_url = base_url + qr_data["verification_url"]

    return templates.TemplateResponse(
        "qr_display.jinja2",
        {
            "request": request,
            "venue_id": venue_id,
            "qr_url": qr_url,
            "expiry_seconds": qr_data["qr_expiry_seconds"],
        },
    )


@router.get(
    "/generate",
    response_model=Dict[str, Any],
    summary="Generate QR Code",
    description="Generate a cryptographically signed QR code for venue access control"
)
async def generate_qr_code(
    venue_id: str = Query(
        ...,
        description="Unique identifier for the venue/location",
        min_length=1,
        max_length=100,
        example="venue_123"
    ),
    db: AsyncSession = Depends(get_db)
) -> Dict[str, Any]:
    """
    Generate a rotating QR code with cryptographic signature.
    
    Process Flow:
        1. Validate venue_id parameter
        2. Call QR service to generate signed token
        3. Insert QR log record in database transaction
        4. Return QR data payload for frontend display
    
    Args:
        venue_id: Unique venue identifier (1-100 characters)
        db: Injected database session from dependency
    
    Returns:
        JSON response containing:
            - signature: Cryptographically signed token string
            - verification_url: Relative URL path for QR verification
            - expires_at: ISO 8601 timestamp for expiration
            - venue_id: Echo of input venue identifier
            - qr_expiry_seconds: TTL in seconds
    
    Raises:
        HTTPException 400: Invalid venue_id format
        HTTPException 500: Database transaction failure or signature collision
    
    Example Response:
        {
            "signature": "venue_123.XYZ123.abc456",
            "verification_url": "/api/v1/qr/verify?signature=venue_123.XYZ123.abc456",
            "expires_at": "2024-01-15T10:30:00",
            "venue_id": "venue_123",
            "qr_expiry_seconds": 300
        }
    
    Transaction State:
        - Auto-committed by get_db() dependency on success
        - Auto-rolled back by get_db() dependency on exception
    """
    try:
        qr_data = await qr_service.generate_rotating_qr(venue_id, db)
        return qr_data
    
    except ValueError as e:
        raise HTTPException(
            status_code=400,
            detail=f"QR generation failed: {str(e)}"
        )
    
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Internal server error during QR generation: {str(e)}"
        )


@router.get(
    "/verify",
    response_class=RedirectResponse,
    summary="Verify QR Code and Create Session",
    description="Verify QR signature, create gatekeeper session, and redirect to form"
)
async def verify_qr_code(
    request: Request,
    signature: str = Query(
        ...,
        description="Cryptographically signed token from QR code",
        min_length=1,
        example="venue_123.XYZ123.abc456"
    ),
    db: AsyncSession = Depends(get_db)
) -> RedirectResponse:
    """
    Verify QR code signature and issue session token with HTTP redirect.
    
    Process Flow:
        1. Extract device fingerprint from request headers (server-side)
        2. Extract and validate signature parameter
        3. Cryptographically verify signature with itsdangerous
        4. Check database for QR log existence and expiration
        5. Prevent replay attacks via session deduplication
        6. Create new gatekeeper session in database transaction
        7. Issue HTTP 307 redirect to frontend form with session token
    
    Args:
        request: FastAPI Request object (for extracting headers/client info)
        signature: Signed token string from QR code scan
        db: Injected database session from dependency
    
    Returns:
        HTTP 307 Temporary Redirect to:
            {FRONTEND_FORM_BASE_URL}?token={session_uuid}
    
    Raises:
        HTTPException 400: Invalid/expired signature or replay attempt
        HTTPException 404: QR code not found in database
        HTTPException 500: Database transaction failure
    
    Security Considerations:
        - Device fingerprint generated server-side from request metadata
        - Uses SELECT FOR UPDATE to prevent race conditions
        - Validates both cryptographic and database expiration
        - Enforces single-use session per device fingerprint
        - HTTP 307 preserves GET method for safe redirects
    
    Transaction State:
        - Atomic: QR verification and session creation in single transaction
        - Isolation: Row-level locks prevent concurrent verification
        - Auto-committed by get_db() dependency on success
    """
    from urllib.parse import urlencode

    try:
        device_fingerprint = generate_device_fingerprint(request)

        session_data = await qr_service.verify_qr_and_create_session(
            signature_string=signature,
            device_fingerprint=device_fingerprint,
            db=db,
        )

        session_token = session_data["session_token"]
        redirect_url = f"{settings.FRONTEND_FORM_BASE_URL}?token={session_token}"
        return RedirectResponse(url=redirect_url, status_code=307)

    except ValueError as e:
        msg = str(e)
        error_type = "qr_expired" if "expired" in msg.lower() else "unknown"
        return RedirectResponse(
            url="/form/error?" + urlencode({"type": error_type, "message": msg}),
            status_code=302,
        )

    except Exception as e:
        return RedirectResponse(
            url="/form/error?" + urlencode({"type": "unknown", "message": str(e)}),
            status_code=302,
        )
