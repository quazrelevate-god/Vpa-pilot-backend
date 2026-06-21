"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Activity, AlertTriangle, Clock, RefreshCw, Timer, CalendarCheck, ArrowLeft, Hourglass, Gauge as GaugeIcon,
} from "lucide-react";

import TopBar from "@/components/TopBar";
import MetricTile from "@/components/MetricTile";
import { useLang } from "@/lib/lang-context";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchStats } from "@/lib/api";
import type { StatsResponse, SlaBucket } from "@/lib/types";
import { cn } from "@/lib/utils";

interface WaitingItem {
  id: number; token: number; name: string; mobile: string; category: string;
  queue_position: number; waiting_since: string; priority_score: number;
}

interface TodaySchedule {
  has_availability: boolean;
  total_slots?: number;
  booked_slots?: number;
  remaining_slots?: number;
  time_range?: string;
  date?: string;
}

const PRIORITY_TONE: Record<string, { bar: string; chip: string; label: string }> = {
  P0: { bar: "from-rose-500 to-rose-400",     chip: "bg-rose-100 text-rose-700",     label: "P0 — Critical (3d SLA)" },
  P1: { bar: "from-orange-500 to-orange-400", chip: "bg-orange-100 text-orange-700", label: "P1 — High (1w SLA)" },
  P2: { bar: "from-amber-400 to-amber-300",   chip: "bg-amber-100 text-amber-800",   label: "P2 — Medium (2w SLA)" },
  P3: { bar: "from-slate-400 to-slate-300",   chip: "bg-slate-100 text-slate-700",   label: "P3 — Low (4w SLA)" },
};

