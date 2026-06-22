"""
Scheduling service — 30-minute fixed slots, 6 citizens max per slot.

Booking is concurrency-safe via SELECT ... FOR UPDATE: if two citizens
try to book the 6th seat simultaneously, the second transaction sees
booked_count == max_capacity after waiting for the lock and gets a
"Slot full" error with no double-booking.
"""
import base64
from datetime import datetime, date, time, timedelta
from typing import Optional, Dict, List

from sqlalchemy import select, func, delete
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from src.models.scheduling_models import (
    MLA,
    MLADailyAvailability,
    AppointmentSlot,
    SlotBooking,
    RescheduleLog,
    FIXED_START_TIME,
    FIXED_END_TIME,
    SLOT_DURATION,
    MAX_CAPACITY,
    TOTAL_SLOTS,
)
from src.models.appointment_models import Appointment, Citizen
from src.core.utils import utc_iso


def _decrypt(ciphertext: str) -> str:
    try:
        return base64.b64decode(ciphertext.encode()).decode("utf-8")
    except Exception:
        return ciphertext


def _slot_times() -> List[tuple]:
    """Return list of (slot_number, start_time, end_time) for all 20 slots."""
    slots = []
    current = datetime.combine(date.min, FIXED_START_TIME)
    end     = datetime.combine(date.min, FIXED_END_TIME)
    n = 1
    while current < end:
        slot_end = current + timedelta(minutes=SLOT_DURATION)
        slots.append((n, current.time(), slot_end.time()))
        current = slot_end
        n += 1
    return slots   # always 20 items


