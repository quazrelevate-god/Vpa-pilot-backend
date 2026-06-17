// In-memory mock backend so the PA portal is fully usable without the FastAPI
// service running. It mimics the contract in docs/pa-portal-queue-scheduler.md.
//
// When the real backend is ready, set VITE_USE_MOCK=false (see client.ts) and
// this file is bypassed entirely — no component code changes required.

import type {
  Appointment,
  BookAppointmentRequest,
  Case,
  Slot,
} from "../shared/types";

const todayIso = (): string => new Date().toISOString().slice(0, 10);

// Build an ISO timestamp for today at a given HH:mm (local-ish, good enough for demo).
const todayAt = (hhmm: string): string => {
  const [h, m] = hhmm.split(":").map(Number);
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d.toISOString();
};

let caseSeq = 100;
let apptSeq = 1;
const nextCaseId = () => `C-${++caseSeq}`;
const nextApptId = () => `A-${apptSeq++}`;

// --- Seed data -------------------------------------------------------------

const cases: Case[] = [
  {
    id: "C-101",
    citizenName: "Lakshmi Narayanan",
    summary:
      "Requests repair of the broken street light on 4th Cross, Gandhi Nagar — dark for three weeks, safety concern at night.",
    status: "waiting",
    entryType: "appointment",
    appointmentTime: todayAt("09:30"),
    createdAt: todayAt("08:55"),
  },
  {
    id: "C-102",
    citizenName: "Mohammed Irfan",
    summary:
      "Pension payment stopped since April; asks office to follow up with the treasury on his behalf.",
    status: "waiting",
    entryType: "walkin",
    tokenNumber: 12,
    createdAt: todayAt("09:05"),
  },
  {
    id: "C-103",
    citizenName: "Saroja Devi",
    summary:
      "Water supply to her ward has been irregular for a month; requests a tanker schedule and a long-term fix.",
    status: "called",
    entryType: "appointment",
    appointmentTime: todayAt("10:00"),
    createdAt: todayAt("09:12"),
  },
  {
    id: "C-104",
    citizenName: "Ramesh Kumar",
    summary:
      "Seeks a recommendation letter for his daughter's college scholarship application; deadline this week.",
    status: "waiting",
    entryType: "walkin",
    tokenNumber: 13,
    createdAt: todayAt("09:20"),
  },
  {
    id: "C-105",
    citizenName: "Fatima Begum",
    summary:
      "Complaint about garbage not being collected on her street for ten days; raises health concern.",
    status: "in_meeting",
    entryType: "walkin",
    tokenNumber: 11,
    createdAt: todayAt("08:40"),
  },
  {
    id: "C-106",
    citizenName: "Venkatesh Rao",
    summary:
      "Disputes a property tax reassessment he believes is incorrect; brings prior year receipts.",
    status: "waiting",
    entryType: "appointment",
    appointmentTime: todayAt("11:15"),
    createdAt: todayAt("09:34"),
  },
];

const appointments: Appointment[] = [];

// Slots for the next 7 days, two morning + two afternoon blocks per day.
const slots: Slot[] = [];
(() => {
  const base = new Date();
  const blocks = ["09:00", "10:30", "12:00", "14:30"];
  let id = 1;
  for (let day = 0; day < 7; day++) {
    const d = new Date(base);
    d.setDate(base.getDate() + day);
    const date = d.toISOString().slice(0, 10);
    blocks.forEach((startTime, i) => {
      const capacity = 5;
      // Some realistic pre-existing bookings, more on nearer days.
      const bookedCount = Math.max(0, Math.min(capacity, 4 - day - (i % 2)));
      slots.push({ id: `S-${id++}`, date, startTime, capacity, bookedCount });
    });
  }
})();

// --- Simulated network ------------------------------------------------------

const LATENCY_MS = 350;
const delay = <T>(value: T): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(value), LATENCY_MS));

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

// --- Mock handlers ----------------------------------------------------------

export const mockApi = {
  async getQueue(date: string): Promise<Case[]> {
    void date; // demo always returns "today"
    const active = cases.filter((c) =>
      ["waiting", "called", "in_meeting"].includes(c.status)
    );
    // Sort: appointment time first (chronological), then walk-ins by token.
    active.sort((a, b) => {
      if (a.appointmentTime && b.appointmentTime)
        return a.appointmentTime.localeCompare(b.appointmentTime);
      if (a.appointmentTime) return -1;
      if (b.appointmentTime) return 1;
      return (a.tokenNumber ?? 0) - (b.tokenNumber ?? 0);
    });
    return delay(clone(active));
  },

  async callIn(caseId: string): Promise<Case> {
    const found = cases.find((c) => c.id === caseId);
    if (!found) throw new Error(`Case ${caseId} not found`);
    found.status = "called";
    return delay(clone(found));
  },

  async getSlots(date: string): Promise<Slot[]> {
    const day = slots.filter((s) => s.date === date);
    return delay(clone(day));
  },

  async bookAppointment(req: BookAppointmentRequest): Promise<Appointment> {
    const slot = slots.find((s) => s.id === req.slotId);
    if (!slot) throw new Error("Slot not found");
    if (slot.bookedCount >= slot.capacity) throw new Error("Slot is full");

    const caseId = nextCaseId();
    cases.push({
      id: caseId,
      citizenName: req.citizenName,
      summary: `${req.grievanceText.slice(0, 140)}${
        req.grievanceText.length > 140 ? "…" : ""
      }`,
      status: "waiting",
      entryType: "appointment",
      appointmentTime: todayAt(slot.startTime),
      createdAt: new Date().toISOString(),
    });

    slot.bookedCount += 1;
    const appt: Appointment = {
      id: nextApptId(),
      slotId: slot.id,
      caseId,
      citizenName: req.citizenName,
      status: "booked",
    };
    appointments.push(appt);
    return delay(clone(appt));
  },
};

export const mockToday = todayIso;
