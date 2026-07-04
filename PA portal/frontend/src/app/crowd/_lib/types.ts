// Shapes returned by the /crowd/api/* and /api/v1/scheduling/* endpoints.

export type ApptItem = {
  id: number;
  token: string;
  name: string;
  mobile: string;
  num_persons: number;
  category: string;
  reason: string;
  status: string;
  status_db: string; // SCHEDULED | RESCHEDULED | AWAITING_REVIEW | NOT_CAME
  time: string;
};

export type RefItem = {
  id: number;
  token: string;
  name: string;
  mobile?: string;
  num_persons?: number;
  reason?: string;
  referred_by?: string;
  slot?: string;
  status: string; // PENDING | CAME | NOT_CAME
};

export type Feed<T> = {
  items: T[];
  total: number;
  expected: number;
  present: number;
  not_came: number;
  date: string;
};

export type ApptFeed = Feed<ApptItem>;
export type RefFeed = Feed<RefItem>;

export type Slot = {
  id: number;
  slot_number: number;
  label: string;
  start: string;
  end: string;
  available: boolean;
  booked_count: number;
  max_capacity: number;
  remaining: number;
  status: string; // AVAILABLE | FULL | BLOCKED
};

export type SlotsResp = {
  available: boolean;
  date: string;
  date_label: string;
  slots: Slot[];
};

export type OpenDate = {
  date: string;
  date_label: string;
  open?: number | null; // client-enriched: number of open slots that day
};

export type IntakeResult = {
  appointment_id?: number;
  token_assigned?: number;
  token_display?: string;
  status?: string; // SCHEDULED | WAITING | AWAITING_REVIEW
  scheduled_date?: string | null;
  scheduled_time?: string | null;
  slot_window?: string | null;
  message?: string;
};

export type Availability = {
  seats: number;
  slots: number;
  open: boolean;
  offline: boolean;
  updated?: string;
};
