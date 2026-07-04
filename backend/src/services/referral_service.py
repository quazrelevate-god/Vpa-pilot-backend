"""
Referral booking service — isolated from petition scheduling.

  - Daily-reset QR: a signed token encoding the date. Valid only on that date.
  - Fixed 11:00–13:00 window → 4 half-hour slots per open date.
  - Concurrency-safe booking via SELECT ... FOR UPDATE.
  - booked_count tracks total PERSONS (so a slot of capacity 6 = 6 people),
    a booking of N persons needs N free seats.
  - Admin can block / unblock / close / reopen slots (same state machine as
    petition scheduling). No rescheduling, no waiting queue.
"""
from datetime import datetime, date, time, timedelta
from typing import Optional, Dict, List

from itsdangerous import Signer, BadSignature
from sqlalchemy import select, func, delete, text
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.config import settings
from src.core import crypto
from src.models.referral_models import (
    ReferralAvailability,
    ReferralSlot,
    ReferralBooking,
    FIXED_START_TIME,
    FIXED_END_TIME,
    SLOT_DURATION,
    MAX_CAPACITY,
    TOTAL_SLOTS,
    MAX_PERSONS,
)

# Salted signer so referral tokens can never be confused with other signed values.
_signer = Signer(settings.SECRET_KEY, salt="referral-daily-qr")


def _slot_times() -> List[tuple]:
    """Return [(slot_number, start_time, end_time), ...] for the 11-1 window."""
    slots = []
    current = datetime.combine(date.min, FIXED_START_TIME)
    end     = datetime.combine(date.min, FIXED_END_TIME)
    n = 1
    while current < end:
        slot_end = current + timedelta(minutes=SLOT_DURATION)
        slots.append((n, current.time(), slot_end.time()))
        current = slot_end
        n += 1
    return slots   # 4 items


