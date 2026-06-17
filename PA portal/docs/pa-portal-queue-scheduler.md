# PA Portal — Live Queue & Scheduler

Detailed build context for the first two features of the React PA portal. See the root `CLAUDE.md` for overall project context, architecture, and design principles — don't repeat those decisions here, just build against them.

## Scope for this pass

Build only:

- **Live Queue** — today's cases, call-in action
- **Scheduler** — future appointment slots, booking a citizen into one

Do not build yet, even though they're part of the eventual portal: case detail/edit, manual case entry, Minister check-in/check-out, audit log, daily reports, login/roles. If something strictly needs a logged-in user, stub it — don't build auth out.

## Folder structure (subset relevant now)

```
src/
├── api/
│   └── client.ts          # fetch wrapper: base URL, error handling
├── queue/
│   ├── QueuePage.tsx
│   ├── QueueTable.tsx
│   ├── CallInButton.tsx
│   └── useQueue.ts         # polling refresh, every 10-15s
├── scheduler/
│   ├── SchedulerPage.tsx
│   ├── SlotCalendar.tsx
│   └── useSlots.ts
└── shared/
    ├── components/
    └── types.ts
```

## Live Queue

Shows today's cases — both walk-ins and anyone whose pre-booked appointment falls today — in one list, sorted by appointment time where one exists, otherwise by arrival/token order. Each row needs: a short reference (token number or case ID), the citizen's name, the AI-generated summary (one or two lines — never the full grievance text in the list view), current status, and a Call In action.

Call In marks the case `called`. It's the only write action in this feature for now; closing a case out after the meeting happens later — calling someone in is what this pass needs to get right.

Refresh by polling every 10-15 seconds, not websockets. The realistic load is dozens of cases a day in one office, not enough to justify the extra complexity yet.

### Data shape

```ts
interface Case {
  id: string;
  citizenName: string;
  summary: string;
  status: "waiting" | "called" | "in_meeting" | "closed" | "rescheduled";
  entryType: "walkin" | "appointment";
  tokenNumber?: number;       // present if entryType is "walkin"
  appointmentTime?: string;   // ISO time, present if entryType is "appointment"
  createdAt: string;
}
```

### Endpoints (proposed — confirm against whatever the backend actually implements)

```
GET  /api/queue?date=today
  → Case[]   (status in waiting | called | in_meeting, for the given date)

POST /api/queue/{case_id}/call-in
  → Case     (status updated to "called")
```

## Scheduler

Shows available appointment capacity by date, and lets the PA book a citizen into a future slot. This is what makes "appointment scheduling" real instead of just a same-day line — without it, citizens can only be added to today's queue, which doesn't solve the original problem of letting people book ahead so they don't all arrive at once.

A day view is enough for this pass: pick a date, see that day's slots with capacity used vs. available, book a case into an open one. A full month calendar grid isn't needed yet.

### Data shape

```ts
interface Slot {
  id: string;
  date: string;        // YYYY-MM-DD
  startTime: string;   // HH:mm
  capacity: number;
  bookedCount: number;
}

interface Appointment {
  id: string;
  slotId: string;
  caseId: string;
  citizenName: string;
  status: "booked" | "completed" | "cancelled" | "rescheduled";
}
```

### Endpoints (proposed)

```
GET  /api/slots?date=YYYY-MM-DD
  → Slot[]

POST /api/appointments
  body: { slotId, citizenName, citizenPhone, grievanceText }
  → Appointment   (also creates the underlying Case)
```

## Worth keeping in mind, even now

A case can originate from either path — walk-in (gets a token, shows up in the Live Queue today) or pre-booked (gets an appointment, shows up in the Scheduler until its date arrives, then in the Live Queue that day). Model this as one `Case` type with an `entryType` field, not two separate object types. Splitting it now would make the Minister check-in/reschedule logic — built in a later pass, where a checked-out Minister needs to bump affected walk-ins and appointments through the same logic — much harder to bolt on afterward.
