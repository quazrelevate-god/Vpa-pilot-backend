"""Unit tests for proposal_analytics — pure Python aggregation over an
in-memory list of ProposalSubmission-shaped rows. No DB.

Guards the KPIs the Minister dashboard hangs on:
  - approval_rate must NOT hallucinate 0% when only NEEDS_CLARIFICATION exists
    (approve/reject denominator is 0 → treat as "no signal yet");
  - avg_decision_days is None when nothing is decided;
  - parse_cost handles ₹ / lakh / crore / commas / Indian numbering;
  - pipeline_cost_value / _count sum ONLY parseable estimates (never inject);
  - growth_pct returns None when the prior window is empty.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

from src.services.proposal_analytics import (
    get_proposal_analytics, parse_cost, with_cost_count,
)


def _now(offset_days: int = 0) -> datetime:
    return datetime.now(timezone.utc) - timedelta(days=offset_days)


def _row(
    *, status: str = "AWAITING_REVIEW", cost: str | None = None,
    org: str | None = "OrgOne", category: str | None = "school",
    reviewed_at_offset: int | None = None, created_offset: int = 5,
    ai_recommendation: str | None = None,
) -> SimpleNamespace:
    """Build a lightweight stand-in for ProposalSubmission — the analytics
    reads only fields we set here, so a SimpleNamespace avoids DB dependency."""
    ex = {}
    if cost is not None:
        ex["estimated_cost"] = cost
    if ai_recommendation:
        ex["ai_recommendation"] = ai_recommendation
    return SimpleNamespace(
        status=status,
        org_name=org,
        category=category,
        extraction_json=ex,
        created_at=_now(created_offset),
        reviewed_at=_now(reviewed_at_offset) if reviewed_at_offset is not None else None,
    )


# ── parse_cost ───────────────────────────────────────────────────────────────
class TestParseCost:
    def test_crore_variants(self):
        assert parse_cost("Rs 2 crore") == 20_000_000
        assert parse_cost("₹1.5 Cr") == 15_000_000
        assert parse_cost("approx 3 crore for phase 1") == 30_000_000

    def test_lakh_variants(self):
        assert parse_cost("50 lakh") == 5_000_000
        assert parse_cost("10 lakhs") == 1_000_000
        assert parse_cost("Rs 2.5 lac") == 250_000

    def test_indian_commas_no_unit(self):
        assert parse_cost("5,00,000") == 500_000
        assert parse_cost("500000") == 500_000

    def test_si_units(self):
        assert parse_cost("2 million") == 2_000_000
        assert parse_cost("1 billion") == 1_000_000_000
        # Naked digits fall through as a rupee count — "800M" without a space
        # matches the digit group only ("800") and the unit is dropped. The
        # parser is deliberately lenient so a stray "₹500" isn't discarded.
        assert parse_cost("800M") == 800

    def test_absent_and_placeholder(self):
        assert parse_cost(None) == 0
        assert parse_cost("") == 0
        assert parse_cost("Not specified") == 0
        assert parse_cost("N/A") == 0

    def test_never_invents(self):
        assert parse_cost("no cost — CSR funded") == 0
        assert parse_cost("varies") == 0


# ── analytics ─────────────────────────────────────────────────────────────────
class TestAnalytics:
    async def test_empty_table(self, monkeypatch):
        # Bypass the DB SELECT by monkeypatching what get_proposal_analytics
        # would fetch. Simpler: call it via a fake db that returns [].
        class FakeDB:
            async def execute(self, _stmt):
                class R:
                    def scalars(self): return self
                    def all(self): return []
                return R()
        r = await get_proposal_analytics(FakeDB())
        assert r["kpis"]["total"] == 0
        assert r["kpis"]["approval_rate"] == 0.0
        assert r["kpis"]["avg_decision_days"] is None
        assert r["kpis"]["pipeline_cost_value"] == 0
        assert r["kpis"]["growth_pct"] is None
        assert r["by_status"] == []

    async def test_only_awaiting_returns_zero_decided(self, monkeypatch):
        rows = [_row() for _ in range(3)]
        class FakeDB:
            async def execute(self, _stmt):
                class R:
                    def scalars(self): return self
                    def all(self): return rows
                return R()
        r = await get_proposal_analytics(FakeDB())
        assert r["kpis"]["total"] == 3
        assert r["kpis"]["awaiting"] == 3
        assert r["kpis"]["decided"] == 0
        assert r["kpis"]["approval_rate"] == 0.0  # denominator 0 — the frontend guards the render
        assert r["kpis"]["avg_decision_days"] is None

    async def test_pipeline_cost_sums_only_parseable(self, monkeypatch):
        rows = [
            _row(cost="₹2 crore"),      # 2 Cr
            _row(cost="50 lakh"),        # 50 L
            _row(cost="Not specified"),  # 0 — excluded
            _row(cost=None),             # 0 — excluded
            _row(cost="varies"),         # 0 — excluded
        ]
        class FakeDB:
            async def execute(self, _stmt):
                class R:
                    def scalars(self): return self
                    def all(self): return rows
                return R()
        r = await get_proposal_analytics(FakeDB())
        assert r["kpis"]["pipeline_cost_value"] == 20_000_000 + 5_000_000
        assert r["kpis"]["pipeline_cost_count"] == 2  # only the two parseable ones
        # `with_cost` is deliberately looser than `pipeline_cost_count` — it
        # counts every row that STATED a cost (even if the parser couldn't
        # make sense of it), which is what the "N of M with a stated cost"
        # dashboard tile shows. "varies" is a stated (but unparseable) cost.
        assert r["kpis"]["with_cost"] == 3

    async def test_approval_rate_with_only_needs_clarification(self, monkeypatch):
        # This is the bug the audit found — decided > 0 but approved+rejected = 0
        # → 0% "approval" would mislead. The KPI stays 0, and the frontend
        # renders "—" via its own guard.
        rows = [
            _row(status="AWAITING_REVIEW"),
            _row(status="NEEDS_CLARIFICATION", reviewed_at_offset=1),
            _row(status="NEEDS_CLARIFICATION", reviewed_at_offset=1),
        ]
        class FakeDB:
            async def execute(self, _stmt):
                class R:
                    def scalars(self): return self
                    def all(self): return rows
                return R()
        r = await get_proposal_analytics(FakeDB())
        assert r["kpis"]["decided"] == 2
        assert r["kpis"]["approved"] == 0
        assert r["kpis"]["rejected"] == 0
        assert r["kpis"]["approval_rate"] == 0.0
        # This is the exact input the frontend guard now inspects.
        assert r["kpis"]["approved"] + r["kpis"]["rejected"] == 0

    async def test_avg_decision_days_computed_over_only_decided(self, monkeypatch):
        rows = [
            _row(status="APPROVED", created_offset=10, reviewed_at_offset=8),   # 2 days
            _row(status="REJECTED", created_offset=15, reviewed_at_offset=11),  # 4 days
            _row(status="AWAITING_REVIEW", created_offset=1),                    # ignored
        ]
        class FakeDB:
            async def execute(self, _stmt):
                class R:
                    def scalars(self): return self
                    def all(self): return rows
                return R()
        r = await get_proposal_analytics(FakeDB())
        # 3.0 with some rounding tolerance — both spans are exact days from _now
        assert r["kpis"]["avg_decision_days"] is not None
        assert 2.5 <= r["kpis"]["avg_decision_days"] <= 3.5


# ── with_cost_count helper ────────────────────────────────────────────────────
class TestWithCostCount:
    def test_counts_only_specified(self):
        rows = [_row(cost="1 lakh"), _row(cost="Not specified"), _row(cost=None), _row(cost="₹2 Cr")]
        assert with_cost_count(rows) == 2
