/** Proposal dashboard data — same-origin admin API (super_admin gated). */

export interface ProposalKpis {
  total: number;
  awaiting: number;
  approved: number;
  rejected: number;
  needs_clarification: number;
  processing: number;
  failed: number;
  decided: number;
  decided_pct: number;
  approval_rate: number;
  avg_decision_days: number | null;
  with_cost: number;
  pipeline_cost_value: number;   // summed stated cost, rupees (best-effort)
  pipeline_cost_count: number;   // proposals that contributed a parseable cost
  received_30d: number;
  growth_pct: number | null;
}
export interface Bar { key: string; label: string; count: number }
export interface ApprovalByCat { key: string; label: string; approved: number; rejected: number; rate: number }
export interface TrendPoint { date: string; received: number }

export interface ProposalAnalytics {
  kpis: ProposalKpis;
  by_status: Bar[];
  by_category: Bar[];
  by_recommendation: Bar[];
  approval_by_category: ApprovalByCat[];
  top_orgs: { name: string; count: number }[];
  trend: TrendPoint[];
}

export interface ProposalRow {
  id: number;
  tracking_ref: string;
  category: string | null;
  org_name: string | null;
  person_name: string | null;
  status: string;
  title: string | null;
  ai_recommendation: string | null;
  estimated_cost: string | null;
  created_at: string | null;
  reviewed_at: string | null;
}
export interface ProposalListResponse {
  items: ProposalRow[];
  total: number;
  counts: Record<string, number>;
}

/** Rupees → compact Indian currency ("₹1.5 Cr", "₹50 L", "₹5K"). */
export function fmtINR(rupees?: number | null): string {
  const v = rupees ?? 0;
  if (v <= 0) return "—";
  if (v >= 1e7) return `₹${(v / 1e7).toFixed(v >= 1e8 ? 0 : 1)} Cr`;
  if (v >= 1e5) return `₹${(v / 1e5).toFixed(v >= 1e6 ? 0 : 1)} L`;
  if (v >= 1e3) return `₹${Math.round(v / 1e3)}K`;
  return `₹${v.toLocaleString("en-IN")}`;
}

async function getJSON<T>(url: string, signal?: AbortSignal): Promise<T> {
  const r = await fetch(url, { credentials: "include", cache: "no-store", signal });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || `Request failed (${r.status})`);
  return r.json();
}

export const getProposalAnalytics = (trendDays = 90, signal?: AbortSignal) =>
  getJSON<ProposalAnalytics>(`/api/v1/admin/proposals/analytics?trend_days=${trendDays}`, signal);

export function listProposals(
  { status, q, limit = 50, offset = 0 }: { status?: string; q?: string; limit?: number; offset?: number },
  signal?: AbortSignal,
) {
  const p = new URLSearchParams();
  if (status) p.set("status", status);
  if (q) p.set("q", q);
  p.set("limit", String(limit));
  p.set("offset", String(offset));
  return getJSON<ProposalListResponse>(`/api/v1/admin/proposals?${p.toString()}`, signal);
}

// ── Client-side analytics ────────────────────────────────────────────────────
// The proposals table is small (institutional, not citizen-scale), so the whole
// dashboard is computed in the browser from one full fetch. That's what makes
// every chart a live cross-filter: click a slice → re-run analyze() on the
// filtered rows → every KPI + chart + the table move together. Mirrors the
// server proposal_analytics.py so the numbers stay identical.
const CAT_LABEL: Record<string, string> = {
  school: "School Education", tamil: "Tamil & Heritage",
  information: "Information & Publicity", film: "Film",
};
const STATUS_LABEL: Record<string, string> = {
  AWAITING_REVIEW: "Awaiting decision", APPROVED: "Approved",
  REJECTED: "Rejected", NEEDS_CLARIFICATION: "Needs clarification",
};
const REC_LABEL: Record<string, string> = {
  review_closely: "Review closely", standard: "Standard", needs_more_info: "Needs more info",
};
const DECISION_ORDER = ["AWAITING_REVIEW", "APPROVED", "REJECTED", "NEEDS_CLARIFICATION"];
const DECIDED = new Set(["APPROVED", "REJECTED", "NEEDS_CLARIFICATION"]);

const COST_UNIT: Record<string, number> = {
  crores: 1e7, crore: 1e7, cr: 1e7, lakhs: 1e5, lakh: 1e5, lacs: 1e5, lac: 1e5,
  billion: 1e9, bn: 1e9, million: 1e6, mn: 1e6, thousand: 1e3, k: 1e3,
};
const NO_COST = new Set(["", "not specified", "n/a", "na", "nil", "-", "none", "not mentioned"]);

/** Best-effort rupee value from free-text cost — mirrors backend parse_cost. */
export function parseCost(text?: string | null): number {
  if (!text) return 0;
  const s = text.trim().toLowerCase();
  if (NO_COST.has(s)) return 0;
  const m = s.match(/(\d[\d,]*(?:\.\d+)?)\s*(crores|crore|cr|lakhs|lakh|lacs|lac|billion|bn|million|mn|thousand|k)?\b/);
  if (!m) return 0;
  const num = parseFloat(m[1].replace(/,/g, ""));
  if (!isFinite(num)) return 0;
  return Math.round(num * (COST_UNIT[m[2] || ""] ?? 1));
}
const hasCost = (c?: string | null) => {
  const s = (c || "").trim().toLowerCase();
  return !!s && !NO_COST.has(s);
};
const pct = (n: number, d: number) => (d ? Math.round((1000 * n) / d) / 10 : 0);
const titleCase = (s: string) => s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

