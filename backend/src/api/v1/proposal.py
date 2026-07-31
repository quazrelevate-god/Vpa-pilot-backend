"""
FastAPI routes for the public "/proposal" form's mobile OTP.

The proposal form (Nam Kural — institutional proposals to the Minister) is shared
as a plain link, so it is NOT reached only through a QR gatekeeper session and
cannot use the QR-gated /api/v1/otp/request. These routes send and verify OTPs
session-lessly, reusing the same APM SMS gateway and otp_verifications storage as
the citizen flow (see AppointmentService.create_open_otp_request).
"""
import re

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.database import get_db
from src.core.rate_limit import limiter
from src.services.appointment_service import appointment_service

router = APIRouter(prefix="/api/v1/proposal", tags=["Proposal OTP"])


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
