"""
Referral API — daily-reset QR + isolated slot booking (11 AM – 1 PM).

Public (no auth — accessed via the shared daily QR):
  GET  /api/v1/referral/scan?d=<token>      → verify token, redirect to form
  GET  /referral                            → referral form page (jinja2)
  GET  /api/v1/referral/slots?d=<token>     → today's slots for the form
  POST /api/v1/referral/submit              → book a referral slot

Admin (auth — PA portal):
  GET  /api/v1/referral/admin/qr
  POST /api/v1/referral/admin/open-date
  GET  /api/v1/referral/admin/slots?target_date=YYYY-MM-DD
  POST /api/v1/referral/admin/slots/{slot_id}/block|unblock|close|reopen
  GET  /api/v1/referral/admin/dates
  GET  /api/v1/referral/admin/bookings?target_date=YYYY-MM-DD
"""
from pathlib import Path
from datetime import date as date_type, datetime as datetime_type
from typing import Optional
from urllib.parse import urlencode

from fastapi import APIRouter, Depends, Form, Request
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.database import get_db
from src.core.config import settings
from src.services.referral_service import referral_service
from src.api.v1.dashboard import require_auth

_TEMPLATES_DIR = Path(__file__).resolve().parent.parent.parent.parent / "templates"
templates = Jinja2Templates(directory=str(_TEMPLATES_DIR))

# Two routers: one under /api/v1/referral (JSON + scan), one bare (/referral page)
router = APIRouter(prefix="/api/v1/referral", tags=["Referral"])
page_router = APIRouter(tags=["Referral"])


def _base_url(request: Request) -> str:
    if settings.SERVER_BASE_URL != "http://localhost:8000":
        return settings.SERVER_BASE_URL.rstrip("/")
    return str(request.base_url).rstrip("/")


# ── Pydantic ──────────────────────────────────────────────────────────────────

class OpenDateRequest(BaseModel):
    date:         date_type = Field(..., description="Date to open (YYYY-MM-DD)")
    max_capacity: int       = Field(6, ge=1, le=100, description="Persons per slot")


# ── Public: QR scan → redirect to form ───────────────────────────────────────

@router.get("/scan")
async def referral_scan(d: str):
    """QR target. Verify today's token, then redirect to the referral form."""
    try:
        referral_service.verify_daily_token(d)
    except ValueError as e:
        return RedirectResponse(url="/form/error?" + urlencode({"type": "qr_expired", "message": str(e)}), status_code=302)
    return RedirectResponse(url=f"/referral?d={d}", status_code=307)


# ── Public: referral form page ────────────────────────────────────────────────

@page_router.get("/referral", response_class=HTMLResponse)
async def referral_form_page(request: Request, d: str = ""):
    """Render the referral form. Requires a valid daily token in ?d=."""
    try:
        token_date = referral_service.verify_daily_token(d)
    except ValueError as e:
        return RedirectResponse(url="/form/error?" + urlencode({"type": "qr_expired", "message": str(e)}), status_code=302)

    resp = templates.TemplateResponse(
        "referral_form.jinja2",
        {
            "request":    request,
            "token":      d,
            "date":       token_date.isoformat(),
            "date_label": token_date.strftime("%d %b %Y"),
        },
    )
    resp.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    return resp


# ── Public: open dates for citizen date picker ────────────────────────────────

@router.get("/open-dates")
async def referral_open_dates(d: str, db: AsyncSession = Depends(get_db)):
    """Return future open dates with available slots. Token required (verifies QR legitimacy)."""
    try:
        referral_service.verify_daily_token(d)
    except ValueError as e:
        return JSONResponse({"error": str(e)}, status_code=403)
    result = await referral_service.list_open_dates_public(db)
    return JSONResponse(result)


# ── Public: slots for the form ────────────────────────────────────────────────

@router.get("/slots")
async def referral_slots(
    d: str,
    target_date: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
):
    """
    Return slots for a specific date.
    If target_date not provided, defaults to today (token date).
    """
    try:
        referral_service.verify_daily_token(d)
    except ValueError as e:
        return JSONResponse({"available": False, "reason": "INVALID_QR", "message": str(e), "slots": []}, status_code=403)
    # Use citizen-selected date if provided, otherwise fallback to today
    if target_date:
        try:
            slot_date = datetime_type.strptime(target_date, "%Y-%m-%d").date()
        except ValueError:
            return JSONResponse({"available": False, "reason": "INVALID_DATE", "slots": []}, status_code=400)
    else:
        from datetime import date as date_mod
        slot_date = date_mod.today()
    result = await referral_service.get_available_slots(db, slot_date)
    return JSONResponse(result)


