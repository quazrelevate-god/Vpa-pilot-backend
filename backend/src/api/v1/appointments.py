"""
FastAPI routes for OTP verification and appointment submission.
Implements stateless identity gatekeeper with atomic submission pattern.
"""
import logging
from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Form, UploadFile, File, Request
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel, Field
from src.core.database import get_db
from src.core.validators import clean_mobile, clean_name
from src.services.appointment_service import appointment_service

# Shared rate limiter (registered on the app in main.py so the limits fire)
from src.core.rate_limit import limiter

logger = logging.getLogger(__name__)


router = APIRouter(
    prefix="/api/v1",
    tags=["Appointments & OTP"]
)


async def _record_invitation_event(
    files: Optional[List[UploadFile]], citizen_name: str, db: AsyncSession
) -> None:
    """Mirror a citizen INVITATION into the events module so the events-PWA
    reviewer sees it in "needs review".

    An invitation submission carries a photo/scan of the invitation card. We
    hand that image to event_service.create_event, which stores it, inserts an
    InvitationEvent as QUEUED with is_approved=False (→ lands in the reviewer's
    needs-review queue), and spawns Gemini extraction to pull title/venue/date.

    Best-effort by design: the appointment is already committed by the time we
    get here, so any failure here is logged and swallowed — it must never turn a
    successful citizen submission into an error.
    """
    try:
        image = None
        for f in (files or []):
            mime = (getattr(f, "content_type", "") or "").lower().split(";")[0].strip()
            if f.filename and mime.startswith("image/"):
                image = f
                break
        if image is None:
            # PDF-only or no attachment — the events extractor is image-based,
            # so there's nothing to create an event from. The appointment still
            # holds the original upload.
            logger.info("invitation: no image attachment to mirror into events")
            return

        try:
            await image.seek(0)  # process_atomic_submission already read the stream
        except Exception:
            pass
        data = await image.read()
        if not data:
            return

        from src.services import event_service
        event = await event_service.create_event(
            db=db,
            file_bytes=data,
            mime_type=image.content_type or "image/jpeg",
            note=(f"Citizen invitation — {citizen_name}".strip() or "Citizen invitation"),
            created_by="citizen-submit",
        )
        logger.info("invitation mirrored into events: event_id=%s", getattr(event, "id", None))
    except Exception as exc:  # noqa: BLE001 — never fail the citizen submission
        logger.warning("invitation → events mirror failed (submission unaffected): %r", exc)


# Request/Response Models
class OTPRequestModel(BaseModel):
    """Request model for OTP generation."""
    session_token: UUID = Field(
        ...,
        description="Session token from QR verification",
        example="550e8400-e29b-41d4-a716-446655440000"
    )
    mobile_number: str = Field(
        ...,
        description="Citizen's mobile number (10-15 digits)",
        min_length=10,
        max_length=15,
        example="9876543210"
    )


class OTPResponseModel(BaseModel):
    """Response model for OTP generation."""
    message: str
    expires_at: str
    mobile_number: str
    expires_in_seconds: int
    otp_code: str | None = None  # Only populated in dummy/dev mode (no SMS configured)


class OTPVerifyModel(BaseModel):
    """Request model for OTP verification."""
    mobile_number: str = Field(..., min_length=10, max_length=15, example="9876543210")
    otp_code: str = Field(..., min_length=6, max_length=6, example="123456")


class OTPVerifyResponseModel(BaseModel):
    """Response model for OTP verification."""
    verified: bool
    message: str


class AppointmentResponseModel(BaseModel):
    """Response model for appointment submission."""
    appointment_id: int
    token_assigned: int
    citizen_id: int
    attachments_count: int
    status: str
    submitted_at: Optional[str] = None
    scheduled_date: Optional[str] = None
    scheduled_time: Optional[str] = None
    message: str


