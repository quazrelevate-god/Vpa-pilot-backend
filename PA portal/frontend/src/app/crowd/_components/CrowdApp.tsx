"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { useT } from "../_lib/i18n";
import { api, todayISO, nowTime } from "../_lib/api";
import type { ApptFeed, RefFeed, Availability, IntakeResult } from "../_lib/types";

import BottomNav from "./BottomNav";
import CrowdTopBar from "./CrowdTopBar";
import ListScreen from "./ListScreen";
import RegisterWizard from "./RegisterWizard";
import TicketScreen from "./TicketScreen";
import OfflineScreen from "./OfflineScreen";
import InstallSheet from "./InstallSheet";

export type View = "list" | "wizard" | "ticket";
export type Tab = "appt" | "ref";

type BeforeInstallPromptEvent = Event & {
  prompt: () => void;
  userChoice: Promise<{ outcome: string }>;
};

export default function CrowdApp() {
  const router = useRouter();
  const { t } = useT();

  const [view, setView] = useState<View>("list");
  const [tab, setTab] = useState<Tab>("appt");
  const [appt, setAppt] = useState<ApptFeed | null>(null);
  const [refs, setRefs] = useState<RefFeed | null>(null);
  const [avail, setAvail] = useState<Availability>({ seats: 0, slots: 0, open: false, offline: false });
  const [offline, setOffline] = useState(false);
  const [ticket, setTicket] = useState<IntakeResult | null>(null);
  const [installSheet, setInstallSheet] = useState(false);
  const deferred = useRef<BeforeInstallPromptEvent | null>(null);

  const gotoLogin = useCallback(() => { router.push("/crowd/login"); router.refresh(); }, [router]);
  const is401 = (e: unknown) => (e as { status?: number })?.status === 401;

  const load = useCallback(async () => {
    const [a, r] = await Promise.allSettled([api.today(), api.refs()]);
    if (a.status === "fulfilled") setAppt(a.value);
    if (r.status === "fulfilled") setRefs(r.value);
    if (is401(a.status === "rejected" ? a.reason : null) || is401(r.status === "rejected" ? r.reason : null)) {
      gotoLogin();
      return;
    }
    setOffline(a.status === "rejected" && r.status === "rejected");
  }, [gotoLogin]);

  const loadAvail = useCallback(async () => {
    try {
      const data = await api.slots(todayISO());
      const open = (data.slots || []).filter((s) => s.available && s.remaining > 0);
      setAvail({
        seats: open.reduce((n, s) => n + s.remaining, 0),
        slots: open.length,
        open: open.length > 0,
        offline: false,
        updated: nowTime(),
      });
    } catch {
      setAvail((v) => ({ ...v, offline: true }));
    }
  }, []);

  // Initial load + polling + lifecycle listeners.
  useEffect(() => {
    load();
    loadAvail();
    const t1 = setInterval(load, 12000);
    const t2 = setInterval(loadAvail, 30000);
    const onOnline = () => { setOffline(false); load(); loadAvail(); };
    const onOffline = () => setOffline(true);
    const onVis = () => { if (!document.hidden) { load(); loadAvail(); } };
    const onInstall = (e: Event) => { e.preventDefault(); deferred.current = e as BeforeInstallPromptEvent; };
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("beforeinstallprompt", onInstall);
    return () => {
      clearInterval(t1); clearInterval(t2);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("beforeinstallprompt", onInstall);
    };
  }, [load, loadAvail]);

  const go = useCallback((v: View) => { setView(v); window.scrollTo(0, 0); }, []);
  const goList = useCallback((tb: Tab) => { setTab(tb); go("list"); }, [go]);

  // Optimistic attendance toggle (toggle-to-revert), mirrors the tested flow.
  const onMark = useCallback((isAppt: boolean, id: number, wantCame: boolean) => {
    if (isAppt) {
      const it = appt?.items.find((x) => x.id === id);
      if (!it) return;
      const cur = it.status_db;
      const courtesy = ["invitation", "greetings"].includes((it.category_key || "").toLowerCase());
      // For courtesy, the terminal "came" state is COURTESY_DONE, not AWAITING_REVIEW.
      const activeCame = courtesy ? cur === "COURTESY_DONE" : (cur === "AWAITING_REVIEW" || cur === "CAME");
      const activeNo = cur === "NOT_CAME";
      const already = (wantCame && activeCame) || (!wantCame && activeNo);
      const newState = already
        ? "SCHEDULED"
        : wantCame
          ? (courtesy ? "COURTESY_DONE" : "AWAITING_REVIEW")
          : "NOT_CAME";
      const payload = already ? "Reset" : wantCame ? "Came" : "Not Came";
      setAppt((p) => (p ? { ...p, items: p.items.map((x) => (x.id === id ? { ...x, status_db: newState } : x)) } : p));
      api.markAppt(id, payload)
        .then(() => { toast.success(already ? t("Reverted", "மீட்டமை") : t("Updated", "புதுப்பிக்கப்பட்டது")); load(); })
        .catch((e) => { if (is401(e)) return gotoLogin(); toast.error(t("Offline — try again", "இணைப்பு இல்லை — மீண்டும்")); load(); });
    } else {
      const it = refs?.items.find((x) => x.id === id);
      if (!it) return;
      const cur = (it.status || "").toUpperCase();
      const already = (wantCame && cur === "CAME") || (!wantCame && cur === "NOT_CAME");
      const newState = already ? "PENDING" : wantCame ? "CAME" : "NOT_CAME";
      setRefs((p) => (p ? { ...p, items: p.items.map((x) => (x.id === id ? { ...x, status: newState } : x)) } : p));
      api.markRef(id, newState)
        .then(() => { toast.success(already ? t("Reverted", "மீட்டமை") : t("Updated", "புதுப்பிக்கப்பட்டது")); load(); })
        .catch((e) => { if (is401(e)) return gotoLogin(); toast.error(t("Offline — try again", "இணைப்பு இல்லை — மீண்டும்")); load(); });
    }
  }, [appt, refs, load, gotoLogin, t]);

  function promptInstall() {
    const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
    const standalone = window.matchMedia("(display-mode: standalone)").matches
      || (navigator as unknown as { standalone?: boolean }).standalone === true;
    if (standalone) { toast.success(t("Already installed", "நிறுவப்பட்டது")); return; }
    if (deferred.current) {
      deferred.current.prompt();
      deferred.current.userChoice.finally(() => { deferred.current = null; });
    } else if (isIOS) {
      setInstallSheet(true);
    } else {
      toast(t("Use browser menu → Install", 'உலாவி மெனு → "நிறுவு"'));
    }
  }

  async function signOut() {
    try { await api.logout(); } catch {}
    gotoLogin();
  }

  // The wizard keeps the chrome (top bar + bottom nav); only the ticket
  // success screen goes full-bleed.
  const chromeless = view === "ticket";

  return (
    <>
      {offline && !appt && !refs ? (
        <OfflineScreen onRetry={() => { load(); loadAvail(); }} />
      ) : (
        <>
          {!chromeless && (
            <CrowdTopBar
              avail={avail}
              onInstall={promptInstall}
              onRefresh={() => { load(); loadAvail(); toast(t("Refreshing…", "புதுப்பிக்கிறது…")); }}
              onSignOut={signOut}
            />
          )}
          {view === "list" ? (
            <ListScreen
              tab={tab} appt={appt} refs={refs} offline={offline}
              onMark={onMark}
            />
          ) : view === "wizard" ? (
            <RegisterWizard
              onDone={(tk) => { setTicket(tk); go("ticket"); load(); loadAvail(); }}
            />
          ) : view === "ticket" ? (
            <TicketScreen data={ticket} onDone={() => { setTicket(null); goList("appt"); }} />
          ) : null}
        </>
      )}

      {!chromeless && (
        <BottomNav view={view} tab={tab} onList={goList} onRegister={() => go("wizard")} />
      )}

      {installSheet && <InstallSheet onClose={() => setInstallSheet(false)} />}
    </>
  );
}
