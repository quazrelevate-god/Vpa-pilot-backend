"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Lightbulb, Inbox, CheckCircle2, XCircle, HelpCircle, IndianRupee,
  Layers, Sparkles, TrendingUp, Building2, Search, RefreshCw, ArrowRight, Landmark,
} from "lucide-react";

import TopBar from "@/components/TopBar";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { fetchMe } from "@/app/(dashboard)/settings/_lib/adminApi";
import {
  StatTile, ChartCard, BarBreakdown, DonutBreakdown, TrendArea, RankedList,
  NotAuthorized, C, SERIES, fmtInt,
} from "@/components/insights/DashboardKit";
import {
  getProposalAnalytics, listProposals,
  type ProposalAnalytics, type ProposalRow,
} from "./_lib/api";

const CAT_LABEL: Record<string, string> = {
  school: "School Education", tamil: "Tamil & Heritage",
  information: "Information & Publicity", film: "Film",
};
const STATUS_PILL: Record<string, { label: string; cls: string }> = {
  QUEUED:              { label: "Queued",        cls: "bg-slate-100 text-slate-600" },
  PROCESSING:          { label: "Reading",       cls: "bg-sky-100 text-sky-700" },
  AWAITING_REVIEW:     { label: "Awaiting",      cls: "bg-amber-100 text-amber-800" },
  FAILED:              { label: "Failed",        cls: "bg-red-100 text-red-700" },
  APPROVED:            { label: "Approved",      cls: "bg-emerald-100 text-emerald-700" },
  REJECTED:            { label: "Rejected",      cls: "bg-red-100 text-red-700" },
  NEEDS_CLARIFICATION: { label: "Needs info",    cls: "bg-orange-100 text-orange-800" },
};
const REC_PILL: Record<string, { label: string; cls: string }> = {
  review_closely:  { label: "Review closely", cls: "border-violet-300 bg-violet-50 text-violet-700" },
  standard:        { label: "Standard",       cls: "border-slate-300 bg-slate-50 text-slate-600" },
  needs_more_info: { label: "Needs more info", cls: "border-amber-300 bg-amber-50 text-amber-700" },
};
const TABS = [
  { key: "", label: "All" },
  { key: "AWAITING_REVIEW", label: "Awaiting" },
  { key: "APPROVED", label: "Approved" },
  { key: "REJECTED", label: "Rejected" },
  { key: "NEEDS_CLARIFICATION", label: "Needs info" },
];

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }); }
  catch { return "—"; }
}

type Gate = "loading" | "denied" | "ok";