@router.post(
    "/otp/request",
    response_model=OTPResponseModel,
    status_code=200,
    summary="Request OTP for Mobile Verification",
    description="Generate and send 6-digit OTP code via SMS for identity verification"
)
@limiter.limit("3/minute")
async def request_otp(
    request: Request,
    otp_request: OTPRequestModel,
    db: AsyncSession = Depends(get_db)
) -> OTPResponseModel:
    """
    Generate and send OTP code for mobile number verification.
    
    This endpoint is called by the frontend after the user enters their
    mobile number in the form. The OTP is sent via SMS and must be entered
    within 3 minutes to complete the appointment submission.
    
    Process Flow:
        1. Validate session_token exists in gatekeeper_sessions
        2. Generate cryptographically secure 6-digit OTP
        3. Hash OTP using SHA-256 and store in otp_verifications
        4. Send OTP via external SMS gateway (async)
        5. Return success response with expiry time
    
    Request Body:
        {
            "session_token": "550e8400-e29b-41d4-a716-446655440000",
            "mobile_number": "9876543210"
        }
    
    Response (200 OK):
        {
            "message": "OTP sent successfully",
            "expires_at": "2024-01-15T10:33:00",
            "mobile_number": "******3210",
            "expires_in_seconds": 180
        }
    
    Errors:
        - 400: Invalid mobile number format or session expired
        - 404: Session token not found
        - 500: SMS gateway failure or database error
    
    Security:
        - OTP is hashed before storage (SHA-256)
        - Session token must be active and not expired
        - Rate limiting recommended at API gateway level
        - Mobile number is masked in response
    
    Args:
        request: OTP request payload with session_token and mobile_number
        db: Injected database session from dependency
    
    Returns:
        OTPResponseModel: Success message with expiry details
    
    Raises:
        HTTPException: Various error codes based on validation failures
    """
    try:
        result = await appointment_service.create_otp_request(
            session_token=otp_request.session_token,
            mobile_number=otp_request.mobile_number,
            db=db
        )
        
        return OTPResponseModel(**result)
    
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"OTP request failed: {str(e)}"
        )


@router.post(
    "/otp/verify",
    response_model=OTPVerifyResponseModel,
    status_code=200,
    summary="Verify OTP Code",
    description="Verify the 6-digit OTP entered by the citizen before form submission"
)
@limiter.limit("5/minute")
async def verify_otp(
    request: Request,
    body: OTPVerifyModel,
    db: AsyncSession = Depends(get_db),
) -> OTPVerifyResponseModel:
    try:
        if not body.otp_code.isdigit():
            raise HTTPException(status_code=400, detail="OTP must be 6 digits.")
        result = await appointment_service.verify_otp(
            mobile_number=body.mobile_number,
            otp_code=body.otp_code,
            db=db,
        )
        return OTPVerifyResponseModel(**result)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"OTP verification failed: {str(e)}")


