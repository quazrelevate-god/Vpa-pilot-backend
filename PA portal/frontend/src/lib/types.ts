// Shapes that come back from FastAPI's /dashboard/api/* endpoints.
// Keep this in sync with backend/src/services/dashboard_service.py.

export type Priority = "low" | "medium" | "high" | "critical";

export type AppointmentStatus =
  | "Scheduled"
  | "Waiting"
  | "Rescheduled"
  | "Awaiting Review"
  | "Reviewed";

export interface SlaBucket {
  priority: Priority;
  on_track: number;
  breached: number;
  target_days: number;
}

export interface StatsResponse {
  total: number;
  scheduled: number;
  reviewed: number;
  awaiting_review: number;
  waiting: number;
  rescheduled: number;
  ai_coverage: number;       // 0-100 (%)
  resolution_rate: number;   // 0-100 (%)
  trend_labels: string[];
  trend_counts: number[];
  trend_resolved?: number[];
  categories: { label: string; count: number }[];
  departments: { label: string; count: number }[];
  priority: Partial<Record<Priority, number>>;
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
  name_ta?: string | null;
  mobile: string;
  category: string;
  department?: string | null;     // primary dept — snake_case Department enum key
  secondary_departments?: string[]; // 0–2 additional depts to loop in
  status: AppointmentStatus;
  source?: string | null;    // intake channel: qr_citizen | ai_scan | manual_staff
  created_at: string;        // pre-formatted timestamp
  scheduled_date?: string | null;  // ISO date of the meeting slot (YYYY-MM-DD)
  appointment_time?: string;        // personal sub-slot ISO datetime
  slot_window?: string | null;      // "08:00 – 08:30" range label
  appointment_slot_end?: string | null;
  priority?: Priority | null;
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
  num_persons?: number | null;
}

export interface AppointmentsResponse {
  items: AppointmentRow[];
  total: number;
}

export interface AppointmentActivityEvent {
  id: number;
  event_type: string;
  actor: string;
  note?: string | null;
  payload?: Record<string, unknown> | null;
  created_at: string;
}

export interface AppointmentActivityResponse {
  items: AppointmentActivityEvent[];
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

export type ClosureReason =
  | "action_taken"
  | "not_actionable"
  | "duplicate"
  | "resolved_by_dept"
  | "no_response_from_citizen"
  | "out_of_scope";

export interface TicketEvent {
  id: number | string;   // real events are numeric; synthetic anchors are string ids
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
  priority?: Priority | null;   // from the AI review (low|medium|high|critical)
  assigned_to_pa?: string | null;
  due_date?: string | null;
  forwarded_to_dept?: string | null;
  forwarded_to_dept_label?: string | null;
  reopen_count: number;
  created_at: string;
  updated_at: string;
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
  // Routed school department (Assign) + acceptance state.
  assigned_department?: string | null;
  assigned_department_label?: string | null;
  accepted_at?: string | null;
  accepted_by?: string | null;
  resolution_notes?: string | null;
  closure_reason?: ClosureReason | null;
  resolved_at?: string | null;
  closed_at?: string | null;
  reopened_at?: string | null;
  forwarded_at?: string | null;
  forwarded_by?: string | null;
  forwarded_notes?: string | null;
  attachments?: AppointmentAttachment[];
  resolution_attachments?: ResolutionAttachment[];
  events: TicketEvent[];
}

export interface ResolutionAttachment {
  url: string;
  mime: string;
  name: string;
  kind: string;          // "resolution"
  by: string;            // department key that uploaded it
  at: string;
}

export interface TicketsResponse {
  items: TicketRow[];
  total: number;
  page: number;
  page_size: number;
}
