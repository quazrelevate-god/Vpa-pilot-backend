"""
API endpoints for MLA scheduling and availability management.
Handles citizen time window selection and admin availability management.
"""
import base64
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel, Field
from datetime import date as date_type, datetime as datetime_type, time as time_type
from typing import Optional, List

from src.core.database import get_db
from src.services.scheduling_service import scheduling_service
from src.api.v1.dashboard import require_auth
from src.models.scheduling_models import MLA, MLADailyAvailability

router = APIRouter(prefix="/api/v1/scheduling", tags=["scheduling"])


# Pydantic models for request validation
class SetAvailabilityRequest(BaseModel):
    mla_id: int = Field(1, description="MLA ID (defaults to 1 for single person workflow)")
    date: date_type = Field(..., description="Date of availability")
    start_time: time_type = Field(..., description="Start time (e.g., 16:00)")
    end_time: time_type = Field(..., description="End time (e.g., 18:00)")
    slot_duration_minutes: int = Field(5, description="Slot duration in minutes")
    window_duration_minutes: int = Field(30, description="Window duration in minutes")


class ManualScheduleRequest(BaseModel):
    appointment_id: int = Field(..., description="Appointment ID to schedule")
    slot_id: int = Field(..., description="Target slot ID")


class RescheduleRequest(BaseModel):
    new_datetime: datetime_type = Field(..., description="New appointment datetime (ISO 8601)")
    sms_text: Optional[str] = Field(None, description="Custom SMS to send to citizen")


# Citizen-facing endpoints
@router.get("/time-windows/available")
async def get_available_time_windows(
    target_date: Optional[str] = None,
    db: AsyncSession = Depends(get_db)
):
    """
    Get available time windows for citizen selection.
    
    Query params:
        target_date: Date in YYYY-MM-DD format (defaults to today)
    
    Returns:
        {
            "available": true/false,
            "reason": "NO_AVAILABILITY" | "CAPACITY_FULL" | null,
            "total_slots": 24,
            "booked_slots": 10,
            "remaining_slots": 14,
            "windows": [
                {
                    "id": 1,
                    "label": "4:30 PM - 5:00 PM",
                    "start": "16:30",
                    "end": "17:00",
                    "available_slots": 6,
                    "total_slots": 6
                },
                ...
            ]
        }
    """
    try:
        parsed_date = None
        if target_date:
            from datetime import datetime
            parsed_date = datetime.strptime(target_date, '%Y-%m-%d').date()
        
        result = await scheduling_service.get_available_time_windows(db, parsed_date)
        return JSONResponse(result)
    
    except Exception as e:
        print(f"[ERROR] Failed to get time windows: {e}")
        return JSONResponse({
            'available': False,
            'reason': 'ERROR',
            'message': 'Failed to fetch availability',
            'windows': []
        }, status_code=500)


# Admin endpoints
@router.post("/admin/set-availability")
async def set_mla_availability(
    request: Request,
    data: SetAvailabilityRequest,
    db: AsyncSession = Depends(get_db),
    user: str = Depends(require_auth)
):
    """
    Admin: Set MLA availability and auto-schedule waiting queue.
    
    Request body:
        {
            "mla_id": 1,
            "date": "2026-06-21",
            "start_time": "16:00:00",
            "end_time": "18:00:00",
            "slot_duration_minutes": 5,
            "window_duration_minutes": 30
        }
    
    Returns:
        {
            "availability_id": 1,
            "date": "21 Jun 2026",
            "time_range": "04:00 PM - 06:00 PM",
            "total_slots": 24,
            "scheduled_from_queue": 15,
            "remaining_in_queue": 5,
            "message": "Created 24 slots. Scheduled 15 waiting appointments. 5 still waiting."
        }
    """
    try:
        result = await scheduling_service.set_mla_availability(
            db=db,
            mla_id=data.mla_id,
            target_date=data.date,
            start_time=data.start_time,
            end_time=data.end_time,
            slot_duration_minutes=data.slot_duration_minutes,
            window_duration_minutes=data.window_duration_minutes,
            created_by=user
        )

        return JSONResponse(result)

    except ValueError as e:
        return JSONResponse({'error': str(e)}, status_code=409)

    except Exception as e:
        print(f"[ERROR] Failed to set availability: {e}")
        return JSONResponse({
            'error': str(e)
        }, status_code=500)


