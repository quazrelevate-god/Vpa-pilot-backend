"""
Delete a test appointment and all its related data from the database.

Deletes (in safe order):
  1. ticket_events       (FK -> tickets)
  2. tickets             (FK -> appointments)
  3. grievance_summary_records (FK -> appointments)
  4. appointment_events  (FK -> appointments)
  5. appointment_attachments (FK -> appointments)
  6. slot_bookings       (junction; also decrements slot booked_count / resets FULL->AVAILABLE)
  7. appointments        (the main record)
  8. citizens            (only if no other appointments remain)

Usage:
    cd backend
    python delete_test_appointment.py <appointment_id>
    python delete_test_appointment.py 161
"""
import asyncio
import sys
import base64

if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

from sqlalchemy import select, delete, func
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.database import AsyncSessionLocal
# Import all models so mapper relationships resolve
from src.models.appointment_models import Appointment, Citizen, AppointmentAttachment, AppointmentEvent
from src.models.grievance_summary_record import GrievanceSummaryRecord
from src.models.ticket_models import Ticket, TicketEvent
from src.models.scheduling_models import AppointmentSlot, SlotBooking
from src.models.qr_models import GatekeeperSession  # noqa: F401
from src.models.referral_models import ReferralAvailability  # noqa: F401


def decode_field(encoded: str | None) -> str:
    if not encoded:
        return ""
    try:
        return base64.b64decode(encoded.encode("utf-8")).decode("utf-8")
    except Exception:
        return encoded


async def fetch_appointment_summary(db: AsyncSession, appointment_id: int):
    """Fetch and display appointment details before deletion."""
    result = await db.execute(
        select(Appointment).where(Appointment.id == appointment_id)
    )
    appt = result.scalar_one_or_none()
    if not appt:
        return None

    citizen = None
    if appt.citizen_id:
        cr = await db.execute(select(Citizen).where(Citizen.id == appt.citizen_id))
        citizen = cr.scalar_one_or_none()

    name = decode_field(appt.encrypted_name or (citizen.encrypted_name if citizen else ""))
    mobile = decode_field(citizen.encrypted_mobile if citizen else "")

    print(f"\n  Appointment ID : {appt.id}")
    print(f"  Token          : {appt.token_assigned}")
    print(f"  Name           : {name}")
    print(f"  Mobile         : {mobile}")
    print(f"  Category       : {appt.grievance_category or '-'}")
    print(f"  Status         : {appt.status}")
    print(f"  Created        : {appt.created_at.strftime('%Y-%m-%d %H:%M') if appt.created_at else '-'}")
    print(f"  Citizen ID     : {appt.citizen_id}")
    return appt


async def count_other_appointments(db: AsyncSession, citizen_id: int, exclude_appt_id: int) -> int:
    count = await db.scalar(
        select(func.count(Appointment.id))
        .where(Appointment.citizen_id == citizen_id)
        .where(Appointment.id != exclude_appt_id)
    )
    return count or 0