class SchedulingService:

    # ── Admin: open a date ───────────────────────────────────────────────────

    async def set_mla_availability(
        self,
        db: AsyncSession,
        mla_id: int,
        target_date: date,
        created_by: Optional[str] = None,
    ) -> Dict:
        """
        Open target_date for bookings.

        - Creates MLADailyAvailability + 20 AppointmentSlot rows.
        - If the date is already open with zero bookings, it is reset.
        - If any booking exists, raises ValueError.
        """
        if target_date < date.today():
            raise ValueError(
                f"Cannot open a past date ({target_date.strftime('%d %b %Y')}). "
                "Only today or future dates are allowed."
            )

        existing = await db.scalar(
            select(MLADailyAvailability)
            .where(MLADailyAvailability.mla_id == mla_id)
            .where(MLADailyAvailability.date    == target_date)
        )
        if existing:
            total_booked = await db.scalar(
                select(func.sum(AppointmentSlot.booked_count))
                .where(AppointmentSlot.availability_id == existing.id)
            ) or 0
            if total_booked > 0:
                raise ValueError(
                    f"{target_date.strftime('%d %b %Y')} already has {total_booked} booking(s). "
                    "Cancel existing bookings before resetting this date."
                )
            # No bookings — safe to recreate
            await db.execute(
                delete(AppointmentSlot)
                .where(AppointmentSlot.availability_id == existing.id)
            )
            await db.delete(existing)
            await db.flush()

        avail = MLADailyAvailability(
            mla_id     = mla_id,
            date       = target_date,
            start_time = FIXED_START_TIME,
            end_time   = FIXED_END_TIME,
            status     = "ACTIVE",
            created_by = created_by,
        )
        db.add(avail)
        await db.flush()

        for slot_num, start, end in _slot_times():
            db.add(AppointmentSlot(
                availability_id = avail.id,
                slot_number     = slot_num,
                start_time      = start,
                end_time        = end,
                status          = "AVAILABLE",
                max_capacity    = MAX_CAPACITY,
                booked_count    = 0,
            ))

        await db.commit()

        return {
            "availability_id": avail.id,
            "date":            target_date.isoformat(),
            "date_label":      target_date.strftime("%d %b %Y"),
            "total_slots":     TOTAL_SLOTS,
            "max_per_slot":    MAX_CAPACITY,
            "total_capacity":  TOTAL_SLOTS * MAX_CAPACITY,
            "message":         f"Opened {target_date.strftime('%d %b %Y')} — {TOTAL_SLOTS} slots, {MAX_CAPACITY} seats each.",
        }

    # ── Citizen: browse available slots ─────────────────────────────────────

    async def get_available_slots(
        self,
        db: AsyncSession,
        target_date: Optional[date] = None,
    ) -> Dict:
        """
        Return all 20 slots for target_date with per-slot availability.
        Used by the citizen form slot picker.
        """
        if target_date is None:
            target_date = date.today()

        avail = await db.scalar(
            select(MLADailyAvailability)
            .where(MLADailyAvailability.date   == target_date)
            .where(MLADailyAvailability.status == "ACTIVE")
        )
        if not avail:
            return {
                "available": False,
                "reason":    "NO_AVAILABILITY",
                "message":   "No meeting slots open for this date.",
                "date":      target_date.isoformat(),
                "slots":     [],
            }

        result = await db.execute(
            select(AppointmentSlot)
            .where(AppointmentSlot.availability_id == avail.id)
            .order_by(AppointmentSlot.slot_number)
        )
        slots = result.scalars().all()

        slot_list = []
        any_available = False
        for s in slots:
            remaining   = s.max_capacity - s.booked_count
            is_bookable = s.status == "AVAILABLE" and remaining > 0
            if is_bookable:
                any_available = True
            slot_list.append({
                "id":           s.id,
                "slot_number":  s.slot_number,
                "label":        f"{s.start_time.strftime('%I:%M %p')} – {s.end_time.strftime('%I:%M %p')}",
                "start":        s.start_time.strftime("%H:%M"),
                "end":          s.end_time.strftime("%H:%M"),
                "available":    is_bookable,
                "booked_count": s.booked_count,
                "max_capacity": s.max_capacity,
                "remaining":    remaining,
                "status":       s.status,
            })

        return {
            "available":    any_available,
            "date":         target_date.isoformat(),
            "date_label":   target_date.strftime("%d %b %Y"),
            "slots":        slot_list,
        }

    # ── Book a slot (concurrency-safe) ───────────────────────────────────────

    async def book_slot(
        self,
        db: AsyncSession,
        appointment: Appointment,
        slot_id: int,
        commit: bool = True,
    ) -> Dict:
        """
        Book citizen into slot_id using SELECT ... FOR UPDATE.

        If two citizens race for the last seat:
        - First one locks the row, increments booked_count, commits.
        - Second one waits, sees booked_count == max_capacity, raises ValueError.
        """
        slot = await db.scalar(
            select(AppointmentSlot)
            .where(AppointmentSlot.id == slot_id)
            .with_for_update()
        )
        if slot is None:
            raise ValueError("Slot not found.")
        if slot.status == "BLOCKED":
            raise ValueError("That slot has been blocked by the PA office.")
        if slot.booked_count >= slot.max_capacity:
            raise ValueError("Slot full, kindly select another slot.")

        # Calculate personal 5-min sub-slot BEFORE incrementing booked_count.
        # Person 1 → slot_start + 0 min, Person 2 → +5 min, ... Person 6 → +25 min.
        sub_index     = slot.booked_count  # 0-based before increment
        assigned_time = (
            datetime.combine(date.min, slot.start_time) + timedelta(minutes=sub_index * 5)
        ).time()

        # Reserve the seat
        slot.booked_count += 1
        if slot.booked_count >= slot.max_capacity:
            slot.status = "FULL"

        db.add(SlotBooking(slot_id=slot.id, appointment_id=appointment.id))

        avail = await db.get(MLADailyAvailability, slot.availability_id)
        appointment.status               = "SCHEDULED"
        appointment.scheduled_date       = avail.date
        appointment.scheduled_start_time = assigned_time   # personal 5-min slot
        appointment.scheduled_end_time   = slot.end_time
        appointment.appointment_slot_id  = slot.id

        if commit:
            await db.commit()
        else:
            await db.flush()

        return {
            "scheduled_date":  avail.date.isoformat(),
            "scheduled_time":  assigned_time.strftime("%H:%M"),
            "assigned_time":   assigned_time.strftime("%I:%M %p"),
            "slot_window":     f"{slot.start_time.strftime('%I:%M %p')} – {slot.end_time.strftime('%I:%M %p')}",
            "slot_id":         slot.id,
            "remaining_seats": slot.max_capacity - slot.booked_count,
        }

    # ── Release a slot booking ───────────────────────────────────────────────

    async def release_slot(
        self,
        db: AsyncSession,
        appointment: Appointment,
        commit: bool = True,
    ) -> None:
        """Remove the citizen's SlotBooking and decrement slot.booked_count."""
        if not appointment.appointment_slot_id:
            return

        await db.execute(
            delete(SlotBooking)
            .where(SlotBooking.appointment_id == appointment.id)
        )

        slot = await db.get(AppointmentSlot, appointment.appointment_slot_id)
        if slot:
            slot.booked_count = max(0, slot.booked_count - 1)
            if slot.status == "FULL" and slot.booked_count < slot.max_capacity:
                slot.status = "AVAILABLE"

        appointment.appointment_slot_id  = None
        appointment.scheduled_date       = None
        appointment.scheduled_start_time = None
        appointment.scheduled_end_time   = None

        if commit:
            await db.commit()
        else:
            await db.flush()

    # Backwards-compat alias used by dashboard_service
    async def release_appointment_slot(self, db, appointment, commit=True):
        return await self.release_slot(db, appointment, commit=commit)

    # ── Admin: block / unblock individual slots ──────────────────────────────

    async def block_slot(self, db: AsyncSession, slot_id: int) -> Dict:
        slot = await db.get(AppointmentSlot, slot_id)
        if slot is None:
            raise ValueError("Slot not found.")
        if slot.booked_count > 0:
            raise ValueError(
                f"Cannot block — slot already has {slot.booked_count} booking(s). "
                "Release those bookings first."
            )
        slot.status = "BLOCKED"
        await db.commit()
        return {"slot_id": slot_id, "status": "BLOCKED"}

    async def unblock_slot(self, db: AsyncSession, slot_id: int) -> Dict:
        slot = await db.get(AppointmentSlot, slot_id)
        if slot is None:
            raise ValueError("Slot not found.")
        slot.status = "AVAILABLE"
        await db.commit()
        return {"slot_id": slot_id, "status": "AVAILABLE"}

    # ── Admin: list open dates ───────────────────────────────────────────────

    async def get_open_dates(self, db: AsyncSession) -> List[Dict]:
        result = await db.execute(
            select(MLADailyAvailability)
            .where(MLADailyAvailability.status == "ACTIVE")
            .where(MLADailyAvailability.date   >= date.today())
            .order_by(MLADailyAvailability.date)
        )
        rows = []
        for a in result.scalars().all():
            # Compute live booking totals
            booked = await db.scalar(
                select(func.sum(AppointmentSlot.booked_count))
                .where(AppointmentSlot.availability_id == a.id)
            ) or 0
            blocked = await db.scalar(
                select(func.count(AppointmentSlot.id))
                .where(AppointmentSlot.availability_id == a.id)
                .where(AppointmentSlot.status          == "BLOCKED")
            ) or 0
            total_cap = TOTAL_SLOTS * MAX_CAPACITY
            rows.append({
                "id":             a.id,
                "date":           a.date.isoformat(),
                "date_label":     a.date.strftime("%d %b %Y"),
                "total_slots":    TOTAL_SLOTS,
                "total_capacity": total_cap,
                "booked":         booked,
                "blocked_slots":  blocked,
                "remaining":      total_cap - booked,
            })
        return rows

    # ── Admin: full slot grid for a specific date ────────────────────────────

    async def get_slots_for_date(self, db: AsyncSession, target_date: date) -> Dict:
        avail = await db.scalar(
            select(MLADailyAvailability)
            .where(MLADailyAvailability.date   == target_date)
            .where(MLADailyAvailability.status == "ACTIVE")
        )
        if not avail:
            return {"has_availability": False, "date": target_date.isoformat(), "slots": []}

        result = await db.execute(
            select(AppointmentSlot)
            .where(AppointmentSlot.availability_id == avail.id)
            .order_by(AppointmentSlot.slot_number)
        )
        slots = result.scalars().all()
        slot_list = []
        for s in slots:
            remaining = s.max_capacity - s.booked_count
            slot_list.append({
                "id":           s.id,
                "slot_number":  s.slot_number,
                "label":        f"{s.start_time.strftime('%I:%M %p')} – {s.end_time.strftime('%I:%M %p')}",
                "start":        s.start_time.strftime("%H:%M"),
                "end":          s.end_time.strftime("%H:%M"),
                "status":       s.status,
                "booked_count": s.booked_count,
                "max_capacity": s.max_capacity,
                "remaining":    remaining,
                "available":    s.status == "AVAILABLE" and remaining > 0,
            })

        booked_total  = sum(s["booked_count"] for s in slot_list)
        blocked_total = sum(1 for s in slot_list if s["status"] == "BLOCKED")
        return {
            "has_availability": True,
            "availability_id":  avail.id,
            "date":             target_date.isoformat(),
            "date_label":       target_date.strftime("%d %b %Y"),
            "total_slots":      TOTAL_SLOTS,
            "total_capacity":   TOTAL_SLOTS * MAX_CAPACITY,
            "booked_total":     booked_total,
            "blocked_slots":    blocked_total,
            "remaining_total":  TOTAL_SLOTS * MAX_CAPACITY - booked_total,
            "slots":            slot_list,
        }

    # ── Reschedule an appointment to a different slot ────────────────────────

    async def reschedule_appointment(
        self,
        db: AsyncSession,
        appointment_id: int,
        new_slot_id: int,
    ) -> Dict:
        appt = await db.scalar(
            select(Appointment)
            .options(selectinload(Appointment.citizen))
            .where(Appointment.id == appointment_id)
        )
        if not appt:
            raise ValueError(f"Appointment {appointment_id} not found.")

        old_slot_id = appt.appointment_slot_id
        await self.release_slot(db, appt, commit=False)
        result = await self.book_slot(db, appt, new_slot_id, commit=False)
        await db.commit()

        return {
            "appointment_id":  appt.id,
            "old_slot_id":     old_slot_id,
            "new_slot_id":     new_slot_id,
            "scheduled_date":  result["scheduled_date"],
            "scheduled_time":  result["scheduled_time"],
            "label":           result["label"],
        }

    # ── Waiting queue ────────────────────────────────────────────────────────

    async def move_to_waiting_queue(
        self,
        db: AsyncSession,
        appointment: Appointment,
        reason: str,
        commit: bool = True,
    ) -> Dict:
        appointment.status = "WAITING"
        appointment.waiting_since = datetime.utcnow()

        queue_count = await db.scalar(
            select(func.count(Appointment.id))
            .where(Appointment.status         == "WAITING")
            .where(Appointment.schedule_meeting == True)
        )
        appointment.queue_position = (queue_count or 0) + 1
        appointment.priority_score = 0

        if commit:
            await db.commit()
        else:
            await db.flush()

        return {
            "status":         "WAITING",
            "queue_position": appointment.queue_position,
            "reason":         reason,
        }

    async def get_waiting_queue(self, db: AsyncSession, limit: int = 100) -> List[Dict]:
        result = await db.execute(
            select(Appointment)
            .options(selectinload(Appointment.citizen))
            .where(Appointment.status          == "WAITING")
            .where(Appointment.schedule_meeting == True)
            .order_by(
                Appointment.priority_score.desc(),
                Appointment.created_at.asc(),
            )
            .limit(limit)
        )
        rows = []
        for appt in result.scalars().all():
            citizen = appt.citizen
            rows.append({
                "id":             appt.id,
                "token":          appt.token_assigned,
                "name":           _decrypt(appt.encrypted_name) if appt.encrypted_name else (_decrypt(citizen.encrypted_name) if citizen else "Unknown"),
                "mobile":         _decrypt(citizen.encrypted_mobile) if citizen else "Unknown",
                "category":       appt.grievance_category,
                "queue_position": appt.queue_position,
                "waiting_since":  utc_iso(appt.waiting_since),
                "priority_score": appt.priority_score,
                "created_at":     utc_iso(appt.created_at),
            })
        return rows

    # ── Emergency: cancel all today's scheduled appointments ─────────────────

    async def cancel_all_scheduled(self, db: AsyncSession) -> Dict:
        """
        Move today's SCHEDULED appointments back to waiting queue,
        release their SlotBookings, and cancel today's availability.
        """
        today = date.today()

        appt_result = await db.execute(
            select(Appointment)
            .where(Appointment.status         == "SCHEDULED")
            .where(Appointment.scheduled_date == today)
            .order_by(Appointment.scheduled_start_time)
        )
        appointments = appt_result.scalars().all()

        cancelled = 0
        for appt in appointments:
            await self.release_slot(db, appt, commit=False)
            appt.status        = "WAITING"
            appt.waiting_since = datetime.utcnow()
            appt.priority_score = 0
            queue_count = await db.scalar(
                select(func.count(Appointment.id))
                .where(Appointment.status == "WAITING")
            )
            appt.queue_position = (queue_count or 0) + 1
            cancelled += 1

        avail_result = await db.execute(
            select(MLADailyAvailability)
            .where(MLADailyAvailability.date   == today)
            .where(MLADailyAvailability.status == "ACTIVE")
        )
        cancelled_dates = 0
        for avail in avail_result.scalars().all():
            avail.status = "CANCELLED"
            cancelled_dates += 1

        await db.commit()
        return {
            "cancelled_appointments": cancelled,
            "cancelled_dates":        cancelled_dates,
            "message": (
                f"Moved {cancelled} appointment(s) to waiting queue. "
                f"Cancelled {cancelled_dates} availability record(s) for today."
            ),
        }

    # ── Statistics ───────────────────────────────────────────────────────────

    async def get_statistics(self, db: AsyncSession) -> Dict:
        waiting_count = await db.scalar(
            select(func.count(Appointment.id))
            .where(Appointment.status          == "WAITING")
            .where(Appointment.schedule_meeting == True)
        ) or 0

        today = date.today()
        scheduled_today = await db.scalar(
            select(func.count(Appointment.id))
            .where(Appointment.scheduled_date == today)
            .where(Appointment.status         == "SCHEDULED")
        ) or 0

        oldest_waiting = await db.scalar(
            select(Appointment.waiting_since)
            .where(Appointment.status          == "WAITING")
            .where(Appointment.schedule_meeting == True)
            .order_by(Appointment.waiting_since.asc())
            .limit(1)
        )
        oldest_days = (datetime.utcnow() - oldest_waiting).days if oldest_waiting else 0

        return {
            "waiting_count":       waiting_count,
            "scheduled_today":     scheduled_today,
            "oldest_waiting_days": oldest_days,
        }


# Singleton
scheduling_service = SchedulingService()
