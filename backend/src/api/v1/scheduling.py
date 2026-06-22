"""
Scheduling API — fixed 30-minute slots, 8 AM – 6 PM, 6 citizens per slot.

Citizen endpoints:
  GET  /api/v1/scheduling/slots/available?target_date=YYYY-MM-DD

Admin endpoints (auth required):
  POST /api/v1/scheduling/admin/open-date
  GET  /api/v1/scheduling/admin/slots?target_date=YYYY-MM-DD
  POST /api/v1/scheduling/admin/slots/{slot_id}/block
  POST /api/v1/scheduling/admin/slots/{slot_id}/unblock
  GET  /api/v1/scheduling/admin/dates
  GET  /api/v1/scheduling/admin/waiting-queue
  GET  /api/v1/scheduling/admin/statistics
  GET  /api/v1/scheduling/admin/mlas
  POST /api/v1/scheduling/admin/cancel-all-scheduled
  PATCH /api/v1/scheduling/admin/reschedule/{appointment_id}
"""
import base64
from datetime import date as date_type, datetime as datetime_type
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.database import get_db
from src.services.scheduling_service import scheduling_service
from src.api.v1.dashboard import require_auth
from src.models.scheduling_models import MLA

router = APIRouter(prefix="/api/v1/scheduling", tags=["scheduling"])


# ── Pydantic request bodies ──────────────────────────────────────────────────

class OpenDateRequest(BaseModel):
    mla_id: int        = Field(1, description="MLA ID (defaults to 1)")
    date:   date_type  = Field(..., description="Date to open for bookings (YYYY-MM-DD)")


class RescheduleRequest(BaseModel):
    new_slot_id: int = Field(..., description="Target slot ID to move the appointment to")


# ── Citizen-facing ────────────────────────────────────────────────────────────

@router.get("/slots/available")
async def get_available_slots(
    target_date: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
):
    """
    Return all 20 slots for the given date with per-slot availability.

    Response:
    {
      "available": true,
      "date": "2026-06-22",
      "date_label": "22 Jun 2026",
      "slots": [
        { "id": 1, "slot_number": 1, "label": "08:00 AM – 08:30 AM",
          "start": "08:00", "end": "08:30",
          "available": true, "booked_count": 2, "max_capacity": 6, "remaining": 4, "status": "AVAILABLE" },
        ...
      ]
    }
    """
    try:
        parsed = None
        if target_date:
            parsed = datetime_type.strptime(target_date, "%Y-%m-%d").date()
        result = await scheduling_service.get_available_slots(db, parsed)
        return JSONResponse(result)
    except Exception as e:
        return JSONResponse({"available": False, "reason": "ERROR", "message": str(e), "slots": []}, status_code=500)


# ── Admin: open a date ────────────────────────────────────────────────────────

@router.post("/admin/open-date")
async def open_date(
    data: OpenDateRequest,
    db: AsyncSession = Depends(get_db),
    user: str = Depends(require_auth),
):
    """
    Open a date for citizen bookings.
    Creates MLADailyAvailability + 20 × 30-min AppointmentSlot rows.
    Fixed hours: 08:00 – 18:00.  Max 6 citizens per slot.
    """
    try:
        result = await scheduling_service.set_mla_availability(
            db=db,
            mla_id=data.mla_id,
            target_date=data.date,
            created_by=user,
        )
        return JSONResponse(result)
    except ValueError as e:
        return JSONResponse({"error": str(e)}, status_code=409)
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


# ── Admin: slot grid for a date ───────────────────────────────────────────────

@router.get("/admin/slots")
async def get_slots(
    target_date: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    user: str = Depends(require_auth),
):
    """
    Return all 20 slots for target_date with full booking details.
    Used by the PA portal slot management grid.
    """
    try:
        parsed = datetime_type.strptime(target_date, "%Y-%m-%d").date() if target_date else date_type.today()
        result = await scheduling_service.get_slots_for_date(db, parsed)
        return JSONResponse(result)
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


# ── Admin: block / unblock ────────────────────────────────────────────────────

@router.post("/admin/slots/{slot_id}/block")
async def block_slot(
    slot_id: int,
    db: AsyncSession = Depends(get_db),
    user: str = Depends(require_auth),
):
    """Block a slot — only allowed when booked_count == 0."""
    try:
        result = await scheduling_service.block_slot(db, slot_id)
        return JSONResponse(result)
    except ValueError as e:
        return JSONResponse({"error": str(e)}, status_code=409)
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


