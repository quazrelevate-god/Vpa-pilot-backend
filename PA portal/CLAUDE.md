# Grievance, Appointment & Crowd Management System

## What this is

The Minister's PA office currently handles citizen visits and petitions with no system: long unmanaged queues, no way to book ahead, and no record once a petition is handed in. This project replaces that with a tracked process — every visit becomes a case, every citizen gets status updates, and the office gets visibility it never had.

## Phase 1 scope (building now)

- QR self check-in (citizen's own phone) + an assisted intake screen for those without one
- AI-generated summary for every grievance — summarization only, no auto-classification or auto-decisioning
- Appointment scheduler (book ahead) + same-day walk-in queue
- PA portal: live queue, scheduler, manual case entry, call-in, Minister availability
- SMS/WhatsApp updates at every status change

Deferred to later phases — don't pull these in early: paper petition OCR, multilingual voice classification, camera-based crowd analytics, multi-office rollout.

## Architecture

One FastAPI backend, two front doors:

- **Jinja2-rendered pages** (served directly by FastAPI) for the simple, linear citizen-facing flows: the outside QR display, the citizen self check-in form, and the kiosk intake screen. These need to be fast on weak mobile connections, not richly interactive — server rendering is the right tool here.
- **JSON API under `/api/*`** (Pydantic models, FastAPI's auto docs) consumed by a separate React app for the PA portal — the one surface complex and stateful enough to justify it (live queue, scheduler, case editing, Minister availability, audit log).

FastAPI serves the React app's built static files too. One process, one deployment — not two backends.

## Design principles

1. **The case is the spine.** Every petition is one case record linking the citizen, the grievance, the AI summary, and a status (`waiting` → `called` → `in_meeting` → `closed`, or `rescheduled`). Nothing should be tracked outside this record — including the two different ways a case can start (walk-in vs. pre-booked appointment).
2. **AI is assistive, not authoritative.** It summarizes; it never decides who gets seen, what priority means, or who gets rescheduled, without a human (the PA) confirming. A misjudged auto-decision here is a political problem, not just a bug.
3. **Build the simple version first.** No OCR, no multilingual voice classification, no crowd cameras, no microservices, no message queues. One small backend, one database, plain polling instead of websockets — until there's an actual reason to need more.

## Current focus

Building the React PA portal, starting with **Live Queue** and **Scheduler**. See [`docs/pa-portal-queue-scheduler.md`](docs/pa-portal-queue-scheduler.md) for the detailed spec — data shapes, proposed API contract, folder structure.

Not in scope for this pass, even though they exist in the eventual design: case detail/edit, manual case entry, Minister check-in/check-out, audit log, reporting, login/roles. Stub auth only if something strictly needs a logged-in user; don't build it out yet.

## Tech stack

- Backend: FastAPI, Pydantic, Postgres
- Citizen-facing pages: Jinja2 templates (server-rendered)
- PA portal: React + Vite + TypeScript, calling FastAPI's `/api/*` JSON endpoints
- Notifications: SMS/WhatsApp gateway, triggered server-side on case status changes

## Key entities

- **Case** — citizen + grievance + AI summary + status + a link to either a token (walk-in) or an appointment
- **Appointment** — a citizen booked into a future slot
- **Slot** — available capacity for a given date/time block
- **MinisterAvailability** — not built yet; will track check-in/check-out windows and drive auto-rescheduling in a later pass
