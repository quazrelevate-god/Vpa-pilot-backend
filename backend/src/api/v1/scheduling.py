"""
API endpoints for MLA scheduling and availability management.
Handles citizen time window selection and admin availability management.
"""
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel, Field
from datetime import date as date_type, time as time_type
from typing import Optional, List

from src.core.database import get_db
from src.services.scheduling_service import scheduling_service
from src.api.v1.dashboard import require_auth
from src.models.scheduling_models import MLA, MLADailyAvailability

router = APIRouter(prefix="/api/v1/scheduling", tags=["scheduling"])


# Pydantic models for request validation
class SetAvailabilityRequest(BaseModel):
    mla_id: int = Field(..., description="MLA ID")
    date: date_type = Field(..., description="Date of availability")
    start_time: time_type = Field(..., description="Start time (e.g., 16:00)")
    end_time: time_type = Field(..., description="End time (e.g., 18:00)")
    slot_duration_minutes: int = Field(5, description="Slot duration in minutes")
    window_duration_minutes: int = Field(30, description="Window duration in minutes")


class ManualScheduleRequest(BaseModel):
    appointment_id: int = Field(..., description="Appointment ID to schedule")
    slot_id: int = Field(..., description="Target slot ID")


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
    Admin: Get today's schedule summary.
    
    Returns:
        {
            "has_availability": true,
            "total_slots": 24,
            "booked_slots": 18,
            "remaining_slots": 6,
            "time_range": "04:00 PM - 06:00 PM",
            "appointments": [...]
        }
    """
    try:
        from sqlalchemy import select
        from datetime import date
        
        today = date.today()
        
        availability = await db.scalar(
            select(MLADailyAvailability)
            .where(MLADailyAvailability.date == today)
            .where(MLADailyAvailability.status == 'ACTIVE')
        )
        
        if not availability:
            return JSONResponse({
                'has_availability': False,
                'message': 'No availability set for today'
            })
        
        return JSONResponse({
            'has_availability': True,
            'total_slots': availability.total_slots,
            'booked_slots': availability.booked_slots,
            'remaining_slots': availability.total_slots - availability.booked_slots,
            'time_range': f"{availability.start_time.strftime('%I:%M %p')} - {availability.end_time.strftime('%I:%M %p')}",
            'date': today.strftime('%d %b %Y')
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
