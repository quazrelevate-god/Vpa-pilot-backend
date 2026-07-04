# Crowd Management PWA — Functional Brief

A functional description of the Crowd Management PWA for a UI designer. It
lists **what the app is**, **who uses it**, **what it must do**, and **what
information/actions each screen has to present** — without prescribing any
visual, structural, or branding choices. The designer decides how to
express these features.

---

## 1. What the app is

A **Progressive Web App** for the floor team at the Minister's PA office.
Installed to the phone/tablet home screen; works offline for reading, needs
network for writes. Bilingual English + Tamil throughout.

## 2. Who uses it

- The **floor operator** — front-desk staff running the walk-in day. Mostly
  on a phone.
- A **citizen** sometimes stands next to the operator. Some citizens have
  no phone. Some can't read or write.

## 3. What they do here

Three jobs:

1. **See who is due today** — appointments and referrals.
2. **Mark visitors present or absent** as they arrive.
3. **Register new walk-in visitors on the spot** — for citizens without a
   phone, illiterate citizens, or anyone the operator is entering on
   behalf of.

## 4. Core features the app must present

### 4.1 Session
- Sign in with a shared floor account.
- Sign out.
- Install-to-home-screen (Android/desktop native prompt + iOS
  instructions).
- Language switch (English ⇄ Tamil) applied everywhere.

### 4.2 Today at a glance
- Current time (updates every second).
- Today's date.
- Live meeting-slot availability for today — three possible states:
  - Slots open (how many seats and how many slots).
  - No slots open today.
  - Offline / cannot fetch.
- Auto-updated on load, every 30 seconds, on focus, and on language switch.

### 4.3 Two lists: Appointments and Referrals
Switchable, each with a live count. Only one visible at a time.

For **appointments**, each visitor entry must present:
- Name.
- Number of persons.
- Token (a `TKN…` number).
- The scheduled slot time (if any).
- A one-line description of the grievance (if there is one).
- Current attendance state: Expected / Came / Not Came / Rescheduled.
- An action to mark **Came** and an action to mark **Not Came**.
- If the current state is Came or Not Came, tapping that same action
  reverts to Expected.
- The action updates optimistically and re-syncs from the server. If the
  write fails, the user is told and the row snaps back.

For **referrals**, each entry must present:
- Name.
- Referred-by name.
- Reason.
- Attendance state (Pending / Came / Not Came).
- The same Came / Not Came / revert actions.

### 4.4 Live summary counts
Above the list — how many are **expected**, how many have **come**, how many
are **not come**. Updates as the list refreshes.

### 4.5 Search
One search input that filters the current list by name, mobile, token, or
(for referrals) referred-by. Client-side, instant.

### 4.6 Offline behaviour
- The list keeps working from the cached shell when the network is down.
- A visible offline notice appears when a fetch fails; it clears when
  connectivity returns.
- Writes (attendance updates, walk-in submits) always require network.
  A failed write must show a "try again" message and leave the local
  state as it was.

### 4.7 Empty state
When there are no visitors for today, the list must present a clear
"nothing yet" message (bilingual).

### 4.8 Register a walk-in visitor (the big one)
A single entry point (always reachable) that opens an intake form. In one
form, the operator can:

- Enter the citizen's **name** (required).
- Enter the citizen's **mobile** (optional — citizens may not have one).
- Choose a **category** (required). The list of allowed categories:
  action required, proposals, transfer requests, pension requests,
  school admission, job requests, RTI, associations/unions,
  school upgradation, invitation, greetings, general, other.
- Type the **grievance** (optional — describe what the citizen is
  asking for).
- Attach **photo(s)** of a paper petition (optional — via the phone
  camera or gallery; multiple allowed).
- Optionally **book a meeting slot** — see 4.8.a below.

At least one of grievance, photo, or slot must be provided. The form
must tell the operator when something required is missing, before the
network call.

