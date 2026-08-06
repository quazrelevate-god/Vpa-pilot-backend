"""Unit tests for association_analytics — pure Python aggregation over an
in-memory list of AssociationSubmission-shaped rows. No DB.

Guards the KPIs the Minister dashboard hangs on:
  - parse_members handles Indian numbering / ranges / prose / absent;
  - unique_bodies dedups case + whitespace but keeps unnamed rows apart;
  - median_days_to_decision computes over decided rows only, None on empty;
  - decided_pct handles a zero-total table without ZeroDivisionError;
  - critical_high / engage_now sum from urgency + ai_recommendation buckets;
  - empty table returns a fully-shaped payload (all zeros, no crashes).
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

from src.services.association_analytics import (
    get_association_analytics, parse_members,
)


def _now(offset_days: int = 0) -> datetime:
    return datetime.now(timezone.utc) - timedelta(days=offset_days)


def _row(
    *, status: str = "AWAITING_REVIEW", association_name: str | None = "Union A",
    member_count: str | None = "1,000 members",
    category: str | None = "job_requests", ministry: str | None = "school_education",
    urgency: str | None = "medium", district: str | None = "Chennai",
    created_offset: int = 5, reviewed_offset: int | None = None,
    ai_recommendation: str | None = None, id: int = 1,
) -> SimpleNamespace:
    """Lightweight stand-in for an AssociationSubmission row. get_association_analytics
    only reads attributes; SimpleNamespace matches that contract without needing
    the SQLAlchemy model + DB."""
    ex: dict = {}
    if ai_recommendation:
        ex["ai_recommendation"] = ai_recommendation
    return SimpleNamespace(
        id=id, status=status, association_name=association_name,
        member_count=member_count, category=category, ministry=ministry,
        urgency=urgency, district=district,
        extraction_json=ex,
        created_at=_now(created_offset),
        reviewed_at=_now(reviewed_offset) if reviewed_offset is not None else None,
    )


class _FakeDB:
    """Minimal AsyncSession stub that returns a preset row list from `execute()`."""
    def __init__(self, rows):
        self._rows = rows
    async def execute(self, _stmt):
        class R:
            def __init__(self, rows): self._rows = rows
            def scalars(self): return self
            def all(self): return self._rows
        return R(self._rows)


# ── parse_members ────────────────────────────────────────────────────────────
class TestParseMembers:
    def test_plain_integers(self):
        assert parse_members("5000") == 5000
        assert parse_members("128 members") == 128

    def test_indian_commas(self):
        assert parse_members("12,000 members") == 12000
        assert parse_members("1,20,000") == 120000

    def test_approx_and_prose(self):
        assert parse_members("approx 5000") == 5000
        assert parse_members("Over 3,200 guest lecturers") == 3200

    def test_range_takes_larger(self):
        # "5000-6000" — both are separate matches, largest wins (upper bound
        # is the honest headline for reach).
        assert parse_members("5000-6000 members") == 6000

    def test_absent_and_placeholder(self):
        assert parse_members(None) == 0
        assert parse_members("") == 0
        assert parse_members("Not specified") == 0
        assert parse_members("no membership stated") == 0

    def test_negative_and_junk(self):
        assert parse_members("---") == 0
        assert parse_members("abc") == 0


# ── analytics KPIs ────────────────────────────────────────────────────────────
class TestAnalyticsEmpty:
    async def test_empty_table_full_shape(self):
        """Empty table must return every KPI as 0 / None (never a KeyError)."""
        r = await get_association_analytics(_FakeDB([]))
        k = r["kpis"]
        assert k["total"] == 0
        assert k["unique_bodies"] == 0
        assert k["repeat_bodies"] == 0
        assert k["awaiting"] == k["reviewed"] == k["forwarded"] == 0
        assert k["decided"] == 0
        assert k["decided_pct"] == 0.0
        assert k["median_days_to_decision"] is None
        assert k["members_represented"] == 0
        assert k["bodies_with_size"] == 0
        assert k["districts_covered"] == 0
        assert k["received_30d"] == 0
        assert k["growth_pct"] is None
        assert k["critical_high"] == 0
        assert k["engage_now"] == 0
        # Chart series present but empty — never missing keys.
        for key in ("by_status", "by_category", "by_urgency", "by_district",
                    "by_ministry", "by_recommendation", "top_associations", "trend"):
            assert key in r
            assert isinstance(r[key], list)


class TestUniqueBodies:
    async def test_dedups_case_and_whitespace(self):
        rows = [
            _row(association_name="Chennai PTA", id=1),
            _row(association_name="chennai pta", id=2),   # case  → same
            _row(association_name=" Chennai PTA ", id=3), # trim → same
            _row(association_name="Madurai Union", id=4),
        ]
        r = await get_association_analytics(_FakeDB(rows))
        assert r["kpis"]["unique_bodies"] == 2

    async def test_unnamed_rows_are_distinct(self):
        # Two unnamed rows must not collapse into one body — different orgs
        # that happened to file without a name are still different orgs.
        rows = [
            _row(association_name=None, id=10),
            _row(association_name="", id=11),
            _row(association_name="   ", id=12),
            _row(association_name="Real Union", id=13),
        ]
        r = await get_association_analytics(_FakeDB(rows))
        assert r["kpis"]["unique_bodies"] == 4  # 3 unnamed (keyed by id) + 1 real

    async def test_repeat_bodies_needs_2_plus(self):
        rows = [
            _row(association_name="A", id=1),
            _row(association_name="A", id=2),  # A submitted twice
            _row(association_name="B", id=3),  # B once
            _row(association_name="C", id=4),
            _row(association_name="C", id=5),
            _row(association_name="C", id=6),  # C thrice
        ]
        r = await get_association_analytics(_FakeDB(rows))
        assert r["kpis"]["unique_bodies"] == 3
        assert r["kpis"]["repeat_bodies"] == 2  # A + C


class TestMedianDaysToDecision:
    async def test_computes_over_decided_only(self):
        rows = [
            # Awaiting rows must not count in the median even if they have a
            # reviewed_at (defensive — shouldn't happen, but if it does, ignore).
            _row(status="AWAITING_REVIEW", created_offset=10, reviewed_offset=None, id=1),
            _row(status="REVIEWED",  created_offset=10, reviewed_offset=8, id=2),   # 2 days
            _row(status="FORWARDED", created_offset=15, reviewed_offset=11, id=3),  # 4 days
            _row(status="REVIEWED",  created_offset=20, reviewed_offset=14, id=4),  # 6 days
        ]
        r = await get_association_analytics(_FakeDB(rows))
        # median of [2, 4, 6] = 4
        assert r["kpis"]["median_days_to_decision"] == 4.0
        assert r["kpis"]["decided"] == 3

    async def test_none_when_nothing_decided(self):
        rows = [_row() for _ in range(3)]  # all AWAITING_REVIEW
        r = await get_association_analytics(_FakeDB(rows))
        assert r["kpis"]["median_days_to_decision"] is None
        assert r["kpis"]["decided"] == 0

    async def test_ignores_negative_diffs(self):
        # Malformed row where reviewed_at somehow predates created_at — the
        # KPI must not go negative or crash; the row is silently dropped.
        rows = [
            _row(status="REVIEWED", created_offset=1, reviewed_offset=5, id=1),  # -4 days → dropped
            _row(status="REVIEWED", created_offset=10, reviewed_offset=8, id=2), # +2 days
        ]
        r = await get_association_analytics(_FakeDB(rows))
        assert r["kpis"]["median_days_to_decision"] == 2.0


class TestDecidedPct:
    async def test_denominator_zero_returns_zero(self):
        # Empty table already covered above; here decided=0 with total>0 = 0.0%.
        rows = [_row() for _ in range(4)]  # all AWAITING_REVIEW
        r = await get_association_analytics(_FakeDB(rows))
        assert r["kpis"]["decided_pct"] == 0.0

    async def test_rounds_to_one_decimal(self):
        rows = (
            [_row(status="AWAITING_REVIEW", id=i) for i in range(2)]
            + [_row(status="REVIEWED",  created_offset=5, reviewed_offset=3, id=10 + i) for i in range(3)]
            + [_row(status="FORWARDED", created_offset=5, reviewed_offset=2, id=20)]
        )
        # 4 decided of 6 total → 66.666... → 66.7
        r = await get_association_analytics(_FakeDB(rows))
        assert r["kpis"]["decided_pct"] == 66.7
        assert r["kpis"]["decided"] == 4


class TestAttentionKpis:
    async def test_critical_high_sums_both(self):
        rows = [
            _row(urgency="critical", id=1),
            _row(urgency="critical", id=2),
            _row(urgency="high",     id=3),
            _row(urgency="medium",   id=4),
            _row(urgency="low",      id=5),
            _row(urgency=None,       id=6),   # excluded
        ]
        r = await get_association_analytics(_FakeDB(rows))
        assert r["kpis"]["critical_high"] == 3  # 2 crit + 1 high

    async def test_engage_now_from_extraction_json(self):
        rows = [
            _row(ai_recommendation="engage_now", id=1),
            _row(ai_recommendation="engage_now", id=2),
            _row(ai_recommendation="routine",    id=3),
            _row(ai_recommendation=None,         id=4),  # pre-v2 row, no rec
        ]
        r = await get_association_analytics(_FakeDB(rows))
        assert r["kpis"]["engage_now"] == 2
        # by_recommendation excludes zero-count entries so a partial mix is honest
        rec_keys = {b["key"] for b in r["by_recommendation"]}
        assert "engage_now" in rec_keys and "routine" in rec_keys


class TestReach:
    async def test_members_sum_and_bodies_with_size(self):
        rows = [
            _row(member_count="1,000 members", id=1),
            _row(member_count="500",           id=2),
            _row(member_count="Not specified", id=3),  # excluded from sum + count
            _row(member_count=None,            id=4),  # excluded
        ]
        r = await get_association_analytics(_FakeDB(rows))
        assert r["kpis"]["members_represented"] == 1500
        assert r["kpis"]["bodies_with_size"] == 2

    async def test_districts_covered_ignores_unknown(self):
        rows = [
            _row(district="Chennai",  id=1),
            _row(district="Madurai",  id=2),
            _row(district="unknown",  id=3),  # excluded
            _row(district="Unknown",  id=4),  # excluded (case-insensitive)
            _row(district=None,       id=5),  # excluded
        ]
        r = await get_association_analytics(_FakeDB(rows))
        assert r["kpis"]["districts_covered"] == 2
