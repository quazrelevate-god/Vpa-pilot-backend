# PA Portal — Frontend

React + Vite + TypeScript app for the Minister's PA office. This pass covers the
two features in [`../docs/pa-portal-queue-scheduler.md`](../docs/pa-portal-queue-scheduler.md):

- **Live Queue** — today's walk-ins and appointments in one list, with a *Call in* action. Auto-refreshes every ~12s.
- **Scheduler** — pick a day, see slot capacity, and book a citizen into an open slot.

The whole portal runs **without a backend** out of the box via an in-memory mock
(`src/api/mock.ts`), so anyone can open it and click around immediately.

## Run it

```bash
cd "PA portal/frontend"
npm install
npm run dev
```

Open http://localhost:5173. The app starts on the Live Queue.

## Try it

- **Live Queue:** click **Call in** on any waiting person — the status flips to
  *Called in*, a confirmation toast appears, and the stat counters update. The
  "Updated …" pill shows the auto-refresh ticking.
- **Scheduler:** pick a day from the strip (or the date picker), pick an open
  slot, fill the short form, and confirm. The slot's capacity meter updates and
  a new case is created behind the scenes (visible in the Live Queue if it's for
  today).

## Connecting the real backend

No component changes needed — flip one flag:

```bash
cp .env.example .env
# set VITE_USE_MOCK=false
```

In dev, `/api/*` is proxied to `http://localhost:8000` (see `vite.config.ts`).
In production, FastAPI serves `dist/` and the same-origin `/api` just works.

The API contract the client expects (`src/api/client.ts`):

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/queue?date=today` | today's active cases |
| `POST` | `/api/queue/{case_id}/call-in` | mark a case `called` |
| `GET` | `/api/slots?date=YYYY-MM-DD` | a day's slots |
| `POST` | `/api/appointments` | book a slot (creates the case) |

## Structure

```
src/
├── api/            client.ts (fetch wrapper) + mock.ts (in-memory backend)
├── queue/          Live Queue: page, table, call-in button, polling hook
├── scheduler/      Scheduler: page, slot grid, booking modal, slots hook
└── shared/         types.ts + reusable UI (Layout, Modal, Toast, badges…)
```

## Build

```bash
npm run build      # type-checks then bundles to dist/
npm run preview    # serve the production build locally
```
