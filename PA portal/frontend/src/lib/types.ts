// Shapes that come back from FastAPI's /dashboard/api/* endpoints.
// Keep this in sync with backend/src/services/dashboard_service.py.

export type Urgency = "low" | "medium" | "high" | "critical";

export type AppointmentStatus =
  | "Scheduled"
  | "Waiting"
  | "Rescheduled"
  | "Awaiting Review"
  | "Reviewed";

export interface SlaBucket {
  priority: "P0" | "P1" | "P2" | "P3";
  on_track: number;
  breached: number;
  target_days: number;
}

export interface StatsResponse {
  total: number;
  scheduled: number;
  submitted: number;
  closed: number;
  rescheduled: number;
  ai_coverage: number;       // 0-100 (%)
  resolution_rate: number;   // 0-100 (%)
  trend_labels: string[];
  trend_counts: number[];
  trend_resolved?: number[];
  categories: { label: string; count: number }[];
  departments: { label: string; count: number }[];
  urgency: Partial<Record<Urgency, number>>;
  // New political/operational KPIs
  unique_citizens?: number;
  meetings_held?: number;
  active_cases?: number;
  avg_response_hours?: number;
  growth_pct?: number | null;
  sla_buckets?: SlaBucket[];
  forwarded_departments?: { label: string; count: number }[];
  total_forwarded?: number;
}

export interface AppointmentAttachment {
  name: string;
  url: string;
  type: "IMAGE" | "DOCUMENT" | "AUDIO" | "VIDEO";
}

export interface AppointmentRow {
  id: number;
  token: string | number;
  name: string;
  mobile: string;
  category: string;
  department?: string | null;     // primary dept — snake_case Department enum key
  secondary_departments?: string[]; // 0–2 additional depts to loop in
  status: AppointmentStatus;
  created_at: string;        // pre-formatted timestamp
  appointment_time?: string;
  urgency?: Urgency | null;
  description?: string;
  headline?: string;
  headline_ta?: string | null;
  summary?: string;
  summary_ta?: string | null;
  citizen_ask?: string;
  citizen_ask_ta?: string | null;
  key_details?: string[];
  key_details_ta?: string[];
  audio_transcript?: string | null;
  audio_url?: string | null;            // dedicated form-mic recording
  attachments?: AppointmentAttachment[];
  category_label?: string | null;
  department_label?: string | null;
  priority?: TicketPriority | null;
}

export interface AppointmentsResponse {
  items: AppointmentRow[];
  total: number;
}

// ── Ticketing (PA team only) ────────────────────────────────────────────────

export type TicketStatus =
  | "open"
  | "triaged"
  | "assigned"
  | "in_progress"
  | "forwarded_to_dept"
  | "pending_citizen"
  | "resolved"
  | "closed"
  | "reopened";

export type TicketPriority = "P0" | "P1" | "P2" | "P3";

export type ClosureReason =
  | "action_taken"
  | "not_actionable"
  | "duplicate"
  | "resolved_by_dept"
  | "no_response_from_citizen"
  | "out_of_scope";

export interface TicketEvent {
  id: number;
  event_type: string;
  actor: string;
  note?: string | null;
  payload?: Record<string, unknown> | null;
  created_at: string;
}

export interface TicketRow {
  id: number;
  ticket_number: string;
  token?: string | null;
  appointment_id: number;
  citizen_name?: string | null;
  citizen_mobile?: string | null;
  status: TicketStatus;
  priority?: TicketPriority | null;
  assigned_to_pa?: string | null;
  due_date?: string | null;
  forwarded_to_dept?: string | null;
  forwarded_to_dept_label?: string | null;
  reopen_count: number;
  created_at: string;
  updated_at: string;
  urgency?: Urgency | null;
  category?: string | null;
  category_label?: string | null;
  department?: string | null;
  department_label?: string | null;
  headline?: string | null;
}

export interface TicketDetail extends TicketRow {
  description?: string | null;
  summary?: string | null;
  summary_ta?: string | null;
  headline_ta?: string | null;
  citizen_ask?: string | null;
  citizen_ask_ta?: string | null;
  key_details?: string[];
  key_details_ta?: string[];
  audio_transcript?: string | null;
  secondary_departments?: string[];
  resolution_notes?: string | null;
  closure_reason?: ClosureReason | null;
  resolved_at?: string | null;
  closed_at?: string | null;
  reopened_at?: string | null;
  forwarded_at?: string | null;
  forwarded_by?: string | null;
  forwarded_notes?: string | null;
  attachments?: AppointmentAttachment[];
  events: TicketEvent[];
}

export interface TicketsResponse {
  items: TicketRow[];
  total: number;
  page: number;
  page_size: number;
}