@router.post(
    "/appointments/submit",
    response_model=AppointmentResponseModel,
    status_code=201,
    summary="Submit Appointment with OTP Verification",
    description="Atomically verify OTP and create appointment with attachments"
)
@limiter.limit("5/minute")
async def submit_appointment(
    request: Request,
    session_token: UUID = Form(
        ...,
        description="Session token from QR verification"
    ),
    name: str = Form(
        ...,
        description="Citizen's full name",
        min_length=1,
        max_length=100
    ),
    mobile_number: str = Form(
        ...,
        description="Citizen's mobile number (must match OTP request)",
        min_length=10,
        max_length=15
    ),
    constituency: str = Form(
        ...,
        description="Ward/region/constituency identifier",
        min_length=1,
        max_length=100
    ),
    description: str = Form(
        ...,
        description="Grievance/query description",
        min_length=1,
        max_length=5000
    ),
    otp_code: str = Form(
        ...,
        description="6-digit OTP code received via SMS",
        min_length=6,
        max_length=6
    ),
    grievance_category: Optional[str] = Form(
        default=None,
        description="Citizen-selected grievance category"
    ),
    schedule_meeting: str = Form(
        default="false",
        description="Whether to schedule a meeting (true/false)"
    ),
    slot_id: Optional[int] = Form(
        default=None,
        description="Selected 30-minute slot ID (required when schedule_meeting=true)"
    ),
    num_persons: int = Form(
        default=1,
        ge=1,
        le=4,
        description="Number of persons attending the meeting (1–4, only relevant when schedule_meeting=true)"
    ),
    audio_recording: str = Form(
        default="",
        description="Base64 encoded audio recording (optional)"
    ),
    files: List[UploadFile] = File(
        default=[],
        description="Optional file attachments (audio, images, documents, video)"
    ),
    db: AsyncSession = Depends(get_db)
) -> AppointmentResponseModel:
    """
    Atomically verify OTP and create appointment with file attachments.
    
    This is the core stateless submission endpoint. The frontend collects
    all form data and files locally, then sends everything in a single
    multipart/form-data POST request along with the OTP code. If the OTP
    is valid, the entire transaction is committed atomically. If invalid,
    the request is rejected with zero disk footprint.
    
    Process Flow:
        1. Look up active OTP record for mobile number
        2. Verify OTP code (max 3 attempts, brute-force protection)
        3. Begin database transaction
        4. Mark OTP as used (single-use enforcement)
        5. Allocate appointment slot atomically (FOR UPDATE SKIP LOCKED)
        6. Save uploaded files to disk
        7. Create/update citizen record (with field-level encryption)
        8. Create appointment record
        9. Create attachment records
        10. Commit transaction
        11. Return assigned token number
    
    Request (multipart/form-data):
        - session_token: UUID
        - name: string
        - mobile_number: string (10-15 digits)
        - constituency: string
        - description: string (grievance details)
        - otp_code: string (6 digits)
        - files: array of files (optional)
    
    Response (201 Created):
        {
            "appointment_id": 123,
            "token_assigned": 42,
            "citizen_id": 456,
            "attachments_count": 2,
            "status": "SCHEDULED",
            "message": "Appointment created successfully. Your token number is 42."
        }
    
    Errors:
        - 400: Invalid OTP, max attempts exceeded, or validation failure
        - 404: OTP record not found
        - 500: Database or file I/O error
    
    Security:
        - OTP verification with brute-force protection (max 3 attempts)
        - OTP is single-use (marked as used after verification)
        - All PII fields encrypted before storage (AES-256)
        - Atomic transaction ensures data consistency
        - File type and size validation
    
    Performance:
        - Lock-free slot allocation using FOR UPDATE SKIP LOCKED
        - Files saved to disk outside transaction
        - Composite indexes optimize OTP lookup
    
    File Upload:
        - Supported types: images (JPG, PNG) and PDF documents
        - Max file size: configurable via MAX_FILE_SIZE_MB in .env (default 5MB)
        - Files stored in: uploads/attachments/{appointment_id}/
    
    Args:
        session_token: UUID from gatekeeper_sessions
        name: Citizen's full name
        mobile_number: Mobile number (must match OTP request)
        constituency: Ward/region identifier
        description: Grievance description
        otp_code: 6-digit OTP code
        files: List of uploaded files (optional)
        db: Injected database session from dependency
    
    Returns:
        AppointmentResponseModel: Created appointment details with token number
    
    Raises:
        HTTPException: Various error codes based on validation/processing failures
    """
    try:
        # Validate OTP code format
        if not otp_code.isdigit():
            raise HTTPException(
                status_code=400,
                detail="OTP code must be 6 digits"
            )
        
        # Server-side name + mobile validation (CITZ-04) — the Jinja / Next.js
        # forms enforce the same shape client-side, but a JS-off browser or a
        # scripted client used to reach the server with '<img src=x>', 500
        # spaces, or a mobile in any format. Reject early with the citizen-
        # facing message so bad data never lands in the encrypted PII columns.
        try:
            name = clean_name(name)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
        try:
            mobile_number = clean_mobile(mobile_number)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
        
        # Validate description OR files OR audio (at least one required)
        has_description = description and description.strip()
        has_files = files and len(files) > 0 and any(f.filename for f in files)
        has_audio = audio_recording and audio_recording.strip()
        
        if not has_description and not has_files and not has_audio:
            raise HTTPException(
                status_code=400,
                detail="Either description, audio recording, or file attachments must be provided"
            )
        
        # Convert schedule_meeting string to boolean
        schedule_meeting_bool = schedule_meeting.lower() == "true"
        
        # Process atomic submission
        result = await appointment_service.process_atomic_submission(
            session_token=session_token,
            name=name,
            mobile=mobile_number,
            constituency=constituency,
            description=description,
            otp_code=otp_code,
            schedule_meeting=schedule_meeting_bool,
            slot_id=slot_id,
            num_persons=num_persons,
            audio_recording=audio_recording,
            files=files,
            db=db,
            grievance_category=grievance_category,
        )

        # An INVITATION also gets mirrored into the events module so the
        # events-PWA reviewer picks it up in "needs review". Best-effort — the
        # helper swallows its own errors so it can't fail the submission.
        if (grievance_category or "").strip().lower() == "invitation":
            await _record_invitation_event(files, name, db)

        return AppointmentResponseModel(**result)
    
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Appointment submission failed: {str(e)}"
        )


# NOTE: a GET /appointments/{id} placeholder used to live here — it was
# unauthenticated and returned fake {"message": "to be implemented"} data with
# no real lookup. Removed as dead code (P2). Reintroduce with proper auth +
# real retrieval if/when a client actually needs appointment-detail-by-id.
