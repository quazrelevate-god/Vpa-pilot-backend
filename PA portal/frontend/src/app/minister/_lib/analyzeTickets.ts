// Client-side ticket analytics — mirrors analytics_service.get_ticket_dashboard
// so the Minister Tickets screen can cross-filter: click a status / priority /
// department → recompute every KPI + chart + the SLA health from the filtered
// rows. Constants are kept in lock-step with the backend so the numbers match.

import type { TicketRow } from "./api";

export interface Bar { key: string; label: string; count: number }
export interface TicketDeptRow {
  key: string; label: string; open: number; resolved: number; total: number;
  resolution_rate: number; on_time_pct: number | null; avg_resolution_days: number | null;
}
export interface TicketView {
  kpis: {
    total: number; open: number; resolved: number;
    breached: number; due_soon: number; on_track: number;
    resolution_rate: number; on_time_pct: number | null; avg_response_hours: number | null;
  };
  by_status: Bar[]; by_priority: Bar[];
  departments: TicketDeptRow[];
  trend: { date: string; raised: number }[];
}

// ── Backend-matched constants ─────────────────────────────────────────────────
const CLOSED = new Set(["resolved", "closed"]);
const SLA_TARGET_DAYS: Record<string, number> = { critical: 3, high: 7, medium: 14, low: 28 };
const STATUS_LABEL: Record<string, string> = {
  open: "Open", triaged: "Triaged", assigned: "Assigned", awaiting_department: "Awaiting Department",
  in_progress: "In Progress", forwarded_to_dept: "Forwarded to Dept", pending_citizen: "Pending Citizen",
  resolved: "Resolved", closed: "Closed", reopened: "Reopened", reverted: "Reverted",
};
const PRIORITY_ORDER = ["critical", "high", "medium", "low"];

const titleCase = (s: string) => s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
const days = (a?: string | null, b?: string | null) => {
  if (!a || !b) return null;
  const d = (new Date(b).getTime() - new Date(a).getTime()) / 86400000;
  return Number.isFinite(d) ? d : null;
};

export function analyzeTickets(rows: TicketRow[]): TicketView {
  const now = Date.now();
  const total = rows.length;
  const isClosed = (r: TicketRow) => CLOSED.has((r.status || "").toLowerCase());
  const closedRows = rows.filter(isClosed);
  const openRows = rows.filter((r) => !isClosed(r));
  const resolved = closedRows.length;

  // SLA buckets over OPEN tickets: used-days vs the priority target (0.75 → due soon).
  let breached = 0, due_soon = 0, on_track = 0;
  for (const r of openRows) {
    if (!r.created_at) { on_track++; continue; }
    const target = SLA_TARGET_DAYS[(r.priority || "").toLowerCase()] ?? 14;
    const used = (now - new Date(r.created_at).getTime()) / 86400000;
    if (used >= target) breached++;
    else if (used >= target * 0.75) due_soon++;
    else on_track++;
  }

  const resolution_rate = total ? Math.round((resolved / total) * 1000) / 10 : 0;

  const respHours: number[] = [];
  let onTime = 0, considered = 0;
  for (const r of closedRows) {
    const d = days(r.created_at, r.updated_at);
    if (d == null) continue;
    respHours.push(d * 24);
    considered++;
    const target = SLA_TARGET_DAYS[(r.priority || "").toLowerCase()] ?? 14;
    if (d <= target) onTime++;
  }
  const avg_response_hours = respHours.length
    ? Math.round((respHours.reduce((a, b) => a + b, 0) / respHours.length) * 10) / 10 : null;
  const on_time_pct = considered ? Math.round((onTime / considered) * 1000) / 10 : null;

  // Group helpers.
  const group = (pick: (r: TicketRow) => string | null | undefined, order?: string[]): Bar[] => {
    const c: Record<string, number> = {};
    for (const r of rows) { const k = (pick(r) || "").toLowerCase(); if (k) c[k] = (c[k] || 0) + 1; }
    const entries = order
      ? order.filter((k) => c[k] > 0).map((k) => [k, c[k]] as [string, number])
      : Object.entries(c).sort((a, b) => b[1] - a[1]);
    return entries.map(([k, v]) => ({ key: k, label: STATUS_LABEL[k] || titleCase(k), count: v }));
  };

  // Per-department performance.
  const deptMap = new Map<string, { label: string; rows: TicketRow[] }>();
  for (const r of rows) {
    const key = r.assigned_department || r.department || "";
    if (!key) continue;
    if (!deptMap.has(key)) deptMap.set(key, { label: r.assigned_department_label || titleCase(key), rows: [] });
    deptMap.get(key)!.rows.push(r);
  }
  const departments: TicketDeptRow[] = [...deptMap.entries()].map(([key, { label, rows: dr }]) => {
    const dClosed = dr.filter(isClosed);
    const dSpans = dClosed.map((r) => days(r.created_at, r.updated_at)).filter((x): x is number => x != null);
    let dOnTime = 0, dConsidered = 0;
    for (const r of dClosed) {
      const d = days(r.created_at, r.updated_at); if (d == null) continue;
      dConsidered++;
      if (d <= (SLA_TARGET_DAYS[(r.priority || "").toLowerCase()] ?? 14)) dOnTime++;
    }
    return {
      key, label,
      open: dr.length - dClosed.length, resolved: dClosed.length, total: dr.length,
      resolution_rate: dr.length ? Math.round((dClosed.length / dr.length) * 1000) / 10 : 0,
      on_time_pct: dConsidered ? Math.round((dOnTime / dConsidered) * 1000) / 10 : null,
      avg_resolution_days: dSpans.length ? Math.round((dSpans.reduce((a, b) => a + b, 0) / dSpans.length) * 10) / 10 : null,
    };
  }).sort((a, b) => b.open - a.open || b.total - a.total);

  // 30-day raised trend.
  const dayCount: Record<string, number> = {};
  for (const r of rows) { if (r.created_at) { const d = r.created_at.slice(0, 10); dayCount[d] = (dayCount[d] || 0) + 1; } }
  const trend: { date: string; raised: number }[] = [];
  const today = new Date(); today.setUTCHours(0, 0, 0, 0);
  for (let i = 29; i >= 0; i--) {
    const dt = new Date(today); dt.setUTCDate(dt.getUTCDate() - i);
    const iso = dt.toISOString().slice(0, 10);
    trend.push({ date: iso, raised: dayCount[iso] || 0 });
  }

  return {
    kpis: {
      total, open: breached + due_soon + on_track, resolved,
      breached, due_soon, on_track, resolution_rate, on_time_pct, avg_response_hours,
    },
    by_status: group((r) => r.status),
    by_priority: group((r) => r.priority, PRIORITY_ORDER),
    departments,
    trend,
  };
}
