import type {
  AppointmentsResponse,
  AppointmentStatus,
  AppointmentActivityResponse,
  StatsResponse,
  TicketDetail,
  TicketsResponse,
} from "./types";

// Every call hits the same-origin proxy paths declared in next.config.mjs:
//   /api/*   →  http://<api>/dashboard/api/*
//   /auth/*  →  http://<api>/dashboard/{login|logout}
// Cookies sit on the Next.js origin so credentials: 'include' Just Works.
const J = { "Content-Type": "application/json" } as const;

// Build a thrown error from a non-OK response WITHOUT leaking internals.
// Previously these dumped `await r.text()` — raw backend HTML / 500 stacks /
// SQLAlchemy text — straight into toast messages. Now: read a clean JSON
// `{detail}`/`{error}` when present (intentional 4xx business messages), drop
// the body entirely on 5xx, and always attach `.status` so lib/errors
// (toUserMessage) can classify it. See lib/errors.ts.
async function apiError(r: Response, label: string): Promise<Error & { status?: number }> {
  let msg = "";
  if (r.status < 500) {
    try {
      const d = await r.clone().json();
      const detail = (d as { detail?: unknown }).detail;
      const error = (d as { error?: unknown }).error;
      if (typeof detail === "string") msg = detail;
      else if (typeof error === "string") msg = error;
    } catch { /* non-JSON body — never surface it */ }
  }
  const err = new Error(msg || `${label} failed (${r.status})`) as Error & { status?: number };
  err.status = r.status;
  return err;
}

export async function fetchStats(dateFrom?: string, dateTo?: string): Promise<StatsResponse> {
  const params = new URLSearchParams();
  if (dateFrom) params.set("date_from", dateFrom);
  if (dateTo) params.set("date_to", dateTo);
  const resp = await fetch(`/api/stats?${params.toString()}`, {
    credentials: "include",
    cache: "no-store",
  });
  if (!resp.ok) throw await apiError(resp, "Stats");
  return resp.json();
}

export interface AppointmentListOpts {
  status?: string;
  search?: string;
  dateFrom?: string;
  dateTo?: string;
  apptDateFrom?: string;
  apptDateTo?: string;
  priority?: string;
  ministry?: string;
  category?: string;
  /** VenueRegistry.key — narrows to appointments scanned at that venue.
   *  Matches historical rows even if the venue was later deactivated. */
  venue?: string;
  kind?: string;
  sort?: string;
  page?: number;
  pageSize?: number;
}

export interface VenueOption {
  key: string;
  display_en: string;
  display_ta: string | null;
  is_active: boolean;
}

function _appointmentParams(opts: AppointmentListOpts, includeStatus: boolean): URLSearchParams {
  const params = new URLSearchParams();
  if (includeStatus) params.set("status", opts.status ?? "All");
  if (opts.search) params.set("search", opts.search);
  if (opts.dateFrom) params.set("date_from", opts.dateFrom);
  if (opts.dateTo) params.set("date_to", opts.dateTo);
  if (opts.apptDateFrom) params.set("appt_date_from", opts.apptDateFrom);
  if (opts.apptDateTo) params.set("appt_date_to", opts.apptDateTo);
  if (opts.priority) params.set("priority", opts.priority);
  if (opts.ministry) params.set("ministry", opts.ministry);
  if (opts.category) params.set("category", opts.category);
  if (opts.venue)    params.set("venue",    opts.venue);
  if (opts.kind) params.set("kind", opts.kind);
  return params;
}

export async function fetchVenues(signal?: AbortSignal): Promise<VenueOption[]> {
  const resp = await fetch("/api/venues", { credentials: "include", cache: "no-store", signal });
  if (!resp.ok) throw await apiError(resp, "Venues");
  return resp.json();
}

export async function fetchAppointments(
  opts: AppointmentListOpts,
  signal?: AbortSignal,
): Promise<AppointmentsResponse> {
  const params = _appointmentParams(opts, true);
  params.set("page", String(opts.page ?? 1));
  if (opts.sort) params.set("sort", opts.sort);
  if (opts.pageSize) params.set("page_size", String(opts.pageSize));
  const resp = await fetch(`/api/appointments?${params.toString()}`, {
    credentials: "include",
    cache: "no-store",
    signal,
  });
  if (!resp.ok) throw await apiError(resp, "Appointments");
  return resp.json();
}

