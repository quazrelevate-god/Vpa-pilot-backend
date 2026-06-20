"""
Business logic for MLA scheduling and availability management.
Handles time slot generation, queue processing, and auto-scheduling.
"""
import asyncio
import base64
from datetime import datetime, date, time, timedelta
from typing import Optional, Dict, List
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_, or_
from sqlalchemy.orm import selectinload

from src.models.scheduling_models import (
    MLA,
    MLADailyAvailability,
    TimeWindow,
    AppointmentSlot,
    RescheduleLog,
)
from src.models.appointment_models import Appointment, Citizen


def _decrypt_field(ciphertext: str) -> str:
    """Decrypt base64-encoded field."""
    try:
        return base64.b64decode(ciphertext.encode()).decode("utf-8")
    except Exception:
        return ciphertext


class SchedulingService:
    """Service for MLA scheduling and availability management."""
    
    async def get_available_time_windows(
        self,
        db: AsyncSession,
        target_date: date = None
    ) -> Dict:
        """
        Get available time windows for citizen selection.
        
        Args:
            db: Database session
            target_date: Date to check (defaults to today)
            
        Returns:
            Dict with availability status and windows list
        """
        if target_date is None:
            target_date = date.today()
        
        # Check if MLA has set availability for this date
        availability = await db.scalar(
            select(MLADailyAvailability)
            .where(MLADailyAvailability.date == target_date)
            .where(MLADailyAvailability.status == 'ACTIVE')
        )
        
        if not availability:
            return {
                'available': False,
                'reason': 'NO_AVAILABILITY',
                'message': 'MLA is not available today',
                'windows': []
            }
        
        # Check if capacity is full
        if availability.booked_slots >= availability.total_slots:
            return {
                'available': False,
                'reason': 'CAPACITY_FULL',
                'total_slots': availability.total_slots,
                'booked_slots': availability.booked_slots,
                'message': f'All {availability.total_slots} slots are full',
                'windows': []
            }
        
        # Get available windows
        windows = await db.execute(
            select(TimeWindow)
            .where(TimeWindow.availability_id == availability.id)
            .where(TimeWindow.available_slots > 0)
            .order_by(TimeWindow.window_start)
        )
        windows = windows.scalars().all()
        
        result = []
        for window in windows:
            result.append({
                'id': window.id,
                'label': window.window_label,
                'start': window.window_start.strftime('%H:%M'),
                'end': window.window_end.strftime('%H:%M'),
                'available_slots': window.available_slots,
                'total_slots': window.total_slots_in_window
            })
        
        return {
            'available': True,
            'total_slots': availability.total_slots,
            'booked_slots': availability.booked_slots,
            'remaining_slots': availability.total_slots - availability.booked_slots,
            'windows': result
        }
    
    async def book_appointment_with_window(
        self,
        db: AsyncSession,
        appointment: Appointment,
        preferred_window_id: int,
        citizen_name: str,
        citizen_mobile: str
    ) -> Dict:
        """
        Book appointment within citizen's preferred time window.
        Auto-assigns next available slot in that window.
        
        Args:
            db: Database session
            appointment: Appointment object
            preferred_window_id: Selected time window ID
            citizen_name: Citizen's name for SMS
            citizen_mobile: Citizen's mobile for SMS
            
        Returns:
            Dict with scheduling details
        """
        # Get the preferred time window
        window = await db.get(TimeWindow, preferred_window_id)
        
        if not window or window.available_slots == 0:
            raise ValueError("Selected time window is full")
        
        # Find next available slot in this window
        next_slot = await db.scalar(
            select(AppointmentSlot)
            .where(AppointmentSlot.availability_id == window.availability_id)
            .where(AppointmentSlot.start_time >= window.window_start)
            .where(AppointmentSlot.start_time < window.window_end)
            .where(AppointmentSlot.status == 'AVAILABLE')
            .order_by(AppointmentSlot.slot_number)
            .limit(1)
        )
        
        if not next_slot:
            raise ValueError("No available slots in selected window")
        
        # Book the slot
        next_slot.appointment_id = appointment.id
        next_slot.status = 'BOOKED'
        
        # Update window availability
        window.available_slots -= 1
        if window.available_slots == 0:
            window.is_available = False
        
        # Update availability booked count
        availability = await db.get(MLADailyAvailability, window.availability_id)
        availability.booked_slots += 1
        
        # Update appointment
        appointment.status = 'SCHEDULED'
        appointment.scheduled_date = availability.date
        appointment.scheduled_start_time = next_slot.start_time
        appointment.scheduled_end_time = next_slot.end_time
        appointment.appointment_slot_id = next_slot.id
        appointment.preferred_window_id = preferred_window_id
        
        await db.commit()
        
        return {
            'scheduled_date': availability.date,
            'scheduled_time': next_slot.start_time,
            'slot_id': next_slot.id,
            'window_label': window.window_label
        }
    
    async def move_to_waiting_queue(
        self,
        db: AsyncSession,
        appointment: Appointment,
        reason: str
    ) -> Dict:
        """
        Move appointment to waiting queue.
        
        Args:
            db: Database session
            appointment: Appointment object
            reason: Reason code (NO_AVAILABILITY_TODAY, CAPACITY_FULL)
            
        Returns:
            Dict with queue status
        """
        appointment.status = 'WAITING'
        appointment.waiting_since = datetime.utcnow()
        
        # Calculate queue position
        queue_count = await db.scalar(
            select(func.count(Appointment.id))
            .where(Appointment.status == 'WAITING')
            .where(Appointment.schedule_meeting == True)
        )
        appointment.queue_position = (queue_count or 0) + 1
        
        # Initialize priority score (will increase daily)
        appointment.priority_score = 0
        
        await db.commit()
        
        return {
            'status': 'WAITING',
            'queue_position': appointment.queue_position,
            'reason': reason
        }
    
    async def generate_time_windows(
        self,
        db: AsyncSession,
        availability_id: int,
        start_time: time,
        end_time: time,
        window_duration_minutes: int = 30
    ) -> List[TimeWindow]:
        """
        Generate 30-minute time windows from MLA's availability.
        
        Args:
            db: Database session
            availability_id: MLADailyAvailability ID
            start_time: Start time of availability
            end_time: End time of availability
            window_duration_minutes: Duration of each window (default 30)
            
        Returns:
            List of created TimeWindow objects
        """
        availability = await db.get(MLADailyAvailability, availability_id)
        slot_duration = availability.slot_duration_minutes
        
        # Calculate slots per window
        slots_per_window = window_duration_minutes // slot_duration
        
        current_time = start_time
        windows = []
        
        while current_time < end_time:
            window_end = (
                datetime.combine(date.min, current_time) + 
                timedelta(minutes=window_duration_minutes)
            ).time()
            
            if window_end > end_time:
                window_end = end_time
                # Recalculate slots for partial window
                remaining_minutes = (
                    datetime.combine(date.min, window_end) - 
                    datetime.combine(date.min, current_time)
                ).total_seconds() / 60
                slots_per_window = int(remaining_minutes // slot_duration)
            
            # Format label
            label = f"{current_time.strftime('%I:%M %p')} - {window_end.strftime('%I:%M %p')}"
            
            window = TimeWindow(
                availability_id=availability_id,
                window_start=current_time,
                window_end=window_end,
                window_label=label,
                total_slots_in_window=slots_per_window,
                available_slots=slots_per_window,
                is_available=True
            )
            db.add(window)
            windows.append(window)
            
            current_time = window_end
        
        await db.flush()
        return windows
    
    async def generate_appointment_slots(
        self,
        db: AsyncSession,
        availability_id: int,
        start_time: time,
        end_time: time,
        slot_duration_minutes: int = 5
    ) -> List[AppointmentSlot]:
        """
        Generate individual appointment slots.
        
        Args:
            db: Database session
            availability_id: MLADailyAvailability ID
            start_time: Start time
            end_time: End time
            slot_duration_minutes: Duration of each slot (default 5)
            
        Returns:
            List of created AppointmentSlot objects
        """
        # Calculate total slots
        total_minutes = (
            datetime.combine(date.min, end_time) - 
            datetime.combine(date.min, start_time)
        ).total_seconds() / 60
        total_slots = int(total_minutes / slot_duration_minutes)
        
        current_time = start_time
        slots = []
        
        for slot_num in range(1, total_slots + 1):
            slot_end = (
                datetime.combine(date.min, current_time) + 
                timedelta(minutes=slot_duration_minutes)
            ).time()
            
            slot = AppointmentSlot(
                availability_id=availability_id,
                slot_number=slot_num,
                start_time=current_time,
                end_time=slot_end,
                status='AVAILABLE'
            )
            db.add(slot)
            slots.append(slot)
            
            current_time = slot_end
        
        await db.flush()
        return slots
    
    async def set_mla_availability(
        self,
        db: AsyncSession,
        mla_id: int,
        target_date: date,
        start_time: time,
        end_time: time,
        slot_duration_minutes: int = 5,
        window_duration_minutes: int = 30,
        created_by: str = None
    ) -> Dict:
        """
        Set MLA availability and auto-schedule waiting queue.
        
        Args:
            db: Database session
            mla_id: MLA ID
            target_date: Date of availability
            start_time: Start time
            end_time: End time
            slot_duration_minutes: Slot duration (default 5)
            window_duration_minutes: Window duration (default 30)
            created_by: Admin username
            
        Returns:
            Dict with creation summary
        """
        # Calculate total slots
        total_minutes = (
            datetime.combine(date.min, end_time) - 
            datetime.combine(date.min, start_time)
        ).total_seconds() / 60
        total_slots = int(total_minutes / slot_duration_minutes)
        
        # Create availability record
        availability = MLADailyAvailability(
            mla_id=mla_id,
            date=target_date,
            start_time=start_time,
            end_time=end_time,
            slot_duration_minutes=slot_duration_minutes,
            total_slots=total_slots,
            booked_slots=0,
            status='ACTIVE',
            created_by=created_by
        )
        db.add(availability)
        await db.flush()
        
        # Generate slots
        await self.generate_appointment_slots(
            db,
            availability.id,
            start_time,
            end_time,
            slot_duration_minutes
        )
        
        # Generate time windows
        await self.generate_time_windows(
            db,
            availability.id,
            start_time,
            end_time,
            window_duration_minutes
        )
        
        await db.commit()
        
        # Auto-schedule waiting queue
        scheduled_count = await self.auto_schedule_waiting_queue(
            db,
            availability.id,
            target_date,
            max_slots=total_slots
        )
        
        # Get remaining waiting count
        remaining_waiting = await db.scalar(
            select(func.count(Appointment.id))
            .where(Appointment.status == 'WAITING')
            .where(Appointment.schedule_meeting == True)
        ) or 0
        
        return {
            'availability_id': availability.id,
            'date': target_date.strftime('%d %b %Y'),
            'time_range': f"{start_time.strftime('%I:%M %p')} - {end_time.strftime('%I:%M %p')}",
            'total_slots': total_slots,
            'scheduled_from_queue': scheduled_count,
            'remaining_in_queue': remaining_waiting,
            'message': f"Created {total_slots} slots. Scheduled {scheduled_count} waiting appointments. {remaining_waiting} still waiting."
        }
    
    async def auto_schedule_waiting_queue(
        self,
        db: AsyncSession,
        availability_id: int,
        target_date: date,
        max_slots: int = 24
    ) -> int:
        """
        Auto-schedule waiting appointments with priority.
        
        Args:
            db: Database session
            availability_id: MLADailyAvailability ID
            target_date: Target date for scheduling
            max_slots: Maximum slots to fill
            
        Returns:
            Number of appointments scheduled
        """
        # Get waiting appointments (priority order)
        waiting_appointments = await db.execute(
            select(Appointment)
            .options(selectinload(Appointment.citizen))
            .where(Appointment.status == 'WAITING')
            .where(Appointment.schedule_meeting == True)
            .order_by(
                Appointment.priority_score.desc(),
                Appointment.created_at.asc()
            )
            .limit(max_slots)
        )
        waiting_appointments = waiting_appointments.scalars().all()
        
        # Get available slots
        available_slots = await db.execute(
            select(AppointmentSlot)
            .where(AppointmentSlot.availability_id == availability_id)
            .where(AppointmentSlot.status == 'AVAILABLE')
            .order_by(AppointmentSlot.slot_number)
            .limit(max_slots)
        )
        available_slots = available_slots.scalars().all()
        
        # Get time windows
        windows_result = await db.execute(
            select(TimeWindow)
            .where(TimeWindow.availability_id == availability_id)
        )
        windows = {w.id: w for w in windows_result.scalars().all()}
        
        scheduled_count = 0
        
        # Schedule appointments to slots
        for appointment, slot in zip(waiting_appointments, available_slots):
            # Book the slot
            slot.appointment_id = appointment.id
            slot.status = 'BOOKED'
            
            # Find which window this slot belongs to
            for window_id, window in windows.items():
                if window.window_start <= slot.start_time < window.window_end:
                    window.available_slots -= 1
                    if window.available_slots == 0:
                        window.is_available = False
                    appointment.preferred_window_id = window_id
                    break
            
            # Update appointment
            appointment.status = 'SCHEDULED'
            appointment.scheduled_date = target_date
            appointment.scheduled_start_time = slot.start_time
            appointment.scheduled_end_time = slot.end_time
            appointment.appointment_slot_id = slot.id
            appointment.waiting_since = None
            appointment.queue_position = None
            appointment.priority_score = 0
            
            scheduled_count += 1
        
        # Update availability booked count
        availability = await db.get(MLADailyAvailability, availability_id)
        availability.booked_slots = scheduled_count
        
        await db.commit()
        
        # Send SMS notifications (fire-and-forget)
        for appointment in waiting_appointments[:scheduled_count]:
            asyncio.create_task(self._send_schedule_notification(appointment))
        
        return scheduled_count
    
    async def _send_schedule_notification(self, appointment: Appointment):
        """
        Send SMS notification for scheduled appointment.
        Fire-and-forget helper.
        """
        try:
            from src.services.appointment_service import appointment_service
            from src.core.config import settings
            import httpx
            
            citizen = appointment.citizen
            if not citizen:
                return
            
            citizen_name = _decrypt_field(citizen.encrypted_name)
            citizen_mobile = _decrypt_field(citizen.encrypted_mobile)
            
            # Format the scheduling message
            scheduled_date = appointment.scheduled_date.strftime('%d %b %Y')
            scheduled_time = appointment.scheduled_start_time.strftime('%I:%M %p')
            
            message = (
                f"Dear {citizen_name}, your MLA meeting is scheduled for "
                f"{scheduled_date} at {scheduled_time}. Token: {appointment.token_assigned}. "
                f"Please arrive 10 minutes early."
            )
            
            # Send SMS using APM API
            if not settings.APM_SMS_API_KEY:
                print(f"[SMS SCHEDULE DUMMY] {message}")
                return
            
            phone = citizen_mobile.lstrip("+")
            if phone.startswith("91") and len(phone) == 12:
                phone = phone[2:]
            
            async with httpx.AsyncClient(timeout=10) as client:
                resp = await client.post(
                    "https://sms.apmtechnologies.in/api/Home/ForgotPassword",
                    params={
                        "ApiKey": settings.APM_SMS_API_KEY,
                        "PhoneNumber": phone
                    },
                )
                resp.raise_for_status()
                print(f"[SMS SCHEDULE SUCCESS] Sent to {phone}: {message}")
                
        except Exception as e:
            print(f"[SMS NOTIFICATION ERROR] Failed to send schedule SMS: {e}")
    
    async def get_waiting_queue(
        self,
        db: AsyncSession,
        limit: int = 100
    ) -> List[Dict]:
        """
        Get waiting queue with citizen details.
        
        Args:
            db: Database session
            limit: Maximum records to return
            
        Returns:
            List of waiting appointments with details
        """
        waiting = await db.execute(
            select(Appointment)
            .options(selectinload(Appointment.citizen))
            .where(Appointment.status == 'WAITING')
            .where(Appointment.schedule_meeting == True)
            .order_by(
                Appointment.priority_score.desc(),
                Appointment.created_at.asc()
            )
            .limit(limit)
        )
        waiting = waiting.scalars().all()
        
        result = []
        for appt in waiting:
            citizen = appt.citizen
            result.append({
                'id': appt.id,
                'token': appt.token_assigned,
                'name': _decrypt_field(citizen.encrypted_name) if citizen else 'Unknown',
                'mobile': _decrypt_field(citizen.encrypted_mobile) if citizen else 'Unknown',
                'category': appt.grievance_category,
                'queue_position': appt.queue_position,
                'waiting_since': appt.waiting_since.strftime('%Y-%m-%d %H:%M') if appt.waiting_since else None,
                'priority_score': appt.priority_score,
                'created_at': appt.created_at.strftime('%Y-%m-%d %H:%M')
            })
        
        return result


# Singleton instance
scheduling_service = SchedulingService()