@router.post("/admin/slots/{slot_id}/unblock")
async def unblock_slot(
    slot_id: int,
    db: AsyncSession = Depends(get_db),
    user: str = Depends(require_auth),
):
    """Unblock a previously blocked slot."""
    try:
        result = await scheduling_service.unblock_slot(db, slot_id)
        return JSONResponse(result)
    except ValueError as e:
        return JSONResponse({"error": str(e)}, status_code=404)
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


# ── Admin: list open dates ────────────────────────────────────────────────────

@router.get("/admin/dates")
async def get_open_dates(
    db: AsyncSession = Depends(get_db),
    user: str = Depends(require_auth),
):
    """List all open (ACTIVE) future dates with booking totals."""
    try:
        result = await scheduling_service.get_open_dates(db)
        return JSONResponse(result)
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


# ── Admin: reschedule ─────────────────────────────────────────────────────────

@router.patch("/admin/reschedule/{appointment_id}")
async def reschedule_appointment(
    appointment_id: int,
    data: RescheduleRequest,
    db: AsyncSession = Depends(get_db),
    user: str = Depends(require_auth),
):
    """
    Move a SCHEDULED appointment to a different slot.
    Releases the old SlotBooking and books the new slot (FOR UPDATE concurrency).
    """
    try:
        result = await scheduling_service.reschedule_appointment(
            db=db,
            appointment_id=appointment_id,
            new_slot_id=data.new_slot_id,
        )
        return JSONResponse(result)
    except ValueError as e:
        return JSONResponse({"error": str(e)}, status_code=404)
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


# ── Admin: waiting queue ──────────────────────────────────────────────────────

@router.get("/admin/waiting-queue")
async def get_waiting_queue(
    limit: int = 100,
    db: AsyncSession = Depends(get_db),
    user: str = Depends(require_auth),
):
    """Return waiting queue in priority order."""
    try:
        result = await scheduling_service.get_waiting_queue(db, limit)
        return JSONResponse(result)
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


# ── Admin: statistics ─────────────────────────────────────────────────────────

@router.get("/admin/statistics")
async def get_statistics(
    db: AsyncSession = Depends(get_db),
    user: str = Depends(require_auth),
):
    """Return scheduling KPIs: waiting count, scheduled today, oldest waiting."""
    try:
        result = await scheduling_service.get_statistics(db)
        return JSONResponse(result)
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


# ── Admin: list MLAs ──────────────────────────────────────────────────────────

@router.get("/admin/mlas")
async def get_mlas(
    db: AsyncSession = Depends(get_db),
    user: str = Depends(require_auth),
):
    """Return all active MLAs."""
    try:
        from sqlalchemy import select
        result = await db.execute(select(MLA).where(MLA.is_active == True).order_by(MLA.name))
        mlas = result.scalars().all()
        return JSONResponse([
            {"id": m.id, "name": m.name, "constituency": m.constituency, "is_active": m.is_active}
            for m in mlas
        ])
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


# ── Admin: emergency cancel ───────────────────────────────────────────────────

@router.post("/admin/cancel-all-scheduled")
async def cancel_all_scheduled(
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: str = Depends(require_auth),
):
    """
    Emergency: move all today's SCHEDULED appointments back to waiting queue
    and cancel today's availability.
    """
    try:
        result = await scheduling_service.cancel_all_scheduled(db)
        return JSONResponse(result)
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


# ── Legacy alias (form.jinja2 still uses this until rebuilt) ──────────────────

@router.get("/time-windows/available")
async def get_available_time_windows_legacy(
    target_date: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
):
    """Redirect to new /slots/available for backwards-compatibility."""
    try:
        parsed = datetime_type.strptime(target_date, "%Y-%m-%d").date() if target_date else None
        result = await scheduling_service.get_available_slots(db, parsed)
        # Reshape to old format so un-migrated form code still works
        windows = []
        for s in result.get("slots", []):
            if s["available"]:
                windows.append({
                    "id":              s["id"],
                    "label":           s["label"],
                    "start":           s["start"],
                    "end":             s["end"],
                    "available_slots": s["remaining"],
                    "total_slots":     s["max_capacity"],
                })
        return JSONResponse({
            "available":  result["available"],
            "reason":     result.get("reason"),
            "windows":    windows,
        })
    except Exception as e:
        return JSONResponse({"available": False, "reason": "ERROR", "windows": []}, status_code=500)
