"use client";

import { TrendingUp, TrendingDown, Minus, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface MetricTileProps {
  label: string;
  value: string | number;
  icon: LucideIcon;
  /** Brand tone — controls gradient + accent. */
  tone?: "brand" | "emerald" | "amber" | "violet" | "rose" | "slate";
  /** Small caption shown below the value. */
  caption?: string;
  /** Period-over-period delta as a percentage. Null = no comparison. */
  deltaPct?: number | null;
  /** Inverts the colour mapping so "lower is better" (eg. response time). */
  invertDelta?: boolean;
  className?: string;
}

const TONE: Record<
  NonNullable<MetricTileProps["tone"]>,
  { icon: string; ring: string; glow: string }
> = {
  brand:   { icon: "text-brand bg-brand/10",                                                    ring: "ring-brand/15",       glow: "from-brand/10" },
  emerald: { icon: "text-emerald-600 bg-emerald-50", ring: "ring-emerald-200/40", glow: "from-emerald-100/60" },
  amber:   { icon: "text-amber-600 bg-amber-50",         ring: "ring-amber-200/40",     glow: "from-amber-100/60" },
  violet:  { icon: "text-blue-600 bg-blue-50",     ring: "ring-blue-200/40",   glow: "from-blue-100/60" },
  rose:    { icon: "text-rose-600 bg-rose-50",             ring: "ring-rose-200/40",       glow: "from-rose-100/60" },
  slate:   { icon: "text-slate-700 bg-slate-100",        ring: "ring-slate-200/40",     glow: "from-slate-100/60" },
};

export default function MetricTile({
  label, value, icon: Icon, tone = "brand", caption, deltaPct, invertDelta, className,
}: MetricTileProps) {
  const t = TONE[tone];

  const trendIcon =
    deltaPct == null ? null :
    deltaPct === 0 ? <Minus className="h-3 w-3" /> :
    deltaPct > 0 ? <TrendingUp className="h-3 w-3" /> :
    <TrendingDown className="h-3 w-3" />;

  const isGood = deltaPct != null && (
    invertDelta ? deltaPct < 0 : deltaPct > 0
  );
  const isBad = deltaPct != null && deltaPct !== 0 && !isGood;

  return (
    <div className={cn(
      "relative overflow-hidden rounded-2xl border border-border bg-card p-4 shadow-card transition-all hover:-translate-y-0.5 hover:shadow-card-md",
      className
    )}>
      {/* Corner glow */}
      <div className={cn("pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full bg-gradient-to-br to-transparent opacity-70 blur-2xl", t.glow)} />

      <div className="relative flex items-start justify-between gap-2">
        <span className={cn("text-[10.5px] font-bold uppercase tracking-[0.14em] text-muted-foreground")}>
          {label}
        </span>
        <span className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-lg ring-1", t.icon, t.ring)}>
          <Icon className="h-4 w-4" />
        </span>
      </div>

      <div className="relative mt-2 flex items-baseline gap-2">
        <span className="text-[28px] font-extrabold tracking-tight text-foreground tabular-nums">
          {value}
        </span>
      </div>

      <div className="relative mt-1 flex items-center gap-2 text-[11px]">
        {deltaPct != null && (
          <span className={cn(
            "inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 font-semibold",
            isGood ? "bg-emerald-50 text-emerald-700" : isBad ? "bg-rose-50 text-rose-700" : "bg-muted text-muted-foreground"
          )}>
            {trendIcon}
            {Math.abs(deltaPct).toFixed(1)}%
          </span>
        )}
        {caption && <span className="text-muted-foreground">{caption}</span>}
      </div>
    </div>
  );
}
