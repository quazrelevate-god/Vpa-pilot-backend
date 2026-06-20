"""End-to-end wiring check for the ticketing system. Does NOT touch the DB."""
from __future__ import annotations

import inspect
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

if sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

FAIL = []
def check(name, cond):
    if cond:
        print(f"  [OK]   {name}")
    else:
        print(f"  [FAIL] {name}")
        FAIL.append(name)


print("=" * 60)
print("1. MODEL IMPORTS")
print("=" * 60)
from src.models.ticket_models import (  # noqa: E402
    Ticket, TicketEvent, TicketStatus, TicketPriority,
    ClosureReason, TicketEventType, URGENCY_TO_PRIORITY,
    generate_ticket_number,
)
from src.models.appointment_models import Appointment  # noqa: E402
from src.models.grievance_summary_record import GrievanceSummaryRecord  # noqa: E402
print("OK")

print()
print("=" * 60)
print("2. TICKET MODEL — COLUMNS")
print("=" * 60)
expected_cols = {
    "id", "appointment_id", "ticket_number", "status", "priority",
    "assigned_to_pa", "due_date", "forwarded_to_dept", "forwarded_at",
    "forwarded_by", "forwarded_notes", "resolution_notes", "closure_reason",
    "resolved_at", "closed_at", "reopened_at", "reopen_count",
    "created_at", "updated_at",
}
actual = {c.name for c in Ticket.__table__.columns}
missing = expected_cols - actual
extra = actual - expected_cols
print(f"  Expected {len(expected_cols)} | Actual {len(actual)}")
check("All ticket columns present", not missing)
if missing:
    print(f"     missing: {missing}")
if extra:
    print(f"     extra:   {extra}")

print()
print("=" * 60)
print("3. RELATIONSHIPS")
print("=" * 60)
check("Ticket.appointment relationship",   hasattr(Ticket, "appointment"))
check("Ticket.events relationship",        hasattr(Ticket, "events"))
check("Appointment.ticket back-ref",       hasattr(Appointment, "ticket"))

print()
print("=" * 60)
print("4. ENUM COMPLETENESS")
print("=" * 60)
print(f"  TicketStatus    ({len(list(TicketStatus))}): {[s.value for s in TicketStatus]}")
print(f"  TicketPriority  ({len(list(TicketPriority))}): {[p.value for p in TicketPriority]}")
print(f"  ClosureReason   ({len(list(ClosureReason))}): {[c.value for c in ClosureReason]}")
print(f"  TicketEventType ({len(list(TicketEventType))}): {[e.value for e in TicketEventType]}")
print(f"  URGENCY_TO_PRIORITY: {URGENCY_TO_PRIORITY}")
check("9 ticket statuses",  len(list(TicketStatus)) == 9)
check("4 priorities",        len(list(TicketPriority)) == 4)
check("6 closure reasons",   len(list(ClosureReason)) == 6)
check("12 event types",      len(list(TicketEventType)) == 12)

print()
print("=" * 60)
print("5. SERVICE IMPORTS")
print("=" * 60)
from src.services.ticket_service import (  # noqa: E402
    list_tickets, get_ticket, update_ticket_fields, forward_to_dept,
    add_comment, mark_resolved, mark_closed, reopen, get_open_count,
    _serialize_ticket_row, _serialize_ticket_detail, _serialize_event,
)
check("All ticket_service functions importable", True)

print()
print("=" * 60)
print("6. APPOINTMENT_SERVICE WIRING (auto-ticket creation)")
print("=" * 60)
from src.services.appointment_service import appointment_service  # noqa: E402
submit_src = inspect.getsource(appointment_service.process_atomic_submission)
check("imports ticket models",      "from src.models.ticket_models import" in submit_src)
check("calls generate_ticket_number","generate_ticket_number" in submit_src)
check("creates Ticket row",         "Ticket(" in submit_src)
check("logs CREATED event",         "TicketEventType.CREATED.value" in submit_src)
check("year-counted sequence",      "year_count" in submit_src)

print()
print("=" * 60)
print("7. _trigger_summarisation WIRING (auto-priority + event)")
print("=" * 60)
trig_src = inspect.getsource(appointment_service._trigger_summarisation)
check("imports ticket models",          "from src.models.ticket_models import" in trig_src)
check("reads URGENCY_TO_PRIORITY",      "URGENCY_TO_PRIORITY" in trig_src)
check("preserves manual override",      "ticket.priority is None" in trig_src)
check("logs AI_SUMMARISED event",       "AI_SUMMARISED" in trig_src)