export default function ProposalDashboardPage() {
  const router = useRouter();
  const [gate, setGate] = useState<Gate>("loading");
  const [a, setA] = useState<ProposalAnalytics | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [updated, setUpdated] = useState<string | null>(null);

  // table
  const [tab, setTab] = useState("");
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<ProposalRow[] | null>(null);

  // ── gate ──
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
      const res = await getProposalAnalytics(90, signal);
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

  // table load (debounced on q)
  useEffect(() => {
    if (gate !== "ok") return;
    const ac = new AbortController();
    const id = setTimeout(() => {
      listProposals({ status: tab || undefined, q: q || undefined, limit: 100 }, ac.signal)
        .then((r) => { if (!ac.signal.aborted) setRows(r.items); })
        .catch(() => { if (!ac.signal.aborted) setRows([]); });
    }, 250);
    return () => { ac.abort(); clearTimeout(id); };
  }, [gate, tab, q]);

  const k = a?.kpis;
  const trendSeries = useMemo(() => (a?.trend ?? []).map((p) => p.received), [a]);

  if (gate === "loading") {
    return <><TopBar title="Proposal Dashboard" subtitle="Loading…" icon={<Lightbulb className="h-4 w-4" />} /><div className="p-8"><Card className="h-40 animate-pulse" /></div></>;
  }
  if (gate === "denied") {
    return <><TopBar title="Proposal Dashboard" icon={<Lightbulb className="h-4 w-4" />} /><main className="flex-1 overflow-y-auto p-6"><NotAuthorized /></main></>;
  }

  return (
    <>
      <TopBar title="Proposal Dashboard"
        subtitle="Ideas to the Hon’ble Minister — the full picture at a glance"
        icon={<Lightbulb className="h-4 w-4" />} />
      <main className="flex-1 overflow-y-auto bg-background">
        <div className="mx-auto max-w-[1440px] space-y-3 px-3 py-4 sm:px-4">
          {/* live · refresh */}
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

          {/* KPI row */}
          {!a ? (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
              {Array.from({ length: 6 }).map((_, i) => <Card key={i} className="h-[120px] animate-pulse" />)}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
              <StatTile icon={Lightbulb} tone="brand" label="Total proposals" value={fmtInt(k?.total)}
                caption="all time" delta={k?.growth_pct} series={trendSeries} />
              <StatTile icon={Inbox} tone="amber" label="Awaiting your decision" value={fmtInt(k?.awaiting)}
                caption="on your desk" highlight />
              <StatTile icon={CheckCircle2} tone="mint" label="Approved" value={fmtInt(k?.approved)}
                caption={`${k?.approval_rate ?? 0}% approval rate`} />
              <StatTile icon={XCircle} tone="rose" label="Rejected" value={fmtInt(k?.rejected)} caption="declined" />
              <StatTile icon={HelpCircle} tone="amber" label="Needs clarification" value={fmtInt(k?.needs_clarification)} caption="sent back" />
              <StatTile icon={IndianRupee} tone="violet" label="With a stated cost" value={fmtInt(k?.with_cost)}
                caption={`of ${fmtInt(k?.total)} proposals`} />
            </div>
          )}

          {/* decision donut + AI recommendation */}
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <ChartCard icon={Layers} title="Where each proposal stands"
              sub="The Minister’s decision pipeline">
              <DonutBreakdown data={a ? a.by_status : null} centerLabel="proposals"
                colors={["#B45309", "#0F8B4C", "#C0362C", "#EA8C0C"]} empty="No proposals yet" />
            </ChartCard>
            <ChartCard icon={Sparkles} title="What the AI flagged"
              sub="A triage hint — never a decision">
              <DonutBreakdown data={a ? a.by_recommendation : null} centerLabel="briefs"
                colors={["#6D28D9", "#64748B", "#B45309"]} empty="No AI briefs yet" />
            </ChartCard>
          </div>

          {/* portfolio bars + trend */}
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <ChartCard icon={Landmark} title="By portfolio"
              sub="Which desk each idea targets">
              <BarBreakdown data={a ? a.by_category : null} color={C.brand} empty="No proposals yet" />
            </ChartCard>
            <ChartCard icon={TrendingUp} title="Proposals received"
              sub="Last 90 days">
              <TrendArea data={a ? a.trend : null} color={C.brand} label="Proposals" />
            </ChartCard>
          </div>

          {/* approval by portfolio + top orgs */}
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <ChartCard icon={CheckCircle2} title="Decision split by portfolio"
              sub="Approved vs rejected, where decided">
              {a && a.approval_by_category.length > 0 ? (
                <div className="space-y-3">
                  {a.approval_by_category.map((r) => {
                    const tot = r.approved + r.rejected;
                    return (
                      <div key={r.key}>
                        <div className="mb-1 flex items-baseline justify-between gap-3 text-[13px]">
                          <span className="truncate text-foreground/85">{r.label}</span>
                          <span className="shrink-0 font-mono text-[12px] tabular-nums">
                            <span className="font-semibold text-[#0F8B4C]">{r.approved}✓</span>
                            <span className="mx-1 text-muted-foreground">/</span>
                            <span className="font-semibold text-[#C0362C]">{r.rejected}✕</span>
                          </span>
                        </div>
                        <div className="flex h-2 overflow-hidden rounded-full bg-muted">
                          <div className="h-full bg-[#0F8B4C]" style={{ width: `${(r.approved / tot) * 100}%` }} />
                          <div className="h-full bg-[#C0362C]" style={{ width: `${(r.rejected / tot) * 100}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="grid h-24 place-items-center text-[12.5px] italic text-muted-foreground">No decisions recorded yet</div>
              )}
            </ChartCard>
            <ChartCard icon={Building2} title="Who’s proposing"
              sub="Most active organisations">
              <RankedList items={a ? a.top_orgs : null}
                valueOf={(o) => fmtInt(o.count)} empty="No organisations yet" />
            </ChartCard>
          </div>

          {/* detail table */}
          <Card className="overflow-hidden p-0">
            <div className="flex flex-wrap items-center gap-2 border-b border-border p-4">
              <h2 className="type-card-heading">Every proposal</h2>
              <div className="ml-auto flex items-center gap-2">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search ref, org, title…"
                    className="h-9 w-56 rounded-xl border border-input bg-card pl-8 pr-3 text-[13px] shadow-card focus:border-brand focus:outline-none" />
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
              <table className="w-full min-w-[820px] text-left text-sm">
                <thead className="bg-[#EDF1F8] text-[11px] uppercase tracking-[0.08em] text-muted-foreground/80">
                  <tr>
                    <th className="px-4 py-3">Proposal</th>
                    <th className="px-4 py-3">Organisation</th>
                    <th className="px-4 py-3">Portfolio</th>
                    <th className="px-4 py-3">AI</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Received</th>
                  </tr>
                </thead>
                <tbody>
                  {rows == null ? (
                    <tr><td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">Loading…</td></tr>
                  ) : rows.length === 0 ? (
                    <tr><td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">No proposals match.</td></tr>
                  ) : rows.map((p) => {
                    const st = STATUS_PILL[p.status] || { label: p.status, cls: "bg-slate-100 text-slate-600" };
                    const rec = p.ai_recommendation ? REC_PILL[p.ai_recommendation] : null;
                    return (
                      <tr key={p.id} onClick={() => router.push("/proposal-review")}
                        className="cursor-pointer border-t border-border/70 transition-colors hover:bg-[#EFF3FB]">
                        <td className="px-4 py-3">
                          <div className="type-table-row truncate font-medium text-foreground">{p.title || "Untitled proposal"}</div>
                          <div className="font-mono text-[11px] font-semibold text-brand">{p.tracking_ref}</div>
                        </td>
                        <td className="px-4 py-3 text-[13px] text-foreground/85">{p.org_name || "—"}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-[13px] text-muted-foreground">{p.category ? (CAT_LABEL[p.category] || p.category) : "—"}</td>
                        <td className="px-4 py-3">
                          {rec ? <span className={cn("inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium", rec.cls)}>{rec.label}</span> : <span className="text-muted-foreground">—</span>}
                        </td>
                        <td className="px-4 py-3"><span className={cn("inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-semibold", st.cls)}>{st.label}</span></td>
                        <td className="whitespace-nowrap px-4 py-3 text-[12.5px] tabular-nums text-muted-foreground">{fmtDate(p.created_at)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between gap-2 border-t border-border px-4 py-2.5 text-[12px] text-muted-foreground">
              <span>{rows?.length ?? 0} shown</span>
              <button onClick={() => router.push("/proposal-review")} className="inline-flex items-center gap-1 font-medium text-brand hover:underline">
                Go to review queue <ArrowRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </Card>
        </div>
      </main>
    </>
  );
}
