// Shapes that come back from FastAPI's /dashboard/api/* endpoints.
// Keep this in sync with backend/src/services/dashboard_service.py.

export type Urgency = "low" | "medium" | "high" | "critical";

export type AppointmentStatus =
  | "Scheduled"
  | "Waiting"
  | "Rescheduled"
  | "Submitted"
  | "Closed";

export interface StatsResponse {
  total: number;
  scheduled: number;
  submitted: number;
  closed: number;
  rescheduled: number;
  ai_coverage: number;       // 0-100 (%)
  resolution_rate: number;   // 0-100 (%)
  trend_labels: string[];    // ISO dates for last 14 days
  trend_counts: number[];    // matching daily submission counts
  categories: { label: string; count: number }[];
  departments: { label: string; count: number }[];
  urgency: Partial<Record<Urgency, number>>;
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
  summary?: string;
  citizen_ask?: string;
  key_details?: string[];
  audio_transcript?: string | null;
  audio_url?: string | null;            // dedicated form-mic recording
  attachments?: AppointmentAttachment[];
}

export interface AppointmentsResponse {
  items: AppointmentRow[];
  total: number;
}