@router.get("/admin/waiting-queue")
async def get_waiting_queue(
    limit: int = 100,
    db: AsyncSession = Depends(get_db),
    user: str = Depends(require_auth)
):
    """
    Admin: Get waiting queue with priority order.
    
    Query params:
        limit: Maximum records to return (default 100)
    
    Returns:
        [
            {
                "id": 123,
                "token": 45,
                "name": "John Doe",
                "mobile": "9876543210",
                "category": "HEALTH",
                "queue_position": 1,
                "waiting_since": "2026-06-20 10:30",
                "priority_score": 10,
                "created_at": "2026-06-20 10:30"
            },
            ...
        ]
    """
    try:
        result = await scheduling_service.get_waiting_queue(db, limit)
        return JSONResponse(result)
    
    except Exception as e:
        print(f"[ERROR] Failed to get waiting queue: {e}")
        return JSONResponse({
            'error': str(e)
        }, status_code=500)


@router.get("/admin/mlas")
async def get_mlas(
    db: AsyncSession = Depends(get_db),
    user: str = Depends(require_auth)
):
    """
    Admin: Get list of all MLAs.
    
    Returns:
        [
            {
                "id": 1,
                "name": "John Smith",
                "constituency": "North District",
                "is_active": true
            },
            ...
        ]
    """
    try:
        from sqlalchemy import select
        
        result = await db.execute(
            select(MLA)
            .where(MLA.is_active == True)
            .order_by(MLA.name)
        )
        mlas = result.scalars().all()
        
        return JSONResponse([
            {
                'id': mla.id,
                'name': mla.name,
                'constituency': mla.constituency,
                'is_active': mla.is_active
            }
            for mla in mlas
        ])
    
    except Exception as e:
        print(f"[ERROR] Failed to get MLAs: {e}")
        return JSONResponse({
            'error': str(e)
        }, status_code=500)


@router.get("/admin/today-schedule")
async def get_today_schedule(
    db: AsyncSession = Depends(get_db),
    user: str = Depends(require_auth)
):
    """
    Admin: Get today's schedule — supports multiple availability blocks.
    Returns aggregated slot counts and a list of scheduled appointments.
    """
    try:
        from sqlalchemy import select, func
        from sqlalchemy.orm import selectinload
        from src.models.appointment_models import Appointment, Citizen
        from datetime import date

        today = date.today()

        # Fetch ALL availability blocks for today
        avail_result = await db.execute(
            select(MLADailyAvailability)
            .where(MLADailyAvailability.date == today)
            .where(MLADailyAvailability.status == 'ACTIVE')
            .order_by(MLADailyAvailability.start_time.asc())
        )
        availabilities = avail_result.scalars().all()

        if not availabilities:
            return JSONResponse({
                'has_availability': False,
                'message': 'No availability set for today',
                'blocks': [],
                'appointments': []
            })

        # Aggregate stats across all blocks
        total_slots = sum(a.total_slots for a in availabilities)
        booked_slots = sum(a.booked_slots for a in availabilities)

        blocks = [
            {
                'id': a.id,
                'time_range': f"{a.start_time.strftime('%I:%M %p')} - {a.end_time.strftime('%I:%M %p')}",
                'total_slots': a.total_slots,
                'booked_slots': a.booked_slots,
                'remaining_slots': a.total_slots - a.booked_slots,
            }
            for a in availabilities
        ]

        # Fetch scheduled appointments for today
        appt_result = await db.execute(
            select(Appointment)
            .options(selectinload(Appointment.citizen))
            .where(Appointment.scheduled_date == today)
            .where(Appointment.status == 'SCHEDULED')
            .order_by(Appointment.scheduled_start_time.asc())
        )
        appointments = appt_result.scalars().all()

        appt_list = [
            {
                'id': a.id,
                'token': a.token_assigned,
                'name': base64.b64decode(a.encrypted_name.encode()).decode('utf-8') if a.encrypted_name else (base64.b64decode(a.citizen.encrypted_name.encode()).decode('utf-8') if a.citizen else 'Unknown'),
                'mobile': base64.b64decode(a.citizen.encrypted_mobile.encode()).decode('utf-8') if a.citizen else '',
                'category': a.grievance_category or 'General',
                'scheduled_time': f"{a.scheduled_start_time.strftime('%I:%M %p')} - {a.scheduled_end_time.strftime('%I:%M %p')}" if a.scheduled_start_time else '',
            }
            for a in appointments
        ]

        return JSONResponse({
            'has_availability': True,
            'total_slots': total_slots,
            'booked_slots': booked_slots,
            'remaining_slots': total_slots - booked_slots,
            'date': today.strftime('%d %b %Y'),
            'blocks': blocks,
            'appointments': appt_list,
        })

    except Exception as e:
        print(f"[ERROR] Failed to get today's schedule: {e}")
        return JSONResponse({
            'error': str(e)
        }, status_code=500)


