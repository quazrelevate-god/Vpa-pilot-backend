"""
Proposal dashboard analytics — the Minister-facing aggregate view over
``proposal_submissions``.

One read-only pass over the (small) proposals table, distilled into the numbers
a Minister scans before a press meet: how many ideas came in, how many are
waiting on his desk, the approve/reject split, which portfolio they target, what
the AI flagged for a closer look, who's proposing, and the intake trend.

The table is small (institutional proposals, not citizen petitions), so we fetch
once and aggregate in Python — simpler and more robust than JSONB SQL, and the
row count never approaches a size where it matters.
"""
from __future__ import annotations

from collections import Counter
from datetime import timedelta
from typing import Any, Dict, List

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.timeutil import now_utc
from src.models.proposal_models import (
    ProposalSubmission,
    STATUS_QUEUED, STATUS_PROCESSING, STATUS_AWAITING_REVIEW, STATUS_FAILED,
    STATUS_APPROVED, STATUS_REJECTED, STATUS_NEEDS_CLARIFICATION,
)
from src.models.proposal_extraction import RECOMMENDATION_DISPLAY_EN


CATEGORY_LABEL: Dict[str, str] = {
    "school":      "School Education",
    "tamil":       "Tamil & Heritage",
    "information": "Information & Publicity",
    "film":        "Film",
}

STATUS_LABEL: Dict[str, str] = {
    STATUS_QUEUED:              "Queued",
    STATUS_PROCESSING:          "Reading",
    STATUS_AWAITING_REVIEW:     "Awaiting decision",
    STATUS_FAILED:              "Failed",
    STATUS_APPROVED:            "Approved",
    STATUS_REJECTED:            "Rejected",
    STATUS_NEEDS_CLARIFICATION: "Needs clarification",
}

# The decision buckets, in the order the Minister thinks about them.
_DECISION_ORDER = [
    STATUS_AWAITING_REVIEW, STATUS_APPROVED, STATUS_REJECTED, STATUS_NEEDS_CLARIFICATION,
]

_NO_COST = {"", "not specified", "n/a", "na", "nil", "-", "none", "not mentioned"}


def _pct(n: int, d: int) -> float:
    return round(100.0 * n / d, 1) if d else 0.0


def _has_cost(row: ProposalSubmission) -> bool:
    c = ((row.extraction_json or {}).get("estimated_cost") or "").strip().lower()
    return bool(c) and c not in _NO_COST


async def get_proposal_analytics(db: AsyncSession, trend_days: int = 90) -> Dict[str, Any]:
    rows: List[ProposalSubmission] = (
        await db.execute(select(ProposalSubmission))
    ).scalars().all()

    total = len(rows)
    status_counts = Counter(r.status for r in rows)
    approved = status_counts.get(STATUS_APPROVED, 0)
    rejected = status_counts.get(STATUS_REJECTED, 0)
    needs    = status_counts.get(STATUS_NEEDS_CLARIFICATION, 0)
    awaiting = status_counts.get(STATUS_AWAITING_REVIEW, 0)
    processing = status_counts.get(STATUS_QUEUED, 0) + status_counts.get(STATUS_PROCESSING, 0)
    failed   = status_counts.get(STATUS_FAILED, 0)
    decided  = approved + rejected + needs

    # ── Decision status mix (the donut) ──────────────────────────────────────
    by_status = [
        {"key": s, "label": STATUS_LABEL.get(s, s), "count": status_counts.get(s, 0)}
        for s in _DECISION_ORDER if status_counts.get(s, 0) > 0
    ]

    # ── By portfolio / category ──────────────────────────────────────────────
    cat_counts = Counter((r.category or "other") for r in rows)
    by_category = [
        {"key": k, "label": CATEGORY_LABEL.get(k, k.title()), "count": v}
        for k, v in cat_counts.most_common()
    ]

    # ── AI recommendation mix (triage hint the Minister can lean on) ──────────
    rec_counts = Counter(
        ((r.extraction_json or {}).get("ai_recommendation") or "standard")
        for r in rows if r.extraction_json
    )
    by_recommendation = [
        {"key": k, "label": RECOMMENDATION_DISPLAY_EN.get(k, k.replace("_", " ").title()), "count": v}
        for k, v in rec_counts.most_common()
    ]

    # ── Approve / reject split per portfolio ─────────────────────────────────
    appr: Counter = Counter()
    rej:  Counter = Counter()
    for r in rows:
        if r.status == STATUS_APPROVED:
            appr[r.category or "other"] += 1
        elif r.status == STATUS_REJECTED:
            rej[r.category or "other"] += 1
    approval_by_category = []
    for k in cat_counts:
        a, rj = appr.get(k, 0), rej.get(k, 0)
        if a + rj == 0:
            continue
        approval_by_category.append({
            "key": k, "label": CATEGORY_LABEL.get(k, k.title()),
            "approved": a, "rejected": rj, "rate": _pct(a, a + rj),
        })
    approval_by_category.sort(key=lambda x: x["approved"] + x["rejected"], reverse=True)

    # ── Who is proposing (top organisations) ─────────────────────────────────
    org_counts = Counter(
        (r.org_name or "").strip() for r in rows if (r.org_name or "").strip()
    )
    top_orgs = [{"name": n, "count": c} for n, c in org_counts.most_common(8)]

    # ── Intake trend (daily received, filled) ────────────────────────────────
    today = now_utc().date()
    start = today - timedelta(days=trend_days - 1)
    day_counts: Counter = Counter()
    for r in rows:
        if r.created_at and r.created_at.date() >= start:
            day_counts[r.created_at.date().isoformat()] += 1
    trend = []
    d = start
    while d <= today:
        iso = d.isoformat()
        trend.append({"date": iso, "received": day_counts.get(iso, 0)})
        d += timedelta(days=1)

    # ── Momentum: last 30 days vs the 30 before ──────────────────────────────
    def _window(days_from: int, days_to: int) -> int:
        lo = today - timedelta(days=days_from)
        hi = today - timedelta(days=days_to)
        return sum(1 for r in rows if r.created_at and hi < r.created_at.date() <= lo)
    recent30 = sum(1 for r in rows if r.created_at and r.created_at.date() > today - timedelta(days=30))
    prior30  = _window(60, 30)
    growth_pct = _pct(recent30 - prior30, prior30) if prior30 else None

    return {
        "kpis": {
            "total": total,
            "awaiting": awaiting,
            "approved": approved,
            "rejected": rejected,
            "needs_clarification": needs,
            "processing": processing,
            "failed": failed,
            "decided": decided,
            "approval_rate": _pct(approved, approved + rejected),
            "with_cost": with_cost_count(rows),
            "received_30d": recent30,
            "growth_pct": growth_pct,
        },
        "by_status": by_status,
        "by_category": by_category,
        "by_recommendation": by_recommendation,
        "approval_by_category": approval_by_category,
        "top_orgs": top_orgs,
        "trend": trend,
    }


def with_cost_count(rows: List[ProposalSubmission]) -> int:
    return sum(1 for r in rows if _has_cost(r))
