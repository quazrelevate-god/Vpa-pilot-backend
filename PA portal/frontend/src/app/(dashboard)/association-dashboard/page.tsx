"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Users, UsersRound, Inbox, CheckCircle2, Send, MapPin, Flame,
  Landmark, TrendingUp, Search, RefreshCw, Layers, Building2,
} from "lucide-react";

import TopBar from "@/components/TopBar";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import TamilNaduMap from "@/components/TamilNaduMap";
import { cn } from "@/lib/utils";
import { fetchMe } from "@/app/(dashboard)/settings/_lib/adminApi";
import {
  StatTile, ChartCard, BarBreakdown, DonutBreakdown, TrendArea, RankedList,
  NotAuthorized, C, fmtInt,
} from "@/components/insights/DashboardKit";
import {
  getAssociationAnalytics, listAssociations,
  type AssociationAnalytics, type AssociationRow,
} from "./_lib/api";

const STATUS_PILL: Record<string, { label: string; cls: string }> = {
  AWAITING_REVIEW: { label: "Awaiting", cls: "bg-amber-100 text-amber-800" },
  REVIEWED:        { label: "Reviewed", cls: "bg-emerald-100 text-emerald-700" },
  FORWARDED:       { label: "Forwarded", cls: "bg-sky-100 text-sky-700" },
};
const URGENCY_PILL: Record<string, string> = {
  critical: "bg-red-100 text-red-700", high: "bg-orange-100 text-orange-700",
  medium: "bg-amber-100 text-amber-700", low: "bg-slate-100 text-slate-600",
};
const TABS = [
  { key: "", label: "All" },
  { key: "AWAITING_REVIEW", label: "Awaiting" },
  { key: "REVIEWED", label: "Reviewed" },
  { key: "FORWARDED", label: "Forwarded" },
];

/** Compact big number: 12,000 → "12K", 1,20,000 → "1.2L". */
function human(n: number): string {
  if (n >= 1e7) return `${(n / 1e7).toFixed(1)}Cr`;
  if (n >= 1e5) return `${(n / 1e5).toFixed(1)}L`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return fmtInt(n);
}
function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }); }
  catch { return "—"; }
}

type Gate = "loading" | "denied" | "ok";

