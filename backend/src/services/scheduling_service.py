"""
Business logic for MLA scheduling and availability management.
Handles time slot generation, queue processing, and auto-scheduling.
"""
import asyncio
import base64
from datetime import datetime, date, time, timedelta
from typing import Optional, Dict, List
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_, or_, delete
from sqlalchemy.orm import selectinload

from src.models.scheduling_models import (
    MLA,
    MLADailyAvailability,
    TimeWindow,
    AppointmentSlot,
    RescheduleLog,
)
from src.models.appointment_models import Appointment, Citizen
from src.core.utils import utc_iso


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
        citizen_mobile: str,
        commit: bool = True
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
        
        if commit:
            await db.commit()
        else:
            await db.flush()
        
        return {
            'scheduled_date': availability.date,
            'scheduled_time': next_slot.start_time,
            'slot_id': next_slot.id,
            'window_label': window.window_label
        }
    
    async def release_appointment_slot(
        self,
        db: AsyncSession,
        appointment: Appointment,
        commit: bool = True
    ) -> None:
        """Release a booked slot back to the availability pool."""
        if not appointment.appointment_slot_id:
            return
        
        slot = await db.get(AppointmentSlot, appointment.appointment_slot_id)
        if not slot or slot.status != 'BOOKED':
            return
        
        slot.status = 'AVAILABLE'
        slot.appointment_id = None
        
        window = await db.scalar(
            select(TimeWindow)
            .where(TimeWindow.availability_id == slot.availability_id)
            .where(TimeWindow.window_start <= slot.start_time)
            .where(TimeWindow.window_end > slot.start_time)
        )
        if window:
            window.available_slots += 1
            window.is_available = True
        
        availability = await db.get(MLADailyAvailability, slot.availability_id)
        if availability:
            availability.booked_slots = max(0, availability.booked_slots - 1)
        
        appointment.appointment_slot_id = None
        appointment.preferred_window_id = None
        appointment.scheduled_date = None
        appointment.scheduled_start_time = None
        appointment.scheduled_end_time = None
        
        if commit:
            await db.commit()
        else:
            await db.flush()
    
    async def move_to_waiting_queue(
        self,
        db: AsyncSession,
        appointment: Appointment,
        reason: str,
        commit: bool = True
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
        
        if commit:
            await db.commit()
        else:
            await db.flush()
        
        return {
            'status': 'WAITING',
            'queue_position': appointment.queue_position,
            'reason': reason
        }
    
    async def try_auto_assign_slot(
        self,
        db: AsyncSession,
        appointment: Appointment,
        commit: bool = False
    ) -> bool:
        """
        Try to assign a single appointment to an available slot today.
        
        Returns True if assigned, False if no slots available (caller should
        fall back to waiting queue).
        """
        today = date.today()

        # Find all active availability blocks for today
        avail_result = await db.execute(
            select(MLADailyAvailability)
            .where(MLADailyAvailability.date == today)
            .where(MLADailyAvailability.status == 'ACTIVE')
            .order_by(MLADailyAvailability.start_time.asc())
        )
        availabilities = avail_result.scalars().all()

        if not availabilities:
            return False

        now_dt = datetime.now()

        for availability in availabilities:
            # Find first available slot in this block that hasn't passed
            slot_result = await db.execute(
                select(AppointmentSlot)
                .where(AppointmentSlot.availability_id == availability.id)
                .where(AppointmentSlot.status == 'AVAILABLE')
                .where(AppointmentSlot.start_time > now_dt.time())
                .order_by(AppointmentSlot.start_time.asc())
                .limit(1)
            )
            slot = slot_result.scalar_one_or_none()
            if not slot:
                continue

            # Book the slot
            slot.appointment_id = appointment.id
            slot.status = 'BOOKED'

            # Find which window this slot belongs to
            windows_result = await db.execute(
                select(TimeWindow)
                .where(TimeWindow.availability_id == availability.id)
            )
            for window in windows_result.scalars().all():
                if window.window_start <= slot.start_time < window.window_end:
                    window.available_slots -= 1
                    if window.available_slots == 0:
                        window.is_available = False
                    appointment.preferred_window_id = window.id
                    break

            # Update appointment
            appointment.status = 'SCHEDULED'
            appointment.scheduled_date = today
            appointment.scheduled_start_time = slot.start_time
            appointment.scheduled_end_time = slot.end_time
            appointment.appointment_slot_id = slot.id
            appointment.waiting_since = None
            appointment.queue_position = None
            appointment.priority_score = 0

            # Update availability booked count
            availability.booked_slots += 1

            if commit:
                await db.commit()
            else:
                await db.flush()

            return True

        return False
    
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
        
        # Skip slots that have already passed (only relevant for today)
        now_dt = datetime.now()
        current_time = start_time
        slots = []
        slot_num = 0
        
        for _ in range(total_slots):
            slot_end = (
                datetime.combine(date.min, current_time) + 
                timedelta(minutes=slot_duration_minutes)
            ).time()
            slot_num += 1
            
            # Skip slots that have already passed (only relevant for today)
            slot_start_dt = datetime.combine(now_dt.date(), current_time)
            if slot_start_dt <= now_dt:
                current_time = slot_end
                continue
            
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
        # Reject past dates entirely
        if target_date < date.today():
            raise ValueError(
                f"Cannot set availability for a past date ({target_date.strftime('%d %b %Y')}). "
                "Only today or future dates are allowed."
            )

        # Reject availability where the start or end time has already passed today
        if target_date == date.today():
            now = datetime.now().time()
            if start_time <= now:
                raise ValueError(
                    f"Cannot set availability in the past. "
                    f"Start time {start_time.strftime('%H:%M')} has already passed."
                )
            if end_time <= now:
                raise ValueError(
                    f"Cannot set availability in the past. "
                    f"End time {end_time.strftime('%H:%M')} has already passed."
                )

        # Calculate total slots
        total_minutes = (
            datetime.combine(date.min, end_time) - 
            datetime.combine(date.min, start_time)
        ).total_seconds() / 60
        total_slots = int(total_minutes / slot_duration_minutes)
        
        # Check for time overlap with existing availability on the same date
        overlapping_result = await db.execute(
            select(MLADailyAvailability)
            .where(MLADailyAvailability.mla_id == mla_id)
            .where(MLADailyAvailability.date == target_date)
            .where(
                or_(
                    # New block starts during existing block
                    and_(
                        MLADailyAvailability.start_time <= start_time,
                        MLADailyAvailability.end_time > start_time
                    ),
                    # New block ends during existing block
                    and_(
                        MLADailyAvailability.start_time < end_time,
                        MLADailyAvailability.end_time >= end_time
                    ),
                    # New block completely contains existing block
                    and_(
                        MLADailyAvailability.start_time >= start_time,
                        MLADailyAvailability.end_time <= end_time
                    )
                )
            )
        )
        overlapping = overlapping_result.scalars().all()

        if overlapping:
            # Check if any overlapping block has booked slots
            for existing in overlapping:
                booked_count = await db.scalar(
                    select(func.count(AppointmentSlot.id))
                    .where(AppointmentSlot.availability_id == existing.id)
                    .where(AppointmentSlot.status == 'BOOKED')
                ) or 0

                if booked_count > 0:
                    raise ValueError(
                        f"Time overlap detected with existing availability "
                        f"({existing.start_time.strftime('%H:%M')}-{existing.end_time.strftime('%H:%M')}) "
                        f"that has {booked_count} booked slot(s). "
                        "Cancel or reschedule existing appointments before changing."
                    )

                # Remove overlapping availability with no bookings
                await db.execute(delete(AppointmentSlot).where(AppointmentSlot.availability_id == existing.id))
                await db.execute(delete(TimeWindow).where(TimeWindow.availability_id == existing.id))
                await db.delete(existing)
            
            await db.flush()

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
        
        # Get available slots (skip past slots if scheduling for today)
        slot_query = (
            select(AppointmentSlot)
            .where(AppointmentSlot.availability_id == availability_id)
            .where(AppointmentSlot.status == 'AVAILABLE')
            .order_by(AppointmentSlot.slot_number)
        )
        if target_date == date.today():
            slot_query = slot_query.where(AppointmentSlot.start_time > datetime.now().time())
        available_slots = await db.execute(slot_query.limit(max_slots))
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
        
        # Update availability booked count (preserve slots booked concurrently)
        availability = await db.get(MLADailyAvailability, availability_id)
        availability.booked_slots += scheduled_count
        
        # Collect notification data while objects are still session-attached
        payloads = [
            self._notification_payload(appt)
            for appt in waiting_appointments[:scheduled_count]
        ]

        await db.commit()

        # SMS notifications disabled — only OTP SMS is sent
        # for p in payloads:
        #     asyncio.create_task(self._send_schedule_notification(**p))
        
        return scheduled_count
    
    async def _send_schedule_notification(
        self,
        citizen_name: str,
        citizen_mobile: str,
        scheduled_date: str,
        scheduled_time: str,
        token: int,
    ):
        """
        Send SMS notification for scheduled appointment.
        Accepts pre-extracted plain-Python values so this coroutine never
        touches SQLAlchemy ORM objects — avoids greenlet_spawn issues when
        running as an asyncio.create_task fire-and-forget.
        """
        try:
            from src.core.config import settings
            import httpx

            message = (
                f"Dear {citizen_name}, your MLA meeting is scheduled for "
                f"{scheduled_date} at {scheduled_time}. Token: {token}. "
                f"Please arrive 10 minutes early."
            )

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
                        "PhoneNumber": phone,
                    },
                )
                resp.raise_for_status()
                print(f"[SMS SCHEDULE SUCCESS] Sent to {phone}: {message}")

        except Exception as e:
            print(f"[SMS NOTIFICATION ERROR] Failed to send schedule SMS: {e}")

    async def cancel_all_scheduled(
        self,
        db: AsyncSession,
    ) -> Dict:
        """
        Emergency: Move today's scheduled appointments back to the waiting
        queue and cancel today's active availabilities.

        Only affects TODAY — future availabilities and future scheduled
        appointments are left untouched.

        Returns:
            {"cancelled_appointments": N, "cancelled_availabilities": M}
        """
        today = date.today()
        now = datetime.now()

        # 1. Fetch SCHEDULED appointments for TODAY with upcoming start times
        appt_result = await db.execute(
            select(Appointment)
            .where(Appointment.status == 'SCHEDULED')
            .where(Appointment.scheduled_date == today)
            .where(Appointment.scheduled_start_time >= now.time())
            .order_by(Appointment.scheduled_start_time.asc())
        )
        appointments = appt_result.scalars().all()

        cancelled_appointments = 0
        for appt in appointments:
            # Release the slot back to the pool
            await self.release_appointment_slot(db, appt, commit=False)

            # Move to waiting queue
            appt.status = 'WAITING'
            appt.waiting_since = datetime.utcnow()
            appt.priority_score = 0

            # Compute queue position incrementally
            queue_count = await db.scalar(
                select(func.count(Appointment.id))
                .where(Appointment.status == 'WAITING')
                .where(Appointment.schedule_meeting == True)
            )
            appt.queue_position = (queue_count or 0) + 1

            cancelled_appointments += 1

        # 2. Mark TODAY's ACTIVE availabilities as CANCELLED
        avail_result = await db.execute(
            select(MLADailyAvailability)
            .where(MLADailyAvailability.date == today)
            .where(MLADailyAvailability.status == 'ACTIVE')
        )
        availabilities = avail_result.scalars().all()

        cancelled_availabilities = 0
        for avail in availabilities:
            avail.status = 'CANCELLED'
            cancelled_availabilities += 1

        await db.commit()

        return {
            "cancelled_appointments": cancelled_appointments,
            "cancelled_availabilities": cancelled_availabilities,
            "message": (
                f"Moved {cancelled_appointments} scheduled appointment(s) to waiting queue. "
                f"Cancelled {cancelled_availabilities} availability block(s) for today."
            ),
        }

    def _notification_payload(self, appt: Appointment) -> dict:
        """
        Extract all SMS-relevant data from a loaded Appointment while the
        session is still open (before commit / detach).
        Returns a plain dict so no ORM objects leak into background tasks.
        """
        citizen = appt.citizen  # must have been selectinloaded by caller
        return {
            "citizen_name": _decrypt_field(appt.encrypted_name) if appt.encrypted_name else (_decrypt_field(citizen.encrypted_name) if citizen else "Citizen"),
            "citizen_mobile": _decrypt_field(citizen.encrypted_mobile) if citizen else "",
            "scheduled_date": appt.scheduled_date.strftime("%d %b %Y") if appt.scheduled_date else "",
            "scheduled_time": appt.scheduled_start_time.strftime("%I:%M %p") if appt.scheduled_start_time else "",
            "token": appt.token_assigned,
        }
    
    async def schedule_selected_waiting(
        self,
        db: AsyncSession,
        appointment_ids: List[int],
        mla_id: int,
        target_date: date,
        start_time: time,
        end_time: time,
        slot_duration_minutes: int = 10,
    ) -> Dict:
        """
        Assign a list of WAITING appointments to freshly generated slots.

        Creates (or reuses) an MLADailyAvailability row for the given date,
        generates slots, and assigns each selected appointment to the next
        available slot in order. Appointments whose IDs are not in WAITING
        state are silently skipped.

        Returns:
            {"scheduled": N, "skipped": [ids that had no slot or wrong state]}
        """
        # Resolve / create availability — match by exact date AND time range
        existing_avail = await db.scalar(
            select(MLADailyAvailability)
            .where(MLADailyAvailability.mla_id == mla_id)
            .where(MLADailyAvailability.date == target_date)
            .where(MLADailyAvailability.start_time == start_time)
            .where(MLADailyAvailability.end_time == end_time)
        )

        if existing_avail:
            availability = existing_avail
        else:
            # Check for overlap with any existing availability block on the same date
            overlap_result = await db.execute(
                select(MLADailyAvailability)
                .where(MLADailyAvailability.mla_id == mla_id)
                .where(MLADailyAvailability.date == target_date)
                .where(
                    or_(
                        # New block starts inside an existing block
                        and_(
                            MLADailyAvailability.start_time <= start_time,
                            MLADailyAvailability.end_time > start_time
                        ),
                        # New block ends inside an existing block
                        and_(
                            MLADailyAvailability.start_time < end_time,
                            MLADailyAvailability.end_time >= end_time
                        ),
                        # New block completely contains an existing block
                        and_(
                            MLADailyAvailability.start_time >= start_time,
                            MLADailyAvailability.end_time <= end_time
                        )
                    )
                )
            )
            overlapping = overlap_result.scalars().all()
            if overlapping:
                conflict = overlapping[0]
                raise ValueError(
                    f"Time range {start_time.strftime('%H:%M')}-{end_time.strftime('%H:%M')} "
                    f"overlaps with existing availability "
                    f"{conflict.start_time.strftime('%H:%M')}-{conflict.end_time.strftime('%H:%M')}. "
                    "Choose a non-overlapping time range."
                )

            total_minutes = (
                datetime.combine(date.min, end_time) -
                datetime.combine(date.min, start_time)
            ).total_seconds() / 60
            total_slots = int(total_minutes / slot_duration_minutes)

            availability = MLADailyAvailability(
                mla_id=mla_id,
                date=target_date,
                start_time=start_time,
                end_time=end_time,
                slot_duration_minutes=slot_duration_minutes,
                total_slots=total_slots,
                booked_slots=0,
                status='ACTIVE',
                created_by="admin",
            )
            db.add(availability)
            await db.flush()

            await self.generate_appointment_slots(
                db, availability.id, start_time, end_time, slot_duration_minutes
            )

        # Fetch free slots ordered by start time
        free_slots_result = await db.execute(
            select(AppointmentSlot)
            .where(AppointmentSlot.availability_id == availability.id)
            .where(AppointmentSlot.status == 'AVAILABLE')
            .order_by(AppointmentSlot.start_time.asc())
        )
        free_slots = list(free_slots_result.scalars().all())

        # Fetch the selected waiting appointments ordered by priority / age
        appts_result = await db.execute(
            select(Appointment)
            .options(selectinload(Appointment.citizen))
            .where(Appointment.id.in_(appointment_ids))
            .where(Appointment.status == 'WAITING')
            .order_by(Appointment.priority_score.desc(), Appointment.waiting_since.asc())
        )
        waiting_appts = list(appts_result.scalars().all())
        waiting_ids = {a.id for a in waiting_appts}
        skipped = [i for i in appointment_ids if i not in waiting_ids]
        
        # Debug: log why appointments were skipped
        if skipped:
            all_appts_result = await db.execute(
                select(Appointment.id, Appointment.status, Appointment.schedule_meeting)
                .where(Appointment.id.in_(skipped))
            )
            for appt_id, status, schedule_meeting in all_appts_result:
                print(f"[SCHEDULE SKIP] Appointment {appt_id}: status={status}, schedule_meeting={schedule_meeting}")

        scheduled_count = 0
        notifications = []

        for appt, slot in zip(waiting_appts, free_slots):
            slot.status = 'BOOKED'
            slot.appointment_id = appt.id

            appt.status = 'SCHEDULED'
            appt.appointment_slot_id = slot.id
            appt.scheduled_date = target_date
            appt.scheduled_start_time = slot.start_time
            appt.scheduled_end_time = slot.end_time
            appt.waiting_since = None
            appt.queue_position = None
            appt.priority_score = 0

            availability.booked_slots += 1
            scheduled_count += 1
            notifications.append(appt)

        # Appointments with no matching slot go back to skipped list
        if len(waiting_appts) > len(free_slots):
            skipped += [a.id for a in waiting_appts[len(free_slots):]]

        # Collect notification data while objects are still session-attached
        payloads = [self._notification_payload(appt) for appt in notifications]

        await db.commit()

        # SMS notifications disabled — only OTP SMS is sent
        # for p in payloads:
        #     asyncio.create_task(self._send_schedule_notification(**p))

        return {"scheduled": scheduled_count, "skipped": skipped}

    async def reschedule_appointment(
        self,
        db: AsyncSession,
        appointment_id: int,
        new_datetime: datetime,
    ) -> Dict:
        """
        Reschedule a SCHEDULED appointment to a new date/time.

        Releases the existing slot, creates a bare slot on the target
        date (without a full availability window), updates the appointment
        to SCHEDULED with the new time.
        """
        appt = await db.scalar(
            select(Appointment)
            .options(selectinload(Appointment.citizen))
            .where(Appointment.id == appointment_id)
        )
        if not appt:
            raise ValueError(f"Appointment {appointment_id} not found")

        # Release old slot if any
        await self.release_appointment_slot(db, appt, commit=False)

        # Resolve MLA — pick first active MLA
        mla = await db.scalar(
            select(MLA).where(MLA.is_active == True).limit(1)
        )
        mla_id = mla.id if mla else 1

        new_date = new_datetime.date()
        slot_start = new_datetime.time()
        slot_end = (new_datetime + timedelta(minutes=10)).time()

        # Reuse or create availability for the target date
        availability = await db.scalar(
            select(MLADailyAvailability)
            .where(MLADailyAvailability.mla_id == mla_id)
            .where(MLADailyAvailability.date == new_date)
        )
        if not availability:
            availability = MLADailyAvailability(
                mla_id=mla_id,
                date=new_date,
                start_time=slot_start,
                end_time=slot_end,
                slot_duration_minutes=10,
                total_slots=1,
                booked_slots=0,
                is_active=True,
                created_by="admin",
            )
            db.add(availability)
            await db.flush()

        new_slot = AppointmentSlot(
            availability_id=availability.id,
            slot_number=availability.booked_slots + 1,
            start_time=slot_start,
            end_time=slot_end,
            status='BOOKED',
            appointment_id=appt.id,
        )
        db.add(new_slot)
        await db.flush()

        appt.status = 'SCHEDULED'
        appt.appointment_slot_id = new_slot.id
        appt.scheduled_date = new_date
        appt.scheduled_start_time = slot_start
        appt.scheduled_end_time = slot_end
        appt.waiting_since = None
        appt.queue_position = None

        availability.booked_slots += 1

        payload = self._notification_payload(appt)
        await db.commit()
        # SMS notification disabled — only OTP SMS is sent
        # asyncio.create_task(self._send_schedule_notification(**payload))

        return {
            "appointment_id": appt.id,
            "scheduled_date": new_date.isoformat(),
            "scheduled_time": slot_start.strftime("%H:%M"),
        }

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
                'name': _decrypt_field(appt.encrypted_name) if appt.encrypted_name else (_decrypt_field(citizen.encrypted_name) if citizen else 'Unknown'),
                'mobile': _decrypt_field(citizen.encrypted_mobile) if citizen else 'Unknown',
                'category': appt.grievance_category,
                'queue_position': appt.queue_position,
                'waiting_since': utc_iso(appt.waiting_since),
                'priority_score': appt.priority_score,
                'created_at': utc_iso(appt.created_at)
            })
        
        return result


# Singleton instance
scheduling_service = SchedulingService()
