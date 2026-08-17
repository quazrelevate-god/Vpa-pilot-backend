// Typed fetch wrappers for the super_admin Proposal Review surface
// (/api/v1/admin/proposals/*). Requires a dash_session cookie + role=super_admin.
import { apiError } from "@/app/(dashboard)/settings/_lib/adminApi";

export type ProposalStatus =
  | "QUEUED" | "PROCESSING" | "AWAITING_REVIEW" | "FAILED"
  | "APPROVED" | "REJECTED" | "NEEDS_CLARIFICATION";

export type ProposalRecommendation = "review_closely" | "standard" | "needs_more_info";

export interface ProposalBrief {
  title?: string; title_ta?: string;
  problem_statement?: string; problem_statement_ta?: string;
  proposed_solution?: string; proposed_solution_ta?: string;
  expected_benefit?: string; expected_benefit_ta?: string;
  beneficiary_scope?: string; beneficiary_scope_ta?: string;
  estimated_cost?: string;
  timeline?: string;
  key_highlights?: string[]; key_highlights_ta?: string[];
  ai_recommendation?: ProposalRecommendation;
  ai_rationale?: string;
  // v2 additions — Minister decision context; empty when the document is silent.
  key_risks?: string[]; key_risks_ta?: string[];
  implementation_readiness?: string; implementation_readiness_ta?: string;
  applicant_contribution?: string;
  partnership_model?: string; partnership_model_ta?: string;
  track_record?: string; track_record_ta?: string;
}

export interface ProposalListItem {
  id: number;
  tracking_ref: string;
  category: string | null;
  org_name: string | null;
  person_name: string | null;
  designation: string | null;
  status: ProposalStatus;
  title: string | null;
  ai_recommendation: ProposalRecommendation | null;
  created_at: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  /** Layer-1B dedup soft-flag. `is_duplicate=true` means the fingerprint
   *  matched an earlier row within 90 days — the reviewer sees a pill in the
   *  drawer/list but the row still enters review. */
  is_duplicate?: boolean;
  duplicate_of_id?: number | null;
  duplicate_of_tracking_ref?: string | null;
}

export interface ProposalDoc {
  filename: string | null;
  url: string | null;
  mime: string | null;
}

export interface ProposalDetail extends ProposalListItem {
  email: string | null;
  phone: string | null;
  documents: ProposalDoc[];
  extraction: ProposalBrief | null;
  decision_note: string | null;
  error_message: string | null;
}

export interface ProposalListResponse {
  items: ProposalListItem[];
  total: number;
  counts: Record<string, number>;
}

export type Decision = "approved" | "rejected" | "needs_clarification";

const BASE = "/api/v1/admin/proposals";

export interface ListProposalsArgs {
  status?: string;
  q?: string;
  category?: string;
  recommendation?: string;
  dateFrom?: string;
  dateTo?: string;
  /** AI-upload batch scope — mirrors the ai-review deep-link pattern.
   *  When set, only proposals routed from this batch are returned. */
  batchId?: string;
  limit?: number;
  offset?: number;
}

/** Backwards-compat: keeps the old (status, limit, offset) positional signature
 *  working for existing callers, and adds a richer args-object form so
 *  server-side filters and pagination land in one query. */
export async function listProposals(
  arg?: string | ListProposalsArgs,
  limit = 50,
  offset = 0,
): Promise<ProposalListResponse> {
  const args: ListProposalsArgs = typeof arg === "string" || arg === undefined
    ? { status: arg, limit, offset }
    : { limit: 50, offset: 0, ...arg };
  const qs = new URLSearchParams();
  if (args.status)         qs.set("status", args.status);
  if (args.q?.trim())      qs.set("q", args.q.trim());
  if (args.category)       qs.set("category", args.category);
  if (args.recommendation) qs.set("recommendation", args.recommendation);
  if (args.dateFrom)       qs.set("date_from", args.dateFrom);
  if (args.dateTo)         qs.set("date_to", args.dateTo);
  if (args.batchId)        qs.set("batch_id", args.batchId);
  qs.set("limit", String(args.limit ?? 50));
  qs.set("offset", String(args.offset ?? 0));
  const r = await fetch(`${BASE}?${qs.toString()}`, { credentials: "include", cache: "no-store" });
  if (!r.ok) throw await apiError(r);
  return r.json();
}

export async function getProposal(id: number): Promise<ProposalDetail> {
  const r = await fetch(`${BASE}/${id}`, { credentials: "include", cache: "no-store" });
  if (!r.ok) throw await apiError(r);
  return r.json();
}

export interface ProposalDocumentPage {
  page_no: number;
  thumb_url: string;
}
export interface ProposalDocumentEntry {
  id: string;
  filename: string;
  mime: string | null;
  kind: "pdf" | "image";
  size_bytes: number | null;
  page_count: number;
  pages: ProposalDocumentPage[];
  original_url: string;
}
export interface ProposalDocumentsResponse {
  documents: ProposalDocumentEntry[];
}

export async function fetchProposalDocuments(id: number): Promise<ProposalDocumentsResponse> {
  const r = await fetch(`${BASE}/${id}/documents`, { credentials: "include", cache: "no-store" });
  if (!r.ok) throw await apiError(r);
  return r.json();
}

/** The four desks a proposal can sit with — mirrors the backend's
 *  _VALID_CATEGORIES, so the picker can never offer an invalid value. */
export const PROPOSAL_CATEGORIES: { value: string; label: string }[] = [
  { value: "school",      label: "School Education" },
  { value: "tamil",       label: "Tamil & Heritage" },
  { value: "information", label: "Information & Publicity" },
  { value: "film",        label: "Film" },
];

/** Reassign the desk. The tracking ref is intentionally left untouched — the
 *  citizen already has it. */
export async function updateProposalCategory(id: number, category: string): Promise<ProposalDetail> {
  const r = await fetch(`${BASE}/${id}/category`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ category }),
  });
  if (!r.ok) throw await apiError(r);
  return r.json();
}

/** Layer-2 fuzzy dedup — one card per candidate scored by trigram Jaccard.
 *  Same shape the petition merge panel uses, so the reviewer UI stays
 *  consistent across surfaces. */
export interface SimilarProposalCandidate {
  id: number;
  tracking_ref: string;
  title: string | null;
  org_name: string | null;
  status: ProposalStatus;
  created_at: string | null;
  score: number;
}
export interface SimilarProposalsResponse {
  source: { id: number; tracking_ref: string; title?: string | null; org_name?: string | null; category?: string | null } | null;
  candidates: SimilarProposalCandidate[];
  reason?: string | null;
}

export async function findSimilarProposals(id: number): Promise<SimilarProposalsResponse> {
  const r = await fetch(`${BASE}/${id}/similar`, { credentials: "include", cache: "no-store" });
  if (!r.ok) throw await apiError(r);
  return r.json();
}

export async function decideProposal(id: number, decision: Decision, note?: string): Promise<ProposalDetail> {
  const r = await fetch(`${BASE}/${id}/decision`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ decision, note: note || null }),
  });
  if (!r.ok) throw await apiError(r);
  return r.json();
}

/** Update decision_note WITHOUT flipping status — used to add follow-up
 *  clarifications on a NEEDS_CLARIFICATION row (or amend the note on any
 *  decided row) without the side-effects of the /decision endpoint. */
export async function updateProposalNote(id: number, note: string): Promise<ProposalDetail> {
  const r = await fetch(`${BASE}/${id}/note`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ note }),
  });
  if (!r.ok) throw await apiError(r);
  return r.json();
}