export function analyze(rows: ProposalRow[]): ProposalAnalytics {
  const total = rows.length;
  const sc: Record<string, number> = {};
  for (const r of rows) sc[r.status] = (sc[r.status] || 0) + 1;
  const approved = sc.APPROVED || 0, rejected = sc.REJECTED || 0;
  const needs = sc.NEEDS_CLARIFICATION || 0, awaiting = sc.AWAITING_REVIEW || 0;
  const processing = (sc.QUEUED || 0) + (sc.PROCESSING || 0), failed = sc.FAILED || 0;
  const decided = approved + rejected + needs;

  const by_status: Bar[] = DECISION_ORDER.filter((s) => (sc[s] || 0) > 0)
    .map((s) => ({ key: s, label: STATUS_LABEL[s] || s, count: sc[s] }));

  const cc: Record<string, number> = {};
  for (const r of rows) { const k = r.category || "other"; cc[k] = (cc[k] || 0) + 1; }
  const by_category: Bar[] = Object.entries(cc).sort((a, b) => b[1] - a[1])
    .map(([k, v]) => ({ key: k, label: CAT_LABEL[k] || titleCase(k), count: v }));

  const rc: Record<string, number> = {};
  for (const r of rows) { const k = r.ai_recommendation || "standard"; rc[k] = (rc[k] || 0) + 1; }
  const by_recommendation: Bar[] = Object.entries(rc).sort((a, b) => b[1] - a[1])
    .map(([k, v]) => ({ key: k, label: REC_LABEL[k] || titleCase(k), count: v }));

  const ap: Record<string, number> = {}, rj: Record<string, number> = {};
  for (const r of rows) {
    const k = r.category || "other";
    if (r.status === "APPROVED") ap[k] = (ap[k] || 0) + 1;
    else if (r.status === "REJECTED") rj[k] = (rj[k] || 0) + 1;
  }
  const approval_by_category: ApprovalByCat[] = Object.keys(cc)
    .map((k) => ({ key: k, label: CAT_LABEL[k] || titleCase(k), approved: ap[k] || 0, rejected: rj[k] || 0, rate: pct(ap[k] || 0, (ap[k] || 0) + (rj[k] || 0)) }))
    .filter((x) => x.approved + x.rejected > 0)
    .sort((a, b) => (b.approved + b.rejected) - (a.approved + a.rejected));

  const oc: Record<string, number> = {};
  for (const r of rows) { const n = (r.org_name || "").trim(); if (n) oc[n] = (oc[n] || 0) + 1; }
  const top_orgs = Object.entries(oc).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([name, count]) => ({ name, count }));

  const dayCount: Record<string, number> = {};
  for (const r of rows) { if (r.created_at) { const d = r.created_at.slice(0, 10); dayCount[d] = (dayCount[d] || 0) + 1; } }
  const trend: TrendPoint[] = [];
  const today = new Date(); today.setUTCHours(0, 0, 0, 0);
  for (let i = 89; i >= 0; i--) {
    const d = new Date(today); d.setUTCDate(d.getUTCDate() - i);
    const iso = d.toISOString().slice(0, 10);
    trend.push({ date: iso, received: dayCount[iso] || 0 });
  }
  const daysAgo = (iso: string | null) => (iso ? (Date.now() - new Date(iso).getTime()) / 86400000 : Infinity);
  const recent30 = rows.filter((r) => daysAgo(r.created_at) <= 30).length;
  const prior30 = rows.filter((r) => { const d = daysAgo(r.created_at); return d > 30 && d <= 60; }).length;
  const growth_pct = prior30 ? pct(recent30 - prior30, prior30) : null;

  const spans: number[] = [];
  for (const r of rows) {
    if (DECIDED.has(r.status) && r.reviewed_at && r.created_at) {
      const d = (new Date(r.reviewed_at).getTime() - new Date(r.created_at).getTime()) / 86400000;
      if (d >= 0) spans.push(d);
    }
  }
  const avg_decision_days = spans.length ? Math.round((10 * spans.reduce((a, b) => a + b, 0)) / spans.length) / 10 : null;

  let pipeline_cost_value = 0, pipeline_cost_count = 0;
  for (const r of rows) { const v = parseCost(r.estimated_cost); if (v > 0) { pipeline_cost_value += v; pipeline_cost_count++; } }
  const with_cost = rows.filter((r) => hasCost(r.estimated_cost)).length;

  return {
    kpis: {
      total, awaiting, approved, rejected, needs_clarification: needs, processing, failed,
      decided, decided_pct: pct(decided, total), approval_rate: pct(approved, approved + rejected),
      avg_decision_days, with_cost, pipeline_cost_value, pipeline_cost_count,
      received_30d: recent30, growth_pct,
    },
    by_status, by_category, by_recommendation, approval_by_category, top_orgs, trend,
  };
}