# ── Public: submit a referral booking ─────────────────────────────────────────

@router.post("/submit")
async def referral_submit(
    d: str            = Form(...),
    name: str         = Form(..., min_length=1, max_length=150),
    referred_by: str  = Form(..., min_length=1, max_length=200),
    reason: str       = Form(..., min_length=1, max_length=500),
    num_persons: int  = Form(1),
    slot_id: int      = Form(...),
    mobile: str       = Form(default=""),
    db: AsyncSession  = Depends(get_db),
):
    try:
        referral_service.verify_daily_token(d)
    except ValueError as e:
        return JSONResponse({"error": str(e)}, status_code=403)
    try:
        result = await referral_service.book_slot(
            db, slot_id=slot_id, name=name, referred_by=referred_by,
            reason=reason, num_persons=num_persons, mobile=mobile,
        )
        return JSONResponse(result, status_code=201)
    except ValueError as e:
        await db.rollback()
        return JSONResponse({"error": str(e)}, status_code=409)
    except Exception as e:
        await db.rollback()
        return JSONResponse({"error": str(e)}, status_code=500)


# ── Admin: daily QR ───────────────────────────────────────────────────────────

@router.get("/admin/qr")
async def admin_qr(request: Request, user: str = Depends(require_auth)):
    return JSONResponse(referral_service.daily_qr_payload(_base_url(request)))


# ── Admin: open a date ────────────────────────────────────────────────────────

@router.post("/admin/open-date")
async def admin_open_date(
    data: OpenDateRequest,
    db: AsyncSession = Depends(get_db),
    user: str = Depends(require_auth),
):
    try:
        result = await referral_service.open_date(
            db, target_date=data.date, created_by=user, max_capacity=data.max_capacity,
        )
        return JSONResponse(result)
    except ValueError as e:
        await db.rollback()
        return JSONResponse({"error": str(e)}, status_code=409)
    except Exception as e:
        await db.rollback()
        return JSONResponse({"error": str(e)}, status_code=500)


# ── Admin: slot grid ──────────────────────────────────────────────────────────

@router.get("/admin/slots")
async def admin_slots(
    target_date: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    user: str = Depends(require_auth),
):
    try:
        parsed = datetime_type.strptime(target_date, "%Y-%m-%d").date() if target_date else date_type.today()
        return JSONResponse(await referral_service.get_slots_for_date(db, parsed))
    except Exception as e:
        await db.rollback()
        return JSONResponse({"error": str(e)}, status_code=500)


# ── Admin: block / unblock / close / reopen ───────────────────────────────────

@router.post("/admin/slots/{slot_id}/{action}")
async def admin_slot_action(
    slot_id: int,
    action: str,
    db: AsyncSession = Depends(get_db),
    user: str = Depends(require_auth),
):
    fn = {
        "block":   referral_service.block_slot,
        "unblock": referral_service.unblock_slot,
        "close":   referral_service.close_slot,
        "reopen":  referral_service.reopen_slot,
    }.get(action)
    if fn is None:
        return JSONResponse({"error": "Unknown action."}, status_code=400)
    try:
        return JSONResponse(await fn(db, slot_id))
    except ValueError as e:
        await db.rollback()
        return JSONResponse({"error": str(e)}, status_code=409)
    except Exception as e:
        await db.rollback()
        return JSONResponse({"error": str(e)}, status_code=500)


# ── Admin: open dates ─────────────────────────────────────────────────────────

@router.get("/admin/dates")
async def admin_dates(db: AsyncSession = Depends(get_db), user: str = Depends(require_auth)):
    try:
        return JSONResponse(await referral_service.get_open_dates(db))
    except Exception as e:
        await db.rollback()
        return JSONResponse({"error": str(e)}, status_code=500)


# ── Admin: bookings table ─────────────────────────────────────────────────────

@router.get("/admin/bookings")
async def admin_bookings(
    target_date: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    user: str = Depends(require_auth),
):
    try:
        parsed = datetime_type.strptime(target_date, "%Y-%m-%d").date() if target_date else date_type.today()
        return JSONResponse(await referral_service.get_bookings(db, parsed))
    except Exception as e:
        await db.rollback()
        return JSONResponse({"error": str(e)}, status_code=500)