print()
print("=" * 60)
print("8. API ROUTES REGISTERED")
print("=" * 60)
from src.api.v1.dashboard import router  # noqa: E402
expected_routes = {
    ("GET",    "/dashboard/api/tickets"),
    ("GET",    "/dashboard/api/tickets/open_count"),
    ("GET",    "/dashboard/api/tickets/{ticket_id}"),
    ("PATCH",  "/dashboard/api/tickets/{ticket_id}"),
    ("POST",   "/dashboard/api/tickets/{ticket_id}/forward"),
    ("POST",   "/dashboard/api/tickets/{ticket_id}/comment"),
    ("POST",   "/dashboard/api/tickets/{ticket_id}/resolve"),
    ("POST",   "/dashboard/api/tickets/{ticket_id}/close"),
    ("POST",   "/dashboard/api/tickets/{ticket_id}/reopen"),
}
registered = set()
for r in router.routes:
    if hasattr(r, "methods"):
        for m in r.methods:
            registered.add((m, r.path))
missing_routes = expected_routes - registered
for m, p in sorted(expected_routes):
    check(f"{m:6s} {p}", (m, p) in registered)

print()
print("=" * 60)
print("9. APPOINTMENTS API — NEW FILTERS")
print("=" * 60)
from src.api.v1.dashboard import api_appointments  # noqa: E402
sig = inspect.signature(api_appointments)
for p in ("urgency", "department", "category"):
    check(f"api_appointments accepts ?{p}=", p in sig.parameters)
from src.services.dashboard_service import get_appointments  # noqa: E402
sig2 = inspect.signature(get_appointments)
for p in ("urgency", "department", "category"):
    check(f"get_appointments() arg `{p}`", p in sig2.parameters)

print()
print("=" * 60)
print("10. MIGRATION SQL")
print("=" * 60)
from migrate_add_department import SQL_STATEMENTS  # noqa: E402
print(f"  Total SQL statements: {len(SQL_STATEMENTS)}")
joined = "\n".join(SQL_STATEMENTS)
check("CREATE TABLE tickets",        "CREATE TABLE IF NOT EXISTS tickets" in joined)
check("CREATE TABLE ticket_events",  "CREATE TABLE IF NOT EXISTS ticket_events" in joined)
check("Index on ticket status",      "ix_tickets_status" in joined)
check("Index on ticket priority",    "ix_tickets_priority" in joined)
check("Index on ticket events FK",   "ix_ticket_events_ticket_id" in joined)
check("Backfill with TKT prefix",    "'TKT-'" in joined)
check("Backfill respects existing",  "ON CONFLICT (appointment_id) DO NOTHING" in joined)

print()
print("=" * 60)
print("11. TICKET NUMBER FORMAT")
print("=" * 60)
check("TKT-2026-00001",   generate_ticket_number(2026, 1) == "TKT-2026-00001")
check("TKT-2026-12345",   generate_ticket_number(2026, 12345) == "TKT-2026-12345")

print()
print("=" * 60)
print("12. SERIALIZER ROUND-TRIP (no DB)")
print("=" * 60)
class _Fake:
    def __init__(self, **kw): self.__dict__.update(kw)
fake_appt = _Fake(
    id=1, token_assigned=1, encrypted_grievance=None,
    citizen=_Fake(encrypted_name="", encrypted_mobile=""),
    attachments=[], grievance_summary=[],
)
fake_t = _Fake(
    id=99, ticket_number="TKT-2026-00099", appointment_id=1,
    status="open", priority=None, assigned_to_pa=None, due_date=None,
    forwarded_to_dept=None, reopen_count=0,
    created_at=datetime.utcnow(), updated_at=datetime.utcnow(),
    appointment=fake_appt,
)
row = _serialize_ticket_row(fake_t)
check("row.ticket_number",  row["ticket_number"] == "TKT-2026-00099")
check("row.status",          row["status"] == "open")
check("row.urgency (None)",  row["urgency"] is None)
check("row.token formatted", row["token"] == "TKN00001")

print()
print("=" * 60)
if FAIL:
    print(f"FAILED: {len(FAIL)} check(s)")
    for f in FAIL:
        print(f"  - {f}")
    sys.exit(1)
print("ALL CHECKS PASSED")
print("=" * 60)
