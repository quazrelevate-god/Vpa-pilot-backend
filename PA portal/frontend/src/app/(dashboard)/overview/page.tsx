"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Users, Megaphone, Flame, Handshake, ClipboardList, RefreshCw, Download, X,
  ChevronLeft, ChevronRight, ArrowUpDown, Radio,
} from "lucide-react";

import TopBar from "@/components/TopBar";
import MetricTile from "@/components/MetricTile";
import AppointmentDetailDrawer from "@/components/AppointmentDetailDrawer";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { AppointmentRow } from "@/lib/types";
import { cn } from "@/lib/utils";

// ── Types ──────────────────────────────────────────────────────────────────────
interface Bar { key: string; label: string; count: number }
interface Analytics {
  kpis: { received: number; citizens: number; urgent: number; meetings: number; meeting_persons: number; awaiting_review: number; growth_pct: number | null };
  categories: Bar[]; departments: Bar[]; channels: Bar[];
  urgency: { critical: number; high: number; medium: number; low: number };
  trend: { date: string; count: number }[];
}
interface Petition {
  id: number; token: string; name: string; mobile: string; category: string | null;
  category_label: string; urgency: string | null; status: string; source: string;
  source_label: string; schedule_meeting: boolean; created_at: string | null;
}
type Filters = { category?: string; urgency?: string; department?: string; channel?: string };

