"""
Scheduling service — 1-hour fixed slots, up to MAX_CAPACITY citizens each.

v2 schema notes:
- appointment.slot_id is the sole booking link (SlotBooking junction removed).
- Reschedule + waiting-queue events log to `activity` (Activity model), not
  the removed AppointmentEvent / RescheduleLog tables.
- Scheduled date/time are derived from slot + availability on read, not
  stored on appointment.
- availability.is_open (bool) replaces the ACTIVE/CANCELLED string status.

Booking stays concurrency-safe via SELECT ... FOR UPDATE on the slot row.
"""
from datetime import datetime, date, time, timedelta
from typing import Optional, Dict, List

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from src.services.v2_helpers import v2

from src.models.scheduling_models import (
    MLA,
    MLADailyAvailability,
    AppointmentSlot,
    FIXED_START_TIME,
    FIXED_END_TIME,
    SLOT_DURATION,
    MAX_CAPACITY,
    TOTAL_SLOTS,
)
from src.models.appointment_models import Appointment, Citizen
from src.models.activity_models import Activity
from src.core.utils import utc_iso


def _decrypt(ciphertext: str) -> str:
    """Decrypt a PII field (Fernet, with legacy-base64 fallback). See src.core.crypto."""
    from src.core import crypto
    return crypto.decrypt(ciphertext) if ciphertext is not None else ciphertext


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
        Creates MLADailyAvailability (is_open=True) + 20 AppointmentSlot rows.
        """
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
            # No bookings — safe to recreate (cascade drops slots)
            await db.delete(existing)
            await db.flush()

        avail = MLADailyAvailability(
            mla_id  = mla_id,
            date    = target_date,
            is_open = True,
        )
        db.add(avail)
        await db.flush()

        available_slots_count = 0
        for slot_num, start, end in _slot_times():
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
        if target_date is None:
            target_date = date.today()

        avail = await db.scalar(
            select(MLADailyAvailability)
            .where(MLADailyAvailability.date    == target_date)
            .where(MLADailyAvailability.is_open == True)  # noqa: E712
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
            if s.status == "BLOCKED":
                continue
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
            "available":      any_available,
            "has_open_slots": len(slot_list) > 0,
            "date":           target_date.isoformat(),
            "date_label":     target_date.strftime("%d %b %Y"),
            "slots":          slot_list,
        }

    # ── Citizen: list open dates ─────────────────────────────────────────────

    async def list_open_dates_public(self, db: AsyncSession) -> List[Dict]:
        result = await db.execute(
            select(MLADailyAvailability)
            .where(MLADailyAvailability.is_open == True)  # noqa: E712
            .where(MLADailyAvailability.date    >= date.today())
            .order_by(MLADailyAvailability.date)
        )
        dates: List[Dict] = []
        for a in result.scalars().all():
            non_blocked = await db.scalar(
                select(func.count(AppointmentSlot.id))
                .where(AppointmentSlot.availability_id == a.id)
                .where(AppointmentSlot.status != "BLOCKED")
            ) or 0
            if non_blocked > 0:
                dates.append({
                    "date":       a.date.isoformat(),
                    "date_label": a.date.strftime("%d %b %Y"),
                })
        return dates

    async def has_meeting_availability(self, db: AsyncSession) -> Dict:
        from sqlalchemy import and_, or_
        now_ist = datetime.utcnow() + timedelta(hours=5, minutes=30)
        today   = now_ist.date()
        now_t   = now_ist.time()
        count = await db.scalar(
            select(func.count(AppointmentSlot.id))
            .join(MLADailyAvailability, MLADailyAvailability.id == AppointmentSlot.availability_id)
            .where(MLADailyAvailability.is_open == True)  # noqa: E712
            .where(MLADailyAvailability.date    >= today)
            .where(AppointmentSlot.status      == "AVAILABLE")
            .where(AppointmentSlot.booked_count < AppointmentSlot.max_capacity)
            .where(or_(
                MLADailyAvailability.date > today,
                and_(MLADailyAvailability.date == today, AppointmentSlot.start_time > now_t),
            ))
        ) or 0
        return {"available": count > 0}

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
        v2: appointment.slot_id is set directly (no SlotBooking junction).
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

        sub_index        = slot.booked_count
        interval_minutes = max(1, SLOT_DURATION // slot.max_capacity)
        assigned_time    = (
            datetime.combine(date.min, slot.start_time)
            + timedelta(minutes=sub_index * interval_minutes)
        ).time()

        slot.booked_count += 1
        if slot.booked_count >= slot.max_capacity:
            slot.status = "FULL"

        avail = await db.get(MLADailyAvailability, slot.availability_id)
        appointment.status           = "SCHEDULED"
        appointment.status_id        = v2.appointment_status_id("SCHEDULED")
        appointment.slot_id          = slot.id
        appointment.schedule_meeting = True  # persistent intent

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
        """Clear appointment.slot_id and decrement slot.booked_count."""
        if not appointment.slot_id:
            return

        slot = await db.get(AppointmentSlot, appointment.slot_id)
        if slot:
            slot.booked_count = max(0, slot.booked_count - 1)
            if slot.status == "FULL" and slot.booked_count < slot.max_capacity:
                slot.status = "AVAILABLE"

        appointment.slot_id = None

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
        relocated = 0
        moved_to_waiting = 0
        is_today = False
        # Rows that need a citizen SMS after the transaction commits — we
        # collect ids inside the loop and fire outside so a notification hiccup
        # can't unwind the block.
        _cascade_appointment_ids: list[int] = []

        if booked_count > 0:
            # Fetch appointments booked into this slot (v2: appointment.slot_id)
            booked_appts_result = await db.execute(
                select(Appointment)
                .where(Appointment.slot_id == slot_id)
                .order_by(Appointment.id)
            )
            bookings = list(booked_appts_result.scalars().all())

            avail = await db.get(MLADailyAvailability, slot.availability_id)
            slot_date = avail.date if avail else date.today()
            is_today = (slot_date == date.today())

            if is_today:
                now = datetime.utcnow() + timedelta(hours=5, minutes=30)
                current_time = now.time()

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

                for appt in bookings:
                    relocated_ok = False
                    for cand in candidate_slots:
                        if cand.booked_count >= cand.max_capacity:
                            continue
                        try:
                            await self.release_slot(db, appt, commit=False)
                            await self.book_slot(db, appt, cand.id, commit=False)
                            relocated_ok = True
                            relocated += 1
                            break
                        except ValueError:
                            continue

                    if not relocated_ok:
                        # No same-day slot available — flip to RESCHEDULED so
                        # the PA can call this citizen and pick a new time.
                        # (WAITING is reserved for citizens whose original
                        # submission had no slot; a mid-day cancel is
                        # different.)
                        await self.release_slot(db, appt, commit=False)
                        appt.status = "RESCHEDULED"
                        appt.status_id = v2.appointment_status_id("RESCHEDULED")
                        appt.schedule_meeting = True
                        db.add(Activity(
                            appointment_id=appt.id,
                            user="pa_admin",
                            action_type="rescheduled",
                            message="SLOT_BLOCKED_CASCADE",
                            payload={"from_status": "SCHEDULED",
                                     "to_status": "RESCHEDULED",
                                     "reason": "slot_blocked",
                                     "blocked_slot_id": slot_id},
                        ))
                        _cascade_appointment_ids.append(appt.id)
                        moved_to_waiting += 1
            else:
                # Future date — flip all bookings to RESCHEDULED so the PA can
                # rebook them onto a live day. (v2: bookings ARE the
                # appointments — no SlotBooking junction.)
                for appt in bookings:
                    await self.release_slot(db, appt, commit=False)
                    appt.status = "RESCHEDULED"
                    appt.status_id = v2.appointment_status_id("RESCHEDULED")
                    appt.schedule_meeting = True
                    db.add(Activity(
                        appointment_id=appt.id,
                        user="pa_admin",
                        action_type="rescheduled",
                        message="SLOT_BLOCKED_CASCADE",
                        payload={"from_status": "SCHEDULED",
                                 "to_status": "RESCHEDULED",
                                 "reason": "slot_blocked",
                                 "blocked_slot_id": slot_id},
                    ))
                    _cascade_appointment_ids.append(appt.id)
                    moved_to_waiting += 1

        slot.status = "BLOCKED"
        slot.booked_count = 0
        await db.commit()

        # Fire notifications after commit so partial failure can't unwind the
        # block itself. Every affected citizen learns the meeting was cancelled.
        if _cascade_appointment_ids:
            try:
                import asyncio as _asyncio
                from src.services.notification_service import notify as _notify
                for _aid in _cascade_appointment_ids:
                    _asyncio.create_task(_notify(
                        kind="reschedule_cancel",
                        appointment_id=_aid,
                        ctx={"actor": "pa", "reason": "slot_blocked"},
                    ))
            except Exception:
                pass

        result = {"slot_id": slot_id, "status": "BLOCKED"}
        if booked_count > 0:
            result["relocated"] = relocated if is_today else 0
            # Legacy field name — these rows now go to RESCHEDULED (not
            # waiting); kept as-is so existing UI counts still line up.
            result["moved_to_waiting"] = moved_to_waiting
            result["moved_to_rescheduled"] = moved_to_waiting
        return result

    async def unblock_slot(self, db: AsyncSession, slot_id: int) -> Dict:
        slot = await db.get(AppointmentSlot, slot_id)
        if slot is None:
            raise ValueError("Slot not found.")
        new_status = "FULL" if slot.booked_count >= slot.max_capacity else "AVAILABLE"
        slot.status = new_status
        await db.commit()
        return {"slot_id": slot_id, "status": new_status}

    async def close_slot(self, db: AsyncSession, slot_id: int) -> Dict:
        slot = await db.get(AppointmentSlot, slot_id)
        if slot is None:
            raise ValueError("Slot not found.")
        if slot.status == "BLOCKED":
            raise ValueError("Slot is already blocked. Unblock it first.")
        slot.status = "FULL"
        await db.commit()
        return {
            "slot_id":      slot_id,
            "status":       "FULL",
            "booked_count": slot.booked_count,
            "max_capacity": slot.max_capacity,
        }

    async def reopen_slot(self, db: AsyncSession, slot_id: int) -> Dict:
        slot = await db.get(AppointmentSlot, slot_id)
        if slot is None:
            raise ValueError("Slot not found.")
        if slot.status == "BLOCKED":
            raise ValueError("Slot is blocked, not closed. Use unblock instead.")
        if slot.booked_count >= slot.max_capacity:
            raise ValueError(
                f"Slot is genuinely full ({slot.booked_count}/{slot.max_capacity}). "
                "Cancel a booking first, then reopen."
            )
        slot.status = "AVAILABLE"
        await db.commit()
        return {
            "slot_id":      slot_id,
            "status":       "AVAILABLE",
            "booked_count": slot.booked_count,
            "remaining":    slot.max_capacity - slot.booked_count,
        }

    # ── Admin: list open dates ───────────────────────────────────────────────

    async def get_open_dates(self, db: AsyncSession) -> List[Dict]:
        result = await db.execute(
            select(MLADailyAvailability)
            .where(MLADailyAvailability.is_open == True)  # noqa: E712
            .where(MLADailyAvailability.date    >= date.today())
            .order_by(MLADailyAvailability.date)
        )
        rows = []
        for a in result.scalars().all():
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
            .where(MLADailyAvailability.date    == target_date)
            .where(MLADailyAvailability.is_open == True)  # noqa: E712
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
        try:
            dt = datetime.fromisoformat(new_datetime)
        except ValueError:
            raise ValueError(f"Invalid datetime format: {new_datetime}")

        target_date = dt.date()
        requested_time = dt.time()

        if target_date < date.today():
            raise ValueError("Cannot reschedule to a past date.")

        avail = await db.scalar(
            select(MLADailyAvailability)
            .where(MLADailyAvailability.date    == target_date)
            .where(MLADailyAvailability.is_open == True)  # noqa: E712
        )

        if not avail:
            await self.set_mla_availability(
                db, mla_id=1, target_date=target_date
            )
            avail = await db.scalar(
                select(MLADailyAvailability)
                .where(MLADailyAvailability.date    == target_date)
                .where(MLADailyAvailability.is_open == True)  # noqa: E712
            )
            if not avail:
                raise ValueError("Failed to open target date for booking.")

        slot = await db.scalar(
            select(AppointmentSlot)
            .where(AppointmentSlot.availability_id == avail.id)
            .where(AppointmentSlot.start_time <= requested_time)
            .where(AppointmentSlot.end_time > requested_time)
            .where(AppointmentSlot.status != "BLOCKED")
        )

        if not slot:
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

        old_slot_id = appt.slot_id
        old_status = appt.status
        await self.release_slot(db, appt, commit=False)
        result = await self.book_slot(db, appt, slot.id, commit=False)
        # A successful rebook lands the row on the Scheduled tab, not the
        # Rescheduled tab. Rescheduled is where a row waits until it's rebooked
        # or converted to a petition — coming out of it means "back to normal".
        # (book_slot already set status/status_id=SCHEDULED + schedule_meeting.)
        db.add(Activity(
            appointment_id=appt.id,
            user="pa_admin",
            action_type="rescheduled",
            message=f"Rebooked to {result['scheduled_date']} {result['scheduled_time']}",
            payload={"from_status": old_status,
                     "to_status": "SCHEDULED",
                     "old_slot_id": old_slot_id,
                     "new_slot_id": slot.id,
                     "scheduled_date": str(result["scheduled_date"]),
                     "scheduled_time": str(result["scheduled_time"])},
        ))
        await db.commit()

        # Notify the citizen of the new time + token (fire-and-forget).
        try:
            import asyncio as _asyncio
            from src.services.notification_service import notify as _notify
            _asyncio.create_task(_notify(
                kind="reschedule_rebook",
                appointment_id=appt.id,
                ctx={
                    "actor": "pa",
                    "scheduled_date": str(result["scheduled_date"]),
                    "scheduled_time": str(result["scheduled_time"]),
                    "token": appt.token_assigned,
                },
            ))
        except Exception:
            # Never let a notification issue break the reschedule.
            pass

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
        appointment.status        = "WAITING"
        appointment.status_id     = v2.appointment_status_id("WAITING")
        appointment.waiting_since = datetime.utcnow()

        # v2: schedule_meeting column removed — a "meeting" appointment is
        # one that had a slot_id (now cleared as it enters the queue) OR was
        # explicitly waiting. Use status alone to count queue length.
        queue_count = await db.scalar(
            select(func.count(Appointment.id))
            .where(Appointment.status == "WAITING")
        )
        appointment.queue_position = (queue_count or 0) + 1

        db.add(Activity(
            appointment_id=appointment.id,
            user="system",
            action_type="moved_to_waiting",
            message=reason,
            payload={"queue_position": appointment.queue_position, "reason": reason},
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
            .where(Appointment.status == "WAITING")
            .order_by(Appointment.created_at.asc())
            .limit(limit)
        )
        rows = []
        for appt in result.scalars().all():
            citizen = appt.citizen
            rows.append({
                "id":             appt.id,
                "token":          appt.token_assigned,
                "name":           _decrypt(citizen.encrypted_name) if citizen else "Unknown",
                "mobile":         _decrypt(citizen.encrypted_mobile) if citizen else "Unknown",
                "category":       appt.grievance_category,
                "queue_position": appt.queue_position,
                "waiting_since":  utc_iso(appt.waiting_since),
                "created_at":     utc_iso(appt.created_at),
            })
        return rows

    # ── Auto-allocate waiting queue to today's available slots ──────────────

    async def auto_allocate_waiting_queue(self, db: AsyncSession) -> Dict:
        today = date.today()

        avail = await db.scalar(
            select(MLADailyAvailability)
            .where(MLADailyAvailability.date    == today)
            .where(MLADailyAvailability.is_open == True)  # noqa: E712
        )
        if not avail:
            raise ValueError("No availability opened for today.")

        now = datetime.utcnow() + timedelta(hours=5, minutes=30)
        current_time = now.time()

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

        appt_result = await db.execute(
            select(Appointment)
            .where(Appointment.status == "WAITING")
            .order_by(Appointment.created_at.asc())
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
                    db.add(Activity(
                        appointment_id=appt.id,
                        user="system",
                        action_type="auto_allocated",
                        message=f"Slot {slot.id} @ {slot.start_time}",
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

    # ── Emergency: cancel today's scheduled appointments ─────────────────────

    async def cancel_all_scheduled(
        self,
        db: AsyncSession,
        target_date: Optional[date] = None,
    ) -> Dict:
        """Cancel every SCHEDULED / RESCHEDULED appointment on `target_date`
        (defaults to today), move them back to the waiting queue, and close
        the day's availability so no new bookings can come in.

        Called by the PA's "Cancel All" button, which now sends the date
        currently selected in the scheduling grid — not just today.
        """
        target_date = target_date or date.today()

        appt_result = await db.execute(
            select(Appointment)
            .join(AppointmentSlot, AppointmentSlot.id == Appointment.slot_id)
            .join(MLADailyAvailability, MLADailyAvailability.id == AppointmentSlot.availability_id)
            .where(Appointment.status.in_(["SCHEDULED", "RESCHEDULED"]))
            .where(MLADailyAvailability.date == target_date)
            .order_by(AppointmentSlot.start_time)
        )
        appointments = appt_result.scalars().all()

        cancelled = 0
        for appt in appointments:
            await self.release_slot(db, appt, commit=False)
            appt.status        = "WAITING"
            appt.status_id     = v2.appointment_status_id("WAITING")
            appt.waiting_since = datetime.utcnow()
            queue_count = await db.scalar(
                select(func.count(Appointment.id))
                .where(Appointment.status == "WAITING")
            )
            appt.queue_position = (queue_count or 0) + 1
            cancelled += 1

        avail_result = await db.execute(
            select(MLADailyAvailability)
            .where(MLADailyAvailability.date    == target_date)
            .where(MLADailyAvailability.is_open == True)  # noqa: E712
        )
        cancelled_dates = 0
        for avail in avail_result.scalars().all():
            avail.is_open = False
            cancelled_dates += 1

        await db.commit()
        date_label = target_date.strftime("%d %b %Y")
        return {
            "cancelled_appointments": cancelled,
            "cancelled_dates":        cancelled_dates,
            "date":                   target_date.isoformat(),
            "date_label":             date_label,
            "message": (
                f"Moved {cancelled} appointment(s) on {date_label} to the waiting "
                f"queue. Cancelled {cancelled_dates} availability record(s)."
            ),
        }

    # ── Statistics ───────────────────────────────────────────────────────────

    async def get_statistics(self, db: AsyncSession) -> Dict:
        waiting_count = await db.scalar(
            select(func.count(Appointment.id))
            .where(Appointment.status == "WAITING")
        ) or 0

        today = date.today()
        # Scheduled today = appointment.slot_id → slot → availability with date=today
        scheduled_today = await db.scalar(
            select(func.count(Appointment.id))
            .join(AppointmentSlot, AppointmentSlot.id == Appointment.slot_id)
            .join(MLADailyAvailability, MLADailyAvailability.id == AppointmentSlot.availability_id)
            .where(Appointment.status == "SCHEDULED")
            .where(MLADailyAvailability.date == today)
        ) or 0

        rescheduled_today = await db.scalar(
            select(func.count(Appointment.id))
            .join(AppointmentSlot, AppointmentSlot.id == Appointment.slot_id)
            .join(MLADailyAvailability, MLADailyAvailability.id == AppointmentSlot.availability_id)
            .where(Appointment.status == "RESCHEDULED")
            .where(MLADailyAvailability.date == today)
        ) or 0

        oldest_waiting = await db.scalar(
            select(Appointment.waiting_since)
            .where(Appointment.status == "WAITING")
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
