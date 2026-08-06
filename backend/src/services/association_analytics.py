"""
Association / Union dashboard analytics — the Minister-facing aggregate view over
``association_submissions``.

Associations are collective matters: a union of N members asking for one thing.
So the numbers a Minister cares about differ from proposals — above all the
*reach*: how many bodies, representing roughly how many people, across how many
districts, asking for what. This service distils exactly that: totals, the
member-reach headline, the grievance-category mix, the district spread (for the
Tamil Nadu map), urgency, routing ministry, status, the biggest unions, and the
intake trend.

Small table, single read + Python aggregation (see proposal_analytics for the
same rationale).
"""
from __future__ import annotations

import re
from collections import Counter
from datetime import timedelta
from statistics import median
from typing import Any, Dict, List

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.timeutil import now_utc
from src.models.association_models import (
    AssociationSubmission, STATUS_AWAITING_REVIEW, STATUS_REVIEWED, STATUS_FORWARDED,
)
from src.models.association_extraction import RECOMMENDATION_DISPLAY_EN
from src.models.grievance_summary import (
    CATEGORY_DISPLAY_EN, MINISTRY_DISPLAY, DISTRICT_DISPLAY,
)


STATUS_LABEL: Dict[str, str] = {
    STATUS_AWAITING_REVIEW: "Awaiting review",
    STATUS_REVIEWED:        "Reviewed",
    STATUS_FORWARDED:       "Forwarded",
}
_STATUS_ORDER = [STATUS_AWAITING_REVIEW, STATUS_REVIEWED, STATUS_FORWARDED]

URGENCY_LABEL: Dict[str, str] = {
    "critical": "Critical", "high": "High", "medium": "Medium", "low": "Low",
}
_URGENCY_ORDER = ["critical", "high", "medium", "low"]

# AI-recommendation triage buckets — ordered highest-attention-first so the
# donut / bar picker naturally reads left-to-right by "how soon should this be
# looked at". Any recommendation the extractor doesn't return still parses (the
# label helper falls back to titlecase).
_RECOMMENDATION_ORDER = ["engage_now", "routine", "refer", "needs_more_info"]


def _pct(n: int, d: int) -> float:
    return round(100.0 * n / d, 1) if d else 0.0


def parse_members(text: str | None) -> int:
    """Best-effort membership size from a free-text field.

    The extractor stores ``member_count`` verbatim ("12,000 members", "approx
    5000", "Not specified"). We pull the largest integer group so a headline
    "members represented" number is possible; unparseable / absent → 0.
    """
    if not text:
        return 0
    best = 0
    for grp in re.findall(r"\d[\d,]*", text):
        try:
            best = max(best, int(grp.replace(",", "")))
        except ValueError:
            continue
    return best