@router.get("/admin/statistics")
async def get_statistics(
    db: AsyncSession = Depends(get_db),
    user: str = Depends(require_auth)
):
    """
    Admin: Get scheduling statistics.
    
    Returns:
        {
            "waiting_count": 25,
            "scheduled_today": 18,
            "oldest_waiting_days": 3
        }
    """
    try:
        from sqlalchemy import select, func
        from src.models.appointment_models import Appointment
        from datetime import date, datetime
        
        # Waiting count
        waiting_count = await db.scalar(
            select(func.count(Appointment.id))
            .where(Appointment.status == 'WAITING')
            .where(Appointment.schedule_meeting == True)
        ) or 0
        
        # Scheduled today
        today = date.today()
        scheduled_today = await db.scalar(
            select(func.count(Appointment.id))
            .where(Appointment.scheduled_date == today)
            .where(Appointment.status == 'SCHEDULED')
        ) or 0
        
        # Oldest waiting
        oldest_waiting = await db.scalar(
            select(Appointment.waiting_since)
            .where(Appointment.status == 'WAITING')
            .where(Appointment.schedule_meeting == True)
            .order_by(Appointment.waiting_since.asc())
            .limit(1)
        )
        
        oldest_waiting_days = 0
        if oldest_waiting:
            oldest_waiting_days = (datetime.utcnow() - oldest_waiting).days
        
        return JSONResponse({
            'waiting_count': waiting_count,
            'scheduled_today': scheduled_today,
            'oldest_waiting_days': oldest_waiting_days
        })
    
    except Exception as e:
        print(f"[ERROR] Failed to get statistics: {e}")
        return JSONResponse({
            'error': str(e)
        }, status_code=500)


@router.patch("/admin/reschedule/{appointment_id}")
async def reschedule_appointment(
    appointment_id: int,
    data: RescheduleRequest,
    db: AsyncSession = Depends(get_db),
    user: str = Depends(require_auth),
):
    """
    Admin: Reschedule an existing appointment to a new date/time.

    Releases the old slot and books a new one. Sends an SMS notification.
    """
    try:
        result = await scheduling_service.reschedule_appointment(
            db=db,
            appointment_id=appointment_id,
            new_datetime=data.new_datetime,
        )
        return JSONResponse(result)
    except ValueError as e:
        return JSONResponse({'error': str(e)}, status_code=404)
    except Exception as e:
        print(f"[ERROR] Failed to reschedule: {e}")
        return JSONResponse({'error': str(e)}, status_code=500)


@router.post("/admin/cancel-all-scheduled")
async def cancel_all_scheduled(
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: str = Depends(require_auth),
):
    """
    Admin: Emergency — move ALL scheduled appointments (today + future)
    back to the waiting queue and cancel all active availabilities.

    Use when the MLA is unexpectedly unavailable (emergency, urgent meeting, etc.).
    Appointments can be re-scheduled later by setting new availability.
    """
    try:
        result = await scheduling_service.cancel_all_scheduled(db)
        return JSONResponse(result)
    except Exception as e:
        print(f"[ERROR] Failed to cancel scheduled appointments: {e}")
        return JSONResponse({'error': str(e)}, status_code=500)
