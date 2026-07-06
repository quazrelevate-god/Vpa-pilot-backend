// Department workspace API client. All endpoints assume the dept_session
// cookie is set (session established via /department/login → /department/api/login).

export interface Session {
  department: string;
  label: string;
}

export interface DeptTicket {
  id: number;
  ticket_number: string;
  status: string;                 // open/in_progress/resolved/forwarded_to_dept/closed/reopened
  department: string | null;      // sub-department key
  department_label: string | null;
  progress_pct: number;
  citizen_name: string;
  citizen_mobile: string;
  token: string | null;
  citizen_ask: string | null;
  priority: string | null;        // low/medium/high/critical
  created_at: string;
  accepted_at: string | null;
  resolved_at: string | null;
  category?: string | null;
  category_label?: string | null;
}

export interface DeptEvent {
  type: string;
  actor: string;
  note: string | null;
  payload: Record<string, unknown> | null;
  at: string;
}

export interface DeptAttachment {
  url: string;
  mime: string;
  name: string | null;
  kind: string;   // "petition" | "resolution"
  by: string | null;
  at: string;
}

export interface DeptTicketDetail extends DeptTicket {
  description: string | null;
  summary: string | null;
  summary_ta: string | null;
  citizen_ask_ta?: string | null;
  key_details: string[];
  key_details_ta?: string[];
  resolution_notes: string | null;
  ministry?: string | null;
  ministry_label?: string | null;
  events: DeptEvent[];
  attachments: DeptAttachment[];
}

export interface DeptOption {
  key: string;
  label: string;
}

const base = (path: string) => `/department/api${path}`;

function ok<T>(r: Response, fallback: T | null = null): Promise<T> {
  if (!r.ok) {
    return r.json().then((d) => Promise.reject(new Error(d.error ?? d.detail ?? r.statusText)));
  }
  return r.json() as Promise<T>;
}

// ── Session ──────────────────────────────────────────────────────────────────
export async function fetchSession(signal?: AbortSignal): Promise<Session | null> {
  const r = await fetch(base("/session"), { credentials: "include", cache: "no-store", signal });
  if (r.status === 401) return null;
  return ok<Session>(r);
}

export async function logout(): Promise<void> {
  await fetch(base("/logout"), { method: "POST", credentials: "include" });
}

// ── Tickets ──────────────────────────────────────────────────────────────────
export async function listTickets(status: string, signal?: AbortSignal): Promise<DeptTicket[]> {
  const q = status ? `?status=${encodeURIComponent(status)}` : "";
  const r = await fetch(base(`/tickets${q}`), { credentials: "include", cache: "no-store", signal });
  return ok<DeptTicket[]>(r);
}

export async function fetchCounts(signal?: AbortSignal): Promise<Record<string, number>> {
  const r = await fetch(base("/counts"), { credentials: "include", cache: "no-store", signal });
  return ok<Record<string, number>>(r);
}

export async function fetchTicket(id: number): Promise<DeptTicketDetail> {
  const r = await fetch(base(`/tickets/${id}`), { credentials: "include", cache: "no-store" });
  return ok<DeptTicketDetail>(r);
}

export async function fetchDepartments(): Promise<DeptOption[]> {
  const r = await fetch(base("/departments"), { credentials: "include", cache: "no-store" });
  return ok<DeptOption[]>(r);
}

// ── Actions ──────────────────────────────────────────────────────────────────
export async function acceptTicket(id: number): Promise<void> {
  const r = await fetch(base(`/tickets/${id}/accept`), { method: "POST", credentials: "include" });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? r.statusText);
}

export async function forwardTicket(id: number, toDept: string, reason: string): Promise<void> {
  const fd = new FormData();
  fd.set("to_department", toDept);
  fd.set("reason", reason);
  const r = await fetch(base(`/tickets/${id}/forward`), {
    method: "POST", credentials: "include", body: fd,
  });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? r.statusText);
}

export async function progressTicket(id: number, note: string, pct: number): Promise<void> {
  const fd = new FormData();
  fd.set("note", note);
  fd.set("progress_pct", String(pct));
  const r = await fetch(base(`/tickets/${id}/progress`), {
    method: "POST", credentials: "include", body: fd,
  });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? r.statusText);
}

export async function resolveTicket(id: number, remarks: string, files: File[]): Promise<void> {
  const fd = new FormData();
  fd.set("remarks", remarks);
  files.forEach((f) => fd.append("files", f));
  const r = await fetch(base(`/tickets/${id}/resolve`), {
    method: "POST", credentials: "include", body: fd,
  });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? r.statusText);
}

// ── SLA compute — purely client-side, derived from priority + created_at ────
// Targets mirror backend defaults: critical=3d, high=7d, medium=14d, low=28d.
export const SLA_TARGET_DAYS: Record<string, number> = {
  critical: 3, high: 7, medium: 14, low: 28,
};

export function slaFor(created_at: string, priority: string | null): {
  target: number;                     // hours total budget
  remaining_hours: number;            // negative if breached
  breached: boolean;
  pct_used: number;                   // 0..100+
} | null {
  const p = (priority ?? "").toLowerCase();
  const days = SLA_TARGET_DAYS[p];
  if (!days) return null;
  const target = days * 24;
  const elapsed = (Date.now() - new Date(created_at).getTime()) / (1000 * 60 * 60);
  const remaining = target - elapsed;
  return {
    target,
    remaining_hours: remaining,
    breached: remaining < 0,
    pct_used: Math.min(140, Math.max(0, (elapsed / target) * 100)),
  };
}

export function formatRemaining(hours: number): string {
  if (hours <= 0) {
    const overdue = Math.abs(hours);
    if (overdue < 24) return `Overdue by ${Math.ceil(overdue)}h`;
    return `Overdue by ${Math.ceil(overdue / 24)}d`;
  }
  if (hours < 24) return `${Math.ceil(hours)}h left`;
  return `${Math.floor(hours / 24)}d left`;
}