export async function fetchAppointmentCounts(
  opts: Omit<AppointmentListOpts, "status" | "page" | "pageSize" | "sort">,
  signal?: AbortSignal,
): Promise<Record<string, number>> {
  const params = _appointmentParams(opts, false);
  const resp = await fetch(`/api/appointments/counts?${params.toString()}`, {
    credentials: "include",
    cache: "no-store",
    signal,
  });
  if (!resp.ok) throw await apiError(resp, "Appointment counts");
  return resp.json();
}

// ── Ticketing API client ────────────────────────────────────────────────────

export interface TicketListFilters {
  status?: string;
  priority?: string;   // AI-review priority (low|medium|high|critical)
  ministry?: string;
  category?: string;
  assignedTo?: string;
  forwardedToDept?: string;
  /** Assigned school-department key (Ticket.department) — filters
   *  Assigned / In Progress / Closed / Resolved tabs. */
  department?: string;
  /** Intake channel key (qr_citizen | ai_scan | postal | manual_staff | cm_office). */
  source?: string;
  search?: string;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
}

function _ticketParams(f: TicketListFilters, includeStatus: boolean): URLSearchParams {
  const p = new URLSearchParams();
  if (includeStatus && f.status) p.set("status", f.status);
  if (f.priority) p.set("priority", f.priority);
  if (f.ministry) p.set("ministry", f.ministry);
  if (f.category) p.set("category", f.category);
  if (f.assignedTo) p.set("assigned_to", f.assignedTo);
  if (f.forwardedToDept) p.set("forwarded_to_dept", f.forwardedToDept);
  if (f.department) p.set("department", f.department);
  if (f.source) p.set("source", f.source);
  if (f.search) p.set("search", f.search);
  if (f.dateFrom) p.set("date_from", f.dateFrom);
  if (f.dateTo) p.set("date_to", f.dateTo);
  return p;
}

export async function fetchTickets(f: TicketListFilters = {}, signal?: AbortSignal): Promise<TicketsResponse> {
  const p = _ticketParams(f, true);
  p.set("page", String(f.page ?? 1));
  const r = await fetch(`/api/tickets?${p.toString()}`, { credentials: "include", cache: "no-store", signal });
  if (!r.ok) throw await apiError(r, "Tickets");
  return r.json();
}

export async function fetchTicketsCounts(
  f: Omit<TicketListFilters, "status" | "page">,
  signal?: AbortSignal,
): Promise<Record<string, number>> {
  const p = _ticketParams(f, false);
  const r = await fetch(`/api/tickets/counts?${p.toString()}`, { credentials: "include", cache: "no-store", signal });
  if (!r.ok) throw await apiError(r, "Ticket counts");
  return r.json();
}

// Server-side SLA-breach count for the tickets header badge. Filter-aware:
// the badge reflects whatever filter + status the user is currently viewing
// (WYSIWYG). Chip greys out at 0. Prior behaviour was a stable office-wide
// number but reviewers found the disconnect between the filtered table and
// the header count misleading (red "24" over a filtered view showing 0).
export async function fetchTicketBreachCount(
  f: {
    search?: string; dateFrom?: string; dateTo?: string;
    department?: string; priority?: string; ministry?: string; category?: string;
    assignedTo?: string; forwardedToDept?: string; source?: string;
    status?: string;
  },
  signal?: AbortSignal,
): Promise<number> {
  const p = new URLSearchParams();
  if (f.search)           p.set("search",             f.search);
  if (f.dateFrom)         p.set("date_from",          f.dateFrom);
  if (f.dateTo)           p.set("date_to",            f.dateTo);
  if (f.department)       p.set("department",         f.department);
  if (f.priority)         p.set("priority",           f.priority);
  if (f.ministry)         p.set("ministry",           f.ministry);
  if (f.category)         p.set("category",           f.category);
  if (f.assignedTo)       p.set("assigned_to",        f.assignedTo);
  if (f.forwardedToDept)  p.set("forwarded_to_dept",  f.forwardedToDept);
  if (f.source)           p.set("source",             f.source);
  if (f.status)           p.set("status",             f.status);
  const r = await fetch(`/api/tickets/breach_count?${p.toString()}`, { credentials: "include", cache: "no-store", signal });
  if (!r.ok) throw await apiError(r, "SLA count");
  const data = await r.json();
  return Number(data?.breached ?? 0);
}