// ── Date presets ────────────────────────────────────────────────────────────────
type Preset = "today" | "7d" | "30d" | "90d" | "month" | "lastmonth" | "quarter" | "year" | "all";
const PRESETS: { key: Preset; label: string }[] = [
  { key: "today", label: "Today" }, { key: "7d", label: "7 days" }, { key: "30d", label: "30 days" },
  { key: "90d", label: "90 days" }, { key: "month", label: "This month" }, { key: "lastmonth", label: "Last month" },
  { key: "quarter", label: "This quarter" }, { key: "year", label: "This year" }, { key: "all", label: "All time" },
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

const URGENCY_TONE: Record<string, string> = { critical: "bg-rose-500", high: "bg-orange-500", medium: "bg-amber-400", low: "bg-emerald-500" };
const fmt = (v: number | undefined | null) => (v == null ? "—" : v.toLocaleString());

export default function OverviewPage() {
  const [preset, setPreset] = useState<Preset>("30d");
  const [filters, setFilters] = useState<Filters>({});
  const [data, setData] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // table
  const [pets, setPets] = useState<{ items: Petition[]; total: number; page: number; pages: number } | null>(null);
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<{ by: string; dir: "asc" | "desc" }>({ by: "created_at", dir: "desc" });
  const [selected, setSelected] = useState<AppointmentRow | null>(null);

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
    } catch (e) { setError(`Could not reach the analytics API: ${(e as Error).message}`); }
    finally { setLoading(false); }
  }, [qs]);

  const loadPetitions = useCallback(async () => {
    try {
      const r = await fetch(`/api/analytics/petitions?${qs({ page, page_size: 50, sort: sort.by, direction: sort.dir })}`, { credentials: "include" });
      if (!r.ok) { setPets({ items: [], total: 0, page: 1, pages: 1 }); return; }
      setPets(await r.json());
    } catch { setPets({ items: [], total: 0, page: 1, pages: 1 }); }
  }, [qs, page, sort]);

  useEffect(() => { loadAnalytics(); }, [loadAnalytics]);
  useEffect(() => { loadPetitions(); }, [loadPetitions]);
  // reset to page 1 whenever the scope changes
  useEffect(() => { setPage(1); }, [preset, filters]);

  // toggle a filter (click again to clear)
  function toggle(dim: keyof Filters, key: string) {
    setFilters(f => ({ ...f, [dim]: f[dim] === key ? undefined : key }));
  }
  const activeChips = Object.entries(filters).filter(([, v]) => v) as [keyof Filters, string][];
  const chipLabel = (dim: keyof Filters, v: string) => {
    if (dim === "category") return data?.categories.find(c => c.key === v)?.label ?? v;
    if (dim === "department") return data?.departments.find(c => c.key === v)?.label ?? v;
    if (dim === "channel") return data?.channels.find(c => c.key === v)?.label ?? v;
    return v;
  };

  const k = data?.kpis;
  const urgencyTotal = data ? Object.values(data.urgency).reduce((a, b) => a + b, 0) : 0;
  const maxCat = Math.max(1, ...(data?.categories ?? []).map(c => c.count));
  const maxDept = Math.max(1, ...(data?.departments ?? []).map(c => c.count));
  const maxChan = Math.max(1, ...(data?.channels ?? []).map(c => c.count));

  return (
    <>
      <TopBar />
      <main className="flex-1 overflow-y-auto bg-background">
        <div className="space-y-3 px-3 py-4 animate-in-up">
          {/* Header */}
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1 className="text-[22px] font-extrabold tracking-tight">Voice of the People</h1>
              <p className="text-[12.5px] text-muted-foreground">Live petition analytics · click any chart to filter the whole page</p>
            </div>
            <div className="flex items-center gap-2">
              <select value={preset} onChange={e => setPreset(e.target.value as Preset)}
                className="rounded-lg border border-input bg-card px-3 py-1.5 text-xs font-semibold focus:border-brand focus:outline-none">
                {PRESETS.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
              </select>
              <Button variant="outline" size="sm" onClick={() => { loadAnalytics(); loadPetitions(); }} disabled={loading}>
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
              <button onClick={() => setFilters({})} className="text-xs font-medium text-muted-foreground hover:text-foreground">Clear all</button>
            </div>
          )}

          {/* Error banner */}
          {error && (
            <div className="rounded-lg border border-rose-300 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">
              {error}
            </div>
          )}

          {/* KPIs */}
          {!data ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-[108px] rounded-2xl" />)}</div>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              <MetricTile label="Petitions" value={fmt(k!.received)} caption="received" icon={Megaphone} tone="brand" deltaPct={k!.growth_pct ?? undefined} />
              <MetricTile label="Citizens" value={fmt(k!.citizens)} caption="unique people" icon={Users} tone="violet" />
              <MetricTile label="Urgent" value={fmt(k!.urgent)} caption="critical + high" icon={Flame} tone="rose" />
              <MetricTile label="Meetings" value={fmt(k!.meetings)} caption={`${fmt(k!.meeting_persons)} people`} icon={Handshake} tone="amber" />
              <MetricTile label="Awaiting review" value={fmt(k!.awaiting_review)} caption="pending PA" icon={ClipboardList} tone={k!.awaiting_review > 50 ? "rose" : "slate"} />
            </div>
          )}

          {/* Charts */}
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
            {/* Voice of the People — categories (hero) */}
            <Card className="p-4 lg:col-span-2">
              <ChartHead icon={Megaphone} title="Voice of the People" sub="Top categories — click a bar to filter" />
              <div className="space-y-1.5">
                {(data?.categories ?? []).map(c => (
                  <BarRow key={c.key} label={c.label} count={c.count} pct={Math.round(c.count / maxCat * 100)}
                    active={filters.category === c.key} onClick={() => toggle("category", c.key)} tone="bg-brand" total={k?.received} />
                ))}
                {data && data.categories.length === 0 && <Empty />}
              </div>
            </Card>

            {/* Trend */}
            <Card className="flex flex-col p-4">
              <ChartHead icon={Radio} title="Daily volume" sub="Petitions received over the period" />
              <div className="min-h-[160px] flex-1">{data ? <Trend points={data.trend} /> : <Skeleton className="h-full w-full" />}</div>
            </Card>
          </div>

          <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
            {/* Urgency */}
            <Card className="p-4">
              <ChartHead icon={Flame} title="Urgency mix" sub="Click a level to filter" />
              <div className="mb-2 flex h-2.5 w-full overflow-hidden rounded-full bg-muted">
                {(["critical", "high", "medium", "low"] as const).map(lv => {
                  const v = data?.urgency[lv] ?? 0; const pct = urgencyTotal ? v / urgencyTotal * 100 : 0;
                  return <div key={lv} className={URGENCY_TONE[lv]} style={{ width: `${pct}%` }} title={`${lv}: ${v}`} />;
                })}
              </div>
              <div className="space-y-1">
                {(["critical", "high", "medium", "low"] as const).map(lv => {
                  const v = data?.urgency[lv] ?? 0;
                  return (
                    <button key={lv} onClick={() => toggle("urgency", lv)}
                      className={cn("flex w-full items-center justify-between rounded-md px-1.5 py-1 text-[12px] transition-colors hover:bg-muted", filters.urgency === lv && "bg-brand/10 ring-1 ring-brand/20")}>
                      <span className="inline-flex items-center gap-2 capitalize"><span className={cn("h-2 w-2 rounded-full", URGENCY_TONE[lv])} />{lv}</span>
                      <span className="font-semibold tabular-nums">{v}<span className="ml-1 text-[10px] text-muted-foreground">{urgencyTotal ? Math.round(v / urgencyTotal * 100) : 0}%</span></span>
                    </button>
                  );
                })}
              </div>
            </Card>

            {/* Departments */}
            <Card className="p-4">
              <ChartHead icon={Megaphone} title="Departments" sub="Where the load falls" />
              <div className="space-y-1.5">
                {(data?.departments ?? []).slice(0, 6).map(c => (
                  <BarRow key={c.key} label={c.label} count={c.count} pct={Math.round(c.count / maxDept * 100)}
                    active={filters.department === c.key} onClick={() => toggle("department", c.key)} tone="bg-cyan-500" />
                ))}
                {data && data.departments.length === 0 && <Empty />}
              </div>
            </Card>

            {/* Channels */}
            <Card className="p-4">
              <ChartHead icon={Radio} title="Channels" sub="How petitions arrive" />
              <div className="space-y-1.5">
                {(data?.channels ?? []).map(c => (
                  <BarRow key={c.key} label={c.label} count={c.count} pct={Math.round(c.count / maxChan * 100)}
                    active={filters.channel === c.key} onClick={() => toggle("channel", c.key)} tone="bg-violet-500" total={k?.received} />
                ))}
                {data && data.channels.length === 0 && <Empty />}
              </div>
            </Card>
          </div>

          {/* Full petitions table */}
          <Card className="overflow-hidden p-0">
            <div className="flex flex-wrap items-center gap-2 border-b border-border p-4">
              <h2 className="text-sm font-bold">All petitions {pets && <span className="text-muted-foreground">· {pets.total.toLocaleString()}</span>}</h2>
              <a href={`/api/analytics/export?${qs()}`} className="ml-auto">
                <Button size="sm" variant="outline"><Download className="mr-1.5 h-3.5 w-3.5" /> Export CSV</Button>
              </a>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] text-left text-sm">
                <thead className="bg-muted/50 text-[11px] uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2.5">Name</th>
                    <th className="px-4 py-2.5">Mobile</th>
                    <Th label="Category" col="category" sort={sort} onSort={setSort} />
                    <th className="px-4 py-2.5">Urgency</th>
                    <Th label="Status" col="status" sort={sort} onSort={setSort} />
                    <th className="px-4 py-2.5">Channel</th>
                    <Th label="Submitted" col="created_at" sort={sort} onSort={setSort} />
                  </tr>
                </thead>
                <tbody>
                  {!pets ? (
                    <tr><td colSpan={7} className="px-4 py-10 text-center text-muted-foreground">Loading…</td></tr>
                  ) : pets.items.length === 0 ? (
                    <tr><td colSpan={7} className="px-4 py-10 text-center text-muted-foreground">No petitions match the filters.</td></tr>
                  ) : pets.items.map(p => (
                    <tr key={p.id} onClick={() => openDetail(p.id)} className="cursor-pointer border-t border-border/70 hover:bg-muted/30">
                      <td className="px-4 py-2.5 font-medium">{p.name}</td>
                      <td className="px-4 py-2.5 text-muted-foreground">{p.mobile}</td>
                      <td className="px-4 py-2.5 text-muted-foreground">{p.category_label}</td>
                      <td className="px-4 py-2.5">{p.urgency ? <span className={cn("rounded px-1.5 py-0.5 text-[11px] font-semibold capitalize text-white", URGENCY_TONE[p.urgency])}>{p.urgency}</span> : "—"}</td>
                      <td className="px-4 py-2.5 text-[12px]">{p.status.replace(/_/g, " ").toLowerCase()}</td>
                      <td className="px-4 py-2.5 text-[12px] text-muted-foreground">{p.source_label}</td>
                      <td className="px-4 py-2.5 text-[12px] text-muted-foreground">{p.created_at ? new Date(p.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {pets && pets.pages > 1 && (
              <div className="flex items-center justify-between border-t border-border px-4 py-2.5 text-xs">
                <span className="text-muted-foreground">Page {pets.page} of {pets.pages}</span>
                <div className="flex gap-1">
                  <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(p => p - 1)}><ChevronLeft className="h-4 w-4" /></Button>
                  <Button size="sm" variant="outline" disabled={page >= pets.pages} onClick={() => setPage(p => p + 1)}><ChevronRight className="h-4 w-4" /></Button>
                </div>
              </div>
            )}
          </Card>
        </div>
      </main>

      {/* Petition detail — summary + attachments */}
      <AppointmentDetailDrawer
        row={selected}
        onClose={() => setSelected(null)}
        onStatusChange={() => { loadAnalytics(); loadPetitions(); }}
      />
    </>
  );
}

// ── Small components ─────────────────────────────────────────────────────────────
function ChartHead({ icon: Icon, title, sub }: { icon: any; title: string; sub: string }) {
  return (
    <div className="mb-3">
      <div className="inline-flex items-center gap-1.5 text-[13px] font-bold"><Icon className="h-3.5 w-3.5 text-brand" /> {title}</div>
      <div className="text-[11px] text-muted-foreground">{sub}</div>
    </div>
  );
}
function BarRow({ label, count, pct, active, onClick, tone, total }: { label: string; count: number; pct: number; active: boolean; onClick: () => void; tone: string; total?: number }) {
  return (
    <button onClick={onClick} className={cn("group block w-full rounded-md px-1.5 py-1 text-left transition-colors hover:bg-muted", active && "bg-brand/10 ring-1 ring-brand/20")}>
      <div className="mb-0.5 flex items-center justify-between text-[12px]">
        <span className="truncate pr-2 font-medium text-foreground/90">{label}</span>
        <span className="shrink-0 font-bold tabular-nums">{count}{total ? <span className="ml-1 text-[10px] font-medium text-muted-foreground">{Math.round(count / total * 100)}%</span> : null}</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted"><div className={cn("h-full rounded-full", tone)} style={{ width: `${pct}%` }} /></div>
    </button>
  );
}
function Th({ label, col, sort, onSort }: { label: string; col: string; sort: { by: string; dir: "asc" | "desc" }; onSort: (s: any) => void }) {
  return (
    <th className="cursor-pointer select-none px-4 py-2.5 hover:text-foreground" onClick={() => onSort((s: any) => ({ by: col, dir: s.by === col && s.dir === "desc" ? "asc" : "desc" }))}>
      <span className="inline-flex items-center gap-1">{label} <ArrowUpDown className={cn("h-3 w-3", sort.by === col ? "text-brand" : "opacity-30")} /></span>
    </th>
  );
}
function Trend({ points }: { points: { date: string; count: number }[] }) {
  if (!points.length) return <div className="grid h-full place-items-center text-[12px] italic text-muted-foreground">No data</div>;
  const max = Math.max(1, ...points.map(p => p.count));
  const W = 100, H = 100;
  const step = points.length > 1 ? W / (points.length - 1) : 0;
  const pts = points.map((p, i) => `${i * step},${H - (p.count / max) * H}`);
  const area = `0,${H} ${pts.join(" ")} ${(points.length - 1) * step},${H}`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-full w-full">
      <polygon points={area} fill="currentColor" fillOpacity="0.12" className="text-brand" />
      <polyline points={pts.join(" ")} fill="none" stroke="currentColor" strokeWidth="1.5" vectorEffect="non-scaling-stroke" className="text-brand" />
    </svg>
  );
}
function Empty() { return <div className="grid h-24 place-items-center text-[12px] italic text-muted-foreground">No data in this scope</div>; }
