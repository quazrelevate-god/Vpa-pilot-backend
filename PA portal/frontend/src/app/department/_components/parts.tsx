"use client";

/**
 * Small shared primitives for the department workspace.
 *
 * Kept in one file because they're one-liners and importing 6 tiny files
 * clutters the workspace pages. Bigger components (drawer, list) live in
 * their own files.
 */
import { cn } from "@/lib/utils";
import { AlertTriangle, Check, Clock, Flame, ShieldCheck } from "lucide-react";
import { formatRemaining, slaFor } from "../_lib/api";

// ── Priority pill ──────────────────────────────────────────────────────────
const P_TONE: Record<string, string> = {
  critical: "bg-red-100 text-red-700 ring-red-200",
  high:     "bg-orange-100 text-orange-700 ring-orange-200",
  medium:   "bg-amber-100 text-amber-800 ring-amber-200",
  low:      "bg-slate-100 text-slate-600 ring-slate-200",
};
export function PriorityPill({ p, className }: { p: string | null; className?: string }) {
  if (!p) return null;
  return (
    <span className={cn(
      "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ring-1",
      P_TONE[p.toLowerCase()] ?? P_TONE.medium,
      className,
    )}>
      {p.toLowerCase() === "critical" && <Flame className="h-2.5 w-2.5" />}
      {p}
    </span>
  );
}

// ── Status pill (aligns with Aurora .s-* classes but self-contained) ────
const STATUS_LABEL: Record<string, string> = {
  open:               "Open",
  assigned:           "To accept",
  awaiting_department:"To accept",
  in_progress:        "In progress",
  resolved:           "Resolved",
  closed:             "Closed",
  reopened:           "Reopened",
  forwarded_to_dept:  "Forwarded",
  pending_citizen:    "Pending citizen",
};
const STATUS_TONE: Record<string, string> = {
  open:                "bg-blue-100 text-blue-800",
  assigned:            "bg-amber-100 text-amber-800",
  awaiting_department: "bg-amber-100 text-amber-800",
  in_progress:         "bg-blue-100 text-blue-800",
  resolved:            "bg-emerald-100 text-emerald-800",
  closed:              "bg-slate-200 text-slate-700",
  reopened:            "bg-red-100 text-red-700",
  forwarded_to_dept:   "bg-cyan-100 text-cyan-700",
  pending_citizen:     "bg-orange-100 text-orange-700",
};
export function StatusPill({ s, className }: { s: string; className?: string }) {
  return (
    <span className={cn(
      "inline-flex items-center rounded-full px-2 py-0.5 text-[10.5px] font-semibold",
      STATUS_TONE[s] ?? STATUS_TONE.open, className,
    )}>
      {STATUS_LABEL[s] ?? s}
    </span>
  );
}

// ── SLA pill ────────────────────────────────────────────────────────────────
export function SlaPill({
  created_at, priority, className,
}: { created_at: string; priority: string | null; className?: string }) {
  const sla = slaFor(created_at, priority);
  if (!sla) {
    return (
      <span className={cn(
        "inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10.5px] font-semibold text-muted-foreground",
        className,
      )}>
        <ShieldCheck className="h-3 w-3" /> No SLA
      </span>
    );
  }
  if (sla.breached) {
    return (
      <span className={cn(
        "inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-[10.5px] font-bold text-red-700 ring-1 ring-red-200",
        className,
      )}>
        <AlertTriangle className="h-3 w-3" /> {formatRemaining(sla.remaining_hours)}
      </span>
    );
  }
  const hot = sla.pct_used > 75;
  return (
    <span className={cn(
      "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-semibold ring-1",
      hot
        ? "bg-amber-100 text-amber-800 ring-amber-200"
        : "bg-emerald-50 text-emerald-700 ring-emerald-200",
      className,
    )}>
      <Clock className="h-3 w-3" /> {formatRemaining(sla.remaining_hours)}
    </span>
  );
}

// ── Section card / label — used inside the detail drawer ────────────────────
export function DrawerCard({
  icon: Icon, title, right, children, className,
}: {
  icon: React.ElementType; title: string; right?: React.ReactNode;
  children: React.ReactNode; className?: string;
}) {
  return (
    <section className={cn(
      "rounded-2xl border border-border bg-card p-5 shadow-card sm:p-6",
      className,
    )}>
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="grid h-6 w-6 place-items-center rounded-md bg-brand/10 text-brand">
            <Icon className="h-3.5 w-3.5" />
          </span>
          <h3 className="text-[11px] font-bold uppercase tracking-[0.16em] text-foreground/70">
            {title}
          </h3>
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}

export function KV({
  icon: Icon, label, value, className,
}: {
  icon: React.ElementType; label: string; value: React.ReactNode; className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <dt className="inline-flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </dt>
      <dd className="pl-[22px] text-sm font-semibold leading-relaxed text-foreground">
        {value ?? <span className="font-normal text-muted-foreground">—</span>}
      </dd>
    </div>
  );
}

// ── Empty state ─────────────────────────────────────────────────────────────
export function EmptyState({ icon: Icon, title, sub }: {
  icon: React.ElementType; title: string; sub?: string;
}) {
  return (
    <div className="grid place-items-center rounded-2xl border border-dashed border-border bg-card px-6 py-16 text-center">
      <div className="grid h-12 w-12 place-items-center rounded-2xl bg-brand/10 text-brand">
        <Icon className="h-6 w-6" />
      </div>
      <div className="mt-3 text-base font-semibold text-foreground">{title}</div>
      {sub && <div className="mt-1 text-sm text-muted-foreground">{sub}</div>}
    </div>
  );
}
