"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Search, Ticket } from "lucide-react";
import { cn } from "@/lib/utils";
import { InitialsAvatar } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { useDeptLang } from "../_lib/i18n";
import { PriorityPill, SlaPill, EmptyState } from "./parts";
import { type DeptTicket } from "../_lib/api";

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
// In Progress (working on) → Forwarded (audit trail) → Resolved (finished).
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

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { month: "short", day: "2-digit", year: "numeric" });
const fmtTime = (iso: string) =>
  new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

export default function TicketList({
  rows, loading, segment, counts, onOpen, onSegmentChange,
  query, onQuery, priority, onPriority,
}: Props) {
  const { t } = useDeptLang();

  const PAGE_SIZE = 8;
  const [page, setPage] = useState(1);

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

  // Reset to page 1 whenever the filtered set changes shape.
  useEffect(() => { setPage(1); }, [query, priority, segment]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const paged = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  const rangeStart = filtered.length === 0 ? 0 : (safePage - 1) * PAGE_SIZE + 1;
  const rangeEnd = Math.min(safePage * PAGE_SIZE, filtered.length);

  // Progress only means something while work is underway, so the column exists
  // only on the In Progress tab. Header and cell are gated on the same flag so
  // they can never drift out of alignment.
  const showProgress = segment === "in_progress";

  const th = "whitespace-nowrap px-3 py-2.5 text-left text-[11px] font-bold uppercase tracking-wider text-muted-foreground";

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      {/* Filter bar — search + status + priority, single row */}
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <div className="flex min-w-[180px] flex-1 items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 shadow-card">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            placeholder={t("search")}
            className="flex-1 bg-transparent text-sm placeholder:text-muted-foreground focus:outline-none"
          />
        </div>

        <div className="flex gap-1 rounded-lg border border-border bg-card p-1 shadow-card">
          {SEGMENTS.map((s) => {
            const active = segment === s;
            const n = counts[s] ?? 0;
            return (
              <button
                key={s}
                onClick={() => onSegmentChange(s)}
                className={cn(
                  "flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12.5px] font-semibold transition-colors",
                  active ? "bg-brand text-white" : "text-muted-foreground hover:bg-muted",
                )}
              >
                {t(SEG_KEY[s])}
                <span className={cn(
                  "min-w-[18px] rounded-full px-1 text-center text-[10.5px] font-bold tabular-nums",
                  active ? "bg-white/20 text-white" : "bg-muted text-muted-foreground",
                )}>
                  {n}
                </span>
              </button>
            );
          })}
        </div>

        <div className="flex gap-1 rounded-lg border border-border bg-card p-1 shadow-card">
          {PRIORITY_KEYS.map(({ k, tKey }) => (
            <button
              key={k || "all"}
              onClick={() => onPriority(k)}
              className={cn(
                "rounded-md px-2.5 py-1.5 text-[12.5px] font-semibold transition-colors",
                priority === k ? "bg-brand text-white" : "text-muted-foreground hover:bg-muted",
              )}
            >
              {t(tKey)}
            </button>
          ))}
        </div>
      </div>

      {/* Table card — header + internally scrolling body */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-card shadow-card">
        <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2.5">
          <span className="text-sm font-bold text-foreground">{t("tickets.title")}</span>
          <span className="font-mono text-sm font-semibold text-muted-foreground">({filtered.length})</span>
        </div>

        <div className="min-h-0 flex-1 overflow-auto">
          {loading && rows.length === 0 ? (
            <div className="space-y-2 p-4">
              {[1, 2, 3, 4, 5].map((k) => <Skeleton key={k} className="h-12 w-full rounded-lg" />)}
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-4">
              <EmptyState icon={Ticket} title={t("empty")} sub={rows.length ? "Nothing matches these filters." : undefined} />
            </div>
          ) : (
            <table className="w-full border-collapse">
              <thead className="sticky top-0 z-10 bg-muted/60 backdrop-blur">
                <tr className="border-b border-border">
                  <th className={th}>{t("col.ticket")}</th>
                  <th className={th}>{t("col.subject")}</th>
                  <th className={th}>{t("col.citizen")}</th>
                  <th className={th}>{t("col.priority")}</th>
                  <th className={th}>{t("col.sla")}</th>
                  <th className={th}>{t("col.updated")}</th>
                  {showProgress && <th className={cn(th, "text-right")}>{t("col.progress")}</th>}
                </tr>
              </thead>
              <tbody>
                {paged.map((r) => {
                  const updated = r.resolved_at ?? r.accepted_at ?? r.created_at;
                  return (
                    <tr
                      key={r.id}
                      onClick={() => onOpen(r.id)}
                      className="cursor-pointer border-b border-border/60 transition-colors hover:bg-brand/[0.04]"
                    >
                      {/* Ticket ID + created + priority rail */}
                      <td className="relative whitespace-nowrap py-3 pl-4 pr-3">
                        <span className={cn(
                          "absolute left-0 top-1/2 h-8 w-1 -translate-y-1/2 rounded-full",
                          PRIORITY_RAIL[(r.priority ?? "").toLowerCase()] ?? "bg-transparent",
                        )} />
                        <div className="font-mono text-[12.5px] font-bold text-brand">{r.ticket_number}</div>
                        <div className="mt-0.5 text-[11px] text-muted-foreground">
                          {t("col.createdOn")} {fmtDate(r.created_at)}
                        </div>
                      </td>

                      {/* Subject */}
                      <td className="px-3 py-3">
                        <div className="max-w-[220px] truncate text-[13px] font-semibold text-foreground">
                          {r.citizen_ask ?? "Petition"}
                        </div>
                      </td>

                      {/* Citizen */}
                      <td className="whitespace-nowrap px-3 py-3">
                        <div className="flex items-center gap-2">
                          <InitialsAvatar name={r.citizen_name} />
                          <div className="min-w-0">
                            <div className="truncate text-[13px] font-semibold text-foreground">{r.citizen_name}</div>
                            <div className="font-mono text-[11px] text-muted-foreground">{r.citizen_mobile}</div>
                          </div>
                        </div>
                      </td>

                      {/* Priority */}
                      <td className="px-3 py-3">
                        {r.priority ? <PriorityPill p={r.priority} /> : <span className="text-muted-foreground/50">—</span>}
                      </td>

                      {/* SLA */}
                      <td className="px-3 py-3"><SlaPill created_at={r.created_at} priority={r.priority} /></td>

                      {/* Updated */}
                      <td className="whitespace-nowrap px-3 py-3">
                        <div className="text-[12.5px] font-medium text-foreground">{fmtDate(updated)}</div>
                        <div className="text-[11px] text-muted-foreground">{fmtTime(updated)}</div>
                      </td>

                      {/* Progress — column only exists on the In Progress tab */}
                      {showProgress && (
                        <td className="whitespace-nowrap px-3 py-3 pr-4">
                          {r.status === "in_progress" ? (
                            <div className="flex items-center justify-end gap-2">
                              <div className="h-1.5 w-20 overflow-hidden rounded-full bg-muted">
                                <div className="h-full rounded-full bg-brand" style={{ width: `${Math.min(100, r.progress_pct)}%` }} />
                              </div>
                              <span className="font-mono text-[11px] font-bold text-brand">{r.progress_pct}%</span>
                            </div>
                          ) : (
                            <div className="text-right text-muted-foreground/50">—</div>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Pagination footer */}
        {filtered.length > 0 && (
          <div className="flex shrink-0 items-center justify-between gap-3 border-t border-border px-4 py-2.5">
            <div className="text-[12px] text-muted-foreground">
              <span className="font-mono font-semibold text-foreground">{rangeStart}–{rangeEnd}</span> / <span className="font-mono">{filtered.length}</span>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={safePage <= 1}
                className="grid h-7 w-7 place-items-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="px-2 font-mono text-[12px] font-semibold tabular-nums text-foreground">
                {safePage} / {pageCount}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
                disabled={safePage >= pageCount}
                className="grid h-7 w-7 place-items-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
