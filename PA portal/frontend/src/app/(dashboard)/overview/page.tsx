"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Users, Megaphone, Flame, Handshake, RefreshCw, Download, X,
  ChevronLeft, ChevronRight, ArrowUpDown, AudioLines, CheckCircle2,
  Timer, Gauge, TrendingUp, TrendingDown, Landmark, MapPin, Building2,
} from "lucide-react";
import {
  ResponsiveContainer, AreaChart, Area, BarChart, Bar as RBar, PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, CartesianGrid, LineChart, Line,
} from "recharts";

import TopBar from "@/components/TopBar";
import { InitialsAvatar } from "@/components/ui/avatar";
import AppointmentDetailDrawer from "@/components/AppointmentDetailDrawer";
import TamilNaduMap from "@/components/TamilNaduMap";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { AppointmentRow } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useLang } from "@/lib/lang-context";
import { CATEGORY_DISPLAY_EN, CATEGORY_DISPLAY_TA, ministryText, districtText, schoolDeptText } from "@/lib/enums";

// ── Aurora chart palette (matches globals.css tokens) ────────────────────────
const C = {
  brand:   "#1E40AF",   // royal blue — primary series
  mint:    "#34A26C",   // success — resolved series
  ink:     "#191C24",
  muted:   "#5C5E6E",
  border:  "#ECECF3",
  grid:    "#EDF0F6",
  critical:"#E5484D",
  high:    "#EE7327",
  medium:  "#D39412",
  low:     "#34A26C",
};
// Labels are translation keys — the portal already ships these in EN + TA.
const PRIORITY_META = [
  { key: "critical", tKey: "petition.urgencyCritical", color: C.critical },
  { key: "high",     tKey: "petition.urgencyHigh",     color: C.high },
  { key: "medium",   tKey: "petition.urgencyMedium",   color: C.medium },
  { key: "low",      tKey: "petition.urgencyLow",      color: C.low },
] as const;

// ── Types ────────────────────────────────────────────────────────────────────
interface Bar { key: string; label: string; count: number }
interface TrendPoint { date: string; received: number; resolved: number; count: number }
interface Analytics {
  kpis: {
    received: number; citizens: number; urgent: number; meetings: number;
    meeting_persons: number; awaiting_review: number; growth_pct: number | null;
    resolution_rate: number; avg_response_hours: number; on_time_pct: number; resolved: number;
  };
  categories: Bar[]; ministries: Bar[]; channels: Bar[];
  priority: { critical: number; high: number; medium: number; low: number };
  trend: TrendPoint[];
}
interface Petition {
  id: number; token: string; name: string; mobile: string; category: string | null;
  category_label: string; priority: string | null; status: string; source: string;
  source_label: string; schedule_meeting: boolean; created_at: string | null;
  citizen_ask?: string | null;
}
interface DeptPerf {
  key: string; label: string; open: number; resolved: number; total: number;
  resolution_rate: number; avg_resolution_days: number | null; on_time_pct: number | null;
  avg_accept_minutes: number | null; active_load: number; avg_progress: number;
}
interface Operations { departments: DeptPerf[]; districts: Bar[] }
type Filters = { category?: string; priority?: string; ministry?: string; channel?: string; district?: string };

// ── Date presets ─────────────────────────────────────────────────────────────
type Preset = "today" | "7d" | "30d" | "90d" | "month" | "lastmonth" | "quarter" | "year" | "all";
// Labels are translation KEYS — resolved at render, so the picker switches
// language with the rest of the page.
const PRESETS: { key: Preset; tKey: string }[] = [
  { key: "today", tKey: "ov.rToday" }, { key: "7d", tKey: "ov.r7d" }, { key: "30d", tKey: "ov.r30d" },
  { key: "90d", tKey: "ov.r90d" }, { key: "month", tKey: "ov.rMonth" }, { key: "lastmonth", tKey: "ov.rLastmonth" },
  { key: "quarter", tKey: "ov.rQuarter" }, { key: "year", tKey: "ov.rYear" }, { key: "all", tKey: "ov.rAll" },
];
const iso = (d: Date) => d.toISOString().split("T")[0];
function presetDates(p: Preset): { from?: string; to?: string } {
  const now = new Date();
  if (p === "all") return {};
  if (p === "today") return { from: iso(now), to: iso(now) };
  if (p === "month") return { from: iso(new Date(now.getFullYear(), now.getMonth(), 1)), to: iso(now) };
  if (p === "lastmonth") return { from: iso(new Date(now.getFullYear(), now.getMonth() - 1, 1)), to: iso(new Date(now.getFullYear(), now.getMonth(), 0)) };
  if (p === "quarter") return { from: iso(new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1)), to: iso(now) };
  if (p === "year") return { from: iso(new Date(now.getFullYear(), 0, 1)), to: iso(now) };
  const days = p === "7d" ? 7 : p === "30d" ? 30 : 90;
  const f = new Date(now); f.setDate(now.getDate() - days + 1);
  return { from: iso(f), to: iso(now) };
}

