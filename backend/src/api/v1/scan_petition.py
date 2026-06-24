"""
Scan / manual petition upload — PA staff route.

PA staff photograph or scan handwritten petitions and upload here.
No OTP, no QR — protected by dash_session cookie (same as dashboard).

Routes:
  GET  /petition/scan        → render upload page
  POST /petition/scan/submit → process files, create appointment, fire Gemini
"""
from pathlib import Path
from typing import List

from fastapi import APIRouter, Depends, File, Form, Request, UploadFile
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse
from fastapi.templating import Jinja2Templates
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.database import get_db
from src.services.appointment_service import appointment_service

_TEMPLATES_DIR = Path(__file__).resolve().parent.parent.parent.parent / "templates"
templates = Jinja2Templates(directory=str(_TEMPLATES_DIR))

router = APIRouter(prefix="/petition", tags=["Scan Petition"])


@router.get("/scan", response_class=HTMLResponse)
async def scan_petition_page(request: Request):
    """Render the handwritten petition upload page (open for testing)."""
    return templates.TemplateResponse("upload_petition.jinja2", {"request": request})


@router.post("/scan/submit")
async def scan_petition_submit(
    request: Request,
    name: str         = Form(..., description="Citizen full name"),
    mobile: str       = Form(default="", description="Citizen mobile (optional)"),
    constituency: str = Form(default="Tamil Nadu", description="Constituency / ward"),
    files: List[UploadFile] = File(..., description="Scanned images or PDF (max 10 files)"),
    db: AsyncSession  = Depends(get_db),
):
    """Process uploaded petition pages — creates appointment + fires Gemini."""
    result = await appointment_service.process_manual_petition(
        name=name,
        mobile=mobile.strip(),
        constituency=constituency,
        files=files,
        db=db,
        submitted_by="staff",
    )
    return JSONResponse(result, status_code=201)
