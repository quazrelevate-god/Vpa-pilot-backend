// Thin fetch wrapper for the PA portal.
//
// Base URL + JSON parsing + error handling live here so feature hooks stay clean.
// By default it talks to the in-memory mock (so the portal runs with no backend).
// Set VITE_USE_MOCK=false to hit the real FastAPI /api/* endpoints instead.

import type {
  Appointment,
  BookAppointmentRequest,
  Case,
  Slot,
} from "../shared/types";
import { mockApi } from "./mock";

const USE_MOCK = import.meta.env.VITE_USE_MOCK !== "false";
const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "/api";

export class ApiError extends Error {
  constructor(message: string, public status?: number) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      headers: { "Content-Type": "application/json" },
      ...init,
    });
  } catch {
    throw new ApiError("Can't reach the server. Check your connection.");
  }

  if (!res.ok) {
    let detail = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      if (body?.detail) detail = body.detail;
    } catch {
      /* ignore non-JSON error bodies */
    }
    throw new ApiError(detail, res.status);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  getQueue(date = "today"): Promise<Case[]> {
    if (USE_MOCK) return mockApi.getQueue(date);
    return request<Case[]>(`/queue?date=${encodeURIComponent(date)}`);
  },

  callIn(caseId: string): Promise<Case> {
    if (USE_MOCK) return mockApi.callIn(caseId);
    return request<Case>(`/queue/${encodeURIComponent(caseId)}/call-in`, {
      method: "POST",
    });
  },

  getSlots(date: string): Promise<Slot[]> {
    if (USE_MOCK) return mockApi.getSlots(date);
    return request<Slot[]>(`/slots?date=${encodeURIComponent(date)}`);
  },

  bookAppointment(body: BookAppointmentRequest): Promise<Appointment> {
    if (USE_MOCK) return mockApi.bookAppointment(body);
    return request<Appointment>(`/appointments`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  },
};
