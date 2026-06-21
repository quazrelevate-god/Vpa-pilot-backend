"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Users, Heart, Clock4, Briefcase, Handshake, RefreshCw, ArrowRight,
  Megaphone, Send, Flame, Calendar,
} from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

import TopBar from "@/components/TopBar";
import MetricTile from "@/components/MetricTile";
import DualTrend from "@/components/charts/DualTrend";
import CategoryBar from "@/components/charts/CategoryBar";
import StatusDoughnut from "@/components/charts/StatusDoughnut";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchStats } from "@/lib/api";
import type { StatsResponse } from "@/lib/types";
import { cn } from "@/lib/utils";

type Range = "7d" | "30d" | "90d" | "year" | "all";

const CURRENT_YEAR = new Date().getFullYear();
const YEAR_OPTIONS = Array.from({ length: 4 }, (_, i) => CURRENT_YEAR - i);

function rangeToDates(r: Range, year: number): { from?: string; to?: string } {
  if (r === "all") return {};
  if (r === "year") {
    return { from: `${year}-01-01`, to: `${year}-12-31` };
  }
  const days = r === "7d" ? 7 : r === "30d" ? 30 : 90;
  const to = new Date();
  const from = new Date();
  from.setDate(to.getDate() - days + 1);
  const iso = (d: Date) => d.toISOString().split("T")[0];
  return { from: iso(from), to: iso(to) };
}

function rangeLabel(r: Range, year: number): string {
  return ({
    "7d":   "Last 7 days",
    "30d":  "Last 30 days",
    "90d":  "Last 90 days",
    "year": `Year ${year}`,
    "all":  "All time",
  } as Record<Range, string>)[r];
}

const URGENCY_TONE: Record<string, string> = {
  critical: "bg-rose-500",
  high:     "bg-orange-500",
  medium:   "bg-amber-400",
  low:      "bg-emerald-500",
};

