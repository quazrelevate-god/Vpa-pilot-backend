"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, type EventsRole } from "../_lib/api";
import type { EventItem } from "../_lib/types";
import TopBar from "./TopBar";
import BottomNav from "./BottomNav";
import CalendarScreen from "./CalendarScreen";
import OverviewScreen from "./OverviewScreen";
import NeedsReviewScreen from "./NeedsReviewScreen";
import EventPopup from "./EventPopup";
import RemindersBanner from "./RemindersBanner";
import { useEventReminders } from "../_lib/reminders";

export type View = "overview" | "calendar" | "review";

export default function EventsApp() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [roles, setRoles] = useState<EventsRole[]>([]);
  const [view, setView] = useState<View>("calendar");
  const [reviewCount, setReviewCount] = useState(0);
  const [selected, setSelected] = useState<EventItem | null>(null);
  // Bumped after any mutation (upload/edit/delete/retry) so screens refetch.
  const [refreshKey, setRefreshKey] = useState(0);

  // canApprove gates the reviewer-only Approve action (banner in the popup,
  // pill button on each Needs Review row). Uploader-only accounts still see
  // the queue and can edit/delete/retry — the backend enforces the same rule.
  const canApprove = roles.includes("event_reviewer");
  // Any events role can see the queue; only a real events login reaches this
  // component at all, so hasEventsAccess === (uploader OR reviewer).
  const hasEventsAccess = roles.length > 0;

  // Reminders are a reviewer-role feature: the hook silently subscribes
  // when permission is already granted, and surfaces the state so the
  // banner below can prompt the user for a click-driven grant when it's
  // still `default`. Guard on `ready` so we don't POST /session in a race.
  const { permission: reminderPermission, enable: enableReminders, busy: reminderBusy } =
    useEventReminders(ready && canApprove);

  // Session gate: the middleware already redirects logged-out page loads, but
  // an expired cookie mid-session surfaces here as a 401 → back to login.
  useEffect(() => {
    api.session()
      .then((s) => {
        setRoles(s.roles ?? []);
        setReady(true);
      })
      .catch(() => router.replace("/events/login"));
  }, [router]);

  // If someone landed on the review tab without any events access at all
  // (impossible in practice, but keeps the state machine honest), send them
  // home. Both uploader and reviewer roles are welcome on this tab now.
  useEffect(() => {
    if (ready && view === "review" && !hasEventsAccess) setView("overview");
  }, [ready, view, hasEventsAccess]);

  const refreshBadge = useCallback(() => {
    // Both roles can now read the queue; the badge should follow suit.
    if (!hasEventsAccess) { setReviewCount(0); return; }
    api.needsReview().then((d) => setReviewCount(d.count)).catch(() => {});
  }, [hasEventsAccess]);

  useEffect(() => {
    if (!ready) return;
    refreshBadge();
    const id = setInterval(refreshBadge, 30_000);
    return () => clearInterval(id);
  }, [ready, refreshBadge, refreshKey, view]);

  const bumpRefresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  async function logout() {
    await api.logout();
    router.replace("/events/login");
  }

  if (!ready) {
    return (
      <div className="grid min-h-0 flex-1 place-items-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#21395B] border-t-transparent" />
      </div>
    );
  }

  // The wrapper is a flex column sized by its fixed-height parent (see
  // events/layout.tsx). TopBar + RemindersBanner sit at the top as
  // non-scrolling blocks; <main> takes the remaining space and scrolls
  // internally; BottomNav is fixed to the viewport bottom, so it stays out
  // of the flex flow and out of the scroll region. Result: no page-level
  // scroll, no elastic bounce, chrome always visible.
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <TopBar onLogout={logout} />

      {canApprove && (
        <RemindersBanner
          permission={reminderPermission}
          busy={reminderBusy}
          onEnable={enableReminders}
        />
      )}

      {/* <main> is a fixed-height column between the header and the nav —
          neither of which can be covered any more. It doesn't scroll itself;
          each active screen owns its own internal scroll region (the week
          timeline in CalendarScreen, the list in NeedsReviewScreen, the
          agenda in OverviewScreen), so only the part that actually needs to
          move actually moves. */}
      <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {view === "overview" && <OverviewScreen canApprove={canApprove} />}
        {view === "calendar" && (
          <CalendarScreen refreshKey={refreshKey} onOpen={setSelected} onSent={bumpRefresh} />
        )}
        {view === "review" && hasEventsAccess && (
          <NeedsReviewScreen refreshKey={refreshKey} onOpen={setSelected} canApprove={canApprove} />
        )}
      </main>

      <BottomNav view={view} reviewCount={reviewCount} showReviewTab={hasEventsAccess} onChange={setView} />

      <EventPopup
        event={selected}
        canApprove={canApprove}
        onClose={() => setSelected(null)}
        onChanged={(updated) => { setSelected(updated); bumpRefresh(); }}
        onDeleted={() => { setSelected(null); bumpRefresh(); }}
      />
    </div>
  );
}
