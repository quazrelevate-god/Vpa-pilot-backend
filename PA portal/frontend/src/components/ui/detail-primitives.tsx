"use client";

/**
 * Shared building blocks for the case-detail drawers (Appointment + Ticket),
 * matching the "Citizen Uploads" reference layout: a compact OVERVIEW facts
 * card and a SUMMARY card, each with a tinted-icon section header, plus the
 * dot-style status pills and the footer action bar.
 *
 * Violet (`brand`) is the accent per the Aurora-Lavender direction.
 */
import * as React from "react";
import { cn } from "@/lib/utils";

// ── Card + section header ────────────────────────────────────────────────────
export function SectionCard({
  icon: Icon, title, right, className, children,
}: {
  icon: React.ElementType;
  title: string;
  right?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={cn("rounded-2xl border border-border bg-card p-5 shadow-card sm:p-6", className)}>
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="grid h-6 w-6 place-items-center rounded-md bg-brand/10 text-brand">
            <Icon className="h-3.5 w-3.5" />
          </span>
          <h3 className="text-[11px] font-bold uppercase tracking-[0.16em] text-foreground/70">{title}</h3>
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}

// ── Overview facts grid ──────────────────────────────────────────────────────
export function OverviewGrid({ children }: { children: React.ReactNode }) {
  return <dl className="grid grid-cols-1 gap-x-8 gap-y-5 sm:grid-cols-2">{children}</dl>;
}

export function OverviewItem({
  icon: Icon, label, value, mono, accent,
}: {
  icon: React.ElementType;
  label: string;
  value: React.ReactNode;
  mono?: boolean;
  accent?: "brand" | "emerald" | "amber";
}) {
  const accentText =
    accent === "brand"   ? "text-brand" :
    accent === "emerald" ? "text-emerald-600" :
    accent === "amber"   ? "text-amber-600" : "text-foreground";
  return (
    <div className="flex flex-col gap-1.5">
      <dt className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </dt>
      <dd className={cn("pl-[22px] text-sm font-semibold leading-relaxed", mono && "font-mono", accentText)}>
        {value ?? <span className="font-normal text-muted-foreground">—</span>}
      </dd>
    </div>
  );
}

// ── Dot status pill ("● Awaiting Review") ────────────────────────────────────
type Tone = "amber" | "emerald" | "blue" | "orange" | "slate" | "brand" | "red";

const DOT: Record<Tone, string> = {
  amber:   "bg-amber-100 text-amber-800 ring-amber-200",
  emerald: "bg-emerald-100 text-emerald-700 ring-emerald-200",
  blue:    "bg-blue-100 text-blue-700 ring-blue-200",
  orange:  "bg-orange-100 text-orange-700 ring-orange-200",
  slate:   "bg-muted text-muted-foreground ring-border",
  brand:   "bg-brand/10 text-brand ring-brand/20",
  red:     "bg-red-100 text-red-700 ring-red-200",
};
const DOTCOLOR: Record<Tone, string> = {
  amber: "bg-amber-500", emerald: "bg-emerald-500", blue: "bg-blue-500",
  orange: "bg-orange-500", slate: "bg-muted-foreground/50", brand: "bg-brand", red: "bg-red-500",
};

export function StatusDot({ label, tone = "slate", className }: { label: React.ReactNode; tone?: Tone; className?: string }) {
  return (
    <span className={cn(
      "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1",
      DOT[tone], className,
    )}>
      <span className={cn("h-1.5 w-1.5 rounded-full", DOTCOLOR[tone])} />
      {label}
    </span>
  );
}

// Map an appointment/ticket display status → a pill tone.
export function statusTone(status?: string | null): Tone {
  const s = (status ?? "").toLowerCase();
  if (s.includes("resolved") || s.includes("scheduled") || s.includes("courtesy")) return "emerald";
  if (s.includes("await")) return "amber";
  if (s.includes("waiting") || s.includes("progress") || s.includes("pending")) return "amber";
  if (s.includes("reschedul") || s.includes("reviewed") || s.includes("assigned")) return "blue";
  if (s.includes("closed")) return "slate";
  if (s.includes("not") || s.includes("reopen")) return "red";
  return "slate";
}

export function priorityTone(p?: string | null): Tone {
  const s = (p ?? "").toLowerCase();
  if (s === "critical" || s === "p0" || s === "high" || s === "p1") return "orange";
  if (s === "low" || s === "p3") return "slate";
  return "amber"; // medium / p2
}

// ── Footer action bar ────────────────────────────────────────────────────────
export function ActionBar({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn(
      "flex flex-wrap items-center gap-2 border-t border-border bg-card px-6 py-3",
      className,
    )}>
      {children}
    </div>
  );
}