export default function OverviewPage() {
  const [range, setRange] = useState<Range>("year");
  const [year, setYear] = useState<number>(CURRENT_YEAR);
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [updated, setUpdated] = useState<string>("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { from, to } = rangeToDates(range, year);
      const s = await fetchStats(from, to);
      setStats(s);
      setUpdated(new Date().toLocaleTimeString());
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [range, year]);

  useEffect(() => { load(); }, [load]);

  const urgencyMix = useMemo(() => {
    if (!stats) return { total: 0, parts: [] as { key: string; value: number; pct: number }[] };
    const u = stats.urgency ?? {};
    const order = ["critical", "high", "medium", "low"] as const;
    const total = order.reduce((a, k) => a + (u[k] ?? 0), 0);
    const parts = order.map((k) => ({ key: k, value: u[k] ?? 0, pct: total ? Math.round(((u[k] ?? 0) / total) * 100) : 0 }));
    return { total, parts };
  }, [stats]);

  const fmt = (v: number | undefined | null) => (v == null ? "—" : v.toLocaleString());

  return (
    <>
      <TopBar
        rightSlot={
          updated ? (
            <span className="inline-flex items-center gap-1.5">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
              </span>
              Live · {updated}
            </span>
          ) : null
        }
      />

      <main className="flex-1 overflow-hidden bg-background">
        <div className="flex h-full flex-col gap-3 p-5 animate-in-up">
          {/* Header row — title + range tabs + refresh */}
          <div className="flex flex-shrink-0 flex-wrap items-end justify-between gap-3">
            <div>
              <h1 className="text-[22px] font-extrabold leading-tight tracking-tight text-foreground">
                Performance
              </h1>
              <p className="text-[12.5px] text-muted-foreground">
                {rangeLabel(range, year)} · live snapshot for office leadership
              </p>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-0.5 rounded-lg border border-border bg-card p-0.5 shadow-card">
                {(["7d", "30d", "90d", "all"] as Range[]).map((r) => (
                  <button
                    key={r}
                    onClick={() => setRange(r)}
                    className={cn(
                      "rounded-md px-2.5 py-1 text-xs font-semibold transition-colors",
                      r === range
                        ? "bg-brand text-white shadow-card"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground"
                    )}
                  >
                    {r === "all" ? "All time" : r.toUpperCase()}
                  </button>
                ))}
              </div>
              {/* Year dropdown — for annual reporting cuts */}
              <Select
                value={year.toString()}
                onValueChange={(v) => { setYear(parseInt(v)); setRange("year"); }}
              >
                <SelectTrigger className={cn(
                  "h-8 w-[110px] gap-1 text-xs font-semibold",
                  range === "year" && "border-brand text-brand ring-1 ring-brand/20"
                )}>
                  <Calendar className="h-3.5 w-3.5" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {YEAR_OPTIONS.map((y) => (
                    <SelectItem key={y} value={y.toString()}>Year {y}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button variant="outline" size="sm" onClick={load} disabled={loading}>
                <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
                Refresh
              </Button>
            </div>
          </div>

          {/* Hero KPI strip — the credibility numbers */}
          {!stats ? (
            <div className="grid flex-shrink-0 grid-cols-5 gap-3">
              {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-[112px] rounded-2xl" />)}
            </div>
          ) : (
            <div className="grid flex-shrink-0 grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              <MetricTile
                label="Citizens Served"
                value={fmt(stats.unique_citizens ?? stats.total)}
                caption="distinct petitioners"
                icon={Users}
                tone="brand"
                deltaPct={stats.growth_pct ?? undefined}
              />
              <MetricTile
                label="Resolution Rate"
                value={`${stats.resolution_rate}%`}
                caption="reviewed successfully"
                icon={Heart}
                tone="emerald"
              />
              <MetricTile
                label="Avg Response Time"
                value={stats.avg_response_hours ? `${stats.avg_response_hours}h` : "—"}
                caption="creation → resolution"
                icon={Clock4}
                tone="violet"
                invertDelta
              />
              <MetricTile
                label="Meetings Held"
                value={fmt(stats.meetings_held)}
                caption="face-to-face with citizens"
                icon={Handshake}
                tone="amber"
              />
              <MetricTile
                label="Active Cases"
                value={fmt(stats.active_cases)}
                caption="awaiting action"
                icon={Briefcase}
                tone={stats.active_cases && stats.active_cases > 50 ? "rose" : "slate"}
              />
            </div>
          )}

          {/* Middle band — trend + issue landscape */}
          <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-5">
            {/* Submissions vs Resolved trend */}
            <Card className="flex min-h-0 flex-col p-4 lg:col-span-3">
              <div className="mb-2 flex flex-shrink-0 items-start justify-between">
                <div>
                  <div className="text-[13px] font-bold text-foreground">Petitions vs. Resolutions</div>
                  <div className="text-[11px] text-muted-foreground">
                    Daily flow — incoming vs. reviewed
                  </div>
                </div>
                <div className="flex items-center gap-3 text-[11px] font-semibold text-muted-foreground">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-brand" /> Incoming
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-emerald-500" /> Resolved
                  </span>
                </div>
              </div>
              <div className="min-h-0 flex-1">
                {stats ? (
                  <DualTrend
                    labels={stats.trend_labels}
                    incoming={stats.trend_counts}
                    resolved={stats.trend_resolved}
                  />
                ) : (
                  <Skeleton className="h-full w-full" />
                )}
              </div>
            </Card>

            {/* Top issue categories — voice of the people */}
            <Card className="flex min-h-0 flex-col p-4 lg:col-span-2">
              <div className="mb-2 flex flex-shrink-0 items-start justify-between">
                <div>
                  <div className="inline-flex items-center gap-1.5 text-[13px] font-bold text-foreground">
                    <Megaphone className="h-3.5 w-3.5 text-brand" />
                    Voice of the People
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    Top issues raised by citizens
                  </div>
                </div>
              </div>
              <div className="min-h-0 flex-1">
                {stats ? (
                  <CategoryBar items={(stats.categories ?? []).slice(0, 6)} />
                ) : (
                  <Skeleton className="h-full w-full" />
                )}
              </div>
            </Card>
          </div>

          {/* Bottom band — urgency pulse + dept leadership + status mix */}
          <div className="grid flex-shrink-0 grid-cols-1 gap-3 lg:grid-cols-5">
            {/* Urgency pulse */}
            <Card className="flex min-h-[180px] flex-col p-4 lg:col-span-2">
              <div className="mb-2.5 flex items-start justify-between">
                <div>
                  <div className="inline-flex items-center gap-1.5 text-[13px] font-bold text-foreground">
                    <Flame className="h-3.5 w-3.5 text-rose-500" />
                    Urgency Pulse
                  </div>
                  <div className="text-[11px] text-muted-foreground">How tense is the workload?</div>
                </div>
                {stats && <span className="text-[11px] font-semibold text-muted-foreground">{urgencyMix.total} cases</span>}
              </div>
              {stats ? (
                <div className="flex-1 space-y-1.5">
                  {/* Combined bar */}
                  <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-muted">
                    {urgencyMix.parts.map((p) => (
                      <div key={p.key} className={cn(URGENCY_TONE[p.key])} style={{ width: `${p.pct}%` }} title={`${p.key}: ${p.value}`} />
                    ))}
                  </div>
                  {/* Per-tier rows */}
                  <div className="space-y-1 pt-1">
                    {urgencyMix.parts.map((p) => (
                      <div key={p.key} className="flex items-center justify-between text-[11.5px]">
                        <span className="inline-flex items-center gap-2 capitalize text-foreground/80">
                          <span className={cn("h-2 w-2 rounded-full", URGENCY_TONE[p.key])} />
                          {p.key}
                        </span>
                        <span className="font-semibold tabular-nums text-foreground">
                          {p.value} <span className="ml-1 text-[10px] font-medium text-muted-foreground">{p.pct}%</span>
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <Skeleton className="h-full w-full" />
              )}
            </Card>

            {/* Forwarded-to Departments — outbound routing from Education */}
            <Card className="flex min-h-[180px] flex-col p-4 lg:col-span-2">
              <div className="mb-2 flex items-start justify-between">
                <div>
                  <div className="inline-flex items-center gap-1.5 text-[13px] font-bold text-foreground">
                    <Send className="h-3.5 w-3.5 text-cyan-600" />
                    Forwarded to Departments
                  </div>
                  <div className="text-[11px] text-muted-foreground">Cases we routed externally</div>
                </div>
                {stats && (
                  <span className="rounded-md bg-cyan-50 px-1.5 py-0.5 text-[11px] font-bold text-cyan-700">
                    {stats.total_forwarded ?? 0} total
                  </span>
                )}
              </div>
              {stats ? (
                <div className="flex-1 space-y-1.5">
                  {(stats.forwarded_departments ?? []).slice(0, 5).map((d, i) => {
                    const max = stats.forwarded_departments?.[0]?.count ?? 1;
                    const pct = Math.round((d.count / max) * 100);
                    return (
                      <div key={d.label} className="space-y-0.5">
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="truncate font-medium text-foreground/85">
                            <span className="mr-1 text-[10px] font-bold text-muted-foreground">{i + 1}.</span>
                            {d.label}
                          </span>
                          <span className="ml-2 font-bold tabular-nums text-foreground">{d.count}</span>
                        </div>
                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                          <div className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-cyan-300" style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    );
                  })}
                  {(!stats.forwarded_departments || stats.forwarded_departments.length === 0) && (
                    <div className="grid h-full place-items-center text-center text-[11px] italic text-muted-foreground">
                      No external forwards yet
                    </div>
                  )}
                </div>
              ) : (
                <Skeleton className="h-full w-full" />
              )}
            </Card>

            {/* Status mix — small donut */}
            <Card className="flex min-h-[180px] flex-col p-4 lg:col-span-1">
              <div className="mb-1">
                <div className="text-[13px] font-bold text-foreground">Status Mix</div>
                <div className="text-[11px] text-muted-foreground">All petitions</div>
              </div>
              <div className="min-h-0 flex-1">
                {stats ? (
                  <StatusDoughnut
                    scheduled={stats.scheduled}
                    reviewed={stats.reviewed}
                    awaiting_review={stats.awaiting_review}
                    waiting={stats.waiting}
                    rescheduled={stats.rescheduled}
                  />
                ) : (
                  <Skeleton className="h-full w-full" />
                )}
              </div>
            </Card>
          </div>

          {/* Footer micro — link to operations */}
          <div className="flex flex-shrink-0 items-center justify-between rounded-lg border border-dashed border-border bg-card/40 px-3 py-1.5 text-[11px] text-muted-foreground">
            <span>Numbers refresh on demand · drilldowns available on each section.</span>
            <a href="/operations" className="inline-flex items-center gap-1 font-semibold text-brand hover:underline">
              Operations view <ArrowRight className="h-3 w-3" />
            </a>
          </div>
        </div>
      </main>
    </>
  );
}
