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

export async function fetchAppointments(opts: {
  status?: string;
  search?: string;
  dateFrom?: string;
  dateTo?: string;
  apptDateFrom?: string;
  apptDateTo?: string;
  urgency?: string;
  department?: string;
  category?: string;
  page?: number;
  pageSize?: number;
}): Promise<AppointmentsResponse> {
  const params = new URLSearchParams({
    status: opts.status ?? "All",
    page: String(opts.page ?? 1),
  });
  if (opts.search) params.set("search", opts.search);
  if (opts.dateFrom) params.set("date_from", opts.dateFrom);
  if (opts.dateTo) params.set("date_to", opts.dateTo);
  if (opts.apptDateFrom) params.set("appt_date_from", opts.apptDateFrom);
  if (opts.apptDateTo) params.set("appt_date_to", opts.apptDateTo);
  if (opts.urgency) params.set("urgency", opts.urgency);
  if (opts.department) params.set("department", opts.department);
  if (opts.category) params.set("category", opts.category);
  if (opts.pageSize) params.set("page_size", String(opts.pageSize));
  const resp = await fetch(`/api/appointments?${params.toString()}`, {
    credentials: "include",
    cache: "no-store",
  });
  if (!resp.ok) throw new Error(`appointments ${resp.status}: ${await resp.text()}`);
  return resp.json();
}

// ── Ticketing API client ────────────────────────────────────────────────────

export interface TicketListFilters {
  status?: string;
  priority?: string;
  urgency?: string;
  department?: string;
  category?: string;
  assignedTo?: string;
  forwardedToDept?: string;
  search?: string;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
}

export async function fetchTickets(f: TicketListFilters = {}): Promise<TicketsResponse> {
  const p = new URLSearchParams({ page: String(f.page ?? 1) });
  if (f.status) p.set("status", f.status);
  if (f.priority) p.set("priority", f.priority);
  if (f.urgency) p.set("urgency", f.urgency);
  if (f.department) p.set("department", f.department);
  if (f.category) p.set("category", f.category);
  if (f.assignedTo) p.set("assigned_to", f.assignedTo);
  if (f.forwardedToDept) p.set("forwarded_to_dept", f.forwardedToDept);
  if (f.search) p.set("search", f.search);
  if (f.dateFrom) p.set("date_from", f.dateFrom);
  if (f.dateTo) p.set("date_to", f.dateTo);
  const r = await fetch(`/api/tickets?${p.toString()}`, { credentials: "include", cache: "no-store" });
  if (!r.ok) throw new Error(`tickets ${r.status}: ${await r.text()}`);
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
  patch: { status?: string; priority?: string; assigned_to_pa?: string; due_date?: string | null },
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
  patch: { urgency?: string | null; category?: string | null; department?: string | null },
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
