/** Association dashboard data — same-origin admin API (super_admin gated). */

export interface AssociationKpis {
  total: number;
  awaiting: number;
  reviewed: number;
  forwarded: number;
  members_represented: number;
  bodies_with_size: number;
  districts_covered: number;
  received_30d: number;
  growth_pct: number | null;
}
export interface Bar { key: string; label: string; count: number }
export interface TrendPoint { date: string; received: number }

export interface AssociationAnalytics {
  kpis: AssociationKpis;
  by_status: Bar[];
  by_category: Bar[];
  by_urgency: Bar[];
  by_district: Bar[];
  by_ministry: Bar[];
  top_associations: { name: string; members: number; category: string }[];
  trend: TrendPoint[];
}

export interface AssociationRow {
  id: number;
  association_name: string | null;
  representative_name: string | null;
  representative_designation: string | null;
  member_count: string | null;
  category: string | null;
  ministry: string | null;
  urgency: string | null;
  status: string;
  created_at: string | null;
}
export interface AssociationListResponse {
  items: AssociationRow[];
  total: number;
  counts: Record<string, number>;
}

async function getJSON<T>(url: string, signal?: AbortSignal): Promise<T> {
  const r = await fetch(url, { credentials: "include", cache: "no-store", signal });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || `Request failed (${r.status})`);
  return r.json();
}

export const getAssociationAnalytics = (trendDays = 90, signal?: AbortSignal) =>
  getJSON<AssociationAnalytics>(`/api/v1/admin/associations/analytics?trend_days=${trendDays}`, signal);

export function listAssociations(
  { status, q, limit = 50 }: { status?: string; q?: string; limit?: number },
  signal?: AbortSignal,
) {
  const p = new URLSearchParams();
  if (status) p.set("status", status);
  if (q) p.set("q", q);
  p.set("limit", String(limit));
  return getJSON<AssociationListResponse>(`/api/v1/admin/associations?${p.toString()}`, signal);
}
