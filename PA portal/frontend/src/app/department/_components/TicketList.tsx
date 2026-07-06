"use client";

import { useMemo } from "react";
import { ChevronRight, Search, Ticket } from "lucide-react";
import { cn } from "@/lib/utils";
import { InitialsAvatar } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { useDeptLang } from "../_lib/i18n";
import { PriorityPill, StatusPill, SlaPill, EmptyState } from "./parts";
import { type DeptTicket, slaFor } from "../_lib/api";

interface Props {
  rows: DeptTicket[];
  loading: boolean;
  segment: string;                // the active status segment
  counts: Record<string, number>;
  onOpen: (id: number) => void;
  onSegmentChange: (s: string) => void;
  query: string;
  onQuery: (q: string) => void;
  priority: string;               // "" or "critical" | "high" | "medium" | "low"
  onPriority: (p: string) => void;
}

// Order matches the department workflow: Accept (new arrivals) →
// In Progress (working on) → Forwarded (audit trail of what we sent on) →
// Resolved (finished). Default is In Progress since that's the desk's
// live work. Closed is intentionally omitted — closure is a PA action
// and doesn't need a dedicated column in the department view.
const SEGMENTS = ["assigned", "in_progress", "forwarded_out", "resolved"] as const;
const SEG_KEY: Record<string, string> = {
  assigned:      "seg.toAccept",
  in_progress:   "seg.inProgress",
  forwarded_out: "seg.forwarded",
  resolved:      "seg.resolved",
};

const PRIORITY_KEYS = [
  { k: "",         tKey: "priority.all" },
  { k: "critical", tKey: "priority.critical" },
  { k: "high",     tKey: "priority.high" },
  { k: "medium",   tKey: "priority.medium" },
  { k: "low",      tKey: "priority.low" },
] as const;

const PRIORITY_RAIL: Record<string, string> = {
  critical: "bg-red-500",
  high:     "bg-orange-500",
  medium:   "bg-amber-400",
  low:      "bg-slate-300",
};

export default function TicketList({
  rows, loading, segment, counts, onOpen, onSegmentChange,
  query, onQuery, priority, onPriority,
}: Props) {
  const { t } = useDeptLang();

  // Client-side filter — search + priority.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (priority && (r.priority ?? "").toLowerCase() !== priority) return false;
      if (!q) return true;
      const haystack = [
        r.ticket_number, r.token, r.citizen_name, r.citizen_mobile,
        r.citizen_ask, r.category_label,
      ].filter(Boolean).join(" ").toLowerCase();
      return haystack.includes(q);
    });
  }, [rows, query, priority]);

  return (
    <div className="space-y-4">
      {/* Segmented tabs — Aurora style */}
      <div className="flex flex-wrap items-center gap-1.5 rounded-2xl border border-border bg-card p-1.5 shadow-card">
        {SEGMENTS.map((s) => {
          const active = segment === s;
          const n = counts[s] ?? 0;
          return (
            <button
              key={s}
              onClick={() => onSegmentChange(s)}
              className={cn(
                "flex items-center gap-2 rounded-xl px-3.5 py-2 text-sm font-semibold transition-colors",
                active
                  ? "bg-brand text-white shadow-[0_2px_6px_rgba(30,64,175,0.25)]"
                  : "text-muted-foreground hover:bg-muted",
              )}
            >
              {t(SEG_KEY[s])}
              <span className={cn(
                "min-w-[22px] rounded-full px-1.5 py-0.5 text-center text-[11px] font-bold tabular-nums",
                active ? "bg-white/20 text-white" : "bg-muted text-muted-foreground",
              )}>
                {n}
              </span>
            </button>
          );
        })}
      </div>

      {/* Toolbar: search + priority */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex flex-1 items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 shadow-card">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            placeholder={t("search")}
            className="flex-1 bg-transparent text-sm placeholder:text-muted-foreground focus:outline-none"
          />
        </div>
        <div className="flex gap-1 rounded-xl border border-border bg-card p-1 shadow-card">
          {PRIORITY_KEYS.map(({ k, tKey }) => (
            <button
              key={k || "all"}
              onClick={() => onPriority(k)}
              className={cn(
                "rounded-lg px-3 py-1.5 text-[12.5px] font-semibold transition-colors",
                priority === k
                  ? "bg-brand text-white"
                  : "text-muted-foreground hover:bg-muted",
              )}
            >
              {t(tKey)}
            </button>
          ))}
        </div>
      </div>

      {/* Rows */}
      {loading && rows.length === 0 ? (
        <div className="space-y-2">
          {[1, 2, 3, 4].map((k) => <Skeleton key={k} className="h-20 w-full rounded-2xl" />)}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState icon={Ticket} title={t("empty")} sub={rows.length ? "Nothing matches these filters." : undefined} />
      ) : (
        <div className="space-y-2">
          {filtered.map((r) => (
            <button
              key={r.id}
              onClick={() => onOpen(r.id)}
              className="group flex w-full items-center gap-3.5 rounded-2xl border border-border bg-card p-4 text-left shadow-card transition-all hover:-translate-y-0.5 hover:border-brand/40 hover:shadow-card-md"
            >
              {/* Priority rail */}
              <span className={cn(
                "h-14 w-1 flex-shrink-0 rounded-full",
                PRIORITY_RAIL[(r.priority ?? "").toLowerCase()] ?? "bg-transparent",
              )} />

              <InitialsAvatar name={r.citizen_name} />

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-[11.5px] font-bold text-brand">{r.ticket_number}</span>
                  {r.priority && <PriorityPill p={r.priority} />}
                  <StatusPill s={r.status} />
                  <SlaPill created_at={r.created_at} priority={r.priority} />
                </div>
                <div className="mt-1.5 line-clamp-1 text-[14px] font-semibold text-foreground">
                  {r.citizen_ask ?? "Petition"}
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[12px] text-muted-foreground">
                  <span className="font-semibold text-foreground/70">{r.citizen_name}</span>
                  <span>·</span>
                  <span className="font-mono">{r.citizen_mobile}</span>
                  {r.category_label && (
                    <>
                      <span>·</span>
                      <span>{r.category_label}</span>
                    </>
                  )}
                </div>
              </div>

              {r.status === "in_progress" && (
                <div className="hidden flex-col items-end sm:flex">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Progress</div>
                  <div className="mt-1 w-24 rounded-full bg-muted">
                    <div
                      className="h-1.5 rounded-full bg-brand transition-[width]"
                      style={{ width: `${Math.min(100, r.progress_pct)}%` }}
                    />
                  </div>
                  <div className="mt-0.5 font-mono text-[11px] font-bold text-brand">{r.progress_pct}%</div>
                </div>
              )}

              <ChevronRight className="h-4 w-4 flex-shrink-0 text-muted-foreground/40 transition-colors group-hover:text-brand" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
