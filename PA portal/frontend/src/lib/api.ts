import type {
  AppointmentsResponse,
  AppointmentStatus,
  StatsResponse,
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
  page?: number;
}): Promise<AppointmentsResponse> {
  const params = new URLSearchParams({
    status: opts.status ?? "All",
    page: String(opts.page ?? 1),
  });
  if (opts.search) params.set("search", opts.search);
  if (opts.dateFrom) params.set("date_from", opts.dateFrom);
  if (opts.dateTo) params.set("date_to", opts.dateTo);
  const resp = await fetch(`/api/appointments?${params.toString()}`, {
    credentials: "include",
    cache: "no-store",
  });
  if (!resp.ok) throw new Error(`appointments ${resp.status}: ${await resp.text()}`);
  return resp.json();
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