async def delete_appointment(appointment_id: int):
    async with AsyncSessionLocal() as db:
        # ── Step 1: Show what we're about to delete ───────────────────────────
        print(f"\n{'='*60}")
        print(f"  APPOINTMENT TO DELETE")
        print(f"{'='*60}")

        appt = await fetch_appointment_summary(db, appointment_id)
        if not appt:
            print(f"\n  ERROR: Appointment ID {appointment_id} not found in database.")
            return

        citizen_id = appt.citizen_id

        # ── Step 2: Show related record counts ───────────────────────────────
        ticket_res = await db.execute(select(Ticket).where(Ticket.appointment_id == appointment_id))
        ticket = ticket_res.scalar_one_or_none()

        t_events_count = 0
        if ticket:
            t_events_count = await db.scalar(
                select(func.count(TicketEvent.id)).where(TicketEvent.ticket_id == ticket.id)
            ) or 0

        summary_count = await db.scalar(
            select(func.count(GrievanceSummaryRecord.id))
            .where(GrievanceSummaryRecord.appointment_id == appointment_id)
        ) or 0

        appt_events_count = await db.scalar(
            select(func.count(AppointmentEvent.id))
            .where(AppointmentEvent.appointment_id == appointment_id)
        ) or 0

        attachments_count = await db.scalar(
            select(func.count(AppointmentAttachment.id))
            .where(AppointmentAttachment.appointment_id == appointment_id)
        ) or 0

        slot_booking_res = await db.execute(
            select(SlotBooking).where(SlotBooking.appointment_id == appointment_id)
        )
        slot_booking = slot_booking_res.scalar_one_or_none()

        other_appts = await count_other_appointments(db, citizen_id, appointment_id) if citizen_id else 1

        print(f"\n  Related records to be deleted:")
        print(f"    Ticket              : {'1 (ID: ' + str(ticket.id) + ')' if ticket else 'none'}")
        print(f"    Ticket events       : {t_events_count}")
        print(f"    Grievance summaries : {summary_count}")
        print(f"    Appointment events  : {appt_events_count}")
        print(f"    Attachments         : {attachments_count}")
        print(f"    Slot booking        : {'1 (slot will be freed)' if slot_booking else 'none'}")
        print(f"    Citizen record      : {'YES (no other appointments)' if other_appts == 0 else 'NO (citizen has other appointments, will be kept)'}")

        # ── Step 3: Confirm ───────────────────────────────────────────────────
        print(f"\n{'='*60}")
        confirm = input("  Type YES to confirm deletion: ").strip()
        if confirm != "YES":
            print("\n  Aborted. Nothing was deleted.")
            return

        # ── Step 4: Delete in safe order ──────────────────────────────────────
        print("\n  Deleting...")

        # 4a. Ticket events
        if ticket:
            await db.execute(delete(TicketEvent).where(TicketEvent.ticket_id == ticket.id))
            print(f"    [OK] Ticket events deleted ({t_events_count} row(s))")

            await db.execute(delete(Ticket).where(Ticket.id == ticket.id))
            print(f"    [OK] Ticket deleted")

        # 4b. Grievance summary records
        await db.execute(
            delete(GrievanceSummaryRecord).where(GrievanceSummaryRecord.appointment_id == appointment_id)
        )
        print(f"    [OK] Grievance summaries deleted ({summary_count} row(s))")

        # 4c. Appointment events
        await db.execute(
            delete(AppointmentEvent).where(AppointmentEvent.appointment_id == appointment_id)
        )
        print(f"    [OK] Appointment events deleted ({appt_events_count} row(s))")

        # 4d. Attachments
        await db.execute(
            delete(AppointmentAttachment).where(AppointmentAttachment.appointment_id == appointment_id)
        )
        print(f"    [OK] Attachments deleted ({attachments_count} row(s))")

        # 4e. Slot booking — free the slot
        if slot_booking:
            slot_id = slot_booking.slot_id
            await db.execute(delete(SlotBooking).where(SlotBooking.appointment_id == appointment_id))

            # Decrement booked_count and reset FULL -> AVAILABLE if needed
            slot_res = await db.execute(select(AppointmentSlot).where(AppointmentSlot.id == slot_id))
            slot = slot_res.scalar_one_or_none()
            if slot:
                slot.booked_count = max(0, slot.booked_count - 1)
                if slot.status == "FULL" and slot.booked_count < slot.max_capacity:
                    slot.status = "AVAILABLE"
                print(f"    [OK] Slot booking removed, slot {slot_id} booked_count -> {slot.booked_count}")

        # 4f. Appointment
        await db.execute(delete(Appointment).where(Appointment.id == appointment_id))
        print(f"    [OK] Appointment deleted")

        # 4g. Citizen — only if no other appointments
        if citizen_id and other_appts == 0:
            await db.execute(delete(Citizen).where(Citizen.id == citizen_id))
            print(f"    [OK] Citizen record deleted (no remaining appointments)")
        else:
            print(f"    [--] Citizen record kept (has {other_appts} other appointment(s))")

        await db.commit()
        print(f"\n  Done. Appointment {appointment_id} and all related data deleted successfully.")
        print(f"{'='*60}\n")


def main():
    if len(sys.argv) != 2 or not sys.argv[1].isdigit():
        print("\nUsage: python delete_test_appointment.py <appointment_id>")
        print("Example: python delete_test_appointment.py 161\n")
        sys.exit(1)

    appointment_id = int(sys.argv[1])
    asyncio.run(delete_appointment(appointment_id))


if __name__ == "__main__":
    main()
