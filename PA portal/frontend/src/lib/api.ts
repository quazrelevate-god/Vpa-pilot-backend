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

export async function fetchStats(dateFrom?: string, dateTo?: string): Promise<StatsResponse> {
  const params = new URLSearchParams();
  if (dateFrom) params.set("date_from", dateFrom);
  if (dateTo) params.set("date_to", dateTo);
  const resp = await fetch(`/api/stats?${params.toString()}`, {
    credentials: "include",
    cache: "no-store",
  });
  if (!resp.ok) throw new Error(`stats ${resp.status}: ${await resp.text()}`);
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
  kind?: string;
  sort?: string;
  page?: number;
  pageSize?: number;
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
  if (opts.kind) params.set("kind", opts.kind);
  return params;
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
  if (!resp.ok) throw new Error(`appointments ${resp.status}: ${await resp.text()}`);
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
  if (!resp.ok) throw new Error(`appointment counts ${resp.status}: ${await resp.text()}`);
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
  if (f.search) p.set("search", f.search);
  if (f.dateFrom) p.set("date_from", f.dateFrom);
  if (f.dateTo) p.set("date_to", f.dateTo);
  return p;
}

export async function fetchTickets(f: TicketListFilters = {}, signal?: AbortSignal): Promise<TicketsResponse> {
  const p = _ticketParams(f, true);
  p.set("page", String(f.page ?? 1));
  const r = await fetch(`/api/tickets?${p.toString()}`, { credentials: "include", cache: "no-store", signal });
  if (!r.ok) throw new Error(`tickets ${r.status}: ${await r.text()}`);
  return r.json();
}

export async function fetchTicketsCounts(
  f: Omit<TicketListFilters, "status" | "page">,
  signal?: AbortSignal,
): Promise<Record<string, number>> {
  const p = _ticketParams(f, false);
  const r = await fetch(`/api/tickets/counts?${p.toString()}`, { credentials: "include", cache: "no-store", signal });
  if (!r.ok) throw new Error(`ticket counts ${r.status}: ${await r.text()}`);
  return r.json();
}

export async function fetchTicket(id: number): Promise<TicketDetail> {
  const r = await fetch(`/api/tickets/${id}`, { credentials: "include", cache: "no-store" });
  if (!r.ok) throw new Error(`ticket ${r.status}: ${await r.text()}`);
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
  if (!r.ok) throw new Error(`patch ticket ${r.status}: ${await r.text()}`);
  return r.json();
}

export async function ticketAction(
  id: number,
  action: "forward" | "comment" | "resolve" | "close" | "reopen",
  body: Record<string, unknown>,
): Promise<TicketDetail> {
  const r = await fetch(`/api/tickets/${id}/${action}`, {
    method: "POST", headers: J, credentials: "include", body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${action} ${r.status}: ${await r.text()}`);
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
  if (!resp.ok) throw new Error(`status ${resp.status}`);
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
  if (!resp.ok) throw new Error(`details ${resp.status}`);
}

export async function fetchAppointmentActivity(id: number): Promise<AppointmentActivityResponse> {
  const resp = await fetch(`/api/appointments/${id}/activity`, {
    credentials: "include",
    cache: "no-store",
  });
  if (!resp.ok) throw new Error(`activity ${resp.status}`);
  return resp.json();
}
