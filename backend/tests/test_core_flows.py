"""
Tests for the critical pilot flows: token generation, analytics filtering/scoping,
the petitions table, and the security-relevant filename sanitiser.

Pure-logic tests run anywhere; the DB tests are read-only against the configured
database (they assert shape + invariants, not exact counts).
"""
import pytest
from datetime import datetime

from src.services.appointment_service import appointment_service
from src.services.analytics_service import Filters, _conditions, _parse_dt, analytics_service
from src.models.ticket_models import generate_ticket_number


# ── Pure unit tests ──────────────────────────────────────────────────────────────
def test_ticket_number_format():
    assert generate_ticket_number(2026, 1) == "TKT-2026-00001"
    assert generate_ticket_number(2026, 12345) == "TKT-2026-12345"
    # zero-padding keeps lexical order == numeric order (relied on by the generator)
    assert generate_ticket_number(2026, 9) < generate_ticket_number(2026, 10)


def test_sanitize_filename_blocks_traversal():
    s = appointment_service._sanitize_filename
    assert s("../../etc/passwd") == "passwd"
    assert s("..\\..\\win.ini") == "win.ini"
    assert s("my report (1).pdf") == "my_report__1_.pdf"
    assert s("......") == "file"
    assert len(s("a" * 500)) <= 120


def test_filters_date_parsing():
    f = Filters(date_from="2026-06-01", date_to="2026-06-30")
    assert f.date_from.hour == 0 and f.date_from.day == 1
    assert f.date_to.hour == 23 and f.date_to.minute == 59
    assert _parse_dt("not-a-date", end=False) is None
    assert _parse_dt(None, end=True) is None


def test_filters_cross_filter_excludes_self():
    """A chart must exclude its own dimension so it still shows all options."""
    f = Filters(category="pension_requests", urgency="high")
    appt_all, gsr_all = _conditions(f)
    appt_excl_cat, _ = _conditions(f, exclude="category")
    _, gsr_excl_urg = _conditions(f, exclude="urgency")
    assert len(appt_excl_cat) == len(appt_all) - 1      # category dropped
    assert len(gsr_excl_urg) == len(gsr_all) - 1        # urgency dropped


# ── DB integration (read-only) ───────────────────────────────────────────────────
async def test_assign_daily_token_format(db):
    token, seq = await appointment_service._assign_daily_token(db, datetime.utcnow())
    await db.rollback()  # release the advisory lock; don't persist
    s = str(token)
    assert len(s) == 13                      # YYYYMMDDNNNNN
    assert s.endswith(str(seq).zfill(5))     # last 5 digits are the daily sequence
    assert seq >= 1


async def test_analytics_shape_and_scoping(db):
    full = await analytics_service.get_analytics(db, Filters())
    assert {"kpis", "categories", "urgency", "channels", "departments", "trend"} <= set(full)
    assert {"received", "citizens", "urgent", "meetings", "awaiting_review"} <= set(full["kpis"])

    if full["categories"]:
        cat = full["categories"][0]["key"]
        scoped = await analytics_service.get_analytics(db, Filters(category=cat))
        # filtering narrows the totals…
        assert scoped["kpis"]["received"] <= full["kpis"]["received"]
        # …but the category chart still lists every category (cross-filter excludes self)
        assert len(scoped["categories"]) == len(full["categories"])


async def test_petitions_pagination(db):
    p = await analytics_service.get_petitions(db, Filters(), page=1, page_size=5)
    assert p["page"] == 1
    assert len(p["items"]) <= 5
    assert p["total"] >= len(p["items"])
    if p["items"]:
        row = p["items"][0]
        assert {"name", "mobile", "category", "status", "source"} <= set(row)
