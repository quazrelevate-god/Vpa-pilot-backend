"""
Find and print test data from the database.
Decodes base64-encoded names and shows appointment details including
grievance category (topic), status, token, and creation date.

Usage:
    cd backend
    python find_test_data.py                    # show all appointments
    python find_test_data.py --name "kumar"     # filter by name (case-insensitive)
    python find_test_data.py --topic "health"   # filter by grievance category
    python find_test_data.py --date-from 2026-07-01 --date-to 2026-07-01  # single day
    python find_test_data.py --name "test" --date-from 2026-06-25         # combine filters
"""
import asyncio
import sys
from datetime import datetime

from sqlalchemy import select, func
from sqlalchemy.orm import selectinload

# Windows event loop fix for psycopg async
if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

from src.core.database import AsyncSessionLocal
from src.core.crypto import decrypt
# Import all models so SQLAlchemy mapper relationships resolve correctly
from src.models.appointment_models import Appointment, Citizen, AppointmentAttachment
from src.models.grievance_summary_record import GrievanceSummaryRecord
from src.models.ticket_models import Ticket  # noqa: F401 — needed for mapper
from src.models.qr_models import GatekeeperSession  # noqa: F401 — needed for mapper
from src.models.scheduling_models import AppointmentSlot  # noqa: F401 — needed for mapper


def decode_field(encoded: str | None) -> str:
    """Decrypt a Fernet-encrypted PII field back to plaintext.
    Falls back to legacy base64 automatically for un-migrated rows."""
    if not encoded:
        return ""
    return decrypt(encoded) or ""


async def find_test_data(
    name_filter: str = "",
    topic_filter: str = "",
    date_from: str = "",
    date_to: str = "",
):
    async with AsyncSessionLocal() as db:
        stmt = (
            select(Appointment)
            .join(Citizen, Citizen.id == Appointment.citizen_id)
            .options(
                selectinload(Appointment.citizen),
                selectinload(Appointment.grievance_summary),
                selectinload(Appointment.attachments),
            )
            .order_by(Appointment.created_at.desc())
        )

        if topic_filter:
            stmt = stmt.where(
                func.lower(Appointment.grievance_category).contains(topic_filter.lower())
            )

        # Date range on created_at — matches the /dashboard/api/appointments contract
        # (inclusive on both ends; date_to expands to end-of-day).
        if date_from:
            try:
                stmt = stmt.where(Appointment.created_at >= datetime.strptime(date_from, "%Y-%m-%d"))
            except ValueError:
                print(f"Invalid --date-from '{date_from}', expected YYYY-MM-DD")
                return
        if date_to:
            try:
                stmt = stmt.where(
                    Appointment.created_at <= datetime.strptime(date_to + " 23:59:59", "%Y-%m-%d %H:%M:%S")
                )
            except ValueError:
                print(f"Invalid --date-to '{date_to}', expected YYYY-MM-DD")
                return

        result = await db.execute(stmt)
        appointments = result.scalars().all()

    # Decode and filter
    rows = []
    for appt in appointments:
        citizen_name = decode_field(appt.citizen.encrypted_name) if appt.citizen else ""
        appt_name = decode_field(appt.encrypted_name) if appt.encrypted_name else citizen_name
        mobile = decode_field(appt.citizen.encrypted_mobile) if appt.citizen else ""
        grievance = decode_field(appt.encrypted_grievance) if appt.encrypted_grievance else ""

        display_name = appt_name or citizen_name

        if name_filter and name_filter.lower() not in display_name.lower():
            continue

        # Get AI summary if available
        summary_text = ""
        summary_ta = ""
        urgency = ""
        department = ""
        if appt.grievance_summary:
            latest = appt.grievance_summary[0]  # ordered desc by created_at
            summary_text = getattr(latest, "summary_en", "") or ""
            summary_ta = getattr(latest, "summary_ta", "") or ""
            urgency = getattr(latest, "urgency", "") or ""
            department = getattr(latest, "department", "") or ""

        rows.append({
            "id": appt.id,
            "token": appt.token_assigned,
            "name": display_name,
            "mobile": mobile,
            "category": appt.grievance_category or "-",
            "status": appt.status,
            "grievance": grievance[:80] + ("..." if len(grievance) > 80 else ""),
            "summary": summary_text[:80] + ("..." if len(summary_text) > 80 else ""),
            "urgency": urgency,
            "department": department,
            "attachments": len(appt.attachments) if appt.attachments else 0,
            "created": appt.created_at.strftime("%Y-%m-%d %H:%M") if appt.created_at else "-",
            "ward": appt.citizen.ward_or_region if appt.citizen else "-",
        })

    # Print results
    if not rows:
        print("\nNo matching records found.")
        if name_filter:
            print(f"  Name filter: '{name_filter}'")
        if topic_filter:
            print(f"  Topic filter: '{topic_filter}'")
        if date_from or date_to:
            print(f"  Date range (created_at): {date_from or '...'} → {date_to or '...'}")
        return

    print(f"\n{'='*100}")
    print(f"  APPOINTMENT DATA — {len(rows)} record(s) found")
    if name_filter:
        print(f"  Name filter: '{name_filter}'")
    if topic_filter:
        print(f"  Topic/category filter: '{topic_filter}'")
    if date_from or date_to:
        print(f"  Date range (created_at): {date_from or '...'} → {date_to or '...'}")
    print(f"{'='*100}\n")

    for i, row in enumerate(rows, 1):
        print(f"  [{i}] ID: {row['id']}  |  Token: {row['token']}  |  Status: {row['status']}")
        print(f"      Name:       {row['name']}")
        print(f"      Mobile:     {row['mobile']}")
        print(f"      Ward:       {row['ward']}")
        print(f"      Category:   {row['category']}")
        if row["urgency"]:
            print(f"      Urgency:    {row['urgency']}")
        if row["department"]:
            print(f"      Department: {row['department']}")
        print(f"      Grievance:  {row['grievance']}")
        if row["summary"]:
            print(f"      AI Summary: {row['summary']}")
        print(f"      Attachments: {row['attachments']}")
        print(f"      Created:    {row['created']}")
        print(f"      {'-'*60}")


def main():
    import argparse

    parser = argparse.ArgumentParser(description="Find and print test data from the database")
    parser.add_argument("--name", "-n", default="", help="Filter by citizen name (case-insensitive substring match)")
    parser.add_argument("--topic", "-t", default="", help="Filter by grievance category/topic (case-insensitive)")
    parser.add_argument("--date-from", default="", help="Only rows created on/after this date (YYYY-MM-DD)")
    parser.add_argument("--date-to", default="", help="Only rows created on/before this date (YYYY-MM-DD, inclusive)")
    args = parser.parse_args()

    asyncio.run(find_test_data(
        name_filter=args.name,
        topic_filter=args.topic,
        date_from=args.date_from,
        date_to=args.date_to,
    ))


if __name__ == "__main__":
    main()