const fmt = (v: number | undefined | null) => (v == null ? "—" : v.toLocaleString("en-IN"));
function fmtDuration(hours: number | undefined | null): string {
  if (hours == null || hours === 0) return "—";
  if (hours < 48) return `${hours.toFixed(1)} hrs`;
  return `${(hours / 24).toFixed(1)} days`;
}

export default function OverviewPage() {
  const { t, lang } = useLang();
  // The API labels categories in English. Re-label from the key so the bars,
  // the table column and the active-filter chip all follow the language.
  const catText = (key: string | null | undefined, fallback?: string | null) =>
    (key ? (lang === "ta" ? CATEGORY_DISPLAY_TA[key] : CATEGORY_DISPLAY_EN[key]) : null)
      ?? fallback ?? key ?? "—";
  const [preset, setPreset] = useState<Preset>("30d");
  const [filters, setFilters] = useState<Filters>({});
  const [data, setData] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);

  // table
  const [pets, setPets] = useState<{ items: Petition[]; total: number; page: number; pages: number } | null>(null);
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<{ by: string; dir: "asc" | "desc" }>({ by: "created_at", dir: "desc" });
  const [selected, setSelected] = useState<AppointmentRow | null>(null);

  // operations (Phase 2): department performance, districts, recent activity
  const [ops, setOps] = useState<Operations | null>(null);

  async function openDetail(id: number) {
    try {
      const r = await fetch(`/api/appointments/${id}`, { credentials: "include" });
      if (r.ok) setSelected(await r.json());
    } catch { /* ignore */ }
  }

  const qs = useCallback((extra: Record<string, any> = {}) => {
    const { from, to } = presetDates(preset);
    const p = new URLSearchParams();
    if (from) p.set("date_from", from); if (to) p.set("date_to", to);
    Object.entries(filters).forEach(([k, v]) => v && p.set(k, v));
    Object.entries(extra).forEach(([k, v]) => v != null && p.set(k, String(v)));
    return p.toString();
  }, [preset, filters]);

  const loadAnalytics = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/analytics?${qs()}`, { credentials: "include" });
      if (!r.ok) { setError(`Analytics request failed (HTTP ${r.status}). If this is a fresh deploy, run "alembic upgrade head".`); return; }
      setError(null); setData(await r.json());
      setLastUpdated(new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }));
    } catch (e) { setError(`Could not reach the analytics API: ${(e as Error).message}`); }
    finally { setLoading(false); }
  }, [qs]);

  const loadPetitions = useCallback(async () => {
    try {
      const r = await fetch(`/api/analytics/petitions?${qs({ page, page_size: 25, sort: sort.by, direction: sort.dir })}`, { credentials: "include" });
      if (!r.ok) { setPets({ items: [], total: 0, page: 1, pages: 1 }); return; }
      setPets(await r.json());
    } catch { setPets({ items: [], total: 0, page: 1, pages: 1 }); }
  }, [qs, page, sort]);

  const loadOps = useCallback(async () => {
    try {
      const r = await fetch(`/api/analytics/operations?${qs()}`, { credentials: "include" });
      if (r.ok) setOps(await r.json());
    } catch { /* soft-fail — panels show their empty state */ }
  }, [qs]);

  useEffect(() => { loadAnalytics(); }, [loadAnalytics]);
  useEffect(() => { loadPetitions(); }, [loadPetitions]);
  useEffect(() => { loadOps(); }, [loadOps]);
  useEffect(() => { setPage(1); }, [preset, filters]);

  function toggle(dim: keyof Filters, key: string) {
    setFilters(f => ({ ...f, [dim]: f[dim] === key ? undefined : key }));
  }
  const activeChips = Object.entries(filters).filter(([, v]) => v) as [keyof Filters, string][];
  const chipLabel = (dim: keyof Filters, v: string) => {
    if (dim === "category") return catText(v, data?.categories.find(c => c.key === v)?.label);
    if (dim === "ministry") return ministryText(v, lang, data?.ministries.find(c => c.key === v)?.label);
    if (dim === "district") return districtText(v, lang, ops?.districts.find(c => c.key === v)?.label);
    return v;
  };

  const k = data?.kpis;
  const priorityTotal = data ? PRIORITY_META.reduce((a, p) => a + (data.priority[p.key] ?? 0), 0) : 0;
  // Bars come from the API labelled in English; re-label from the key.
  const localisedCategories = useMemo(
    () => (data?.categories ?? null)?.map(c => ({ ...c, label: catText(c.key, c.label) })) ?? null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, lang],
  );
  const localisedMinistries = useMemo(
    () => (data?.ministries ?? null)?.map(m => ({ ...m, label: ministryText(m.key, lang, m.label) })) ?? null,
    [data, lang],
  );
  const localisedDistricts = useMemo(
    () => (ops?.districts ?? null)?.map(d => ({ ...d, label: districtText(d.key, lang, d.label) })) ?? null,
    [ops, lang],
  );
  const localisedDepts = useMemo(
    () => (ops?.departments ?? null)?.map(d => ({ ...d, label: schoolDeptText(d.key, lang, d.label) })) ?? null,
    [ops, lang],
  );

  return (
    <>
      <TopBar title={t("ov.title")} subtitle={t("ov.subtitle")} icon={<AudioLines className="h-5 w-5" />} />
      <main className="flex-1 overflow-y-auto bg-background">
        <div className="mx-auto max-w-[1440px] space-y-3 px-3 py-4 animate-in-up">
          {/* Live · period · refresh */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3 text-[13px]">
              <span className="inline-flex items-center gap-1.5 font-semibold text-foreground">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full rounded-full bg-[#34A26C] opacity-60" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-[#34A26C]" />
                </span>
                Live System
              </span>
              {lastUpdated && <span className="text-muted-foreground">Last updated: <span className="tabular-nums">{lastUpdated}</span></span>}
            </div>
            <div className="flex items-center gap-2">
              <select value={preset} onChange={e => setPreset(e.target.value as Preset)}
                className="h-9 rounded-xl border border-input bg-card px-3 text-xs font-semibold shadow-card focus:border-brand focus:outline-none">
                {PRESETS.map(p => <option key={p.key} value={p.key}>{t(p.tKey)}</option>)}
              </select>
              <Button variant="outline" size="sm" className="h-9 rounded-xl" onClick={() => { loadAnalytics(); loadPetitions(); loadOps(); }} disabled={loading}>
                <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
              </Button>
            </div>
          </div>

          {/* Active filter chips */}
          {activeChips.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Filtered:</span>
              {activeChips.map(([dim, v]) => (
                <button key={dim} onClick={() => toggle(dim, v)}
                  className="inline-flex items-center gap-1 rounded-full bg-brand/10 px-2.5 py-1 text-xs font-semibold text-brand hover:bg-brand/20">
                  {dim}: {chipLabel(dim, v)} <X className="h-3 w-3" />
                </button>
              ))}
              <button onClick={() => setFilters({})} className="text-xs font-medium text-muted-foreground hover:text-foreground">{t("ov.clearAll")}</button>
            </div>
          )}

          {error && (
            <div className="rounded-lg border border-rose-300 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">{error}</div>
          )}

          {/* KPI cards */}
          {!data ? (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-[116px] rounded-2xl" />)}</div>
          ) : (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
              <KpiCard icon={Users} tone="brand" label={t("ov.kpiCitizens")} value={fmt(k!.citizens)} caption={t("ov.capUnique")} />
              <KpiCard icon={Megaphone} tone="violet" label={t("ov.kpiReceived")} value={fmt(k!.received)}
                caption={t("ov.capPeriod")} delta={k!.growth_pct} series={data.trend.map(t => t.received)} />
              <KpiCard icon={Gauge} tone="mint" label={t("ov.kpiResolution")} value={`${k!.resolution_rate}%`}
                caption={`${fmt(k!.resolved)} ${t("ov.capResolved")}`} series={data.trend.map(t => t.resolved)} seriesColor={C.mint} />
              <KpiCard icon={Timer} tone="amber" label={t("ov.kpiAvgResponse")} value={fmtDuration(k!.avg_response_hours)} caption={t("ov.capResolvedCases")} />
              <KpiCard icon={Handshake} tone="brand" label={t("ov.kpiCitizensMet")} value={fmt(k!.meeting_persons)} caption={`${fmt(k!.meetings)} ${t("ov.capAppointments")}`} />
              <KpiCard icon={CheckCircle2} tone="mint" label={t("ov.kpiOnTime")} value={`${k!.on_time_pct}%`} caption={t("ov.capWithinSla")} />
            </div>
          )}

          {/* Trend (2/3) + Priority donut (1/3) */}
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
            <Card className="p-4 lg:col-span-2">
              <VolumeTrend trend={data?.trend ?? null} loading={!data} />
            </Card>
            <Card className="p-4">
              <ChartHead icon={Flame} title={t("ov.priorityMix")} sub={t("ov.priorityMixSub")} />
              <PriorityDonut priority={data?.priority ?? null} total={priorityTotal}
                active={filters.priority} onSlice={(key) => toggle("priority", key)} loading={!data} />
            </Card>
          </div>

          {/* Category (2/3) + Ministry (1/3) */}
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
            <Card className="p-4 lg:col-span-2">
              <ChartHead icon={Megaphone} title={t("ov.byCategory")} sub={t("ov.byCategorySub")} />
              <CategoryBars data={localisedCategories} activeKey={filters.category}
                onBar={(key) => toggle("category", key)} loading={!data} />
            </Card>
            <Card className="p-4">
              <ChartHead icon={Landmark} title={t("ov.ministryDist")} sub={t("ov.ministryDistSub")} />
              <MinistryBars data={localisedMinistries} activeKey={filters.ministry}
                onBar={(key) => toggle("ministry", key)} loading={!data} />
            </Card>
          </div>

          {/* Department performance */}
          <Card className="overflow-hidden p-0">
            <div className="border-b border-border p-4">
              <ChartHead icon={Building2} title={t("ov.deptPerf")} sub={t("ov.deptPerfSub")} />
            </div>
            <DeptTable rows={localisedDepts} />
          </Card>

          {/* Geographic district distribution — counts on the map; click to filter */}
          <Card className="p-4">
            <ChartHead icon={MapPin} title={t("ov.byDistrict")} sub={t("ov.byDistrictSub")} />
            <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-[minmax(0,1fr)_240px]">
              <TamilNaduMap data={localisedDistricts} activeKey={filters.district} onSelect={(key) => toggle("district", key)} />
              <DistrictLeaders data={localisedDistricts} loading={ops == null} activeKey={filters.district} onSelect={(key) => toggle("district", key)} />
            </div>
          </Card>

          {/* Recent petitions */}
          <Card className="overflow-hidden p-0">
            <div className="flex flex-wrap items-center gap-2 border-b border-border p-4">
              <h2 className="type-card-heading">Recent Petitions {pets && <span className="text-muted-foreground tabular-nums">· {pets.total.toLocaleString("en-IN")}</span>}</h2>
              <a href={`/api/analytics/export?${qs()}`} className="ml-auto">
                <Button size="sm" variant="outline"><Download className="mr-1.5 h-3.5 w-3.5" /> Export CSV</Button>
              </a>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[620px] text-left text-sm">
                <thead className="bg-[#EDF1F8] text-[11px] uppercase tracking-[0.09em] text-muted-foreground/80">
                  <tr>
                    <th className="px-4 py-3">{t("ov.colCitizen")}</th>
                    <th className="px-4 py-3">{t("ov.colAsk")}</th>
                    <Th label={t("ov.colCategory")} col="category" sort={sort} onSort={setSort} />
                  </tr>
                </thead>
                <tbody>
                  {!pets ? (
                    <tr><td colSpan={3} className="px-4 py-10 text-center text-muted-foreground">Loading…</td></tr>
                  ) : pets.items.length === 0 ? (
                    <tr><td colSpan={3} className="px-4 py-10 text-center text-muted-foreground">No petitions match the filters.</td></tr>
                  ) : pets.items.map(p => (
                    <tr key={p.id} onClick={() => openDetail(p.id)} className="cursor-pointer border-t border-border/70 transition-colors hover:bg-[#EFF3FB]">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2.5">
                          <InitialsAvatar name={p.name} className="h-8 w-8 rounded-lg text-[10px]" />
                          <div className="min-w-0 leading-tight">
                            <div className="type-table-row truncate text-foreground">{p.name}</div>
                            <div className="font-mono text-[11px] font-semibold text-brand">{p.token}</div>
                          </div>
                        </div>
                      </td>
                      <td className="max-w-[460px] px-4 py-3 text-[13px] text-foreground/85">
                        <span className="line-clamp-2">{p.citizen_ask || <span className="italic text-muted-foreground">{t("ov.noSummary")}</span>}</span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{catText(p.category, p.category_label)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {pets && pets.pages > 1 && (
              <div className="flex items-center justify-between border-t border-border px-4 py-2.5 text-xs">
                <span className="text-muted-foreground">{t("ov.page")} <span className="tabular-nums">{pets.page}</span> {t("ov.pageOf")} <span className="tabular-nums">{pets.pages}</span></span>
                <div className="flex gap-1">
                  <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(p => p - 1)}><ChevronLeft className="h-4 w-4" /></Button>
                  <Button size="sm" variant="outline" disabled={page >= pets.pages} onClick={() => setPage(p => p + 1)}><ChevronRight className="h-4 w-4" /></Button>
                </div>
              </div>
            )}
          </Card>
        </div>
      </main>

      <AppointmentDetailDrawer row={selected} onClose={() => setSelected(null)} onStatusChange={() => { loadAnalytics(); loadPetitions(); }} />
    </>
  );
}

// ── KPI card ─────────────────────────────────────────────────────────────────
const TONE: Record<string, { bg: string; fg: string }> = {
  brand:  { bg: "bg-brand/10",    fg: "text-brand" },
  violet: { bg: "bg-[#EDE9FE]",   fg: "text-[#6D28D9]" },
  mint:   { bg: "bg-[#DCFAE6]",   fg: "text-[#0F8B4C]" },
  amber:  { bg: "bg-[#FEF0D9]",   fg: "text-[#B45309]" },
  rose:   { bg: "bg-[#FEE4E2]",   fg: "text-[#C0362C]" },
};
function KpiCard({ icon: Icon, tone, label, value, caption, delta, series, seriesColor }: {
  icon: any; tone: keyof typeof TONE; label: string; value: string; caption: string;
  delta?: number | null; series?: number[]; seriesColor?: string;
}) {
  const t = TONE[tone];
  const sparkData = series && series.length > 1 ? series.map((v, i) => ({ i, v })) : null;
  return (
    <Card className="flex flex-col gap-2 p-4">
      <div className="flex items-start justify-between">
        <span className={cn("grid h-9 w-9 place-items-center rounded-xl", t.bg, t.fg)}>
          <Icon className="h-[18px] w-[18px]" />
        </span>
        {delta != null && (
          <span className={cn("inline-flex items-center gap-0.5 text-[11px] font-semibold tabular-nums",
            delta >= 0 ? "text-[#0F8B4C]" : "text-[#C0362C]")}>
            {delta >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
            {Math.abs(delta).toFixed(1)}%
          </span>
        )}
      </div>
      <div>
        <div className="type-caption text-muted-foreground">{label}</div>
        <div className="font-mono text-[26px] font-bold leading-tight tracking-tight text-foreground tabular-nums">{value}</div>
        <div className="type-caption text-muted-foreground">{caption}</div>
      </div>
      {sparkData && (
        <div className="-mb-1 h-7 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={sparkData} margin={{ top: 2, bottom: 2, left: 0, right: 0 }}>
              <Line type="monotone" dataKey="v" stroke={seriesColor ?? C.brand} strokeWidth={1.75} dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </Card>
  );
}

// ── Volume trend ─────────────────────────────────────────────────────────────
type Gran = "daily" | "weekly" | "monthly";
function isoWeek(d: Date): string {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - day);
  const yStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const wk = Math.ceil((((t.getTime() - yStart.getTime()) / 86400000) + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(wk).padStart(2, "0")}`;
}
function rollup(trend: TrendPoint[], gran: Gran) {
  if (gran === "daily") {
    return trend.map(p => ({ label: new Date(p.date).toLocaleDateString("en-IN", { day: "2-digit", month: "short" }), received: p.received, resolved: p.resolved }));
  }
  const buckets = new Map<string, { received: number; resolved: number }>();
  for (const p of trend) {
    const key = gran === "weekly" ? isoWeek(new Date(p.date)) : p.date.slice(0, 7);
    const b = buckets.get(key) ?? { received: 0, resolved: 0 };
    b.received += p.received; b.resolved += p.resolved; buckets.set(key, b);
  }
  return [...buckets.entries()].map(([key, b]) => ({
    label: gran === "monthly" ? new Date(key + "-01").toLocaleDateString("en-IN", { month: "short", year: "2-digit" }) : key,
    ...b,
  }));
}
function VolumeTrend({ trend, loading }: { trend: TrendPoint[] | null; loading: boolean }) {
  const { t } = useLang();
  const [gran, setGran] = useState<Gran>("daily");
  const rows = useMemo(() => (trend ? rollup(trend, gran) : []), [trend, gran]);
  return (
    <>
      <div className="mb-3 flex items-start justify-between">
        <div>
          <div className="type-card-heading inline-flex items-center gap-2"><TrendingUp className="h-4 w-4 text-brand" /> Petition Volume Trend</div>
          <div className="type-caption text-muted-foreground">{t("ov.trendSub")}</div>
        </div>
        <div className="flex rounded-lg border border-border bg-muted/40 p-0.5">
          {(["daily", "weekly", "monthly"] as Gran[]).map(g => (
            <button key={g} onClick={() => setGran(g)}
              className={cn("rounded-md px-2.5 py-1 text-[11px] font-semibold capitalize transition-colors",
                gran === g ? "bg-card text-brand shadow-card" : "text-muted-foreground hover:text-foreground")}>
              {g}
            </button>
          ))}
        </div>
      </div>
      <div className="h-[240px] w-full">
        {loading ? <Skeleton className="h-full w-full" /> : rows.length === 0 ? <Empty /> : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
              <defs>
                <linearGradient id="gRecv" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={C.brand} stopOpacity={0.22} /><stop offset="100%" stopColor={C.brand} stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gRes" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={C.mint} stopOpacity={0.20} /><stop offset="100%" stopColor={C.mint} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={C.grid} vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: C.muted }} tickLine={false} axisLine={{ stroke: C.border }} minTickGap={16} />
              <YAxis tick={{ fontSize: 11, fill: C.muted }} tickLine={false} axisLine={false} width={40} allowDecimals={false} />
              <Tooltip contentStyle={{ borderRadius: 10, border: `1px solid ${C.border}`, fontSize: 12, fontFamily: "var(--font-mono)" }} />
              <Area type="monotone" dataKey="received" name="Received" stroke={C.brand} strokeWidth={2} fill="url(#gRecv)" isAnimationActive={false} />
              <Area type="monotone" dataKey="resolved" name="Resolved" stroke={C.mint} strokeWidth={2} fill="url(#gRes)" isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
      <div className="mt-2 flex items-center justify-center gap-5 text-[11px] text-muted-foreground">
        <Legend color={C.brand} label={t("ov.received")} />
        <Legend color={C.mint} label={t("ov.resolved")} />
      </div>
    </>
  );
}

// ── Priority donut ───────────────────────────────────────────────────────────
function PriorityDonut({ priority, total, active, onSlice, loading }: {
  priority: Analytics["priority"] | null; total: number; active?: string;
  onSlice: (key: string) => void; loading: boolean;
}) {
  const { t } = useLang();
  if (loading) return <div className="h-[240px]"><Skeleton className="h-full w-full" /></div>;
  const slices = PRIORITY_META.map(p => ({ ...p, label: t(p.tKey), value: priority?.[p.key] ?? 0 })).filter(s => s.value > 0);
  return (
    <div className="flex flex-col items-center gap-3">
      <div className="relative h-[180px] w-full">
        {total === 0 ? <Empty /> : (
          <>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={slices} dataKey="value" nameKey="label" cx="50%" cy="50%" innerRadius={54} outerRadius={80} paddingAngle={2} stroke="none" isAnimationActive={false}>
                  {slices.map(s => (
                    <Cell key={s.key} fill={s.color} opacity={active && active !== s.key ? 0.35 : 1} className="cursor-pointer" onClick={() => onSlice(s.key)} />
                  ))}
                </Pie>
                <Tooltip contentStyle={{ borderRadius: 10, border: `1px solid ${C.border}`, fontSize: 12, fontFamily: "var(--font-mono)" }} />
              </PieChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <span className="font-mono text-2xl font-bold tabular-nums text-foreground">{total.toLocaleString("en-IN")}</span>
              <span className="type-caption text-muted-foreground">{t("ov.total")}</span>
            </div>
          </>
        )}
      </div>
      <div className="w-full space-y-1">
        {PRIORITY_META.map(p => {
          const v = priority?.[p.key] ?? 0;
          return (
            <button key={p.key} onClick={() => onSlice(p.key)}
              className={cn("flex w-full items-center justify-between rounded-md px-1.5 py-1 text-[12px] transition-colors hover:bg-muted", active === p.key && "bg-brand/10 ring-1 ring-brand/20")}>
              <span className="inline-flex items-center gap-2"><span className="h-2 w-2 rounded-full" style={{ background: p.color }} />{t(p.tKey)}</span>
              <span className="font-semibold tabular-nums">{v.toLocaleString("en-IN")}<span className="ml-1 text-[10px] font-medium text-muted-foreground">{total ? Math.round(v / total * 100) : 0}%</span></span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Horizontal bar charts (category / ministry) ──────────────────────────────
function HBars({ data, activeKey, onBar, loading, color, height }: {
  data: Bar[] | null; activeKey?: string; onBar: (key: string) => void; loading: boolean; color: string; height: number;
}) {
  if (loading) return <div style={{ height }}><Skeleton className="h-full w-full" /></div>;
  if (!data || data.length === 0) return <div style={{ height }}><Empty /></div>;
  const rows = data.map(d => ({ ...d, name: d.label.length > 22 ? d.label.slice(0, 21) + "…" : d.label }));
  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} layout="vertical" margin={{ top: 0, right: 28, bottom: 0, left: 8 }} barCategoryGap={6}>
          <XAxis type="number" hide />
          <YAxis type="category" dataKey="name" width={140} tick={{ fontSize: 11.5, fill: C.ink }} tickLine={false} axisLine={false} />
          <Tooltip cursor={{ fill: C.grid }} contentStyle={{ borderRadius: 10, border: `1px solid ${C.border}`, fontSize: 12, fontFamily: "var(--font-mono)" }} />
          <RBar dataKey="count" radius={[0, 5, 5, 0]} isAnimationActive={false} label={{ position: "right", fontSize: 11, fill: C.muted, fontFamily: "var(--font-mono)" }}>
            {rows.map(r => (
              <Cell key={r.key} fill={color} opacity={activeKey && activeKey !== r.key ? 0.4 : 1} className="cursor-pointer" onClick={() => onBar(r.key)} />
            ))}
          </RBar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
function CategoryBars(props: Omit<Parameters<typeof HBars>[0], "color" | "height">) {
  return <HBars {...props} color={C.brand} height={300} />;
}
function MinistryBars(props: Omit<Parameters<typeof HBars>[0], "color" | "height">) {
  return <HBars {...props} color="#6D28D9" height={300} />;
}

// ── Department performance table (Phase 2) ───────────────────────────────────
function DeptTable({ rows }: { rows: DeptPerf[] | null }) {
  const { t } = useLang();
  if (rows == null) return <div className="p-4"><Skeleton className="h-40 w-full" /></div>;
  if (rows.length === 0) return <div className="grid h-32 place-items-center text-[12px] italic text-muted-foreground">{t("ov.noDepts")}</div>;
  const rateTone = (r: number) => r >= 80 ? "text-[#0F8B4C]" : r >= 50 ? "text-[#B45309]" : "text-[#C0362C]";
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[860px] text-left text-sm">
        <thead className="bg-[#EDF1F8] text-[11px] uppercase tracking-[0.08em] text-muted-foreground/80">
          <tr>
            <th className="px-4 py-2.5">{t("ov.colDept")}</th>
            <th className="px-3 py-2.5 text-right">{t("ov.colOpen")}</th>
            <th className="px-3 py-2.5 text-right">{t("ov.colResolvedH")}</th>
            <th className="px-3 py-2.5 text-right">{t("ov.colResolutionH")}</th>
            <th className="px-3 py-2.5 text-right">{t("ov.colAvgTime")}</th>
            <th className="px-3 py-2.5 text-right">{t("ov.colOnTimeH")}</th>
            <th className="px-3 py-2.5 text-right">{t("ov.colAcceptance")}</th>
            <th className="px-4 py-2.5">{t("ov.colProgress")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(d => (
            <tr key={d.key} className="border-t border-border/70 hover:bg-[#EFF3FB]">
              <td className="px-4 py-3">
                <div className="flex items-center gap-2">
                  <span className="grid h-7 w-7 flex-shrink-0 place-items-center rounded-lg bg-brand/10 text-brand"><Building2 className="h-3.5 w-3.5" /></span>
                  <span className="truncate font-medium text-foreground">{d.label}</span>
                </div>
              </td>
              <td className="px-3 py-3 text-right font-mono tabular-nums text-foreground">{d.open}</td>
              <td className="px-3 py-3 text-right font-mono tabular-nums text-foreground">{d.resolved}</td>
              <td className={cn("px-3 py-3 text-right font-mono font-semibold tabular-nums", rateTone(d.resolution_rate))}>{d.resolution_rate}%</td>
              <td className="px-3 py-3 text-right font-mono tabular-nums text-muted-foreground">{d.avg_resolution_days != null ? `${d.avg_resolution_days}d` : "—"}</td>
              <td className="px-3 py-3 text-right font-mono tabular-nums text-muted-foreground">{d.on_time_pct != null ? `${d.on_time_pct}%` : "—"}</td>
              <td className="px-3 py-3 text-right font-mono tabular-nums text-muted-foreground">{fmtAccept(d.avg_accept_minutes)}</td>
              <td className="px-4 py-3">
                <div className="flex items-center gap-2">
                  <div className="h-1.5 w-24 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-brand" style={{ width: `${d.avg_progress}%` }} /></div>
                  <span className="font-mono text-[11px] tabular-nums text-muted-foreground">{d.avg_progress}%</span>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
function fmtAccept(min: number | null): string {
  if (min == null) return "—";
  if (min < 60) return `${Math.round(min)}m`;
  if (min < 1440) return `${(min / 60).toFixed(1)}h`;
  return `${(min / 1440).toFixed(1)}d`;
}

// ── District leaders — compact text ranking beside the map (Phase 2) ─────────
function DistrictLeaders({ data, loading, activeKey, onSelect }: {
  data: Bar[] | null; loading: boolean; activeKey?: string; onSelect?: (key: string) => void;
}) {
  const { t } = useLang();
  if (loading) return <Skeleton className="h-[300px] w-full" />;
  if (!data || data.length === 0) {
    return (
      <div className="grid h-full min-h-[200px] place-items-center px-3 text-center">
        <div className="space-y-1">
          <MapPin className="mx-auto h-6 w-6 text-muted-foreground/40" />
          <div className="text-[12px] font-medium text-muted-foreground">{t("ov.noDistricts")}</div>
          <div className="text-[11px] text-muted-foreground/80">Filled as petitions are summarised, or set on a ticket.</div>
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-col">
      <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{t("ov.rankedByVolume")}</div>
      <div className="max-h-[400px] space-y-0.5 overflow-y-auto pr-1">
        {data.map((d, i) => (
          <button key={d.key} onClick={() => onSelect?.(d.key)}
            className={cn("flex w-full items-center justify-between rounded-md px-2 py-1.5 text-[12.5px] transition-colors hover:bg-muted/50",
              activeKey === d.key && "bg-brand/10 ring-1 ring-brand/20")}>
            <span className="inline-flex min-w-0 items-center gap-2">
              <span className="grid h-4 w-4 flex-shrink-0 place-items-center rounded bg-brand/10 font-mono text-[9px] font-bold text-brand">{i + 1}</span>
              <span className="truncate text-foreground/90">{d.label}</span>
            </span>
            <span className="ml-2 flex-shrink-0 font-mono font-bold tabular-nums text-foreground">{d.count.toLocaleString("en-IN")}</span>
          </button>
        ))}
      </div>
    </div>
  );
}


// ── Small shared bits ────────────────────────────────────────────────────────
function ChartHead({ icon: Icon, title, sub }: { icon: any; title: string; sub: string }) {
  return (
    <div className="mb-3">
      <div className="type-card-heading inline-flex items-center gap-2"><Icon className="h-4 w-4 text-brand" /> {title}</div>
      <div className="type-caption text-muted-foreground">{sub}</div>
    </div>
  );
}
function Legend({ color, label }: { color: string; label: string }) {
  return <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: color }} />{label}</span>;
}
function Th({ label, col, sort, onSort }: { label: string; col: string; sort: { by: string; dir: "asc" | "desc" }; onSort: (s: any) => void }) {
  return (
    <th className="cursor-pointer select-none px-4 py-2.5 hover:text-foreground" onClick={() => onSort((s: any) => ({ by: col, dir: s.by === col && s.dir === "desc" ? "asc" : "desc" }))}>
      <span className="inline-flex items-center gap-1">{label} <ArrowUpDown className={cn("h-3 w-3", sort.by === col ? "text-brand" : "opacity-30")} /></span>
    </th>
  );
}
function Empty() {
  const { t } = useLang();
  return <div className="grid h-full min-h-[80px] place-items-center text-[12px] italic text-muted-foreground">{t("ov.noData")}</div>;
}
