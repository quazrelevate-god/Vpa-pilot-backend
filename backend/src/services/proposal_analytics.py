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

import re
from collections import Counter
from datetime import timedelta
from typing import Any, Dict, List, Optional

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


# Indian-numbering units for turning a free-text cost into a rupee figure.
_COST_UNIT = {
    "crore": 10**7, "crores": 10**7, "cr": 10**7,
    "lakh": 10**5, "lakhs": 10**5, "lac": 10**5, "lacs": 10**5,
    "billion": 10**9, "bn": 10**9, "million": 10**6, "mn": 10**6,
    "thousand": 10**3, "k": 10**3,
}
# First number + optional Indian/SI unit. \b after the unit stops "5 kids" →
# "5k". Best-effort: an unparseable or unitless "₹500" counts as 500 rupees.
_COST_RE = re.compile(
    r"(\d[\d,]*(?:\.\d+)?)\s*(?:(crore|crores|cr|lakhs|lakh|lacs|lac|billion|bn|million|mn|thousand|k)\b)?",
    re.IGNORECASE,
)


def parse_cost(text: Optional[str]) -> int:
    """Best-effort rupee value from a free-text ``estimated_cost``.

    Handles "₹50 lakh", "Rs. 2 crore", "₹1.5 Cr", "5,00,000", "2 million".
    Returns 0 when the field is absent / "Not specified" / unparseable — the
    caller sums these into a headline "value in the pipeline", so a rough
    figure is the point, not accounting precision.
    """
    if not text:
        return 0
    s = text.strip().lower()
    if s in _NO_COST:
        return 0
    m = _COST_RE.search(s)
    if not m:
        return 0
    try:
        num = float(m.group(1).replace(",", ""))
    except ValueError:
        return 0
    return int(num * _COST_UNIT.get(m.group(2) or "", 1))


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

    # ── Decision turnaround: avg days from received → decided ─────────────────
    # Only proposals the Minister has actually acted on (a reviewed_at stamp),
    # so this reads as "how long a proposal waits before it gets a verdict".
    _DECIDED = {STATUS_APPROVED, STATUS_REJECTED, STATUS_NEEDS_CLARIFICATION}
    spans = [
        (r.reviewed_at - r.created_at).total_seconds() / 86400.0
        for r in rows
        if r.status in _DECIDED and r.reviewed_at and r.created_at and r.reviewed_at >= r.created_at
    ]
    avg_decision_days = round(sum(spans) / len(spans), 1) if spans else None

    # ── Value in the pipeline: summed stated cost (best-effort) ───────────────
    costed = [(r, parse_cost((r.extraction_json or {}).get("estimated_cost"))) for r in rows]
    pipeline_cost_value = sum(v for _, v in costed if v > 0)
    pipeline_cost_count = sum(1 for _, v in costed if v > 0)

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
            "decided_pct": _pct(decided, total),
            "approval_rate": _pct(approved, approved + rejected),
            "avg_decision_days": avg_decision_days,
            "with_cost": with_cost_count(rows),
            "pipeline_cost_value": pipeline_cost_value,
            "pipeline_cost_count": pipeline_cost_count,
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
