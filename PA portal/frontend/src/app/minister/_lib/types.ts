// Wire types for the Minister PWA. Every /minister/api endpoint re-serves an
// existing analytics service verbatim, so we REUSE the shapes already defined
// for the super-admin dashboards + events app instead of duplicating them.

export type {
  EventItem, EventsOverview, EventStatus,
} from "@/app/events/_lib/types";
export {
  EVENT_TYPE_META, typeMeta, pickTitle, pickVenue, displayTitle, pickRawSummary,
} from "@/app/events/_lib/types";

export type {
  ProposalAnalytics, ProposalKpis,
} from "@/app/(dashboard)/proposal-dashboard/_lib/api";

export type {
  AssociationAnalytics, AssociationKpis,
} from "@/app/(dashboard)/association-dashboard/_lib/api";

// ── Office dashboard (analytics_service.get_analytics) ──────────────────────
// Category/ministry rows may arrive label-only (no key), so `key` is optional
// here; the screens coerce with `key ?? label` before charting.
export interface Bar { key?: string; label: string; count: number }
// Status/priority rows are always keyed by the backend — required key so they
// pass straight to Bar/DonutBreakdown without coercion.
export interface KeyedBar { key: string; label: string; count: number }
export interface DashTrendPoint { date: string; received?: number; resolved?: number; count?: number }

export interface DashboardAnalytics {
  kpis: {
    received: number;
    citizens: number;
    urgent: number;
    meetings: number;
    meeting_persons: number;
    awaiting_review: number;
    growth_pct: number | null;
    resolution_rate: number;
    avg_response_hours: number | null;
    on_time_pct: number;
    resolved: number;
  };
  categories: Bar[];
  ministries: Bar[];
  channels: Bar[];
  priority: { critical: number; high: number; medium: number; low: number };
  trend: DashTrendPoint[];
}

export interface OperationsData {
  departments: { key?: string; label: string; count: number }[];
  districts: { key: string; label: string; count: number }[];
}

// ── Tickets (analytics_service.get_ticket_dashboard) ────────────────────────
export interface TicketTrendPoint { date: string; raised: number; resolved: number }

export interface TicketAnalytics {
  kpis: {
    total: number;
    open: number;
    resolved: number;
    breached: number;
    due_soon: number;
    on_track: number;
    resolution_rate: number;
    avg_response_hours: number | null;
    on_time_pct: number;
  };
  by_status: KeyedBar[];
  by_priority: KeyedBar[];
  departments: TicketDept[];
  trend: TicketTrendPoint[];
}

// Per-department performance row (staff Ticket Insights "Department performance").
export interface TicketDept {
  key?: string; label?: string; name?: string; count?: number;
  open?: number; resolved?: number; total?: number;
  resolution_rate?: number | null; avg_resolution_days?: number | null; on_time_pct?: number | null;
}

export interface MinisterSession { user: string; label: string }
