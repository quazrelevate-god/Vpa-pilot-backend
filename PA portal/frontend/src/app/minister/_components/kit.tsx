"use client";

import { useEffect, useRef, useState, type ComponentProps, type ReactNode } from "react";
import { AlertCircle } from "lucide-react";
import { StatTile } from "@/components/insights/DashboardKit";
import { Card } from "@/components/ui/card";
import { useT } from "../_lib/i18n";
import { cn } from "@/lib/utils";

// ── Count-up: tick a formatted number ("327", "₹3.8 Cr", "15.9%") from its
//    previous value to the new one whenever it changes (mount, or a filter that
//    recomputes it). Non-numeric values ("—") pass straight through. ──────────
function splitNumber(s: string): { prefix: string; num: number; suffix: string; decimals: number } | null {
  const m = s.match(/^(\D*)(\d[\d,]*(?:\.\d+)?)(.*)$/);
  if (!m) return null;
  const numStr = m[2].replace(/,/g, "");
  const num = parseFloat(numStr);
  if (!Number.isFinite(num)) return null;
  const dot = numStr.indexOf(".");
  return { prefix: m[1], num, suffix: m[3], decimals: dot >= 0 ? numStr.length - dot - 1 : 0 };
}

export function useCountUp(value: string, ms = 650): string {
  const parsed = splitNumber(value);
  const target = parsed ? parsed.num : 0;
  const [disp, setDisp] = useState(0);
  const fromRef = useRef(0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!parsed) return;
    const from = fromRef.current;
    if (from === target) { setDisp(target); return; }
    const start = performance.now();
    const step = (now: number) => {
      const p = Math.min(1, (now - start) / ms);
      const eased = 1 - Math.pow(1 - p, 3); // easeOutCubic
      setDisp(from + (target - from) * eased);
      if (p < 1) rafRef.current = requestAnimationFrame(step);
      else fromRef.current = target;
    };
    rafRef.current = requestAnimationFrame(step);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  if (!parsed) return value;
  const shown = disp.toLocaleString("en-IN", {
    minimumFractionDigits: parsed.decimals, maximumFractionDigits: parsed.decimals,
  });
  return `${parsed.prefix}${shown}${parsed.suffix}`;
}

/** Minister KPI tile — the shared StatTile with its number animated. `highlight`
 *  is dropped because the shared implementation adds `bg-brand/[0.03]` which
 *  tailwind-merge collapses on top of `bg-card`, leaving the tile visibly
 *  transparent (reads as a "ghost overlay" against neighbours). We render the
 *  emphasis ourselves — a solid card + a brand ring — so bg-card is preserved. */
export function MKpi({ highlight, ...rest }: ComponentProps<typeof StatTile>) {
  const value = useCountUp(rest.value);
  const tile = <StatTile {...rest} value={value} />;
  if (!highlight) return tile;
  return (
    <div className="relative rounded-xl ring-1 ring-brand/30">
      {tile}
    </div>
  );
}

/** Loading skeleton / error box / content, shared by every overview screen. */
export function ScreenState({
  loading, err, children,
}: { loading: boolean; err: string | null; children: ReactNode }) {
  const { t } = useT();
  if (err) {
    return (
      <div className="mt-2 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-700">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
        <span>{t("Couldn't load. Retrying…", "ஏற்ற முடியவில்லை. மீண்டும் முயற்சிக்கிறோம்…")} <span className="text-red-500/80">{err}</span></span>
      </div>
    );
  }
  if (loading) {
    return (
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => <Card key={i} className="h-[92px] animate-pulse" />)}
        </div>
        <Card className="h-44 animate-pulse" />
        <Card className="h-44 animate-pulse" />
      </div>
    );
  }
  return <>{children}</>;
}

/** Full-width KPI grid — 2-up on phones, 6-up on tablet / desktop. Sized so
 *  every source-portal KPI still fits without the tiles feeling starved. */
export function KpiGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">{children}</div>;
}

/** Compact numbers: 12,000 → 12K · 1,20,000 → 1.2L · 2,00,00,000 → 2Cr. */
export function human(n: number | null | undefined): string {
  const v = n ?? 0;
  if (v >= 1e7) return `${(v / 1e7).toFixed(1)}Cr`;
  if (v >= 1e5) return `${(v / 1e5).toFixed(1)}L`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return v.toLocaleString("en-IN");
}

export function titleCase(s?: string | null): string {
  if (!s) return "";
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }); }
  catch { return "—"; }
}

// ── Read-only data table primitive. Same visual as the portal's tables —
//    striped hover, sticky-friendly headings, no clickable rows, no actions. ─
export interface Col<T> {
  key: string;
  label: string;
  render: (row: T) => ReactNode;
  className?: string;
  align?: "left" | "right";
}

export function DataTable<T>({
  title, subtitle, rows, cols, empty, meta, onRowClick,
}: {
  title: string;
  subtitle?: string;
  rows: T[] | null;
  cols: Col<T>[];
  empty?: string;
  meta?: string;
  /** When set, each row is clickable (opens a read-only detail drawer). */
  onRowClick?: (row: T) => void;
}) {
  const { t } = useT();
  return (
    <Card className="overflow-hidden p-0">
      <div className="flex flex-wrap items-baseline gap-2 border-b border-border px-5 py-3.5">
        <h2 className="type-card-heading">{title}</h2>
        {subtitle && <p className="text-[12.5px] text-muted-foreground">{subtitle}</p>}
        {meta && <span className="ml-auto text-[12px] text-muted-foreground num">{meta}</span>}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-[13.5px]">
          <thead className="bg-[#EDF1F8] text-[11px] uppercase tracking-[0.08em] text-muted-foreground/80">
            <tr>
              {cols.map((c) => (
                <th key={c.key}
                  className={cn(
                    "px-4 py-3 font-semibold",
                    c.align === "right" && "text-right",
                    c.className,
                  )}>{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows == null ? (
              <tr><td colSpan={cols.length} className="px-4 py-10 text-center text-muted-foreground">
                {t("Loading…", "ஏற்றுகிறோம்…")}
              </td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={cols.length} className="px-4 py-14 text-center text-muted-foreground">
                {empty ?? t("No data yet.", "தரவு இல்லை.")}
              </td></tr>
            ) : (
              rows.map((r, i) => (
                <tr key={i}
                  onClick={onRowClick ? () => onRowClick(r) : undefined}
                  className={cn(
                    "border-t border-border/70 transition-colors hover:bg-[#EFF3FB]",
                    onRowClick && "cursor-pointer",
                  )}
                  title={onRowClick ? t("Open detail", "விவரம் திற") : undefined}>
                  {cols.map((c) => (
                    <td key={c.key}
                      className={cn("px-4 py-3", c.align === "right" && "text-right tabular-nums", c.className)}>
                      {c.render(r)}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/** Compact status/urgency pill — used inside table cells. */
export function Pill({ label, tone = "slate" }: { label: string; tone?: "brand" | "amber" | "mint" | "rose" | "orange" | "sky" | "slate" }) {
  const map: Record<string, string> = {
    brand:  "bg-brand/10 text-brand",
    amber:  "bg-amber-100 text-amber-800",
    mint:   "bg-emerald-100 text-emerald-700",
    rose:   "bg-red-100 text-red-700",
    orange: "bg-orange-100 text-orange-700",
    sky:    "bg-sky-100 text-sky-700",
    slate:  "bg-slate-100 text-slate-600",
  };
  return <span className={cn("inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold", map[tone])}>{label}</span>;
}
