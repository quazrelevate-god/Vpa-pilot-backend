// Typed fetch wrappers for the super_admin Association Review surface
// (/api/v1/admin/associations/*). Requires a dash_session cookie + role=super_admin.
import { apiError } from "@/app/(dashboard)/settings/_lib/adminApi";

export type AssociationStatus = "AWAITING_REVIEW" | "REVIEWED" | "FORWARDED";

// The stored AssociationExtraction brief (JSONB). Loosely typed — only the
// fields the review UI renders are declared; extras are ignored.
export interface AssociationBrief {
  association_name?: string;
  member_count?: string;
  representative_name?: string;
  representative_designation?: string;
  association_ask?: string;
  association_ask_ta?: string;
  summary?: string;
  summary_ta?: string;
  key_points?: string[];
  key_points_ta?: string[];
  ai_recommendation?: string;
  ai_rationale?: string;
}

export interface AssociationListItem {
  id: number;
  association_name: string | null;
  representative_name: string | null;
  representative_designation: string | null;
  member_count: string | null;
  category: string | null;
  ministry: string | null;
  urgency: string | null;
  document_date: string | null;
  status: AssociationStatus;
  association_ask: string | null;
  association_ask_ta: string | null;
  created_at: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
}

export interface AssociationDoc {
  filename: string | null;
  url: string | null;
  mime: string | null;
}

export interface AssociationDetail extends AssociationListItem {
  district: string | null;
  documents: AssociationDoc[];
  extraction: AssociationBrief | null;
  decision_note: string | null;
  source: string | null;
}

export interface AssociationListResponse {
  items: AssociationListItem[];
  total: number;
  counts: Record<string, number>;
}

export type AssociationDecision = "reviewed" | "forwarded";

// One card per association BODY (the same union files many submissions over time).
export interface AssociationGroup {
  key: string;
  association_name: string;
  count: number;
  awaiting: number;
  reviewed: number;
  forwarded: number;
  members: number;               // peak stated membership (parsed)
  member_count_raw: string | null;
  categories: string[];
  districts: string[];
  latest_created_at: string | null;
  latest_urgency: string | null;
  representative_name: string | null;
  ids: number[];
}
export interface AssociationGroupedResponse {
  groups: AssociationGroup[];
  total_groups: number;
  page: number;
  page_size: number;
  has_more: boolean;
  counts: Record<string, number>;
}

const BASE = "/api/v1/admin/associations";

/** Level 1 — bodies grouped, paginated + searchable. */
export async function listAssociationGroups(
  { status, q, page = 1, pageSize = 24 }: { status?: string; q?: string; page?: number; pageSize?: number },
  signal?: AbortSignal,
): Promise<AssociationGroupedResponse> {
  const qs = new URLSearchParams();
  if (status) qs.set("status", status);
  if (q) qs.set("q", q);
  qs.set("page", String(page));
  qs.set("page_size", String(pageSize));
  const r = await fetch(`${BASE}/grouped?${qs.toString()}`, { credentials: "include", cache: "no-store", signal });
  if (!r.ok) throw await apiError(r);
  return r.json();
}

/** Level 2 — every submission of one body (drill-in). */
export async function listAssociationsByName(name: string, signal?: AbortSignal): Promise<AssociationListResponse> {
  const qs = new URLSearchParams({ name, limit: "200" });
  const r = await fetch(`${BASE}?${qs.toString()}`, { credentials: "include", cache: "no-store", signal });
  if (!r.ok) throw await apiError(r);
  return r.json();
}

export async function listAssociations(status?: string, limit = 100, offset = 0): Promise<AssociationListResponse> {
  const qs = new URLSearchParams();
  if (status) qs.set("status", status);
  qs.set("limit", String(limit));
  qs.set("offset", String(offset));
  const r = await fetch(`${BASE}?${qs.toString()}`, { credentials: "include", cache: "no-store" });
  if (!r.ok) throw await apiError(r);
  return r.json();
}

export async function getAssociation(id: number): Promise<AssociationDetail> {
  const r = await fetch(`${BASE}/${id}`, { credentials: "include", cache: "no-store" });
  if (!r.ok) throw await apiError(r);
  return r.json();
}

export async function decideAssociation(
  id: number, decision: AssociationDecision, note?: string,
): Promise<AssociationDetail> {
  const r = await fetch(`${BASE}/${id}/decision`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ decision, note: note || null }),
  });
  if (!r.ok) throw await apiError(r);
  return r.json();
}
