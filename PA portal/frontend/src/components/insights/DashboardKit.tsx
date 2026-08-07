"use client";

/**
 * Shared building blocks for the Minister's Proposal + Association dashboards.
 *
 * One visual system, composed by both pages: stat tiles, a titled chart card,
 * a labelled horizontal-bar breakdown, a donut with a legend, a trend area, a
 * ranked list, and the empty / access states. Kept deliberately presentational
 * (data in, pixels out) so each dashboard page only wires data + copy.
 *
 * Matches the PA-portal design tokens already used by /overview (Card,
 * shadow-card, brand blue, muted foreground, IBM Plex Mono for numbers).
 */
import { type ReactNode } from "react";
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip,
  PieChart, Pie, Cell, LineChart, Line,
} from "recharts";
import { TrendingUp, TrendingDown, ShieldAlert } from "lucide-react";

import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

// ── palette ──────────────────────────────────────────────────────────────────
export const C = {
  brand:   "#1E40AF",
  violet:  "#6D28D9",
  mint:    "#0F8B4C",
  amber:   "#B45309",
  rose:    "#C0362C",
  sky:     "#2F6FED",
  slate:   "#64748B",
  gridline:"#E9EDF4",
};

// A stable, legible categorical ramp for donuts / bars.
export const SERIES = ["#1E40AF", "#2F6FED", "#6D28D9", "#0F8B4C", "#B45309", "#C0362C", "#0E7490", "#9333EA"];

export const fmtInt = (v: number | null | undefined) =>
  v == null ? "—" : v.toLocaleString("en-IN");

// ── tone map for stat tiles ──────────────────────────────────────────────────
const TONE: Record<string, { bg: string; fg: string }> = {
  brand:  { bg: "bg-brand/10",    fg: "text-brand" },
  violet: { bg: "bg-[#EDE9FE]",   fg: "text-[#6D28D9]" },
  mint:   { bg: "bg-[#DCFAE6]",   fg: "text-[#0F8B4C]" },
  amber:  { bg: "bg-[#FEF0D9]",   fg: "text-[#B45309]" },
  rose:   { bg: "bg-[#FEE4E2]",   fg: "text-[#C0362C]" },
  slate:  { bg: "bg-slate-100",   fg: "text-slate-600" },
};

