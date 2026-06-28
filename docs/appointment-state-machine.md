# Appointment / Case state machine

The `appointments` table is the **case spine** — every petition, from any channel,
becomes one appointment row. Its behaviour is governed by four columns. This doc
exists because that table is intentionally overloaded; read this before adding a
new status or flag.

## The four control columns

| Column | Purpose | Values |
|---|---|---|
| `status` | Where the case is in its lifecycle | `SCHEDULED`, `WAITING`, `RESCHEDULED`, `AWAITING_REVIEW`, `REVIEWED`, `NOT_CAME` |
| `source` | How it entered the system (analytics channel) | `qr_citizen`, `ai_scan`, `manual_staff` |
| `schedule_meeting` | Did the citizen want a face-to-face meeting? | `true` / `false` |
| `pre_floor_status` | Original status saved before the crowd board marked attendance, so a mistaken Came/Not-Came can be reverted exactly | nullable; `SCHEDULED` / `RESCHEDULED` / null |

`source` and `schedule_meeting` are **set once at creation** and never change.
`status` and `pre_floor_status` move over the case's life.

## Statuses

- **SCHEDULED** — a meeting was requested and a slot is booked (`schedule_meeting=true`).
- **WAITING** — wanted a meeting but no slot was available (waiting queue).
- **RESCHEDULED** — a booked meeting was moved off its slot (PA action).
- **AWAITING_REVIEW** — a petition is waiting for a PA to review it. Reached by:
  direct-submit (no meeting), AI-scan extraction approved, manual staff scan, or the
  crowd board marking a meeting visitor **Came**.
- **REVIEWED** — PA has reviewed it → a **Ticket** is created (this is the convergence
  point into case management). Terminal for the appointment; the ticket takes over.
- **NOT_CAME** — a scheduled visitor did not show up (set by the crowd board).

## Who drives the transitions

```
                         ┌─────────────── intake channels ───────────────┐
 QR self-submit (meeting) ─► SCHEDULED ─┐        AI Uploads ─► (approve) ─┐
 QR self-submit (no slot) ─► WAITING    │        Staff scan ─► (submit) ──┤
 QR direct-submit ────────► AWAITING_REVIEW ◄────────────────────────────┘
                                         │
        crowd board: "Came"  ────────────┼─►  AWAITING_REVIEW  (pre_floor_status = prior)
        crowd board: "Not Came" ─────────┼─►  NOT_CAME         (pre_floor_status = prior)
        crowd board: undo ───────────────┴─►  restore pre_floor_status
                                         │
        PA review (dashboard) ───────────┴─►  REVIEWED  ──►  Ticket created
        PA: Waiting / Rescheduled ───────────►  WAITING / RESCHEDULED (slot released)
```

Transition code lives in:
- `dashboard_service.update_appointment_status()` — PA portal actions (Reviewed →
  ticket via MAX-suffix+advisory-lock ticket numbering; Waiting/Rescheduled release
  the slot).
- `dashboard_service.set_floor_attendance()` — crowd board Came/Not-Came/undo;
  deliberately side-effect-free (no slot release) so the row stays on today's board.
- `ai_upload_service.approve()` → `_build_case()` — AI-scan path: creates Citizen +
  Appointment (`source=ai_scan`) + summary, then calls `update_appointment_status(...,
  "Reviewed")` to make the ticket.

## Invariants worth preserving
- A **Ticket is 1:1 with an appointment** and is created only on REVIEWED.
- The crowd board never releases a slot — only `update_appointment_status` does.
- `token_assigned` (YYYYMMDDNNNNN, IST) and ticket numbers are both assigned under a
  PostgreSQL advisory lock to avoid collisions.
- A direct-submit petition has no `scheduled_date`; only meeting cases do — that's how
  the display board and analytics tell them apart.

## If you need a new state
Prefer a new `status` value + handling in the two service functions above, and update
this doc + the analytics labels. Resist adding a fifth control column to this table —
if the case grows richer, that's a signal to move sub-state onto the `tickets` record
(which already has its own richer lifecycle).
