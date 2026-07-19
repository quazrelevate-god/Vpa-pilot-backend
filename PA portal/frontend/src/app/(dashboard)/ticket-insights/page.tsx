"use client";

/**
 * Ticket Insights — the PA team's ticket-system dashboard.
 *
 * Everything here comes from the ticket side of the house: how many tickets are
 * live, how SLA is holding up, how work splits by priority and status, and how
 * each school department is performing. Deliberately no district breakdown —
 * that dimension belongs to the petition overview.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Ticket as TicketIcon, AlertTriangle, CheckCircle2, Clock, Timer,
  Building2, BarChart3, Flag, RefreshCw,
} from "lucide-react";
import { toast } from "sonner";

import TopBar from "@/components/TopBar";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useLang } from "@/lib/lang-context";
import { cn } from "@/lib/utils";

type Bucket = { key: string; label: string; count: number };
type Dept = {
  key: string; label: string; open: number; resolved: number; total: number;
  resolution_rate: number; avg_resolution_days: number | null;
  on_time_pct: number | null; avg_accept_minutes: number | null; avg_progress: number;
};
interface TicketAnalytics {
  kpis: {
    total: number; open: number; resolved: number;
    breached: number; due_soon: number; on_track: number;
    resolution_rate: number; avg_response_hours: number; on_time_pct: number | null;
  };
  by_status: Bucket[];
  by_priority: Bucket[];
  departments: Dept[];
  trend: { date: string; raised: number; resolved: number }[];
}

// Same preset windows the other analytics rooms use.
const RANGES = [
  { key: "7d",  days: 7 },
  { key: "30d", days: 30 },
  { key: "90d", days: 90 },
  { key: "",    days: 0 },   // all time
] as const;
type RangeKey = (typeof RANGES)[number]["key"];

const PRIORITY_CLS: Record<string, string> = {
  critical: "bg-red-500", high: "bg-orange-500", medium: "bg-amber-400", low: "bg-slate-300",
};

function toISODate(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function TicketInsightsPage() {
  const { t } = useLang();
  const [data, setData] = useState<TicketAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState<RangeKey>("30d");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      const days = RANGES.find(r => r.key === range)?.days ?? 0;
      if (days) {
        const from = new Date(); from.setDate(from.getDate() - days + 1);
        qs.set("date_from", toISODate(from));
        qs.set("date_to", toISODate(new Date()));
      }
      const r = await fetch(`/api/analytics/tickets?${qs}`, { credentials: "include", cache: "no-store" });
      if (!r.ok) throw new Error(String(r.status));
      setData(await r.json());
    } catch {
      toast.error(t("ti.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [range, t]);

  useEffect(() => { load(); }, [load]);

  const k = data?.kpis;
  const slaTotal = (k?.breached ?? 0) + (k?.due_soon ?? 0) + (k?.on_track ?? 0);
  const maxStatus = useMemo(
    () => Math.max(1, ...(data?.by_status ?? []).map(s => s.count)),
    [data],
  );
  const maxPriority = useMemo(
    () => Math.max(1, ...(data?.by_priority ?? []).map(s => s.count)),
    [data],
  );

  return (
    <>
      <TopBar
        title={t("nav.ticketInsights")}
        subtitle={t("ti.subtitle")}
        icon={<BarChart3 className="h-5 w-5" />}
      />
      <main className="flex-1 overflow-y-auto bg-background">
        <div className="flex flex-col gap-4 px-5 py-5 sm:px-6">

          {/* Range presets + refresh */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex gap-1 rounded-lg border border-border bg-card p-1 shadow-card">
              {RANGES.map(r => (
                <button
                  key={r.key || "all"}
                  onClick={() => setRange(r.key)}
                  className={cn(
                    "rounded-md px-3 py-1.5 text-[12.5px] font-semibold transition-colors",
                    range === r.key ? "bg-brand text-white" : "text-muted-foreground hover:bg-muted",
                  )}
                >
                  {t(`ti.range${r.key || "All"}`)}
                </button>
              ))}
            </div>
            <button
              onClick={load}
              className="grid h-[34px] w-[34px] place-items-center rounded-lg border border-border bg-card text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              title={t("ti.refresh")} aria-label={t("ti.refresh")}
            >
              <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
            </button>
          </div>

          {/* KPI row */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <Kpi icon={TicketIcon}    tone="slate"   label={t("ti.kpiTotal")}    value={k?.total}    loading={loading} />
            <Kpi icon={Clock}         tone="blue"    label={t("ti.kpiOpen")}     value={k?.open}     loading={loading} />
            <Kpi icon={CheckCircle2}  tone="emerald" label={t("ti.kpiResolved")} value={k?.resolved} loading={loading} />
            <Kpi icon={AlertTriangle} tone="red"     label={t("ti.kpiBreached")} value={k?.breached} loading={loading} />
            <Kpi icon={Timer}         tone="amber"   label={t("ti.kpiDueSoon")}  value={k?.due_soon} loading={loading} />
          </div>

          {/* Rate strip */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Rate label={t("ti.resolutionRate")} value={k ? `${k.resolution_rate}%` : "—"} loading={loading} />
            <Rate label={t("ti.onTime")} value={k?.on_time_pct != null ? `${k.on_time_pct}%` : "—"} loading={loading} />
            <Rate label={t("ti.avgResponse")} value={k ? `${k.avg_response_hours}h` : "—"} loading={loading} />
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            {/* SLA health */}
            <Panel icon={AlertTriangle} title={t("ti.slaHealth")}>
              {loading ? <Skeleton className="h-28 w-full rounded-lg" /> : slaTotal === 0 ? (
                <Empty text={t("ti.noOpen")} />
              ) : (
                <div className="space-y-3">
                  <div className="flex h-3 overflow-hidden rounded-full bg-muted">
                    <Seg n={k!.on_track}  total={slaTotal} cls="bg-emerald-500" />
                    <Seg n={k!.due_soon}  total={slaTotal} cls="bg-amber-500" />
                    <Seg n={k!.breached}  total={slaTotal} cls="bg-red-500" />
                  </div>
                  <SlaRow cls="bg-emerald-500" label={t("ti.onTrack")} n={k!.on_track} total={slaTotal} />
                  <SlaRow cls="bg-amber-500"   label={t("ti.dueSoon")} n={k!.due_soon} total={slaTotal} />
                  <SlaRow cls="bg-red-500"     label={t("ti.breached")} n={k!.breached} total={slaTotal} />
                </div>
              )}
            </Panel>

            {/* Status mix */}
            <Panel icon={BarChart3} title={t("ti.statusMix")}>
              {loading ? <Skeleton className="h-28 w-full rounded-lg" />
                : !data?.by_status.length ? <Empty text={t("ti.noData")} />
                : <BarList rows={data.by_status} max={maxStatus} tone="bg-brand" />}
            </Panel>

            {/* Priority split */}
            <Panel icon={Flag} title={t("ti.prioritySplit")}>
              {loading ? <Skeleton className="h-28 w-full rounded-lg" />
                : <BarList rows={data?.by_priority ?? []} max={maxPriority} toneOf={r => PRIORITY_CLS[r.key] ?? "bg-brand"} />}
            </Panel>
          </div>

          {/* Department performance */}
          <Panel icon={Building2} title={t("ti.deptPerformance")}>
            {loading ? (
              <div className="space-y-2">{[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-10 w-full rounded-lg" />)}</div>
            ) : !data?.departments.length ? <Empty text={t("ti.noData")} /> : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="border-b border-border text-left text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                      <th className="whitespace-nowrap px-3 py-2.5">{t("ti.colDept")}</th>
                      <th className="whitespace-nowrap px-3 py-2.5 text-right">{t("ti.colOpen")}</th>
                      <th className="whitespace-nowrap px-3 py-2.5 text-right">{t("ti.colResolved")}</th>
                      <th className="whitespace-nowrap px-3 py-2.5 text-right">{t("ti.colTotal")}</th>
                      <th className="whitespace-nowrap px-3 py-2.5 text-right">{t("ti.colRate")}</th>
                      <th className="whitespace-nowrap px-3 py-2.5 text-right">{t("ti.colOnTime")}</th>
                      <th className="whitespace-nowrap px-3 py-2.5 text-right">{t("ti.colAvgDays")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.departments.map(d => (
                      <tr key={d.key} className="border-b border-border/60">
                        <td className="px-3 py-3 text-[13px] font-semibold text-foreground">{d.label}</td>
                        <td className="px-3 py-3 text-right font-mono text-[13px] text-foreground">{d.open}</td>
                        <td className="px-3 py-3 text-right font-mono text-[13px] text-foreground">{d.resolved}</td>
                        <td className="px-3 py-3 text-right font-mono text-[13px] text-muted-foreground">{d.total}</td>
                        <td className="px-3 py-3 text-right"><Pct v={d.resolution_rate} /></td>
                        <td className="px-3 py-3 text-right"><Pct v={d.on_time_pct} /></td>
                        <td className="px-3 py-3 text-right font-mono text-[13px] text-muted-foreground">
                          {d.avg_resolution_days != null ? `${d.avg_resolution_days}d` : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </div>
      </main>
    </>
  );
}

// ── bits ────────────────────────────────────────────────────────────────────
const TONES: Record<string, string> = {
  slate:   "from-slate-50 to-white [--fg:#334155] [--bg:#E2E8F0]",
  blue:    "from-blue-50 to-white [--fg:#1E40AF] [--bg:#DBEAFE]",
  emerald: "from-emerald-50 to-white [--fg:#047857] [--bg:#D1FADF]",
  red:     "from-red-50 to-white [--fg:#B91C1C] [--bg:#FEE2E2]",
  amber:   "from-amber-50 to-white [--fg:#B45309] [--bg:#FCE9C7]",
};

function Kpi({ icon: Icon, tone, label, value, loading }: {
  icon: React.ElementType; tone: string; label: string; value?: number; loading: boolean;
}) {
  return (
    <div className={cn("rounded-lg border border-border bg-gradient-to-br p-4 shadow-card", TONES[tone])}>
      <div className="flex items-center justify-between gap-2">
        <div className="text-[11px] font-bold uppercase tracking-wider text-foreground/60">{label}</div>
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg"
          style={{ background: "var(--bg)", color: "var(--fg)" }}>
          <Icon className="h-3.5 w-3.5" />
        </span>
      </div>
      {loading
        ? <Skeleton className="mt-2 h-7 w-16 rounded" />
        : <div className="mt-2 font-mono text-2xl font-black leading-none text-foreground">{value ?? 0}</div>}
    </div>
  );
}

function Rate({ label, value, loading }: { label: string; value: string; loading: boolean }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4 shadow-card">
      <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{label}</div>
      {loading
        ? <Skeleton className="mt-2 h-6 w-20 rounded" />
        : <div className="mt-1.5 font-mono text-xl font-black text-foreground">{value}</div>}
    </div>
  );
}

function Panel({ icon: Icon, title, children }: {
  icon: React.ElementType; title: string; children: React.ReactNode;
}) {
  return (
    <Card className="rounded-lg p-5 shadow-card">
      <div className="mb-4 flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-foreground/60">
        <Icon className="h-4 w-4 text-brand" /> {title}
      </div>
      {children}
    </Card>
  );
}

function Seg({ n, total, cls }: { n: number; total: number; cls: string }) {
  if (!n) return null;
  return <div className={cls} style={{ width: `${(n / total) * 100}%` }} />;
}

function SlaRow({ cls, label, n, total }: { cls: string; label: string; n: number; total: number }) {
  return (
    <div className="flex items-center gap-2 text-[13px]">
      <span className={cn("h-2.5 w-2.5 rounded-full", cls)} />
      <span className="flex-1 text-foreground/85">{label}</span>
      <span className="font-mono font-bold text-foreground">{n}</span>
      <span className="font-mono text-[11px] text-muted-foreground">
        ({total ? Math.round((n / total) * 100) : 0}%)
      </span>
    </div>
  );
}

function BarList({ rows, max, tone, toneOf }: {
  rows: Bucket[]; max: number; tone?: string; toneOf?: (r: Bucket) => string;
}) {
  if (!rows.length) return <Empty text="—" />;
  return (
    <div className="space-y-2.5">
      {rows.map(r => (
        <div key={r.key}>
          <div className="mb-1 flex items-center justify-between text-[12px]">
            <span className="truncate pr-2 font-medium text-foreground/90">{r.label}</span>
            <span className="shrink-0 font-mono font-bold text-foreground">{r.count}</span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div className={cn("h-full rounded-full", toneOf ? toneOf(r) : tone)}
              style={{ width: `${Math.round((r.count / max) * 100)}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function Pct({ v }: { v: number | null }) {
  if (v == null) return <span className="font-mono text-[13px] text-muted-foreground">—</span>;
  const cls = v >= 80 ? "text-emerald-600" : v >= 50 ? "text-amber-600" : "text-red-600";
  return <span className={cn("font-mono text-[13px] font-bold", cls)}>{v}%</span>;
}

function Empty({ text }: { text: string }) {
  return <div className="grid h-24 place-items-center text-[12px] italic text-muted-foreground">{text}</div>;
}
