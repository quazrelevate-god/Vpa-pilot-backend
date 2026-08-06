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

export async function listProposals(status?: string, limit = 100, offset = 0): Promise<ProposalListResponse> {
  const qs = new URLSearchParams();
  if (status) qs.set("status", status);
  qs.set("limit", String(limit));
  qs.set("offset", String(offset));
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
