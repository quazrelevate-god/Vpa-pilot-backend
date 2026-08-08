// Typed fetch wrappers for the super_admin Association Review surface
// (/api/v1/admin/associations/*). Requires a dash_session cookie + role=super_admin.
import { apiError } from "@/app/(dashboard)/settings/_lib/adminApi";

export type AssociationStatus = "AWAITING_REVIEW" | "REVIEWED" | "FORWARDED";

// The stored AssociationExtraction brief (JSONB). Full shape — matches
// backend/src/models/association_extraction.py::AssociationExtraction. Every
// field is optional because Gemini honours the "empty if silent" rule, so any
// tile / section can be missing on a given brief.
export interface AssociationBrief {
  // Identity
  association_name?: string;
  member_count?: string;
  representative_name?: string;
  representative_designation?: string;

  // Grievance base (inherited from GrievanceSummary)
  category?: string;
  ministry?: string;
  urgency?: string;
  district?: string;
  document_date?: string;
  summary?: string;
  summary_ta?: string;
  key_details?: string[];
  key_details_ta?: string[];

  // Collective ask
  association_ask?: string;
  association_ask_ta?: string;

  // Decision context — why-now, outcome, stakeholders, risks, precedent
  demand_context?: string;
  demand_context_ta?: string;
  expected_outcome?: string;
  expected_outcome_ta?: string;
  key_stakeholders?: string[];
  key_stakeholders_ta?: string[];
  risks_if_ignored?: string[];
  risks_if_ignored_ta?: string[];
  precedent_context?: string;
  precedent_context_ta?: string;

  // Triage
  ai_recommendation?: string;
  ai_rationale?: string;
  ai_rationale_ta?: string;
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
  district: string | null;
  /** Layer-1B dedup soft-flag — see proposalApi.ts for the pattern. */
  is_duplicate?: boolean;
  duplicate_of_id?: number | null;
  duplicate_of_name?: string | null;
  document_date: string | null;
  status: AssociationStatus;
  association_ask: string | null;
  association_ask_ta: string | null;
  ai_recommendation: string | null;
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

// Legacy /grouped and /?name= endpoints kept on the backend (cheap to serve,
// might be useful for future body-level analytics) but the frontend wrappers
// were removed with the review-page rebuild — no consumers.

export interface ListAssociationsArgs {
  status?: string;
  q?: string;
  category?: string;
  urgency?: string;
  district?: string;
  ministry?: string;
  recommendation?: string;
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
  offset?: number;
}

/** Flat listing — one row per submission. Backs the main review table.
 *  Backwards-compat: accepts the old `(status, limit, offset)` positional
 *  signature so existing callers keep working, and a richer args-object
 *  form so server-side filters and pagination land in one query.
 */
export async function listAssociations(
  arg?: string | ListAssociationsArgs,
  limit = 50,
  offset = 0,
): Promise<AssociationListResponse> {
  const args: ListAssociationsArgs = typeof arg === "string" || arg === undefined
    ? { status: arg, limit, offset }
    : { limit: 50, offset: 0, ...arg };
  const qs = new URLSearchParams();
  if (args.status)         qs.set("status", args.status);
  if (args.q?.trim())      qs.set("q", args.q.trim());
  if (args.category)       qs.set("category", args.category);
  if (args.urgency)        qs.set("urgency", args.urgency);
  if (args.district)       qs.set("district", args.district);
  if (args.ministry)       qs.set("ministry", args.ministry);
  if (args.recommendation) qs.set("recommendation", args.recommendation);
  if (args.dateFrom)       qs.set("date_from", args.dateFrom);
  if (args.dateTo)         qs.set("date_to", args.dateTo);
  qs.set("limit", String(args.limit ?? 50));
  qs.set("offset", String(args.offset ?? 0));
  const r = await fetch(`${BASE}?${qs.toString()}`, { credentials: "include", cache: "no-store" });
  if (!r.ok) throw await apiError(r);
  return r.json();
}

export async function getAssociation(id: number): Promise<AssociationDetail> {
  const r = await fetch(`${BASE}/${id}`, { credentials: "include", cache: "no-store" });
  if (!r.ok) throw await apiError(r);
  return r.json();
}

/** Layer-2 fuzzy dedup for associations — trigram Jaccard on the ask. */
export interface SimilarAssociationCandidate {
  id: number;
  association_name: string | null;
  representative_name: string | null;
  category: string | null;
  district: string | null;
  status: AssociationStatus;
  created_at: string | null;
  score: number;
}
export interface SimilarAssociationsResponse {
  source: {
    id: number;
    association_name?: string | null;
    representative_name?: string | null;
    category?: string | null;
    district?: string | null;
  } | null;
  candidates: SimilarAssociationCandidate[];
  reason?: string | null;
}

export async function findSimilarAssociations(id: number): Promise<SimilarAssociationsResponse> {
  const r = await fetch(`${BASE}/${id}/similar`, { credentials: "include", cache: "no-store" });
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
