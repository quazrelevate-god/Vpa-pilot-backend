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
from src.models.appointment_models import Appointment, Citizen, AppointmentEvent
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
        max_capacity: int = MAX_CAPACITY,
        available_from: Optional[time] = None,
        available_to: Optional[time] = None,
    ) -> Dict:
        """
        Open target_date for bookings.

        - Creates MLADailyAvailability + 20 AppointmentSlot rows.
        - Slots within [available_from, available_to) are AVAILABLE;
          all others are BLOCKED. Default window: 14:00–16:00.
        - max_capacity overrides the global MAX_CAPACITY per slot.
        - If the date is already open with zero bookings, it is reset.
        - If any booking exists, raises ValueError.
        """
        # Default window: 2 PM – 4 PM
        if available_from is None:
            available_from = time(14, 0)
        if available_to is None:
            available_to = time(16, 0)
        if available_from >= available_to:
            raise ValueError("available_from must be before available_to.")
        if target_date < date.today():
            raise ValueError(
                f"Cannot open a past date ({target_date.strftime('%d %b %Y')}). "
                "Only today or future dates are allowed."
            )

        # Use SELECT ... FOR UPDATE to prevent race condition between concurrent workers
        existing_result = await db.execute(
            select(MLADailyAvailability)
            .where(MLADailyAvailability.mla_id == mla_id)
            .where(MLADailyAvailability.date    == target_date)
            .with_for_update()
        )
        existing = existing_result.scalar_one_or_none()
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

        available_slots_count = 0
        for slot_num, start, end in _slot_times():
            # Slot is AVAILABLE only if its start is within the availability window.
            # All other slots are BLOCKED by default so the PA doesn't have to
            # manually block each one.
            in_window = available_from <= start < available_to
            slot_status = "AVAILABLE" if in_window else "BLOCKED"
            if in_window:
                available_slots_count += 1
            db.add(AppointmentSlot(
                availability_id = avail.id,
                slot_number     = slot_num,
                start_time      = start,
                end_time        = end,
                status          = slot_status,
                max_capacity    = max_capacity,
                booked_count    = 0,
            ))

        await db.commit()

        avail_label = f"{available_from.strftime('%I:%M %p').lstrip('0')} – {available_to.strftime('%I:%M %p').lstrip('0')}"
        return {
            "availability_id":     avail.id,
            "date":                target_date.isoformat(),
            "date_label":          target_date.strftime("%d %b %Y"),
            "total_slots":         TOTAL_SLOTS,
            "available_slots":     available_slots_count,
            "blocked_slots":       TOTAL_SLOTS - available_slots_count,
            "max_per_slot":        max_capacity,
            "total_capacity":      available_slots_count * max_capacity,
            "availability_window": avail_label,
            "message": (
                f"Opened {target_date.strftime('%d %b %Y')} — "
                f"{available_slots_count} slots available ({avail_label}), "
                f"{TOTAL_SLOTS - available_slots_count} blocked, "
                f"{max_capacity} seats each."
            ),
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

        # Personal sub-slot: interval = floor(slot_duration / max_capacity)
        # e.g. 6 persons → 30/6 = 5 min each;  12 persons → 30/12 = 2 min each
        sub_index        = slot.booked_count  # 0-based, before increment
        interval_minutes = max(1, SLOT_DURATION // slot.max_capacity)
        assigned_time    = (
            datetime.combine(date.min, slot.start_time)
            + timedelta(minutes=sub_index * interval_minutes)
        ).time()

        # Reserve the seat
        slot.booked_count += 1
        if slot.booked_count >= slot.max_capacity:
            slot.status = "FULL"

        db.add(SlotBooking(slot_id=slot.id, appointment_id=appointment.id))

        avail = await db.get(MLADailyAvailability, slot.availability_id)
        appointment.status               = "SCHEDULED"
        appointment.scheduled_date       = avail.date
        appointment.scheduled_start_time = assigned_time
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
        if slot.status == "BLOCKED":
            return {"slot_id": slot_id, "status": "BLOCKED"}

        booked_count = slot.booked_count

        # If the slot has bookings, relocate each appointment before blocking.
        if booked_count > 0:
            # Fetch all appointments booked into this slot.
            booking_rows = await db.execute(
                select(SlotBooking)
                .where(SlotBooking.slot_id == slot_id)
                .order_by(SlotBooking.id)
            )
            bookings = booking_rows.scalars().all()

            # Find the availability for this slot to get the date.
            avail = await db.get(MLADailyAvailability, slot.availability_id)
            slot_date = avail.date if avail else date.today()

            # Only attempt relocation on the same date — future dates keep
            # their bookings intact (PA is blocking a future slot in advance).
            is_today = (slot_date == date.today())

            relocated = 0
            moved_to_waiting = 0

            if is_today:
                # Use IST (UTC+5:30) for slot time comparison — slot times are local.
                now = datetime.utcnow() + timedelta(hours=5, minutes=30)
                current_time = now.time()

                # Find other available slots on the same date with capacity,
                # whose start time is after the current time.
                other_slots = await db.execute(
                    select(AppointmentSlot)
                    .where(AppointmentSlot.availability_id == slot.availability_id)
                    .where(AppointmentSlot.id != slot_id)
                    .where(AppointmentSlot.status != "BLOCKED")
                    .where(AppointmentSlot.start_time > current_time)
                    .where(AppointmentSlot.booked_count < AppointmentSlot.max_capacity)
                    .order_by(AppointmentSlot.start_time)
                )
                candidate_slots = other_slots.scalars().all()

                for booking in bookings:
                    appt = await db.get(Appointment, booking.appointment_id)
                    if appt is None:
                        continue

                    relocated_ok = False
                    for cand in candidate_slots:
                        if cand.booked_count >= cand.max_capacity:
                            continue
                        try:
                            # Release from old slot first (without committing).
                            await self.release_slot(db, appt, commit=False)
                            # Book into the candidate slot.
                            await self.book_slot(db, appt, cand.id, commit=False)
                            relocated_ok = True
                            relocated += 1
                            break
                        except ValueError:
                            continue

                    if not relocated_ok:
                        # No available slot — move to waiting queue.
                        await self.release_slot(db, appt, commit=False)
                        await self.move_to_waiting_queue(
                            db, appt, "SLOT_BLOCKED", commit=False
                        )
                        moved_to_waiting += 1
            else:
                # Future date — just move all bookings to waiting.
                for booking in bookings:
                    appt = await db.get(Appointment, booking.appointment_id)
                    if appt is None:
                        continue
                    await self.release_slot(db, appt, commit=False)
                    await self.move_to_waiting_queue(
                        db, appt, "SLOT_BLOCKED", commit=False
                    )
                    moved_to_waiting += 1

        slot.status = "BLOCKED"
        slot.booked_count = 0
        await db.commit()

        result = {"slot_id": slot_id, "status": "BLOCKED"}
        if booked_count > 0:
            result["relocated"] = relocated if is_today else 0
            result["moved_to_waiting"] = moved_to_waiting
        return result

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
        new_datetime: str,
    ) -> Dict:
        """
        Reschedule an appointment to a new date/time.

        - Parses the datetime string (YYYY-MM-DDTHH:MM).
        - Opens the target date if not already open.
        - Finds the 30-minute slot that contains the requested time.
        - Releases the old booking and books the new slot.
        """
        # Parse the datetime string
        try:
            dt = datetime.fromisoformat(new_datetime)
        except ValueError:
            raise ValueError(f"Invalid datetime format: {new_datetime}")

        target_date = dt.date()
        requested_time = dt.time()

        # Ensure target date is not in the past
        if target_date < date.today():
            raise ValueError("Cannot reschedule to a past date.")

        # Find or create availability for the target date
        avail = await db.scalar(
            select(MLADailyAvailability)
            .where(MLADailyAvailability.date == target_date)
            .where(MLADailyAvailability.status == "ACTIVE")
        )

        if not avail:
            # Open the date — this creates 20 slots
            await self.set_mla_availability(
                db, mla_id=1, target_date=target_date
            )
            avail = await db.scalar(
                select(MLADailyAvailability)
                .where(MLADailyAvailability.date == target_date)
                .where(MLADailyAvailability.status == "ACTIVE")
            )
            if not avail:
                raise ValueError("Failed to open target date for booking.")

        # Find the slot whose 30-min window contains the requested time
        slot = await db.scalar(
            select(AppointmentSlot)
            .where(AppointmentSlot.availability_id == avail.id)
            .where(AppointmentSlot.start_time <= requested_time)
            .where(AppointmentSlot.end_time > requested_time)
            .where(AppointmentSlot.status != "BLOCKED")
        )

        if not slot:
            # Fallback: find the first available slot on that date
            slot = await db.scalar(
                select(AppointmentSlot)
                .where(AppointmentSlot.availability_id == avail.id)
                .where(AppointmentSlot.status != "BLOCKED")
                .where(AppointmentSlot.booked_count < AppointmentSlot.max_capacity)
                .order_by(AppointmentSlot.start_time)
            )

        if not slot:
            raise ValueError("No available slots on the selected date.")

        if slot.booked_count >= slot.max_capacity:
            raise ValueError("Selected slot is full.")

        appt = await db.scalar(
            select(Appointment)
            .options(selectinload(Appointment.citizen))
            .where(Appointment.id == appointment_id)
        )
        if not appt:
            raise ValueError(f"Appointment {appointment_id} not found.")

        old_slot_id = appt.appointment_slot_id
        await self.release_slot(db, appt, commit=False)
        result = await self.book_slot(db, appt, slot.id, commit=False)
        appt.status = "RESCHEDULED"
        db.add(AppointmentEvent(
            appointment_id=appt.id,
            event_type="rescheduled",
            actor="pa_admin",
            payload={"old_slot_id": old_slot_id, "new_slot_id": slot.id,
                     "scheduled_date": str(result["scheduled_date"]),
                     "scheduled_time": str(result["scheduled_time"])},
        ))
        await db.commit()

        return {
            "appointment_id":  appt.id,
            "old_slot_id":     old_slot_id,
            "new_slot_id":     slot.id,
            "scheduled_date":  result["scheduled_date"],
            "scheduled_time":  result["scheduled_time"],
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

        db.add(AppointmentEvent(
            appointment_id=appointment.id,
            event_type="moved_to_waiting",
            actor="system",
            note=reason,
            payload={"queue_position": appointment.queue_position},
        ))

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

    # ── Auto-allocate waiting queue to today's available slots ──────────────

    async def auto_allocate_waiting_queue(self, db: AsyncSession) -> Dict:
        """
        Assign all WAITING appointments to available slots today,
        starting from the current time. Appointments are assigned in
        priority order (priority_score desc, then created_at asc).
        """
        today = date.today()

        # Get today's availability
        avail = await db.scalar(
            select(MLADailyAvailability)
            .where(MLADailyAvailability.date == today)
            .where(MLADailyAvailability.status == "ACTIVE")
        )
        if not avail:
            raise ValueError("No availability opened for today.")

        # Use IST (UTC+5:30) for slot time comparison
        now = datetime.utcnow() + timedelta(hours=5, minutes=30)
        current_time = now.time()

        # Get available slots from current time onwards
        slot_result = await db.execute(
            select(AppointmentSlot)
            .where(AppointmentSlot.availability_id == avail.id)
            .where(AppointmentSlot.status != "BLOCKED")
            .where(AppointmentSlot.start_time > current_time)
            .where(AppointmentSlot.booked_count < AppointmentSlot.max_capacity)
            .order_by(AppointmentSlot.start_time)
        )
        candidate_slots = list(slot_result.scalars().all())

        if not candidate_slots:
            raise ValueError("No available slots remaining today from current time.")

        # Get waiting queue appointments in priority order
        appt_result = await db.execute(
            select(Appointment)
            .where(Appointment.status == "WAITING")
            .where(Appointment.schedule_meeting == True)
            .order_by(
                Appointment.priority_score.desc(),
                Appointment.created_at.asc(),
            )
        )
        waiting_appts = list(appt_result.scalars().all())

        if not waiting_appts:
            return {"allocated": 0, "remaining_in_queue": 0, "message": "No appointments in waiting queue."}

        allocated = 0
        remaining = 0

        for appt in waiting_appts:
            placed = False
            for slot in candidate_slots:
                if slot.booked_count >= slot.max_capacity:
                    continue
                try:
                    await self.book_slot(db, appt, slot.id, commit=False)
                    db.add(AppointmentEvent(
                        appointment_id=appt.id,
                        event_type="auto_allocated",
                        actor="system",
                        payload={"slot_id": slot.id, "slot_time": str(slot.start_time)},
                    ))
                    placed = True
                    allocated += 1
                    break
                except ValueError:
                    continue
            if not placed:
                remaining += 1

        await db.commit()

        return {
            "allocated": allocated,
            "remaining_in_queue": remaining,
            "total_waiting": len(waiting_appts),
        }

    # ── Emergency: cancel all today's scheduled appointments ─────────────────

    async def cancel_all_scheduled(self, db: AsyncSession) -> Dict:
        """
        Move today's SCHEDULED appointments back to waiting queue,
        release their SlotBookings, and cancel today's availability.
        """
        today = date.today()

        appt_result = await db.execute(
            select(Appointment)
            .where(Appointment.status.in_(["SCHEDULED", "RESCHEDULED"]))
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

        rescheduled_today = await db.scalar(
            select(func.count(Appointment.id))
            .where(Appointment.scheduled_date == today)
            .where(Appointment.status         == "RESCHEDULED")
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
            "rescheduled_today":   rescheduled_today,
            "oldest_waiting_days": oldest_days,
        }


# Singleton
scheduling_service = SchedulingService()
