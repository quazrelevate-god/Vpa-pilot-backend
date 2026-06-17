// Shared domain types for the PA portal.
// Mirrors the backend contract in docs/pa-portal-queue-scheduler.md.

export type CaseStatus =
  | "waiting"
  | "called"
  | "in_meeting"
  | "closed"
  | "rescheduled";

export type EntryType = "walkin" | "appointment";

export interface Case {
  id: string;
  citizenName: string;
  summary: string;
  status: CaseStatus;
  entryType: EntryType;
  tokenNumber?: number; // present if entryType is "walkin"
  appointmentTime?: string; // ISO time, present if entryType is "appointment"
  createdAt: string;
}

export interface Slot {
  id: string;
  date: string; // YYYY-MM-DD
  startTime: string; // HH:mm
  capacity: number;
  bookedCount: number;
}

export type AppointmentStatus =
  | "booked"
  | "completed"
  | "cancelled"
  | "rescheduled";

export interface Appointment {
  id: string;
  slotId: string;
  caseId: string;
  citizenName: string;
  status: AppointmentStatus;
}

export interface BookAppointmentRequest {
  slotId: string;
  citizenName: string;
  citizenPhone: string;
  grievanceText: string;
}