class ReferralService:

    # ── Daily QR token ───────────────────────────────────────────────────────

    def make_daily_token(self, for_date: Optional[date] = None) -> str:
        """Sign a date string → token. Anyone holding it can open that day's form."""
        if for_date is None:
            for_date = date.today()
        return _signer.sign(for_date.isoformat().encode()).decode()

    def verify_daily_token(self, token: str) -> date:
        """
        Verify a daily token and return the date it encodes.
        Raises ValueError if tampered or not today's token.
        """
        try:
            raw = _signer.unsign(token.encode()).decode()
            token_date = datetime.strptime(raw, "%Y-%m-%d").date()
        except (BadSignature, ValueError):
            raise ValueError("Invalid referral QR. Please ask the office for today's QR code.")

        if token_date != date.today():
            raise ValueError("This referral QR has expired. Please scan today's QR code.")
        return token_date

    def daily_qr_payload(self, base_url: str) -> Dict:
        """Build today's QR url + metadata for the PA portal."""
        today = date.today()
        token = self.make_daily_token(today)
        scan_url = f"{base_url.rstrip('/')}/api/v1/referral/scan?d={token}"
        return {
            "qr_url":      scan_url,
            "token":       token,
            "date":        today.isoformat(),
            "date_label":  today.strftime("%d %b %Y"),
        }

    # ── Admin: open a referral date ──────────────────────────────────────────

    async def open_date(
        self,
        db: AsyncSession,
        target_date: date,
        created_by: Optional[str] = None,
        max_capacity: int = MAX_CAPACITY,
    ) -> Dict:
        """
        Open target_date for referral bookings — creates 4 slots (11:00–13:00),
        all AVAILABLE. Resets the date if it exists with zero bookings.
        """
        if target_date < date.today():
            raise ValueError(
                f"Cannot open a past date ({target_date.strftime('%d %b %Y')})."
            )

        existing = await db.scalar(
            select(ReferralAvailability)
            .where(ReferralAvailability.date == target_date)
            .with_for_update()
        )
        if existing:
            total_booked = await db.scalar(
                select(func.sum(ReferralSlot.booked_count))
                .where(ReferralSlot.availability_id == existing.id)
            ) or 0
            if total_booked > 0:
                raise ValueError(
                    f"{target_date.strftime('%d %b %Y')} already has {total_booked} booking(s). "
                    "Cancel them before resetting this date."
                )
            await db.execute(
                delete(ReferralSlot).where(ReferralSlot.availability_id == existing.id)
            )
            await db.delete(existing)
            await db.flush()

        avail = ReferralAvailability(
            date       = target_date,
            start_time = FIXED_START_TIME,
            end_time   = FIXED_END_TIME,
            status     = "ACTIVE",
            created_by = created_by,
        )
        db.add(avail)
        await db.flush()

        for slot_num, start, end in _slot_times():
            db.add(ReferralSlot(
                availability_id = avail.id,
                slot_number     = slot_num,
                start_time      = start,
                end_time        = end,
                status          = "AVAILABLE",
                max_capacity    = max_capacity,
                booked_count    = 0,
            ))

        await db.commit()
        return {
            "availability_id": avail.id,
            "date":            target_date.isoformat(),
            "date_label":      target_date.strftime("%d %b %Y"),
            "total_slots":     TOTAL_SLOTS,
            "max_per_slot":    max_capacity,
            "total_capacity":  TOTAL_SLOTS * max_capacity,
            "message":         f"Opened {target_date.strftime('%d %b %Y')} for referrals — "
                               f"{TOTAL_SLOTS} slots (11 AM – 1 PM), {max_capacity} seats each.",
        }

    # ── Citizen: available slots for a date ──────────────────────────────────

    async def get_available_slots(self, db: AsyncSession, target_date: date) -> Dict:
        """Non-blocked slots for the date (used by the referral form)."""
        avail = await db.scalar(
            select(ReferralAvailability)
            .where(ReferralAvailability.date   == target_date)
            .where(ReferralAvailability.status == "ACTIVE")
        )
        if not avail:
            return {
                "available": False, "has_open_slots": False,
                "date": target_date.isoformat(),
                "date_label": target_date.strftime("%d %b %Y"),
                "slots": [],
            }

        rows = await db.execute(
            select(ReferralSlot)
            .where(ReferralSlot.availability_id == avail.id)
            .order_by(ReferralSlot.slot_number)
        )
        slot_list = []
        any_available = False
        for s in rows.scalars().all():
            if s.status == "BLOCKED":
                continue
            remaining = s.max_capacity - s.booked_count
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

    # ── Citizen: book a referral slot (concurrency-safe) ─────────────────────

    async def book_slot(
        self,
        db: AsyncSession,
        slot_id: int,
        name: str,
        referred_by: str,
        num_persons: int,
        reason: str,
        mobile: Optional[str] = None,
    ) -> Dict:
        num_persons = max(1, min(MAX_PERSONS, int(num_persons or 1)))

        slot = await db.scalar(
            select(ReferralSlot).where(ReferralSlot.id == slot_id).with_for_update()
        )
        if slot is None:
            raise ValueError("Slot not found.")
        if slot.status == "BLOCKED":
            raise ValueError("That slot has been blocked. Please pick another slot.")
        remaining = slot.max_capacity - slot.booked_count
        if slot.status == "FULL" or remaining <= 0:
            raise ValueError("Slot is full. Please pick another slot.")

        avail = await db.get(ReferralAvailability, slot.availability_id)
        slot_date = avail.date

        # Guard: never book a slot whose date has already passed. The citizen
        # picker only shows future/today dates, but a stale slot_id must not be
        # bookable directly.
        if slot_date < date.today():
            raise ValueError("That date has passed. Please pick an available date.")

        # Daily sequential token: YYYYMMDD * 100000 + n.
        # Advisory xact-lock keyed on the slot date serialises concurrent
        # bookings so two referrals can never share a token number.
        date_key = int(slot_date.strftime("%Y%m%d"))
        await db.execute(text("SELECT pg_advisory_xact_lock(:k)"), {"k": date_key})
        # MAX(token)+1 over the day's numeric range — delete-safe, unlike COUNT
        # (a deleted booking would otherwise make the next token reuse a number).
        day_floor = date_key * 100000
        last_token = await db.scalar(
            select(func.max(ReferralBooking.token_number))
            .where(
                ReferralBooking.token_number >= day_floor,
                ReferralBooking.token_number < day_floor + 100000,
            )
        )
        token_number = (last_token + 1) if last_token else (day_floor + 1)

        # Reserve seats
        # One booking = one slot use, regardless of family size (num_persons is
        # informational — how many people show up per referral).
        slot.booked_count += 1
        if slot.booked_count >= slot.max_capacity:
            slot.status = "FULL"

        booking = ReferralBooking(
            slot_id              = slot.id,
            token_number         = token_number,
            name                 = crypto.encrypt(name.strip()),
            mobile               = crypto.encrypt((mobile or "").strip() or None),
            num_persons          = num_persons,
            referred_by          = referred_by.strip(),
            reason               = reason.strip(),
            scheduled_date       = slot_date,
            scheduled_start_time = slot.start_time,
            scheduled_end_time   = slot.end_time,
        )
        db.add(booking)
        await db.commit()

        return {
            "token_number":   token_number,
            "token_display":  f"REF{token_number}",
            "name":           name.strip(),
            "num_persons":    num_persons,
            "referred_by":    referred_by.strip(),
            "scheduled_date": slot_date.isoformat(),
            "slot_label":     f"{slot.start_time.strftime('%I:%M %p')} – {slot.end_time.strftime('%I:%M %p')}",
            "message":        f"Referral booked. Token: REF{token_number}.",
        }

    # ── Admin: block / unblock / close / reopen ──────────────────────────────

    async def block_slot(self, db: AsyncSession, slot_id: int) -> Dict:
        slot = await db.get(ReferralSlot, slot_id)
        if slot is None:
            raise ValueError("Slot not found.")
        slot.status = "BLOCKED"
        await db.commit()
        return {"slot_id": slot_id, "status": "BLOCKED"}

    async def unblock_slot(self, db: AsyncSession, slot_id: int) -> Dict:
        slot = await db.get(ReferralSlot, slot_id)
        if slot is None:
            raise ValueError("Slot not found.")
        slot.status = "FULL" if slot.booked_count >= slot.max_capacity else "AVAILABLE"
        await db.commit()
        return {"slot_id": slot_id, "status": slot.status}

    async def close_slot(self, db: AsyncSession, slot_id: int) -> Dict:
        slot = await db.get(ReferralSlot, slot_id)
        if slot is None:
            raise ValueError("Slot not found.")
        if slot.status == "BLOCKED":
            raise ValueError("Slot is blocked. Unblock it first.")
        slot.status = "FULL"
        await db.commit()
        return {"slot_id": slot_id, "status": "FULL"}

    async def reopen_slot(self, db: AsyncSession, slot_id: int) -> Dict:
        slot = await db.get(ReferralSlot, slot_id)
        if slot is None:
            raise ValueError("Slot not found.")
        if slot.status == "BLOCKED":
            raise ValueError("Slot is blocked, not closed. Use unblock instead.")
        if slot.booked_count >= slot.max_capacity:
            raise ValueError(
                f"Slot is genuinely full ({slot.booked_count}/{slot.max_capacity})."
            )
        slot.status = "AVAILABLE"
        await db.commit()
        return {"slot_id": slot_id, "status": "AVAILABLE"}

    # ── Admin: slot grid for a date ──────────────────────────────────────────

    async def get_slots_for_date(self, db: AsyncSession, target_date: date) -> Dict:
        avail = await db.scalar(
            select(ReferralAvailability)
            .where(ReferralAvailability.date   == target_date)
            .where(ReferralAvailability.status == "ACTIVE")
        )
        if not avail:
            return {"has_availability": False, "date": target_date.isoformat(), "slots": []}

        rows = await db.execute(
            select(ReferralSlot)
            .where(ReferralSlot.availability_id == avail.id)
            .order_by(ReferralSlot.slot_number)
        )
        slot_list = []
        for s in rows.scalars().all():
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
            "date":             target_date.isoformat(),
            "date_label":       target_date.strftime("%d %b %Y"),
            "total_slots":      TOTAL_SLOTS,
            "total_capacity":   sum(s["max_capacity"] for s in slot_list),
            "booked_total":     booked_total,
            "blocked_slots":    blocked_total,
            "remaining_total":  sum(s["remaining"] for s in slot_list if s["status"] != "BLOCKED"),
            "slots":            slot_list,
        }

    # ── Public: open dates for citizen date picker ──────────────────────────

    async def list_open_dates_public(self, db: AsyncSession) -> List[Dict]:
        """
        Future dates that are open AND have at least one non-blocked slot.
        Used by the citizen referral form date picker.
        """
        result = await db.execute(
            select(ReferralAvailability)
            .where(ReferralAvailability.status == "ACTIVE")
            .where(ReferralAvailability.date   >= date.today())
            .order_by(ReferralAvailability.date)
        )
        dates: List[Dict] = []
        for a in result.scalars().all():
            non_blocked = await db.scalar(
                select(func.count(ReferralSlot.id))
                .where(ReferralSlot.availability_id == a.id)
                .where(ReferralSlot.status != "BLOCKED")
            ) or 0
            if non_blocked > 0:
                dates.append({
                    "date":       a.date.isoformat(),
                    "date_label": a.date.strftime("%d %b %Y"),
                })
        return dates

    # ── Admin: open dates list ───────────────────────────────────────────────

    async def get_open_dates(self, db: AsyncSession) -> List[Dict]:
        result = await db.execute(
            select(ReferralAvailability)
            .where(ReferralAvailability.status == "ACTIVE")
            .where(ReferralAvailability.date   >= date.today())
            .order_by(ReferralAvailability.date)
        )
        out = []
        for a in result.scalars().all():
            booked = await db.scalar(
                select(func.sum(ReferralSlot.booked_count))
                .where(ReferralSlot.availability_id == a.id)
            ) or 0
            cap = await db.scalar(
                select(func.sum(ReferralSlot.max_capacity))
                .where(ReferralSlot.availability_id == a.id)
            ) or 0
            out.append({
                "id":             a.id,
                "date":           a.date.isoformat(),
                "date_label":     a.date.strftime("%d %b %Y"),
                "total_capacity": cap,
                "booked":         booked,
                "remaining":      cap - booked,
            })
        return out

    # ── Admin: bookings table for a date ─────────────────────────────────────

    async def get_bookings(self, db: AsyncSession, target_date: date) -> List[Dict]:
        result = await db.execute(
            select(ReferralBooking)
            .where(ReferralBooking.scheduled_date == target_date)
            .order_by(ReferralBooking.scheduled_start_time, ReferralBooking.id)
        )
        out = []
        for b in result.scalars().all():
            out.append({
                "id":           b.id,
                "token":        f"REF{b.token_number}",
                "name":         crypto.decrypt(b.name),
                "mobile":       crypto.decrypt(b.mobile),
                "num_persons":  b.num_persons,
                "referred_by":  b.referred_by,
                "reason":       b.reason,
                "status":       b.status,
                "slot":         f"{b.scheduled_start_time.strftime('%I:%M %p')} – {b.scheduled_end_time.strftime('%I:%M %p')}",
                "slot_start":   b.scheduled_start_time.strftime("%H:%M"),
                "booked_at":    b.created_at.isoformat() if b.created_at else None,
            })
        return out

    # ── Floor board: mark attendance (came / not came) ───────────────────────

    async def update_booking_status(self, db: AsyncSession, booking_id: int, status: str) -> Dict:
        """Set a referral booking's floor-attendance status. Used by the crowd PWA."""
        status = (status or "").upper()
        if status not in ("PENDING", "CAME", "NOT_CAME"):
            raise ValueError("Invalid status. Use CAME, NOT_CAME or PENDING.")
        booking = await db.get(ReferralBooking, booking_id)
        if booking is None:
            raise ValueError("Booking not found.")
        booking.status = status
        await db.commit()
        return {"id": booking_id, "status": status}


referral_service = ReferralService()
