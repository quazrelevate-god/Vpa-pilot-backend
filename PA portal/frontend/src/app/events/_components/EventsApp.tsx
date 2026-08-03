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

  const canReview = roles.includes("event_reviewer");

  // Reminders are a reviewer-role feature: the hook silently subscribes
  // when permission is already granted, and surfaces the state so the
  // banner below can prompt the user for a click-driven grant when it's
  // still `default`. Guard on `ready` so we don't POST /session in a race.
  const { permission: reminderPermission, enable: enableReminders, busy: reminderBusy } =
    useEventReminders(ready && canReview);

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

  // If the user landed on the review tab but no longer has the reviewer role
  // (or the initial view state is review for a non-reviewer), send them home.
  useEffect(() => {
    if (ready && view === "review" && !canReview) setView("overview");
  }, [ready, view, canReview]);

  const refreshBadge = useCallback(() => {
    // Only reviewers can see the review queue, so only they need the badge —
    // needs-review is 403 for uploaders anyway, so calling it would 403-loop.
    if (!canReview) { setReviewCount(0); return; }
    api.needsReview().then((d) => setReviewCount(d.count)).catch(() => {});
  }, [canReview]);

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
      <div className="grid min-h-screen place-items-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#21395B] border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col">
      <TopBar onLogout={logout} />

      {canReview && (
        <RemindersBanner
          permission={reminderPermission}
          busy={reminderBusy}
          onEnable={enableReminders}
        />
      )}

      <main className="flex-1 pb-[calc(var(--nav-h)+env(safe-area-inset-bottom)+8px)]">
        {view === "overview" && <OverviewScreen />}
        {view === "calendar" && (
          <CalendarScreen refreshKey={refreshKey} onOpen={setSelected} onSent={bumpRefresh} />
        )}
        {view === "review" && canReview && (
          <NeedsReviewScreen refreshKey={refreshKey} onOpen={setSelected} />
        )}
      </main>

      <BottomNav view={view} reviewCount={reviewCount} canReview={canReview} onChange={setView} />

      <EventPopup
        event={selected}
        onClose={() => setSelected(null)}
        onChanged={(updated) => { setSelected(updated); bumpRefresh(); }}
        onDeleted={() => { setSelected(null); bumpRefresh(); }}
      />
    </div>
  );
}
