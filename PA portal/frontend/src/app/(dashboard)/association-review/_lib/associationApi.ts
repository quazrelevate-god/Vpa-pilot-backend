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

const BASE = "/api/v1/admin/associations";

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
