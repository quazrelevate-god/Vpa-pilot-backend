"""
FastAPI routes for the public "/proposal" form's mobile OTP.

The proposal form (Nam Kural — institutional proposals to the Minister) is shared
as a plain link, so it is NOT reached only through a QR gatekeeper session and
cannot use the QR-gated /api/v1/otp/request. These routes send and verify OTPs
session-lessly, reusing the same APM SMS gateway and otp_verifications storage as
the citizen flow (see AppointmentService.create_open_otp_request).
"""
import re
from typing import List, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.database import get_db
from src.core.rate_limit import limiter
from src.services.appointment_service import appointment_service
from src.services.proposal_service import proposal_service

router = APIRouter(prefix="/api/v1/proposal", tags=["Proposal OTP"])

_VALID_CATEGORIES = {"school", "tamil", "information", "film"}
_EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")


def _norm_mobile(v: str) -> str:
    """Reduce whatever the form sent to a bare 10-digit number (drop +91/91,
    spaces, hyphens) so request-time and verify-time keys match."""
    digits = re.sub(r"\D", "", v or "")
    if len(digits) == 12 and digits.startswith("91"):
        digits = digits[2:]
    return digits


class ProposalOTPRequest(BaseModel):
    mobile_number: str = Field(..., min_length=10, max_length=15, example="9876543210")


class ProposalOTPResponse(BaseModel):
    message: str
    expires_at: str
    mobile_number: str          # masked, e.g. "******3210"
    expires_in_seconds: int
    otp_code: str | None = None  # populated only in dummy/dev mode (SMS not configured)


class ProposalOTPVerify(BaseModel):
    mobile_number: str = Field(..., min_length=10, max_length=15)
    otp_code: str = Field(..., min_length=6, max_length=6, example="123456")


class ProposalOTPVerifyResponse(BaseModel):
    verified: bool
    message: str


@router.post(
    "/otp/request",
    response_model=ProposalOTPResponse,
    status_code=200,
    summary="Send an OTP to the proposer's mobile (session-less)",
)
@limiter.limit("3/minute")
async def request_proposal_otp(
    request: Request,
    body: ProposalOTPRequest,
    db: AsyncSession = Depends(get_db),
) -> ProposalOTPResponse:
    try:
        result = await appointment_service.create_open_otp_request(
            mobile_number=body.mobile_number, db=db
        )
        return ProposalOTPResponse(**result)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"OTP request failed: {str(e)}")


@router.post(
    "/otp/verify",
    response_model=ProposalOTPVerifyResponse,
    status_code=200,
    summary="Verify the OTP entered on the proposal form",
)
@limiter.limit("5/minute")
async def verify_proposal_otp(
    request: Request,
    body: ProposalOTPVerify,
    db: AsyncSession = Depends(get_db),
) -> ProposalOTPVerifyResponse:
    try:
        if not body.otp_code.isdigit():
            raise HTTPException(status_code=400, detail="OTP must be 6 digits.")
        result = await appointment_service.verify_otp(
            mobile_number=_norm_mobile(body.mobile_number),
            otp_code=body.otp_code,
            db=db,
        )
        return ProposalOTPVerifyResponse(**result)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"OTP verification failed: {str(e)}")


class ProposalSubmitResponse(BaseModel):
    tracking_ref: str
    documents: int
    message: str


@router.post(
    "/submit",
    response_model=ProposalSubmitResponse,
    status_code=201,
    summary="Submit a proposal (form fields + PDF documents) after OTP verification",
)
@limiter.limit("5/minute")
async def submit_proposal(
    request: Request,
    category: str = Form(..., description="Desk: school | tamil | information | film"),
    org_name: str = Form(..., min_length=1, max_length=300),
    person_name: str = Form(..., min_length=1, max_length=200),
    designation: Optional[str] = Form(None, max_length=200),
    email: str = Form(..., min_length=3, max_length=254),
    phone: str = Form(..., min_length=10, max_length=15),
    files: List[UploadFile] = File(..., description="Proposal PDF(s), up to 5"),
    db: AsyncSession = Depends(get_db),
) -> ProposalSubmitResponse:
    """
    Persist a proposal + its documents and queue Gemini extraction. Identity from
    the form is authoritative (Gemini never extracts it). The phone must already
    have a verified OTP — this consumes it, binding the submission to that OTP.
    """
    cat = (category or "").strip().lower()
    if cat not in _VALID_CATEGORIES:
        raise HTTPException(status_code=400, detail=f"Unknown category '{category}'.")
    if not _EMAIL_RE.match((email or "").strip()):
        raise HTTPException(status_code=400, detail="Enter a valid email address.")

    mobile = _norm_mobile(phone)
    if not re.fullmatch(r"[6-9]\d{9}", mobile):
        raise HTTPException(status_code=400, detail="Enter a valid 10-digit mobile number.")

    # Gate: the phone must have completed OTP verification. Consumes it.
    await appointment_service.consume_verified_otp(mobile_number=mobile, db=db)

    try:
        result = await proposal_service.create_submission(
            category=cat,
            org_name=org_name,
            person_name=person_name,
            designation=designation,
            email=email,
            phone=mobile,
            files=files,
            db=db,
        )
        return ProposalSubmitResponse(
            tracking_ref=result["tracking_ref"],
            documents=result["documents"],
            message="Proposal received and recorded.",
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Proposal submission failed: {str(e)}")
