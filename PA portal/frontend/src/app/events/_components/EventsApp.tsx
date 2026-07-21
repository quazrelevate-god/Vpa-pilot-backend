"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "../_lib/api";
import type { EventItem } from "../_lib/types";
import TopBar from "./TopBar";
import BottomNav from "./BottomNav";
import CalendarScreen from "./CalendarScreen";
import CaptureScreen from "./CaptureScreen";
import NeedsReviewScreen from "./NeedsReviewScreen";
import EventPopup from "./EventPopup";

export type View = "calendar" | "capture" | "review";

export default function EventsApp() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [view, setView] = useState<View>("calendar");
  const [reviewCount, setReviewCount] = useState(0);
  const [selected, setSelected] = useState<EventItem | null>(null);
  // Bumped after any mutation (upload/edit/delete/retry) so screens refetch.
  const [refreshKey, setRefreshKey] = useState(0);

  // Session gate: the middleware already redirects logged-out page loads, but
  // an expired cookie mid-session surfaces here as a 401 → back to login.
  useEffect(() => {
    api.session()
      .then(() => setReady(true))
      .catch(() => router.replace("/events/login"));
  }, [router]);

  const refreshBadge = useCallback(() => {
    api.needsReview().then((d) => setReviewCount(d.count)).catch(() => {});
  }, []);

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

      <main className="flex-1 pb-[calc(var(--nav-h)+env(safe-area-inset-bottom)+8px)]">
        {view === "calendar" && (
          <CalendarScreen refreshKey={refreshKey} onOpen={setSelected} />
        )}
        {view === "capture" && (
          <CaptureScreen
            onSent={() => { bumpRefresh(); setView("calendar"); }}
          />
        )}
        {view === "review" && (
          <NeedsReviewScreen refreshKey={refreshKey} onOpen={setSelected} />
        )}
      </main>

      <BottomNav view={view} reviewCount={reviewCount} onChange={setView} />

      <EventPopup
        event={selected}
        onClose={() => setSelected(null)}
        onChanged={(updated) => { setSelected(updated); bumpRefresh(); }}
        onDeleted={() => { setSelected(null); bumpRefresh(); }}
      />
    </div>
  );
}
