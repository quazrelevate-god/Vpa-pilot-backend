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
  approval_rate: number;
  with_cost: number;
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
  created_at: string | null;
}
export interface ProposalListResponse {
  items: ProposalRow[];
  total: number;
  counts: Record<string, number>;
}

async function getJSON<T>(url: string, signal?: AbortSignal): Promise<T> {
  const r = await fetch(url, { credentials: "include", cache: "no-store", signal });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || `Request failed (${r.status})`);
  return r.json();
}

export const getProposalAnalytics = (trendDays = 90, signal?: AbortSignal) =>
  getJSON<ProposalAnalytics>(`/api/v1/admin/proposals/analytics?trend_days=${trendDays}`, signal);

export function listProposals(
  { status, q, limit = 50 }: { status?: string; q?: string; limit?: number },
  signal?: AbortSignal,
) {
  const p = new URLSearchParams();
  if (status) p.set("status", status);
  if (q) p.set("q", q);
  p.set("limit", String(limit));
  return getJSON<ProposalListResponse>(`/api/v1/admin/proposals?${p.toString()}`, signal);
}
