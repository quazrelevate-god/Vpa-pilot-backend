// Typed fetch wrappers for the crowd app. Everything is same-origin (Next.js
// rewrites /crowd/api/* and /api/v1/scheduling/* to FastAPI) and carries the
// display_session cookie via credentials:"include".

import type { ApptFeed, RefFeed, SlotsResp, OpenDate, IntakeResult } from "./types";

async function readJSON<T>(r: Response): Promise<T> {
  const d = await r.json().catch(() => ({} as Record<string, unknown>));
  if (!r.ok) {
    const msg = (d as { detail?: string; error?: string }).detail
      || (d as { error?: string }).error
      || `http ${r.status}`;
    const err = new Error(msg) as Error & { status?: number };
    err.status = r.status;
    throw err;
  }
  return d as T;
}

function getJSON<T>(url: string): Promise<T> {
  return fetch(url, {
    headers: { Accept: "application/json" },
    credentials: "include",
    cache: "no-store",
  }).then((r) => readJSON<T>(r));
}

function patch<T>(url: string, body: unknown): Promise<T> {
  return fetch(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body),
  }).then((r) => readJSON<T>(r));
}

export const api = {
  // ── auth ──
  session: () => getJSON<{ user: string; label: string }>("/crowd/api/session"),
  logout: () =>
    fetch("/crowd/api/logout", { method: "POST", credentials: "include" }).then(() => undefined),

  // ── feeds ──
  today: (search = "") =>
    getJSON<ApptFeed>("/crowd/api/today" + (search ? `?search=${encodeURIComponent(search)}` : "")),
  refs: (search = "") =>
    getJSON<RefFeed>("/crowd/api/referral/today" + (search ? `?search=${encodeURIComponent(search)}` : "")),

  // ── attendance ──
  markAppt: (id: number, status: string) =>
    patch<Record<string, unknown>>(`/crowd/api/appointments/${id}/status`, { status }),
  markRef: (id: number, status: string) =>
    patch<Record<string, unknown>>(`/crowd/api/referral/${id}/status`, { status }),

  // ── scheduling ──
  openDates: () => getJSON<OpenDate[]>("/api/v1/scheduling/open-dates"),
  slots: (date: string) =>
    getJSON<SlotsResp>(`/api/v1/scheduling/slots/available?target_date=${date}`),

  // ── intake ──
  intake: (fd: FormData): Promise<IntakeResult> =>
    fetch("/crowd/api/intake", { method: "POST", credentials: "include", body: fd })
      .then((r) => readJSON<IntakeResult>(r)),
};

// Small date helpers shared across screens.
export function pad2(n: number): string {
  return String(n).padStart(2, "0");
}
export function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
export function todayLabel(): string {
  return new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}
export function nowTime(): string {
  return new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true });
}
export function fmtLongDate(iso: string): string {
  try {
    return new Date(iso + "T00:00:00").toLocaleDateString("en-GB", {
      weekday: "short", day: "2-digit", month: "short", year: "numeric",
    });
  } catch { return iso; }
}
