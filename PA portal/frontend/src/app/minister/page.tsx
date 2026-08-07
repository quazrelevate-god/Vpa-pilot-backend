"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useT } from "./_lib/i18n";
import { api, Unauthorized } from "./_lib/api";
import TopBar from "./_components/TopBar";
import Sidebar, { type Tab } from "./_components/Sidebar";
import InstallPrompt from "./_components/InstallPrompt";
import DashboardOverview from "./_components/DashboardOverview";
import ProposalsOverview from "./_components/ProposalsOverview";
import TicketsOverview from "./_components/TicketsOverview";
import AssociationsOverview from "./_components/AssociationsOverview";
import EventsScreen from "./_components/EventsScreen";

export default function MinisterApp() {
  const { t } = useT();
  const [gate, setGate] = useState<"loading" | "ok">("loading");
  const [tab, setTab] = useState<Tab>("home");
  // Side menu visibility. Open by default; a click on the dashboard tucks it
  // away for a full-width view, and the TopBar menu button brings it back.
  const [navOpen, setNavOpen] = useState(true);

  useEffect(() => {
    const ac = new AbortController();
    (async () => {
      try {
        await api.session(ac.signal);
        setGate("ok");
      } catch (e) {
        if (ac.signal.aborted) return;
        if (e instanceof Unauthorized) { window.location.href = "/minister/login"; return; }
        setGate("ok");
      }
    })();
    return () => ac.abort();
  }, []);

  if (gate === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-brand" />
      </div>
    );
  }

  const TITLES: Record<Tab, { title: string; subtitle?: string }> = {
    home:         { title: t("Office overview", "அலுவலக மேலோட்டம்"),  subtitle: t("Petitions, tickets, meetings — the whole desk.", "மனுக்கள், புகார்கள், சந்திப்புகள் — முழு மேசை.") },
    proposals:    { title: t("Proposals", "முன்மொழிவுகள்"),           subtitle: t("Every proposal before the Hon'ble Minister.", "மதிப்பிற்குரிய அமைச்சருக்கு எல்லா முன்மொழிவுகளும்.") },
    tickets:      { title: t("Tickets", "புகார்கள்"),                 subtitle: t("Grievance cases across every department.", "எல்லா துறைகளிலும் புகார் வழக்குகள்.") },
    associations: { title: t("Associations", "சங்கங்கள்"),            subtitle: t("Unions & collective bodies.", "சங்கங்கள் & கூட்டமைப்புகள்.") },
    events:       { title: t("Events", "நிகழ்வுகள்"),                 subtitle: t("The Minister's diary — overview + timeline.", "அமைச்சரின் நாட்குறிப்பு — மேலோட்டம் + காலவரிசை.") },
  };

  return (
    /* App shell: the whole window is fixed height and never scrolls. The side
       menu and the top bar stay put; ONLY <main> scrolls. (A sticky sidebar
       can't work here — the collapse animation needs overflow-hidden on its
       wrapper, and that breaks position:sticky.) */
    <div className="flex h-screen overflow-hidden">
      {/* Animated side-menu column — collapses to zero width for a full-screen
          dashboard; the TopBar menu button brings it back. */}
      <div className={cn(
        "h-full shrink-0 overflow-hidden transition-[width] duration-200 ease-out",
        navOpen ? "w-[240px]" : "w-0",
      )}>
        <Sidebar tab={tab} onTab={setTab} />
      </div>

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <TopBar
          title={TITLES[tab].title}
          subtitle={TITLES[tab].subtitle}
          onMenu={() => setNavOpen((o) => !o)}
          navOpen={navOpen}
        />
        {/* A click anywhere on the dashboard tucks the menu away for full width. */}
        <main
          data-minister-scroll=""
          onClickCapture={() => { if (navOpen) setNavOpen(false); }}
          className="min-w-0 flex-1 overflow-y-auto overflow-x-hidden px-6 py-5"
        >
          <div className="mx-auto w-full max-w-[1440px]">
            {tab === "home" && (
              <div className="mb-4"><InstallPrompt /></div>
            )}
            {tab === "home" && <DashboardOverview />}
            {tab === "proposals" && <ProposalsOverview />}
            {tab === "tickets" && <TicketsOverview />}
            {tab === "associations" && <AssociationsOverview />}
            {tab === "events" && <EventsScreen />}
          </div>
        </main>
      </div>
    </div>
  );
}