async def get_association_analytics(db: AsyncSession, trend_days: int = 90) -> Dict[str, Any]:
    rows: List[AssociationSubmission] = (
        await db.execute(select(AssociationSubmission))
    ).scalars().all()

    total = len(rows)
    status_counts = Counter(r.status for r in rows)
    awaiting  = status_counts.get(STATUS_AWAITING_REVIEW, 0)
    reviewed  = status_counts.get(STATUS_REVIEWED, 0)
    forwarded = status_counts.get(STATUS_FORWARDED, 0)

    # ── Reach: total members represented, and how many bodies stated a size ──
    members = [(r, parse_members(r.member_count)) for r in rows]
    members_represented = sum(m for _, m in members)
    bodies_with_size = sum(1 for _, m in members if m > 0)

    # ── Status mix ───────────────────────────────────────────────────────────
    by_status = [
        {"key": s, "label": STATUS_LABEL.get(s, s), "count": status_counts.get(s, 0)}
        for s in _STATUS_ORDER if status_counts.get(s, 0) > 0
    ]

    # ── What are they asking for (grievance category) ────────────────────────
    cat_counts = Counter((r.category or "other") for r in rows)
    by_category = [
        {"key": k, "label": CATEGORY_DISPLAY_EN.get(k, k.replace("_", " ").title()), "count": v}
        for k, v in cat_counts.most_common()
    ]

    # ── Urgency mix ──────────────────────────────────────────────────────────
    urg_counts = Counter((r.urgency or "").lower() for r in rows if r.urgency)
    by_urgency = [
        {"key": u, "label": URGENCY_LABEL.get(u, u.title()), "count": urg_counts.get(u, 0)}
        for u in _URGENCY_ORDER if urg_counts.get(u, 0) > 0
    ]
    # Critical + high combined — the single number the Minister actually cares
    # about ("how many bodies need urgent attention?"). Overlaps with by_urgency
    # by design: this is the KPI headline, that is the mix breakdown.
    critical_high = urg_counts.get("critical", 0) + urg_counts.get("high", 0)

    # ── AI recommendation mix ────────────────────────────────────────────────
    # Reads extraction_json.ai_recommendation (v2). Rows extracted before v2
    # have no key → they don't count in any bucket (they'll just be silently
    # missing from the donut, which is the honest answer).
    rec_counts: Counter = Counter()
    for r in rows:
        rec = ((r.extraction_json or {}).get("ai_recommendation") or "").strip().lower()
        if rec:
            rec_counts[rec] += 1
    ordered_keys = _RECOMMENDATION_ORDER + [
        k for k in rec_counts.keys() if k not in _RECOMMENDATION_ORDER
    ]
    by_recommendation = [
        {"key": k, "label": RECOMMENDATION_DISPLAY_EN.get(k, k.replace("_", " ").title()),
         "count": rec_counts.get(k, 0)}
        for k in ordered_keys if rec_counts.get(k, 0) > 0
    ]
    engage_now = rec_counts.get("engage_now", 0)

    # ── District spread — feeds the Tamil Nadu choropleth ────────────────────
    dist_counts = Counter(
        (r.district or "").lower() for r in rows
        if r.district and r.district.lower() != "unknown"
    )
    by_district = [
        {"key": k, "label": DISTRICT_DISPLAY.get(k, k.title()), "count": v}
        for k, v in dist_counts.most_common()
    ]
    districts_covered = len(dist_counts)

    # ── Routing ministry ─────────────────────────────────────────────────────
    min_counts = Counter((r.ministry or "other") for r in rows if r.ministry)
    by_ministry = [
        {"key": k, "label": MINISTRY_DISPLAY.get(k, k.replace("_", " ").title()), "count": v}
        for k, v in min_counts.most_common(8)
    ]

    # ── Biggest unions (by parsed member count) ──────────────────────────────
    ranked = sorted(
        (
            {
                "name": (r.association_name or "").strip() or "Unnamed body",
                "members": m,
                "category": CATEGORY_DISPLAY_EN.get(r.category or "", (r.category or "").replace("_", " ").title()),
            }
            for r, m in members if m > 0
        ),
        key=lambda x: x["members"], reverse=True,
    )
    top_associations = ranked[:8]

    # ── Intake trend (daily, filled) ─────────────────────────────────────────
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

    recent30 = sum(1 for r in rows if r.created_at and r.created_at.date() > today - timedelta(days=30))
    prior_lo, prior_hi = today - timedelta(days=60), today - timedelta(days=30)
    prior30 = sum(1 for r in rows if r.created_at and prior_lo < r.created_at.date() <= prior_hi)
    growth_pct = _pct(recent30 - prior30, prior30) if prior30 else None

    # ── Distinct-body count. A single union filing 5 submissions ≠ 5 bodies.
    # Case-insensitive + whitespace-collapsed so "Kalpakkam PTA" and
    # "kalpakkam pta " collapse. Unnamed rows count as separate bodies (no
    # merging on the empty key) — matches how the grouped list already treats
    # them.
    unique_bodies_set: set = set()
    for r in rows:
        name = (r.association_name or "").strip().lower()
        unique_bodies_set.add(name if name else f"__unnamed__{r.id}")
    unique_bodies = len(unique_bodies_set)

    # ── Repeat bodies (bodies with ≥2 submissions — signals well-organised /
    # active petitioning). Ignores unnamed rows (nothing to group them by).
    named_counter: Counter = Counter()
    for r in rows:
        name = (r.association_name or "").strip().lower()
        if name:
            named_counter[name] += 1
    repeat_bodies = sum(1 for _, n in named_counter.items() if n >= 2)

    # ── Median days to decision — over rows that reached REVIEWED / FORWARDED
    # (i.e. actually got a decision) AND have both timestamps. None when no
    # decisions have landed yet so the tile can render "—".
    decision_days: list[float] = []
    for r in rows:
        if r.status not in (STATUS_REVIEWED, STATUS_FORWARDED):
            continue
        if r.created_at is None or r.reviewed_at is None:
            continue
        diff = (r.reviewed_at - r.created_at).total_seconds() / 86_400.0
        if diff >= 0:
            decision_days.append(diff)
    median_days_to_decision = round(median(decision_days), 1) if decision_days else None

    decided = reviewed + forwarded
    decided_pct = _pct(decided, total)

    return {
        "kpis": {
            "total": total,
            "unique_bodies": unique_bodies,
            "repeat_bodies": repeat_bodies,
            "awaiting": awaiting,
            "reviewed": reviewed,
            "forwarded": forwarded,
            "decided": decided,
            "decided_pct": decided_pct,
            "median_days_to_decision": median_days_to_decision,
            "members_represented": members_represented,
            "bodies_with_size": bodies_with_size,
            "districts_covered": districts_covered,
            "received_30d": recent30,
            "growth_pct": growth_pct,
            # v2: attention-required KPIs surfaced on the dashboard row.
            "critical_high": critical_high,
            "engage_now": engage_now,
        },
        "by_status": by_status,
        "by_category": by_category,
        "by_urgency": by_urgency,
        "by_district": by_district,
        "by_ministry": by_ministry,
        "by_recommendation": by_recommendation,
        "top_associations": top_associations,
        "trend": trend,
    }
