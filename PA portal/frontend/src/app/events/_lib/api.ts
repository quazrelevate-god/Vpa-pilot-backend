// Typed fetch wrappers for the events app. Everything is same-origin (Next.js
// rewrites /events/api/* to FastAPI) and carries the events_session cookie via
// credentials:"include".

import type { EventItem, EventsFeed, NeedsReviewFeed } from "./types";

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

function send<T>(url: string, method: string, body?: unknown): Promise<T> {
  return fetch(url, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    credentials: "include",
    body: body === undefined ? undefined : JSON.stringify(body),
  }).then((r) => readJSON<T>(r));
}

export const api = {
  // ── auth ──
  session: () => getJSON<{ user: string; label: string }>("/events/api/session"),
  logout: () =>
    fetch("/events/api/logout", { method: "POST", credentials: "include" }).then(() => undefined),

  // ── calendar ──
  range: (startISO: string, endISO: string) =>
    getJSON<EventsFeed>(`/events/api/events?start=${startISO}&end=${endISO}`),
  needsReview: () => getJSON<NeedsReviewFeed>("/events/api/events/needs-review"),

  // ── one event ──
  get: (id: number) => getJSON<EventItem>(`/events/api/events/${id}`),
  update: (id: number, body: Record<string, string>) =>
    send<EventItem>(`/events/api/events/${id}`, "PATCH", body),
  retry: (id: number) => send<EventItem>(`/events/api/events/${id}/retry`, "POST"),
  remove: (id: number) => send<{ ok: boolean }>(`/events/api/events/${id}`, "DELETE"),

  // ── capture ──
  create: (fd: FormData): Promise<{ id: number; status: string }> =>
    fetch("/events/api/events", { method: "POST", credentials: "include", body: fd })
      .then((r) => readJSON<{ id: number; status: string }>(r)),
};
