// Typed fetchers for the read-only Minister PWA (/minister/api/*). Every call
// carries the minister_session cookie (credentials:"include") and is a GET
// aggregate — there are no write calls anywhere in this app.

import type {
  DashboardAnalytics, OperationsData, TicketAnalytics,
  ProposalAnalytics, AssociationAnalytics, EventsOverview, EventItem,
  MinisterSession,
} from "./types";
import type { ProposalDetail } from "@/app/(dashboard)/proposal-review/_lib/proposalApi";
import type { AssociationDetail } from "@/app/(dashboard)/association-review/_lib/associationApi";
import type { AppointmentRow, TicketDetail } from "@/lib/types";

const BASE = "/minister/api";

/** Cross-filter params for the Home (petition) overview — same dims the staff
 *  overview uses. The server excludes each chart's own dimension natively. */
export interface PetitionFilters {
  category?: string; priority?: string; ministry?: string; district?: string;
  channel?: string; date_from?: string; date_to?: string;
}
function petitionQS(f?: PetitionFilters): string {
  if (!f) return "";
  const p = new URLSearchParams();
  for (const [key, val] of Object.entries(f)) if (val) p.set(key, val);
  const s = p.toString();
  return s ? `?${s}` : "";
}

/** Cross-filter dims the Tickets screen clicks set (filter the ticket list). */
export interface TicketFilters {
  status?: string; priority?: string; category?: string; department?: string; search?: string;
}

/** Thrown on a 401 so the app shell can redirect to /minister/login. */
export class Unauthorized extends Error {
  constructor() { super("Not authenticated"); this.name = "Unauthorized"; }
}

async function getJSON<T>(url: string, signal?: AbortSignal): Promise<T> {
  const r = await fetch(url, { credentials: "include", cache: "no-store", signal });
  if (r.status === 401) throw new Unauthorized();
  if (!r.ok) {
    const d = await r.json().catch(() => ({}));
    throw new Error((d as { error?: string }).error || `Request failed (${r.status})`);
  }
  return r.json() as Promise<T>;
}

export const api = {
  session: (signal?: AbortSignal) =>
    getJSON<MinisterSession>(`${BASE}/session`, signal),

  logout: () =>
    fetch(`${BASE}/logout`, { method: "POST", credentials: "include" }),

  dashboard: (f?: PetitionFilters, signal?: AbortSignal) =>
    getJSON<DashboardAnalytics>(`${BASE}/overview/dashboard${petitionQS(f)}`, signal),

  operations: (f?: PetitionFilters, signal?: AbortSignal) =>
    getJSON<OperationsData>(`${BASE}/overview/operations${petitionQS(f)}`, signal),

  tickets: (signal?: AbortSignal) =>
    getJSON<TicketAnalytics>(`${BASE}/overview/tickets`, signal),

  proposals: (signal?: AbortSignal) =>
    getJSON<ProposalAnalytics>(`${BASE}/overview/proposals`, signal),

  associations: (signal?: AbortSignal) =>
    getJSON<AssociationAnalytics>(`${BASE}/overview/associations`, signal),

  eventsOverview: (signal?: AbortSignal) =>
    getJSON<EventsOverview>(`${BASE}/overview/events`, signal),

  timeline: (start?: string, end?: string, signal?: AbortSignal) => {
    const qs = new URLSearchParams();
    if (start) qs.set("start", start);
    if (end) qs.set("end", end);
    const q = qs.toString();
    return getJSON<{ items: EventItem[] }>(`${BASE}/events/timeline${q ? `?${q}` : ""}`, signal);
  },

  // ── Detail tables ────────────────────────────────────────────────────────
  listPetitions: (page = 1, pageSize = 25, f?: PetitionFilters, signal?: AbortSignal) => {
    const p = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
    if (f) for (const [key, val] of Object.entries(f)) if (val) p.set(key, val);
    return getJSON<{ items: PetitionRow[]; total: number; page: number; page_size: number }>(
      `${BASE}/list/petitions?${p.toString()}`, signal);
  },

  listProposals: (limit = 50, offset = 0, signal?: AbortSignal) =>
    getJSON<{ items: ProposalRow[]; total: number; counts: Record<string, number> }>(
      `${BASE}/list/proposals?limit=${limit}&offset=${offset}`, signal),

  listAssociations: (limit = 50, offset = 0, signal?: AbortSignal) =>
    getJSON<{ items: AssociationRow[]; total: number; counts: Record<string, number> }>(
      `${BASE}/list/associations?limit=${limit}&offset=${offset}`, signal),

  listTickets: (page = 1, pageSize = 25, f?: TicketFilters, signal?: AbortSignal) => {
    const p = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
    if (f) for (const [key, val] of Object.entries(f)) if (val) p.set(key, val);
    return getJSON<{ items: TicketRow[]; total: number; page: number; page_size: number }>(
      `${BASE}/list/tickets?${p.toString()}`, signal);
  },

  // ── Row-click detail (same shapes the desk drawers render; file URLs already
  //    re-pointed at /minister/api/files by the backend). ───────────────────────
  proposalDetail: (id: number, signal?: AbortSignal) =>
    getJSON<ProposalDetail>(`${BASE}/detail/proposals/${id}`, signal),

  associationDetail: (id: number, signal?: AbortSignal) =>
    getJSON<AssociationDetail>(`${BASE}/detail/associations/${id}`, signal),

  appointmentDetail: (id: number, signal?: AbortSignal) =>
    getJSON<AppointmentRow>(`${BASE}/detail/appointments/${id}`, signal),

  ticketDetail: (id: number, signal?: AbortSignal) =>
    getJSON<TicketDetail>(`${BASE}/detail/tickets/${id}`, signal),
};

// ── Row shapes for the detail tables (kept loose — only the columns the
//    Minister tables render are declared; the backend may include more). ────
export interface PetitionRow {
  id?: number;
  appointment_id?: number;
  token?: string;
  citizen_name?: string;
  name?: string;
  mobile?: string;
  category?: string | null;
  category_label?: string | null;
  citizen_ask?: string | null;
  citizen_ask_ta?: string | null;
  priority?: string | null;
  status?: string;
  created_at?: string | null;
  district?: string | null;
  ministry?: string | null;
}

export interface ProposalRow {
  id: number;
  tracking_ref?: string;
  title?: string | null;
  org_name?: string | null;
  person_name?: string | null;
  category?: string | null;
  status: string;
  ai_recommendation?: string | null;
  created_at?: string | null;
}

export interface AssociationRow {
  id: number;
  association_name?: string | null;
  representative_name?: string | null;
  representative_designation?: string | null;
  member_count?: string | null;
  category?: string | null;
  ministry?: string | null;
  urgency?: string | null;
  district?: string | null;
  status: string;
  association_ask?: string | null;
  association_ask_ta?: string | null;
  ai_recommendation?: string | null;
  created_at?: string | null;
  reviewed_at?: string | null;
}

export interface TicketRow {
  id: number;
  ticket_number?: string;
  token?: string;
  citizen_name?: string;
  citizen_mobile?: string;
  citizen_ask?: string | null;
  priority?: string | null;
  status?: string;
  category?: string | null;
  category_label?: string | null;
  ministry?: string | null;
  ministry_label?: string | null;
  department?: string | null;
  assigned_department?: string | null;
  assigned_department_label?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}