// ── stat tile ─────────────────────────────────────────────────────────────────
export function StatTile({
  icon: Icon, tone = "brand", label, value, caption, delta, series, accent, highlight,
}: {
  icon: any; tone?: keyof typeof TONE; label: string; value: string;
  caption?: string; delta?: number | null; series?: number[]; accent?: string; highlight?: boolean;
}) {
  const t = TONE[tone];
  const spark = series && series.length > 1 ? series.map((v, i) => ({ i, v })) : null;
  return (
    <Card className={cn(
      "flex flex-col gap-2 p-4 transition-shadow hover:shadow-card-md",
      highlight && "ring-1 ring-brand/25 bg-brand/[0.03]",
    )}>
      <div className="flex items-start justify-between">
        <span className={cn("grid h-9 w-9 place-items-center rounded-xl", t.bg, t.fg)}>
          <Icon className="h-[18px] w-[18px]" />
        </span>
        {delta != null && Number.isFinite(delta) && (
          <span className={cn("inline-flex items-center gap-0.5 text-[11px] font-semibold tabular-nums",
            delta >= 0 ? "text-[#0F8B4C]" : "text-[#C0362C]")}>
            {delta >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
            {Math.abs(delta).toFixed(0)}%
          </span>
        )}
      </div>
      <div>
        <div className="type-caption text-muted-foreground">{label}</div>
        <div className="font-mono text-[26px] font-bold leading-tight tracking-tight text-foreground tabular-nums">{value}</div>
        {caption && <div className="type-caption text-muted-foreground">{caption}</div>}
      </div>
      {spark && (
        <div className="-mb-1 h-7 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={spark} margin={{ top: 2, bottom: 2, left: 0, right: 0 }}>
              <Line type="monotone" dataKey="v" stroke={accent ?? C.brand} strokeWidth={1.75} dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </Card>
  );
}

// ── titled chart card ─────────────────────────────────────────────────────────
export function ChartCard({
  icon: Icon, title, sub, right, children, className,
}: {
  icon?: any; title: string; sub?: string; right?: ReactNode; children: ReactNode; className?: string;
}) {
  return (
    <Card className={cn("p-4", className)}>
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="flex items-start gap-2.5">
          {Icon && <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-brand/10 text-brand"><Icon className="h-4 w-4" /></span>}
          <div>
            <h3 className="type-card-heading leading-tight">{title}</h3>
            {sub && <p className="type-caption text-muted-foreground">{sub}</p>}
          </div>
        </div>
        {right}
      </div>
      {children}
    </Card>
  );
}

type Bar = { key: string; label: string; count: number };

// ── labelled horizontal bars (clickable) ──────────────────────────────────────
export function BarBreakdown({
  data, color = C.brand, activeKey, onPick, empty = "No data yet", max = 8,
}: {
  data: Bar[] | null; color?: string; activeKey?: string;
  onPick?: (key: string) => void; empty?: string; max?: number;
}) {
  if (data == null) return <BarsSkeleton />;
  const rows = data.slice(0, max);
  if (rows.length === 0) return <EmptyRow text={empty} />;
  const top = Math.max(1, ...rows.map((r) => r.count));
  return (
    <div className="space-y-2.5">
      {rows.map((r) => {
        const active = activeKey === r.key;
        const pct = Math.round((r.count / top) * 100);
        return (
          <button key={r.key} type="button" onClick={() => onPick?.(r.key)}
            className={cn("group block w-full text-left", onPick && "cursor-pointer")}>
            <div className="mb-1 flex items-baseline justify-between gap-3">
              <span className={cn("truncate text-[13px]", active ? "font-semibold text-brand" : "text-foreground/85 group-hover:text-foreground")}>
                {r.label}
              </span>
              <span className="shrink-0 font-mono text-[12.5px] font-semibold tabular-nums text-foreground">{fmtInt(r.count)}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full transition-[width] duration-500"
                style={{ width: `${pct}%`, background: active ? color : `${color}CC`, opacity: activeKey && !active ? 0.4 : 1 }} />
            </div>
          </button>
        );
      })}
    </div>
  );
}

// ── donut with legend (optionally clickable to cross-filter) ──────────────────
export function DonutBreakdown({
  data, colors = SERIES, centerLabel, empty = "No data yet", activeKey, onSlice,
}: {
  data: Bar[] | null; colors?: string[]; centerLabel?: string; empty?: string;
  activeKey?: string; onSlice?: (key: string) => void;
}) {
  if (data == null) return <div className="grid h-[220px] place-items-center"><span className="text-[12px] text-muted-foreground">Loading…</span></div>;
  const rows = data.filter((r) => r.count > 0);
  if (rows.length === 0) return <EmptyRow text={empty} />;
  const total = rows.reduce((a, b) => a + b.count, 0);
  const dim = (key: string) => (activeKey && activeKey !== key ? 0.28 : 1);
  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row">
      <div className="relative h-[168px] w-[168px] shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={rows} dataKey="count" nameKey="label" cx="50%" cy="50%"
              innerRadius={54} outerRadius={78} paddingAngle={2} strokeWidth={0} isAnimationActive={false}
              onClick={onSlice ? (_: unknown, i: number) => onSlice(rows[i].key) : undefined}>
              {rows.map((r, i) => (
                <Cell key={i} fill={colors[i % colors.length]}
                  fillOpacity={dim(r.key)} cursor={onSlice ? "pointer" : "default"} />
              ))}
            </Pie>
            {/* No <Tooltip>: it floated over the centered Total, hiding it. The
                legend on the right already lists every slice's value + %. */}
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <div className="text-center">
            <div className="font-mono text-[24px] font-bold leading-none tabular-nums text-foreground">{fmtInt(total)}</div>
            {centerLabel && <div className="mt-0.5 text-[10.5px] uppercase tracking-wide text-muted-foreground">{centerLabel}</div>}
          </div>
        </div>
      </div>
      <ul className="min-w-0 flex-1 space-y-1.5">
        {rows.map((r, i) => {
          const active = activeKey === r.key;
          const Row = (
            <>
              <span className="inline-flex min-w-0 items-center gap-2">
                <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: colors[i % colors.length], opacity: dim(r.key) }} />
                <span className={cn("truncate", active ? "font-semibold text-brand" : "text-foreground/85")}>{r.label}</span>
              </span>
              <span className="shrink-0 font-mono text-[12.5px] font-semibold tabular-nums">
                {fmtInt(r.count)} <span className="text-muted-foreground">· {Math.round((r.count / total) * 100)}%</span>
              </span>
            </>
          );
          return onSlice ? (
            <li key={r.key}>
              <button type="button" onClick={() => onSlice(r.key)}
                className={cn("flex w-full items-center justify-between gap-3 rounded-md px-1.5 py-1 text-left text-[13px] transition-colors hover:bg-muted/60",
                  active && "bg-brand/10")}>
                {Row}
              </button>
            </li>
          ) : (
            <li key={r.key} className="flex items-center justify-between gap-3 px-1.5 py-1 text-[13px]">{Row}</li>
          );
        })}
      </ul>
    </div>
  );
}

// ── trend area ────────────────────────────────────────────────────────────────
export function TrendArea({ data, color = C.brand, label = "Received" }: {
  data: { date: string; received: number }[] | null; color?: string; label?: string;
}) {
  if (data == null) return <BarsSkeleton />;
  const pts = data.map((p) => ({
    ...p,
    day: new Date(p.date).toLocaleDateString("en-IN", { day: "2-digit", month: "short" }),
  }));
  const anything = pts.some((p) => p.received > 0);
  return (
    <div className="h-[240px] w-full">
      {!anything && (
        <div className="grid h-full place-items-center">
          <span className="text-[12px] italic text-muted-foreground">No submissions in this window yet</span>
        </div>
      )}
      {anything && (
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={pts} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
            <defs>
              <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={0.28} />
                <stop offset="100%" stopColor={color} stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis dataKey="day" tick={{ fontSize: 10.5, fill: "#94A3B8" }} axisLine={false} tickLine={false}
              interval="preserveStartEnd" minTickGap={40} />
            <YAxis allowDecimals={false} width={34} tick={{ fontSize: 10.5, fill: "#94A3B8" }} axisLine={false} tickLine={false} />
            <Tooltip contentStyle={{ borderRadius: 10, border: "1px solid #E1E5EB", fontSize: 12 }}
              labelStyle={{ fontWeight: 600 }} formatter={(v: number) => [v, label]} />
            <Area type="monotone" dataKey="received" stroke={color} strokeWidth={2}
              fill="url(#trendFill)" isAnimationActive={false} />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

// ── ranked list (top orgs / unions) ───────────────────────────────────────────
export function RankedList({
  items, valueOf, subOf, empty = "Nothing to rank yet",
}: {
  items: any[] | null; valueOf: (x: any) => string; subOf?: (x: any) => string | undefined; empty?: string;
}) {
  if (items == null) return <BarsSkeleton />;
  if (items.length === 0) return <EmptyRow text={empty} />;
  return (
    <ol className="space-y-0.5">
      {items.map((it, i) => (
        <li key={i} className="flex items-center gap-3 rounded-md px-1.5 py-1.5">
          <span className="grid h-5 w-5 shrink-0 place-items-center rounded bg-brand/10 font-mono text-[10px] font-bold text-brand">{i + 1}</span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-medium text-foreground">{it.name || "—"}</span>
            {subOf?.(it) && <span className="block truncate text-[11px] text-muted-foreground">{subOf(it)}</span>}
          </span>
          <span className="shrink-0 font-mono text-[13px] font-bold tabular-nums text-foreground">{valueOf(it)}</span>
        </li>
      ))}
    </ol>
  );
}

// ── small states ──────────────────────────────────────────────────────────────
function EmptyRow({ text }: { text: string }) {
  return <div className="grid h-24 place-items-center text-center text-[12.5px] italic text-muted-foreground">{text}</div>;
}
function BarsSkeleton() {
  return (
    <div className="space-y-3">
      {[0, 1, 2, 3].map((i) => <div key={i} className="h-4 w-full animate-pulse rounded bg-muted/60" style={{ width: `${90 - i * 12}%` }} />)}
    </div>
  );
}

export function NotAuthorized() {
  return (
    <Card className="mx-auto mt-10 max-w-md p-8 text-center">
      <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-rose-100 text-rose-600"><ShieldAlert className="h-6 w-6" /></span>
      <h2 className="mt-4 type-card-heading">Restricted</h2>
      <p className="mt-1.5 text-sm text-muted-foreground">
        This dashboard is available to the Minister’s office (super administrators) only.
      </p>
    </Card>
  );
}