export async function fetchTicket(id: number): Promise<TicketDetail> {
  const r = await fetch(`/api/tickets/${id}`, { credentials: "include", cache: "no-store" });
  if (!r.ok) throw await apiError(r, "Ticket");
  return r.json();
}

export async function fetchTicketsOpenCount(): Promise<number> {
  const r = await fetch(`/api/tickets/open_count`, { credentials: "include", cache: "no-store" });
  if (!r.ok) return 0;
  const data = await r.json();
  return data.open ?? 0;
}

export async function patchTicket(
  id: number,
  patch: {
    status?: string;
    priority?: string;
    assigned_to_pa?: string;
    due_date?: string | null;
    district?: string | null;   // District enum key ("madurai") or "" to clear back to unknown
  },
): Promise<TicketDetail> {
  const r = await fetch(`/api/tickets/${id}`, {
    method: "PATCH", headers: J, credentials: "include", body: JSON.stringify(patch),
  });
  if (!r.ok) throw await apiError(r, "Update");
  return r.json();
}

export async function ticketAction(
  id: number,
  action: "forward" | "comment" | "resolve" | "close" | "reopen" | "revert",
  body: Record<string, unknown>,
): Promise<TicketDetail> {
  const r = await fetch(`/api/tickets/${id}/${action}`, {
    method: "POST", headers: J, credentials: "include", body: JSON.stringify(body),
  });
  // apiError surfaces the {"error"/"detail": "..."} 4xx business message and
  // genericizes 5xx (no raw body), with `.status` attached.
  if (!r.ok) throw await apiError(r, action);
  return r.json();
}

export interface UploadedAttachment {
  url: string;
  type: string;
  mime: string;
  name: string;
}

/** Attach a PA-uploaded file (≤5 MB, image/PDF) to a ticket's case. */
export async function uploadTicketAttachment(id: number, file: File): Promise<UploadedAttachment> {
  const fd = new FormData();
  fd.append("file", file);
  const r = await fetch(`/api/tickets/${id}/attachment`, {
    method: "POST", credentials: "include", body: fd,
  });
  if (!r.ok) throw await apiError(r, "Upload");
  return r.json();
}

/** Attach a PA-uploaded file (≤5 MB, image/PDF) to a petition/appointment. */
export async function uploadAppointmentAttachment(id: number, file: File): Promise<UploadedAttachment> {
  const fd = new FormData();
  fd.append("file", file);
  const r = await fetch(`/api/appointments/${id}/attachment`, {
    method: "POST", credentials: "include", body: fd,
  });
  if (!r.ok) throw await apiError(r, "Upload");
  return r.json();
}

export async function updateAppointmentStatus(
  id: number,
  status: AppointmentStatus,
): Promise<void> {
  const resp = await fetch(`/api/appointments/${id}/status`, {
    method: "PATCH",
    headers: J,
    credentials: "include",
    body: JSON.stringify({ status }),
  });
  if (!resp.ok) throw await apiError(resp, "Status update");
}

export async function updateAppointmentDetails(
  id: number,
  patch: { priority?: string | null; category?: string | null; ministry?: string | null },
): Promise<void> {
  const resp = await fetch(`/api/appointments/${id}/details`, {
    method: "PATCH",
    headers: J,
    credentials: "include",
    body: JSON.stringify(patch),
  });
  if (!resp.ok) throw await apiError(resp, "Update");
}

export async function fetchAppointmentActivity(id: number): Promise<AppointmentActivityResponse> {
  const resp = await fetch(`/api/appointments/${id}/activity`, {
    credentials: "include",
    cache: "no-store",
  });
  if (!resp.ok) throw await apiError(resp, "Activity");
  return resp.json();
}
