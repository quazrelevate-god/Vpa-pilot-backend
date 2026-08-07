// Client-side association analytics — mirrors the server association_analytics
// so the Minister dashboard can cross-filter: click any chart → re-run this on
// the filtered rows → every KPI + chart + the table move together. One full
// fetch backs the whole screen (institutional scale, not citizen-scale).

import type { AssociationRow } from "./api";

export interface Bar { key: string; label: string; count: number }
export interface AssocView {
  kpis: {
    total: number; unique_bodies: number; repeat_bodies: number;
    members_represented: number; bodies_with_size: number;
    districts_covered: number; critical_high: number; engage_now: number;
    awaiting: number; reviewed: number; forwarded: number;
    decided: number; decided_pct: number;
    median_days_to_decision: number | null; received_30d: number; growth_pct: number | null;
  };
  by_status: Bar[]; by_category: Bar[]; by_urgency: Bar[];
  by_recommendation: Bar[]; by_ministry: Bar[]; by_district: Bar[];
  top_associations: { name: string; members: number; category: string | null }[];
  trend: { date: string; received: number }[];
}

const titleCase = (s: string) => s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
const pct = (n: number, d: number) => (d ? Math.round((1000 * n) / d) / 10 : 0);

/** First integer in a free-text member count ("1,200", "≈500 members"). */
export function parseMembers(text?: string | null): number {
  if (!text) return 0;
  const m = text.replace(/,/g, "").match(/\d+/);
  return m ? parseInt(m[0], 10) : 0;
}

const STATUS_ORDER = ["AWAITING_REVIEW", "REVIEWED", "FORWARDED"];
const STATUS_LABEL: Record<string, string> = {
  AWAITING_REVIEW: "Awaiting review", REVIEWED: "Reviewed", FORWARDED: "Forwarded",
};
const URGENCY_ORDER = ["critical", "high", "medium", "low"];
const DECIDED = new Set(["REVIEWED", "FORWARDED"]);

function group(rows: AssociationRow[], pick: (r: AssociationRow) => string | null | undefined, order?: string[], labelOf?: (k: string) => string): Bar[] {
  const c: Record<string, number> = {};
  for (const r of rows) { const k = (pick(r) || "").toString().trim(); if (k) c[k] = (c[k] || 0) + 1; }
  const entries = order
    ? order.filter((k) => c[k] > 0).map((k) => [k, c[k]] as [string, number])
    : Object.entries(c).sort((a, b) => b[1] - a[1]);
  return entries.map(([k, v]) => ({ key: k, label: labelOf ? labelOf(k) : titleCase(k), count: v }));
}

export function analyzeAssociations(rows: AssociationRow[]): AssocView {
  const total = rows.length;

  const sc: Record<string, number> = {};
  for (const r of rows) sc[r.status] = (sc[r.status] || 0) + 1;
  const awaiting = sc.AWAITING_REVIEW || 0, reviewed = sc.REVIEWED || 0, forwarded = sc.FORWARDED || 0;
  const decided = reviewed + forwarded;

  const nameCount: Record<string, number> = {};
  for (const r of rows) { const n = (r.association_name || "").trim().toLowerCase(); if (n) nameCount[n] = (nameCount[n] || 0) + 1; }
  const unique_bodies = Object.keys(nameCount).length;
  const repeat_bodies = Object.values(nameCount).filter((n) => n >= 2).length;

  let members_represented = 0, bodies_with_size = 0;
  for (const r of rows) { const m = parseMembers(r.member_count); if (m > 0) { members_represented += m; bodies_with_size++; } }

  const districts = new Set<string>();
  for (const r of rows) { if (r.district) districts.add(r.district); }

  const critical_high = rows.filter((r) => ["critical", "high"].includes((r.urgency || "").toLowerCase())).length;
  const engage_now = rows.filter((r) => (r.ai_recommendation || "").toLowerCase() === "engage_now").length;

  const spans: number[] = [];
  for (const r of rows) {
    if (DECIDED.has(r.status) && (r as { reviewed_at?: string | null }).reviewed_at && r.created_at) {
      const d = (new Date((r as { reviewed_at?: string }).reviewed_at as string).getTime() - new Date(r.created_at).getTime()) / 86400000;
      if (d >= 0) spans.push(d);
    }
  }
  spans.sort((a, b) => a - b);
  const median_days_to_decision = spans.length
    ? Math.round(spans.length % 2 ? spans[(spans.length - 1) / 2] : (spans[spans.length / 2 - 1] + spans[spans.length / 2]) / 2)
    : null;

  const daysAgo = (iso: string | null | undefined) => (iso ? (Date.now() - new Date(iso).getTime()) / 86400000 : Infinity);
  const received_30d = rows.filter((r) => daysAgo(r.created_at) <= 30).length;
  const prior30 = rows.filter((r) => { const d = daysAgo(r.created_at); return d > 30 && d <= 60; }).length;
  const growth_pct = prior30 ? pct(received_30d - prior30, prior30) : null;

  const dayCount: Record<string, number> = {};
  for (const r of rows) { if (r.created_at) { const d = r.created_at.slice(0, 10); dayCount[d] = (dayCount[d] || 0) + 1; } }
  const trend: { date: string; received: number }[] = [];
  const today = new Date(); today.setUTCHours(0, 0, 0, 0);
  for (let i = 89; i >= 0; i--) {
    const d = new Date(today); d.setUTCDate(d.getUTCDate() - i);
    const iso = d.toISOString().slice(0, 10);
    trend.push({ date: iso, received: dayCount[iso] || 0 });
  }

  const topByMembers = rows
    .map((r) => ({ name: r.association_name || "Unnamed body", members: parseMembers(r.member_count), category: r.category ?? null }))
    .filter((x) => x.members > 0)
    .sort((a, b) => b.members - a.members)
    .slice(0, 8);

  return {
    kpis: {
      total, unique_bodies, repeat_bodies, members_represented, bodies_with_size,
      districts_covered: districts.size, critical_high, engage_now,
      awaiting, reviewed, forwarded, decided, decided_pct: pct(decided, total),
      median_days_to_decision, received_30d, growth_pct,
    },
    by_status: group(rows, (r) => r.status, STATUS_ORDER, (k) => STATUS_LABEL[k] || titleCase(k)),
    by_category: group(rows, (r) => r.category),
    by_urgency: group(rows, (r) => (r.urgency || "").toLowerCase(), URGENCY_ORDER),
    by_recommendation: group(rows, (r) => r.ai_recommendation),
    by_ministry: group(rows, (r) => r.ministry),
    by_district: group(rows, (r) => r.district),
    top_associations: topByMembers,
    trend,
  };
}