export default function AssociationDashboardPage() {
  const router = useRouter();
  const [gate, setGate] = useState<Gate>("loading");
  const [a, setA] = useState<AssociationAnalytics | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [updated, setUpdated] = useState<string | null>(null);
  const [district, setDistrict] = useState<string | undefined>(undefined);

  const [tab, setTab] = useState("");
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<AssociationRow[] | null>(null);

  useEffect(() => {
    const ac = new AbortController();
    (async () => {
      try {
        const me = await fetchMe(ac.signal);
        if (!me) { router.replace("/login"); return; }
        setGate(me.role === "super_admin" ? "ok" : "denied");
      } catch { if (!ac.signal.aborted) setGate("denied"); }
    })();
    return () => ac.abort();
  }, [router]);

  const loadAnalytics = useCallback(async (signal?: AbortSignal) => {
    try {
      const res = await getAssociationAnalytics(90, signal);
      if (!signal?.aborted) {
        setA(res); setErr(null);
        setUpdated(new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }));
      }
    } catch (e) { if (!signal?.aborted) setErr((e as Error).message); }
  }, []);

  useEffect(() => {
    if (gate !== "ok") return;
    const ac = new AbortController();
    loadAnalytics(ac.signal);
    const iv = setInterval(() => loadAnalytics(ac.signal), 20000);
    return () => { ac.abort(); clearInterval(iv); };
  }, [gate, loadAnalytics]);

  useEffect(() => {
    if (gate !== "ok") return;
    const ac = new AbortController();
    const id = setTimeout(() => {
      listAssociations({ status: tab || undefined, q: q || undefined, limit: 100 }, ac.signal)
        .then((r) => { if (!ac.signal.aborted) setRows(r.items); })
        .catch(() => { if (!ac.signal.aborted) setRows([]); });
    }, 250);
    return () => { ac.abort(); clearTimeout(id); };
  }, [gate, tab, q]);

  const k = a?.kpis;
  const trendSeries = useMemo(() => (a?.trend ?? []).map((p) => p.received), [a]);

  if (gate === "loading") {
    return <><TopBar title="Association Dashboard" subtitle="Loading…" icon={<Users className="h-4 w-4" />} /><div className="p-8"><Card className="h-40 animate-pulse" /></div></>;
  }
  if (gate === "denied") {
    return <><TopBar title="Association Dashboard" icon={<Users className="h-4 w-4" />} /><main className="flex-1 overflow-y-auto p-6"><NotAuthorized /></main></>;
  }

  return (
    <>
      <TopBar title="Association Dashboard"
        subtitle="Unions & collective bodies before the Hon’ble Minister"
        icon={<Users className="h-4 w-4" />} />
      <main className="flex-1 overflow-y-auto bg-background">
        <div className="mx-auto max-w-[1440px] space-y-3 px-3 py-4 sm:px-4">
          <div className="flex items-center justify-between gap-3 text-[13px]">
            <span className="inline-flex items-center gap-1.5 font-semibold text-foreground">
              <span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full rounded-full bg-[#34A26C] opacity-60" /><span className="relative inline-flex h-2 w-2 rounded-full bg-[#34A26C]" /></span>
              Live
              {updated && <span className="ml-2 font-normal text-muted-foreground">Updated {updated}</span>}
            </span>
            <Button variant="outline" size="sm" className="h-9 rounded-xl" onClick={() => loadAnalytics()}>
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
          </div>

          {err && <div className="rounded-lg border border-rose-300 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">{err}</div>}

          {/* KPI row — reach is the headline */}
          {!a ? (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
              {Array.from({ length: 6 }).map((_, i) => <Card key={i} className="h-[120px] animate-pulse" />)}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
              <StatTile icon={Users} tone="brand" label="Associations & unions" value={fmtInt(k?.total)}
                caption="all time" delta={k?.growth_pct} series={trendSeries} />
              <StatTile icon={UsersRound} tone="violet" label="Members represented" value={human(k?.members_represented ?? 0)}
                caption={`across ${fmtInt(k?.bodies_with_size)} bodies`} highlight />
              <StatTile icon={MapPin} tone="mint" label="Districts covered" value={fmtInt(k?.districts_covered)}
                caption="of 38" />
              <StatTile icon={Inbox} tone="amber" label="Awaiting review" value={fmtInt(k?.awaiting)} caption="on your desk" />
              <StatTile icon={CheckCircle2} tone="mint" label="Reviewed" value={fmtInt(k?.reviewed)} caption="acknowledged" />
              <StatTile icon={Send} tone="brand" label="Forwarded" value={fmtInt(k?.forwarded)} caption="to departments" />
            </div>
          )}

          {/* what they ask for + status */}
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
            <ChartCard icon={Layers} title="What are they asking for" sub="Collective demand by category" className="lg:col-span-2">
              <BarBreakdown data={a ? a.by_category : null} color={C.brand} empty="No association submissions yet" />
            </ChartCard>
            <ChartCard icon={CheckCircle2} title="Status" sub="Review pipeline">
              <DonutBreakdown data={a ? a.by_status : null} centerLabel="bodies"
                colors={["#B45309", "#0F8B4C", "#2F6FED"]} empty="No submissions yet" />
            </ChartCard>
          </div>

          {/* district map + ranked-by-district */}
          <ChartCard icon={MapPin} title="Where the voices come from" sub="Union activity across Tamil Nadu — click a district to focus">
            <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-[minmax(0,1fr)_240px]">
              <TamilNaduMap data={a ? a.by_district : null} activeKey={district} onSelect={(key) => setDistrict((d) => (d === key ? undefined : key))} />
              <div className="flex flex-col">
                <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Ranked by volume</div>
                {a && a.by_district.length > 0 ? (
                  <div className="max-h-[400px] space-y-0.5 overflow-y-auto pr-1">
                    {a.by_district.map((d, i) => (
                      <button key={d.key} onClick={() => setDistrict((cur) => (cur === d.key ? undefined : d.key))}
                        className={cn("flex w-full items-center justify-between rounded-md px-2 py-1.5 text-[12.5px] transition-colors hover:bg-muted/50",
                          district === d.key && "bg-brand/10 ring-1 ring-brand/20")}>
                        <span className="inline-flex min-w-0 items-center gap-2">
                          <span className="grid h-4 w-4 flex-shrink-0 place-items-center rounded bg-brand/10 font-mono text-[9px] font-bold text-brand">{i + 1}</span>
                          <span className="truncate text-foreground/90">{d.label}</span>
                        </span>
                        <span className="ml-2 flex-shrink-0 font-mono font-bold tabular-nums text-foreground">{fmtInt(d.count)}</span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="grid h-full min-h-[160px] place-items-center px-3 text-center">
                    <div className="space-y-1">
                      <MapPin className="mx-auto h-6 w-6 text-muted-foreground/40" />
                      <div className="text-[12px] font-medium text-muted-foreground">No districts yet</div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </ChartCard>

          {/* urgency + ministry + trend */}
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
            <ChartCard icon={Flame} title="Urgency mix" sub="How pressing the asks are">
              <DonutBreakdown data={a ? a.by_urgency : null} centerLabel="bodies"
                colors={["#C0362C", "#EE7327", "#D39412", "#64748B"]} empty="No urgency data yet" />
            </ChartCard>
            <ChartCard icon={Landmark} title="Routing ministry" sub="Where matters are directed">
              <BarBreakdown data={a ? a.by_ministry : null} color={C.violet} empty="No routing yet" max={6} />
            </ChartCard>
            <ChartCard icon={TrendingUp} title="Received" sub="Last 90 days">
              <TrendArea data={a ? a.trend : null} color={C.brand} label="Submissions" />
            </ChartCard>
          </div>

          {/* biggest unions */}
          <ChartCard icon={Building2} title="Biggest bodies" sub="Ranked by stated membership">
            <RankedList items={a ? a.top_associations : null}
              valueOf={(x) => `${human(x.members)}`} subOf={(x) => x.category || undefined}
              empty="No membership figures stated yet" />
          </ChartCard>

          {/* detail table */}
          <Card className="overflow-hidden p-0">
            <div className="flex flex-wrap items-center gap-2 border-b border-border p-4">
              <h2 className="type-card-heading">Every association</h2>
              <div className="ml-auto flex items-center gap-2">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search union / representative…"
                    className="h-9 w-60 rounded-xl border border-input bg-card pl-8 pr-3 text-[13px] shadow-card focus:border-brand focus:outline-none" />
                </div>
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5 border-b border-border px-4 py-2.5">
              {TABS.map((tb) => (
                <button key={tb.key || "all"} onClick={() => setTab(tb.key)}
                  className={cn("rounded-lg px-3 py-1.5 text-[12.5px] font-medium transition-colors",
                    tab === tb.key ? "bg-brand text-white" : "text-muted-foreground hover:bg-accent")}>
                  {tb.label}
                </button>
              ))}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] text-left text-sm">
                <thead className="bg-[#EDF1F8] text-[11px] uppercase tracking-[0.08em] text-muted-foreground/80">
                  <tr>
                    <th className="px-4 py-3">Association / Union</th>
                    <th className="px-4 py-3">Members</th>
                    <th className="px-4 py-3">Representative</th>
                    <th className="px-4 py-3">Asking for</th>
                    <th className="px-4 py-3">Urgency</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Received</th>
                  </tr>
                </thead>
                <tbody>
                  {rows == null ? (
                    <tr><td colSpan={7} className="px-4 py-10 text-center text-muted-foreground">Loading…</td></tr>
                  ) : rows.length === 0 ? (
                    <tr><td colSpan={7} className="px-4 py-14 text-center">
                      <Users className="mx-auto mb-2 h-7 w-7 text-muted-foreground/40" />
                      <div className="text-sm font-medium text-foreground">No association submissions yet</div>
                      <div className="text-[12.5px] text-muted-foreground">Scanned union documents classified as “association” will appear here.</div>
                    </td></tr>
                  ) : rows.map((r) => {
                    const st = STATUS_PILL[r.status] || { label: r.status, cls: "bg-slate-100 text-slate-600" };
                    return (
                      <tr key={r.id} className="border-t border-border/70 transition-colors hover:bg-[#EFF3FB]">
                        <td className="px-4 py-3"><div className="type-table-row truncate font-medium text-foreground">{r.association_name || "Unnamed body"}</div></td>
                        <td className="whitespace-nowrap px-4 py-3 font-mono text-[13px] tabular-nums text-foreground">{r.member_count || "—"}</td>
                        <td className="px-4 py-3 text-[13px] text-foreground/85">
                          {r.representative_name || "—"}
                          {r.representative_designation && <span className="block text-[11px] text-muted-foreground">{r.representative_designation}</span>}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-[13px] text-muted-foreground">{r.category ? r.category.replace(/_/g, " ") : "—"}</td>
                        <td className="px-4 py-3">
                          {r.urgency ? <span className={cn("inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize", URGENCY_PILL[r.urgency] || "bg-slate-100 text-slate-600")}>{r.urgency}</span> : <span className="text-muted-foreground">—</span>}
                        </td>
                        <td className="px-4 py-3"><span className={cn("inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-semibold", st.cls)}>{st.label}</span></td>
                        <td className="whitespace-nowrap px-4 py-3 text-[12.5px] tabular-nums text-muted-foreground">{fmtDate(r.created_at)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="border-t border-border px-4 py-2.5 text-[12px] text-muted-foreground">{rows?.length ?? 0} shown</div>
          </Card>
        </div>
      </main>
    </>
  );
}
