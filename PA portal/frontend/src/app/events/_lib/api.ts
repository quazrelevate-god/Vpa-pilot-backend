// Typed fetch wrappers for the events app. Everything is same-origin (Next.js
// rewrites /events/api/* to FastAPI) and carries the events_session cookie via
// credentials:"include".

import type { EventItem, EventsFeed, NeedsReviewFeed, OverviewData } from "./types";

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

// Roles the events PWA understands. Server-provided in /session, drives nav
// gating (hide Needs Review from users without event_reviewer).
export type EventsRole = "event_uploader" | "event_reviewer";

export interface EventsSession {
  user: string;
  label: string;
  roles: EventsRole[];
}

export const api = {
  // ── auth ──
  session: () => getJSON<EventsSession>("/events/api/session"),
  logout: () =>
    fetch("/events/api/logout", { method: "POST", credentials: "include" }).then(() => undefined),

  // ── overview ──
  overview: () => getJSON<OverviewData>("/events/api/overview"),

  // ── calendar ──
  range: (startISO: string, endISO: string) =>
    getJSON<EventsFeed>(`/events/api/events?start=${startISO}&end=${endISO}`),
  needsReview: () => getJSON<NeedsReviewFeed>("/events/api/events/needs-review"),

  // ── one event ──
  get: (id: number) => getJSON<EventItem>(`/events/api/events/${id}`),
  update: (id: number, body: Record<string, string>) =>
    send<EventItem>(`/events/api/events/${id}`, "PATCH", body),
  retry: (id: number) => send<EventItem>(`/events/api/events/${id}/retry`, "POST"),
  approve: (id: number) => send<EventItem>(`/events/api/events/${id}/approve`, "POST"),
  remove: (id: number) => send<{ ok: boolean }>(`/events/api/events/${id}`, "DELETE"),

  // ── capture ──
  create: (fd: FormData): Promise<{ id: number; status: string }> =>
    fetch("/events/api/events", { method: "POST", credentials: "include", body: fd })
      .then((r) => readJSON<{ id: number; status: string }>(r)),

  // ── manual creation ──
  createManual: (fd: FormData): Promise<EventItem> =>
    fetch("/events/api/events/manual", { method: "POST", credentials: "include", body: fd })
      .then((r) => readJSON<EventItem>(r)),

  // ── web push (event reminders) ──
  // 503 from vapidPublicKey / subscribe means "push disabled server-side" —
  // callers should treat it as feature-off and skip the permission dance.
  vapidPublicKey: () => getJSON<{ public_key: string }>("/events/api/push/vapid-public-key"),
  pushSubscribe: (body: { endpoint: string; keys: { p256dh: string; auth: string }; device_label?: string }) =>
    send<{ id: number; is_active: boolean }>("/events/api/push/subscribe", "POST", body),
  pushUnsubscribe: (endpoint: string) =>
    send<{ ok: boolean }>("/events/api/push/unsubscribe", "POST", { endpoint }),
};
