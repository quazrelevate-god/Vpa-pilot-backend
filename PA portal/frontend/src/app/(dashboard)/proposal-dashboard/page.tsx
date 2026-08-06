"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Lightbulb, Inbox, CheckCircle2, Clock, Gauge, IndianRupee,
  Layers, Sparkles, TrendingUp, Building2, Search, RefreshCw, ArrowRight, Landmark, X,
} from "lucide-react";

import TopBar from "@/components/TopBar";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { fetchMe } from "@/app/(dashboard)/settings/_lib/adminApi";
import {
  StatTile, ChartCard, BarBreakdown, DonutBreakdown, TrendArea, RankedList,
  NotAuthorized, C, fmtInt,
} from "@/components/insights/DashboardKit";
import { listProposals, analyze, fmtINR, type ProposalRow } from "./_lib/api";

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
  review_closely:  { label: "Review closely",  cls: "border-violet-300 bg-violet-50 text-violet-700" },
  standard:        { label: "Standard",        cls: "border-slate-300 bg-slate-50 text-slate-600" },
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
  const [rows, setRows] = useState<ProposalRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [updated, setUpdated] = useState<string | null>(null);

  // Cross-filters — every chart writes here, every number reads from here.
  const [fStatus, setFStatus] = useState("");
  const [fRec, setFRec] = useState("");
  const [fCat, setFCat] = useState("");
  const [q, setQ] = useState("");

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

  // ── one full fetch; the dashboard is computed client-side from it ──
  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      // Institutional proposals stay well under the endpoint's 200 cap; the
      // whole dashboard is computed from this one fetch.
      const res = await listProposals({ limit: 200 }, signal);
      if (!signal?.aborted) {
        setRows(res.items); setErr(null);
        setUpdated(new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }));
      }
    } catch (e) { if (!signal?.aborted) setErr((e as Error).message); }
  }, []);

  useEffect(() => {
    if (gate !== "ok") return;
    const ac = new AbortController();
    load(ac.signal);
    const iv = setInterval(() => load(ac.signal), 20000);
    return () => { ac.abort(); clearInterval(iv); };
  }, [gate, load]);

  const matchQ = useCallback((r: ProposalRow) => {
    const s = q.trim().toLowerCase();
    if (!s) return true;
    return (r.title || "").toLowerCase().includes(s)
      || (r.org_name || "").toLowerCase().includes(s)
      || (r.tracking_ref || "").toLowerCase().includes(s);
  }, [q]);

  // `base` = everything EXCEPT the status filter (so the status tabs/donut can
  // still show their would-be counts). `filtered` adds the status filter.
  const base = useMemo(
    () => (rows ?? []).filter((r) =>
      (!fRec || r.ai_recommendation === fRec) &&
      (!fCat || (r.category || "other") === fCat) &&
      matchQ(r)),
    [rows, fRec, fCat, matchQ],
  );
  const filtered = useMemo(
    () => base.filter((r) => !fStatus || r.status === fStatus),
    [base, fStatus],
  );
  const view = useMemo(() => analyze(filtered), [filtered]);
  const k = view.kpis;
  const trendSeries = useMemo(() => view.trend.map((p) => p.received), [view]);

  const statusCounts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const r of base) c[r.status] = (c[r.status] || 0) + 1;
    return c;
  }, [base]);
  const countFor = (key: string) => (key === "" ? base.length : statusCounts[key] || 0);

  const tableRows = useMemo(
    () => [...filtered].sort((a, b) => (b.created_at || "").localeCompare(a.created_at || "")),
    [filtered],
  );

  const toggle = (cur: string, set: (v: string) => void) => (key: string) => set(cur === key ? "" : key);
  const clearAll = () => { setFStatus(""); setFRec(""); setFCat(""); setQ(""); };

  const chips: { label: string; clear: () => void }[] = [];
  if (fStatus) chips.push({ label: `Status · ${STATUS_PILL[fStatus]?.label ?? fStatus}`, clear: () => setFStatus("") });
  if (fRec) chips.push({ label: `AI · ${REC_PILL[fRec]?.label ?? fRec}`, clear: () => setFRec("") });
  if (fCat) chips.push({ label: `Portfolio · ${CAT_LABEL[fCat] ?? fCat}`, clear: () => setFCat("") });
  if (q.trim()) chips.push({ label: `“${q.trim()}”`, clear: () => setQ("") });
  const anyFilter = chips.length > 0;

  const loading = rows == null;

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
            <Button variant="outline" size="sm" className="h-9 rounded-xl" onClick={() => load()}>
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
          </div>

          {err && <div className="rounded-lg border border-rose-300 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">{err}</div>}

          {/* active cross-filters — click any chart to add one */}
          {anyFilter && (
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-brand/20 bg-brand/[0.04] px-3 py-2">
              <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Filtered</span>
              {chips.map((c, i) => (
                <button key={i} onClick={c.clear}
                  className="inline-flex items-center gap-1.5 rounded-full border border-brand/30 bg-card px-2.5 py-1 text-[12px] font-medium text-brand transition-colors hover:bg-brand/10">
                  {c.label} <X className="h-3 w-3" />
                </button>
              ))}
              <button onClick={clearAll} className="text-[12px] font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
                Clear all
              </button>
              <span className="ml-auto font-mono text-[12px] font-semibold tabular-nums text-foreground">
                {fmtInt(filtered.length)} <span className="font-sans font-normal text-muted-foreground">of {fmtInt(rows?.length ?? 0)} proposals</span>
              </span>
            </div>
          )}

          {/* KPIs — decision-first, then pipeline. All recompute under filters. */}
          {loading ? (
            <div className="space-y-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">{Array.from({ length: 3 }).map((_, i) => <Card key={i} className="h-[128px] animate-pulse" />)}</div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">{Array.from({ length: 3 }).map((_, i) => <Card key={i} className="h-[112px] animate-pulse" />)}</div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <StatTile icon={Inbox} tone="amber" label="Awaiting your decision" value={fmtInt(k.awaiting)}
                  caption={`of ${fmtInt(k.total)} · on your desk`} highlight />
                {/* Approval rate uses approved / (approved + rejected). A pool
                    of only NEEDS_CLARIFICATION decisions is `k.decided > 0`
                    but the denominator is still 0 — showing "0%" there would
                    mislead the Minister into thinking nothing was approved,
                    when the truth is nothing has been decided approve-or-reject
                    yet. Guard against that specific 0/0 case. */}
                <StatTile icon={CheckCircle2} tone="mint" label="Approval rate"
                  value={(k.approved + k.rejected) > 0 ? `${k.approval_rate}%` : "—"}
                  caption={(k.approved + k.rejected) > 0
                    ? `${fmtInt(k.approved)} approved of ${fmtInt(k.approved + k.rejected)} decided`
                    : "no approve/reject decisions yet"} />
                <StatTile icon={Clock} tone="violet" label="Avg decision time"
                  value={k.avg_decision_days != null ? `${k.avg_decision_days}d` : "—"}
                  caption={k.avg_decision_days != null ? "received → decided" : "no decisions yet"} />
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <StatTile icon={Lightbulb} tone="brand" label={fStatus || fRec || fCat ? "Proposals (filtered)" : "Total proposals"} value={fmtInt(k.total)}
                  caption={anyFilter ? "in the current view" : "all time"} delta={anyFilter ? null : k.growth_pct} series={trendSeries} />
                <StatTile icon={IndianRupee} tone="violet" label="Value in the pipeline"
                  value={fmtINR(k.pipeline_cost_value)}
                  caption={k.pipeline_cost_count > 0 ? `stated across ${fmtInt(k.pipeline_cost_count)} proposals` : "no costs stated"} />
                <StatTile icon={Gauge} tone="mint" label="Decided so far" value={fmtInt(k.decided)}
                  caption={`${k.decided_pct}% of this view`} />
              </div>
            </div>
          )}

          {/* decision donut + AI recommendation — both clickable */}
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <ChartCard icon={Layers} title="Where each proposal stands" sub="Click a slice to filter · the Minister’s decision pipeline">
              <DonutBreakdown data={loading ? null : view.by_status} centerLabel="proposals"
                colors={["#B45309", "#0F8B4C", "#C0362C", "#EA8C0C"]} empty="No proposals in this view"
                activeKey={fStatus} onSlice={toggle(fStatus, setFStatus)} />
            </ChartCard>
            <ChartCard icon={Sparkles} title="What the AI flagged" sub="Completeness triage — click to filter · never a decision">
              <DonutBreakdown data={loading ? null : view.by_recommendation} centerLabel="briefs"
                colors={["#6D28D9", "#64748B", "#B45309"]} empty="No AI briefs in this view"
                activeKey={fRec} onSlice={toggle(fRec, setFRec)} />
            </ChartCard>
          </div>

          {/* portfolio bars (clickable) + trend */}
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <ChartCard icon={Landmark} title="By portfolio" sub="Click a bar to filter · which desk each idea targets">
              <BarBreakdown data={loading ? null : view.by_category} color={C.brand} empty="No proposals in this view"
                activeKey={fCat} onPick={toggle(fCat, setFCat)} />
            </ChartCard>
            <ChartCard icon={TrendingUp} title="Proposals received" sub="Last 90 days">
              <TrendArea data={loading ? null : view.trend} color={C.brand} label="Proposals" />
            </ChartCard>
          </div>

          {/* approval by portfolio + top orgs */}
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <ChartCard icon={CheckCircle2} title="Decision split by portfolio" sub="Approved vs rejected, where decided">
              {!loading && view.approval_by_category.length > 0 ? (
                <div className="space-y-3">
                  {view.approval_by_category.map((r) => {
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
                <div className="grid h-24 place-items-center text-[12.5px] italic text-muted-foreground">No decisions in this view</div>
              )}
            </ChartCard>
            <ChartCard icon={Building2} title="Who’s proposing" sub="Most active organisations">
              <RankedList items={loading ? null : view.top_orgs} valueOf={(o) => fmtInt(o.count)} empty="No organisations in this view" />
            </ChartCard>
          </div>

          {/* detail table — shares the same filter state */}
          <Card className="overflow-hidden p-0">
            <div className="flex flex-wrap items-center gap-2 border-b border-border p-4">
              <h2 className="type-card-heading">Proposals</h2>
              <span className="font-mono text-[12px] font-semibold tabular-nums text-muted-foreground">{fmtInt(tableRows.length)}</span>
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
                <button key={tb.key || "all"} onClick={() => setFStatus(tb.key)}
                  className={cn("inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12.5px] font-medium transition-colors",
                    fStatus === tb.key ? "bg-brand text-white" : "text-muted-foreground hover:bg-accent")}>
                  {tb.label}
                  <span className={cn("num rounded-full px-1.5 text-[11px]", fStatus === tb.key ? "bg-white/20 text-white" : "bg-muted text-muted-foreground")}>{countFor(tb.key)}</span>
                </button>
              ))}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] text-left text-sm">
                <thead className="bg-[#EDF1F8] text-[11px] uppercase tracking-[0.08em] text-muted-foreground/80">
                  <tr>
                    <th className="px-4 py-3">Proposal</th>
                    <th className="px-4 py-3">Organisation</th>
                    <th className="px-4 py-3">Portfolio</th>
                    <th className="w-36 px-4 py-3">AI</th>
                    <th className="w-28 px-4 py-3">Status</th>
                    <th className="w-28 px-4 py-3">Received</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr><td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">Loading…</td></tr>
                  ) : tableRows.length === 0 ? (
                    <tr><td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">
                      No proposals match. {anyFilter && <button onClick={clearAll} className="font-medium text-brand hover:underline">Clear filters</button>}
                    </td></tr>
                  ) : tableRows.map((p) => {
                    const st = STATUS_PILL[p.status] || { label: p.status, cls: "bg-slate-100 text-slate-600" };
                    const rec = p.ai_recommendation ? REC_PILL[p.ai_recommendation] : null;
                    return (
                      <tr key={p.id} onClick={() => router.push(`/proposal-review?id=${p.id}`)}
                        className="cursor-pointer border-t border-border/70 transition-colors hover:bg-[#EFF3FB]">
                        <td className="px-4 py-3">
                          <div className="type-table-row truncate font-medium text-foreground">{p.title || "Untitled proposal"}</div>
                          <div className="font-mono text-[11px] font-semibold text-brand">{p.tracking_ref}</div>
                        </td>
                        <td className="px-4 py-3 text-[13px] text-foreground/85">{p.org_name || "—"}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-[13px] text-muted-foreground">{p.category ? (CAT_LABEL[p.category] || p.category) : "—"}</td>
                        <td className="px-4 py-3">
                          {rec ? <span className={cn("inline-flex w-fit whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium", rec.cls)}>{rec.label}</span> : <span className="text-muted-foreground">—</span>}
                        </td>
                        <td className="px-4 py-3"><span className={cn("inline-flex w-fit whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-semibold", st.cls)}>{st.label}</span></td>
                        <td className="whitespace-nowrap px-4 py-3 text-[12.5px] tabular-nums text-muted-foreground">{fmtDate(p.created_at)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between gap-2 border-t border-border px-4 py-2.5 text-[12px] text-muted-foreground">
              <span>{fmtInt(tableRows.length)} shown</span>
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