The submit action must be **adaptive**:
- If a meeting slot is picked, the action is "Book appointment".
- Otherwise, the action is "Submit petition".

#### 4.8.a Live meeting-slot picker (inside the intake form)
Always visible (not behind a toggle). The operator must be able to see
real-time availability and tell the citizen up front whether a meeting
is possible today or in the next few days.

- A row of **open future dates** (real dates from the scheduling system).
  One is selected at a time.
- For the selected date, a grid of **time slots**, each with:
  - The slot's time window (e.g. "08:00 – 08:30").
  - How many seats remain vs. capacity.
  - Whether the slot is open, full, or blocked.
- Full and blocked slots cannot be selected.
- One slot at a time is selectable. Tapping the selected slot deselects it
  (returns to petition-only mode).
- Live-refreshes every few seconds while the form is open (a slot can fill
  in the middle of intake).
- A clear message per day: how many slots are open, or "No slots
  available for this day".
- When a slot is selected, a **persons picker** appears (1–4).

#### 4.8.b Ticket / receipt on success
After the submit succeeds, the intake sheet swaps to a **ticket** screen
that the operator reads out to the citizen. It must present:

- The generated **token** (large, unambiguous).
- The **result state** — one of:
  - "Scheduled" with the date and time.
  - "Added to waiting queue".
  - "Petition submitted" (petition-only).
- An action to close the ticket (which returns the operator to the feed
  with the new visitor already appearing).

### 4.9 Feedback messages
Short, dismissible messages ("toasts") for confirmations and errors —
attendance updated, reverted, validation errors, network failure.
Non-modal, self-dismissing.

## 5. Business rules the design must respect

- **AI summarisation is only triggered when a photo is attached.** A pure
  appointment booking and a text-only petition must not fire AI. Nothing
  in the UI needs to expose this — but the ticket screen should not
  promise AI classification when none was requested.
- **Mobile number is optional** for walk-ins (phone-less citizens).
- **Category is required** — the operator picks it up front regardless of
  whether the citizen speaks/writes clearly.
- **Waiting fallback** — if the operator picks a slot that happens to
  become full during the flow, the system silently books the citizen
  into the waiting queue; the ticket screen must say "Added to waiting
  queue" instead of "Scheduled".
- **Attendance actions are reversible** — tapping the active state
  reverts to the neutral Expected/Pending state.
- **Everything is bilingual.** Both English and Tamil must always be
  present for every user-visible string. Layout must accommodate the
  Tamil version being roughly 20–30% longer than the English.
- **Never expose or cache citizen PII beyond the session.** The design
  should not add screens that persist names, mobiles, or grievance text
  to the device.

## 6. Non-negotiables for the design

- Mobile-first. Big, easy tap targets (the operator often has a pen in
  the other hand).
- One-handed operation for the primary actions (Came, Not Came, Add).
- No modals that trap the user — dismissible sheets/panels only.
- Fast to open — the app is used many times a day, in short bursts.
- Legible bilingual text — no clipping or overlap when Tamil is longer.
- Usable when writes are failing (feed keeps working, offline banner
  appears, retries succeed silently when the network returns).

## 7. What the design should improve (open direction)

- Make the daily availability status impossible to miss.
- Make the ticket / token screen feel like something the operator is
  comfortable reading out loud to a citizen.
- Compress the slot picker so 20 slots per day don't feel overwhelming.
- Make the empty state welcoming rather than blank.
- Give the language switch a first-class treatment (many operators use
  Tamil most of the day).
- Consider a proper Tamil display face.

## 8. Out of scope for the redesign

The following are backend or platform behaviours; the redesign must not
change them (but must accommodate them):

- The authentication mechanism (single shared floor login).
- The install / service-worker behaviour on Android, desktop, and iOS.
- The API contracts behind attendance updates, feed loads, slot lookups,
  and walk-in intake.
- The attendance vocabulary — Expected, Came, Not Came, Rescheduled,
  Pending. The redesign can change how they look, not what they mean.