export default function OperationsPage() {
  const { t } = useLang();
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [waiting, setWaiting] = useState<WaitingItem[]>([]);
  const [today, setToday] = useState<TodaySchedule | null>(null);
  const [loading, setLoading] = useState(false);
  const [updated, setUpdated] = useState<string>("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, w, sched] = await Promise.all([
        fetchStats().catch(() => null),
        fetch("/api/v1/scheduling/admin/waiting-queue?limit=10").then((r) => r.json()).catch(() => []),
        fetch("/api/v1/scheduling/admin/today-schedule").then((r) => r.json()).catch(() => null),
      ]);
      if (s) setStats(s);
      if (Array.isArray(w)) setWaiting(w);
      if (sched) setToday(sched);
      setUpdated(new Date().toLocaleTimeString());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const fmt = (v: number | undefined | null) => (v == null ? "—" : v.toLocaleString());

  const oldestWaitingDays = waiting.length
    ? Math.floor((Date.now() - new Date(waiting[0].waiting_since).getTime()) / 86_400_000)
    : 0;

  const slaTotal = (stats?.sla_buckets ?? []).reduce((a, b) => a + b.on_track + b.breached, 0);
  const slaBreached = (stats?.sla_buckets ?? []).reduce((a, b) => a + b.breached, 0);
  const slaBreachPct = slaTotal ? Math.round((slaBreached / slaTotal) * 100) : 0;

  const meetingFillPct = today?.total_slots
    ? Math.round(((today.booked_slots ?? 0) / today.total_slots) * 100)
    : 0;

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
          {/* Header */}
          <div className="flex flex-shrink-0 flex-wrap items-end justify-between gap-3">
            <div>
              <h1 className="text-[22px] font-extrabold leading-tight tracking-tight text-foreground">
                {t("ops.title")}
              </h1>
              <p className="text-[12.5px] text-muted-foreground">
                {t("ops.subtitle")}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <a href="/overview" className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2.5 py-1 text-xs font-semibold text-brand hover:bg-muted">
                <ArrowLeft className="h-3 w-3" /> {t("ops.goPerf")}
              </a>
              <Button variant="outline" size="sm" onClick={load} disabled={loading}>
                <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
                Refresh
              </Button>
            </div>
          </div>

          {/* KPI strip — operations focus */}
          <div className="grid flex-shrink-0 grid-cols-2 gap-3 sm:grid-cols-4">
            <MetricTile
              label={t("ops.backlog")}
              value={fmt(stats?.active_cases)}
              icon={Activity}
              tone="brand"
              caption={t("ops.backlogSub")}
            />
            <MetricTile
              label={t("ops.slaBreachRate")}
              value={`${slaBreachPct}%`}
              icon={AlertTriangle}
              tone={slaBreachPct >= 25 ? "rose" : slaBreachPct >= 10 ? "amber" : "emerald"}
              caption={`${slaBreached} of ${slaTotal} ${t("overview.cases")}`}
              invertDelta
            />
            <MetricTile
              label={t("ops.waiting")}
              value={fmt(waiting.length)}
              icon={Hourglass}
              tone={waiting.length >= 20 ? "rose" : waiting.length >= 5 ? "amber" : "slate"}
              caption={oldestWaitingDays ? `${t("ops.oldest")}: ${oldestWaitingDays}d` : t("ops.queueClearCaption")}
            />
            <MetricTile
              label={t("ops.slots")}
              value={today?.has_availability ? `${today.booked_slots ?? 0}/${today.total_slots ?? 0}` : "—"}
              icon={CalendarCheck}
              tone={meetingFillPct >= 80 ? "rose" : meetingFillPct >= 50 ? "amber" : "emerald"}
              caption={today?.has_availability ? `${meetingFillPct}% ${t("ops.booked")}` : t("ops.noAvailability")}
            />
          </div>

          {/* Middle band — Meeting capacity + Waiting queue */}
          <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-2">
            {/* Meeting capacity gauge */}
            <Card className="flex min-h-0 flex-col p-4">
              <div className="mb-2 flex flex-shrink-0 items-start justify-between">
                <div>
                  <div className="inline-flex items-center gap-1.5 text-[13px] font-bold text-foreground">
                    <GaugeIcon className="h-3.5 w-3.5 text-violet-600" />
                    {t("ops.capacity")}
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    {today?.has_availability ? today.time_range : t("ops.noAvailability")}
                  </div>
                </div>
              </div>
              {today?.has_availability ? (
                <div className="flex flex-1 flex-col justify-center gap-3">
                  <div className="text-center">
                    <div className="inline-flex items-baseline gap-1">
                      <span className="text-[44px] font-extrabold tracking-tight tabular-nums text-foreground">
                        {meetingFillPct}
                      </span>
                      <span className="text-lg font-bold text-muted-foreground">%</span>
                    </div>
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      {t("ops.booked")}
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <div className="h-3 w-full overflow-hidden rounded-full bg-muted">
                      <div
                        className={cn(
                          "h-full rounded-full",
                          meetingFillPct >= 100 ? "bg-rose-500" :
                          meetingFillPct >= 80 ? "bg-orange-500" :
                          meetingFillPct >= 40 ? "bg-emerald-500" :
                          "bg-emerald-400"
                        )}
                        style={{ width: `${Math.min(meetingFillPct, 100)}%` }}
                      />
                    </div>
                    <div className="flex justify-between text-[11px] font-semibold text-muted-foreground">
                      <span>{today.booked_slots ?? 0} {t("ops.booked")}</span>
                      <span>{today.remaining_slots ?? 0} {t("ops.remaining")}</span>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex flex-1 flex-col items-center justify-center text-center">
                  <Clock className="mb-2 h-8 w-8 text-muted-foreground/30" />
                  <p className="text-[12px] font-semibold text-foreground">{t("ops.noSlotsToday")}</p>
                  <a href="/scheduling" className="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold text-brand hover:underline">
                    {t("ops.setAvailability")}
                  </a>
                </div>
              )}
            </Card>

            {/* Waiting Queue — next in line */}
            <Card className="flex min-h-0 flex-col p-4">
              <div className="mb-2 flex flex-shrink-0 items-start justify-between">
                <div>
                  <div className="inline-flex items-center gap-1.5 text-[13px] font-bold text-foreground">
                    <Hourglass className="h-3.5 w-3.5 text-amber-600" />
                    {t("ops.nextInLine")}
                  </div>
                  <div className="text-[11px] text-muted-foreground">{t("ops.nextInLineSub")}</div>
                </div>
                <a href="/waiting-queue" className="text-[10px] font-semibold text-brand hover:underline">
                  {t("ops.viewAll")}
                </a>
              </div>
              {waiting.length === 0 ? (
                <div className="flex flex-1 flex-col items-center justify-center text-center">
                  <CalendarCheck className="mb-1 h-7 w-7 text-emerald-500/40" />
                  <p className="text-[11.5px] font-semibold text-foreground">{t("ops.queueClear")}</p>
                  <p className="text-[10.5px] text-muted-foreground">{t("ops.allScheduled")}</p>
                </div>
              ) : (
                <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto pr-1">
                  {waiting.slice(0, 6).map((w) => {
                    const days = Math.floor((Date.now() - new Date(w.waiting_since).getTime()) / 86_400_000);
                    return (
                      <div key={w.id} className="flex items-center gap-1.5 rounded-md border border-border bg-muted/30 px-2 py-1">
                        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-amber-100 text-[10px] font-bold text-amber-700">
                          {w.queue_position}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[11.5px] font-semibold text-foreground">{w.name}</div>
                          <div className="truncate text-[9.5px] text-muted-foreground">{w.category || "General"}</div>
                        </div>
                        <span className={cn(
                          "rounded px-1.5 py-0.5 text-[9.5px] font-bold tabular-nums",
                          days >= 3 ? "bg-rose-100 text-rose-700" : days >= 1 ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700"
                        )}>
                          {days}d
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>
          </div>

          {/* Bottom band — SLA Performance (full width) */}
          <Card className="flex min-h-[180px] flex-shrink-0 flex-col p-4">
            <div className="mb-3 flex flex-shrink-0 flex-wrap items-start justify-between gap-2">
              <div>
                <div className="inline-flex items-center gap-1.5 text-[13px] font-bold text-foreground">
                  <Timer className="h-3.5 w-3.5 text-brand" />
                  {t("ops.slaTitle")}
                </div>
                <div className="text-[11px] text-muted-foreground">{t("ops.slaSub")}</div>
              </div>
              <div className="flex items-center gap-3 text-[11px] font-semibold text-muted-foreground">
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-emerald-500" /> {t("ops.onTrack")}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-rose-500" /> {t("ops.breached")}
                </span>
              </div>
            </div>
            {stats?.sla_buckets ? (
              <div className="grid flex-1 grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
                {stats.sla_buckets.map((b: SlaBucket) => {
                  const total = b.on_track + b.breached;
                  const okPct = total ? (b.on_track / total) * 100 : 0;
                  const breachPct = total ? (b.breached / total) * 100 : 0;
                  const tone = PRIORITY_TONE[b.priority];
                  return (
                    <div key={b.priority} className="rounded-lg border border-border bg-muted/20 p-2.5">
                      <div className="mb-1.5 flex items-center justify-between text-[11px]">
                        <span className={cn("inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-bold", tone.chip)}>
                          {tone.label}
                        </span>
                      </div>
                      <div className="mb-1.5 flex items-baseline gap-1.5">
                        <span className="text-[22px] font-extrabold tabular-nums text-foreground">{total}</span>
                        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">cases</span>
                        {b.breached > 0 && (
                          <span className="ml-auto inline-flex items-center gap-0.5 rounded bg-rose-50 px-1.5 py-0.5 text-[10px] font-bold text-rose-700">
                            <AlertTriangle className="h-2.5 w-2.5" />{b.breached}
                          </span>
                        )}
                      </div>
                      <div className="flex h-2.5 overflow-hidden rounded-full bg-muted">
                        {okPct > 0 && (
                          <div className="bg-gradient-to-r from-emerald-500 to-emerald-400" style={{ width: `${okPct}%` }} />
                        )}
                        {breachPct > 0 && (
                          <div className="bg-gradient-to-r from-rose-500 to-rose-400" style={{ width: `${breachPct}%` }} />
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <Skeleton className="h-full w-full" />
            )}
          </Card>
        </div>
      </main>
    </>
  );
}
