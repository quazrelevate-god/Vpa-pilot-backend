"use client";

/**
 * Department workspace — the one page a department team lives in.
 *
 * Composition:
 *   DeptTopBar      · sticky top with dept name + language toggle + sign out
 *   KpiHero         · 4-card summary: To Accept / In Progress / Resolved this week / SLA breached
 *   TicketList      · segmented tabs + search + priority chips + rich rows
 *   TicketDetail    · slide-in drawer with overview, summary (En/Ta), attachments,
 *                     timeline, and a state-dependent action bar
 *
 * Auto-refreshes every 30s. All data is fetched through the typed api.ts client;
 * SLA + resolved-this-week are computed client-side from the raw ticket list.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import DeptTopBar from "./_components/DeptTopBar";
import KpiHero from "./_components/KpiHero";
import TicketList from "./_components/TicketList";
import TicketDetail from "./_components/TicketDetail";
import {
  fetchSession, listTickets, fetchCounts, fetchTicket,
  fetchDepartments, logout, slaFor,
  type DeptTicket, type DeptTicketDetail, type DeptOption,
} from "./_lib/api";

const REFRESH_MS = 30_000;

export default function DepartmentPage() {
  const router = useRouter();

  const [label, setLabel]         = useState("");
  const [myDept, setMyDept]       = useState("");
  // Default landing is In Progress — that's the desk's live work.
  const [seg, setSeg]             = useState("in_progress");
  const [tickets, setTickets]     = useState<DeptTicket[]>([]);
  const [allTickets, setAllTickets] = useState<DeptTicket[]>([]);
  const [counts, setCounts]       = useState<Record<string, number>>({});
  const [departments, setDepartments] = useState<DeptOption[]>([]);
  const [detail, setDetail]       = useState<DeptTicketDetail | null>(null);
  const [loading, setLoading]     = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery]         = useState("");
  const [priority, setPriority]   = useState("");

  // Bootstrap session + departments + first fetch.
  useEffect(() => {
    const ac = new AbortController();
    (async () => {
      const sess = await fetchSession(ac.signal).catch(() => null);
      if (!sess) { router.replace("/department/login"); return; }
      setLabel(sess.label);
      setMyDept(sess.department);
      try {
        setDepartments(await fetchDepartments());
      } catch { /* fine — Forward will just show empty */ }
    })();
    return () => ac.abort();
  }, [router]);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    try {
      const [rows, cts, allRows] = await Promise.all([
        listTickets(seg),
        fetchCounts(),
        // Also pull EVERYTHING so KPI hero can compute SLA breached + resolved this week
        // across statuses. The endpoint is server-scoped to the dept so scope is right.
        listTickets(""),
      ]);
      setTickets(rows);
      setCounts(cts);
      setAllTickets(allRows);
    } catch (e) {
      if (!silent) toast.error("Couldn't load tickets", { description: (e as Error).message });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [seg]);

  useEffect(() => { load(); }, [load]);

  // Live-refresh every 30 seconds; skip while a drawer is open so the user
  // doesn't get their action stolen by a re-render.
  useEffect(() => {
    if (detail) return;
    const id = setInterval(() => load(true), REFRESH_MS);
    return () => clearInterval(id);
  }, [detail, load]);

  const open = async (id: number) => {
    try {
      const d = await fetchTicket(id);
      setDetail(d);
    } catch (e) {
      toast.error("Couldn't load ticket", { description: (e as Error).message });
    }
  };

  const doLogout = async () => {
    await logout();
    router.push("/department/login");
  };

  const jumpFromKpi = (segment: string) => {
    if (segment === "__breached") {
      // No dedicated tab for SLA-breached — they live inside To Accept and
      // In Progress. Reset filters so the row sort (breached-first) surfaces
      // them at the top of whatever the user is currently on.
      setPriority("");
      setQuery("");
      toast.info("Breached tickets are at the top of your list.");
      return;
    }
    setSeg(segment);
    setPriority("");
    setQuery("");
  };

  // Sort: SLA-breached at top when we're on the KPI-driven "all" view, else by
  // created_at desc. Small QoL — the user probably wants urgent stuff first.
  const sorted = useMemo(() => {
    return [...tickets].sort((a, b) => {
      const sa = slaFor(a.created_at, a.priority);
      const sb = slaFor(b.created_at, b.priority);
      const aBreached = sa?.breached ? 1 : 0;
      const bBreached = sb?.breached ? 1 : 0;
      if (aBreached !== bBreached) return bBreached - aBreached;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
  }, [tickets]);

  return (
    <>
      <DeptTopBar
        label={label}
        onRefresh={() => load(true)}
        refreshing={refreshing}
        onSignOut={doLogout}
      />

      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-6xl space-y-5 px-6 py-6 sm:px-10 sm:py-8">
          <KpiHero
            counts={counts}
            allTickets={allTickets}
            onJump={jumpFromKpi}
            activeSeg={seg}
          />
          <TicketList
            rows={sorted}
            loading={loading}
            segment={seg}
            counts={counts}
            onOpen={open}
            onSegmentChange={(s) => { setSeg(s); setPriority(""); setQuery(""); }}
            query={query}
            onQuery={setQuery}
            priority={priority}
            onPriority={setPriority}
          />
        </div>
      </main>

      {detail && (
        <TicketDetail
          detail={detail}
          departments={departments}
          myDept={myDept}
          onClose={() => setDetail(null)}
          onDone={() => { setDetail(null); load(); }}
        />
      )}
    </>
  );
}
