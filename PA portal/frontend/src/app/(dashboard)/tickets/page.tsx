"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Search, ChevronLeft, ChevronRight, ChevronRight as RowChevron, Ticket as TicketIcon, CalendarDays, X } from "lucide-react";

import TopBar from "@/components/TopBar";
import FilterStrip from "@/components/FilterStrip";
import { useLang } from "@/lib/lang-context";
import TicketDetailDrawer from "@/components/TicketDetailDrawer";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { InitialsAvatar } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { fetchTickets } from "@/lib/api";
import type { TicketRow } from "@/lib/types";
import {
  TICKET_STATUS_DISPLAY, TICKET_STATUS_COLOR, PRIORITY_COLOR,
  priorityOptions, urgencyOptions, deptOptions, categoryOptions,
} from "@/lib/enums";

const PAGE_SIZE = 25;

// Primary status segments (double as the main filter + live-count overview).
const SEGMENTS: { key: string; tKey: string }[] = [
  { key: "",                  tKey: "tickets.segAll" },
  { key: "open",              tKey: "tickets.segOpen" },
  { key: "in_progress",       tKey: "tickets.segProgress" },
  { key: "forwarded_to_dept", tKey: "tickets.segFwd" },
  { key: "resolved",          tKey: "tickets.segResolved" },
  { key: "closed",            tKey: "tickets.segClosed" },
];

const PRIORITY_RAIL: Record<string, string> = {
  P0: "bg-red-500", P1: "bg-orange-500", P2: "bg-amber-400", P3: "bg-slate-300",
};

// SLA targets in days, per priority. Red at full target, amber at half.
const SLA_DAYS: Record<string, number> = { P0: 3, P1: 7, P2: 14, P3: 28 };

function slaColor(iso: string, status: string, priority: string | null | undefined): string {
  if (status === "resolved" || status === "closed") return "text-muted-foreground";
  if (!priority || !SLA_DAYS[priority]) return "text-muted-foreground";
  const days = (Date.now() - new Date(iso).getTime()) / 86_400_000;
  const target = SLA_DAYS[priority];
  if (days >= target) return "text-red-600 font-semibold";
  if (days >= target / 2) return "text-amber-600 font-medium";
  return "text-emerald-600 font-medium";
}

function formatAge(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

function slaLabel(priority: string | null | undefined): string {
  if (!priority || !SLA_DAYS[priority]) return "—";
  const d = SLA_DAYS[priority];
  return d >= 7 ? `${d / 7}w SLA` : `${d}d SLA`;
}

export default function TicketsPage() {
  const { t } = useLang();
  const [rows, setRows] = useState<TicketRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);

  const [status, setStatus] = useState("");
  const [priority, setPriority] = useState("");
  const [urgency, setUrgency] = useState("");
  const [department, setDepartment] = useState("");
  const [category, setCategory] = useState("");
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const [counts, setCounts] = useState<Record<string, number>>({});
  const [openId, setOpenId] = useState<number | null>(null);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  const secondary = { priority, urgency, department, category, search };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await fetchTickets({ status, priority, urgency, department, category, search, dateFrom, dateTo, page });
      setRows(d.items); setTotal(d.total);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [status, priority, urgency, department, category, search, dateFrom, dateTo, page]);

  // Live counts per segment, honouring the secondary filters.
  const loadCounts = useCallback(async () => {
    try {
      const results = await Promise.all(
        SEGMENTS.map((s) =>
          fetchTickets({ status: s.key, priority, urgency, department, category, search, dateFrom, dateTo, page: 1 })
            .then((r) => [s.key, r.total] as const)
            .catch(() => [s.key, 0] as const)
        )
      );
      setCounts(Object.fromEntries(results));
    } catch { /* ignore */ }
  }, [priority, urgency, department, category, search, dateFrom, dateTo]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadCounts(); }, [loadCounts]);

  function onSearchChange(v: string) {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => { setPage(1); setSearch(v); }, 300);
  }

  function clearAll() {
    setPriority(""); setUrgency(""); setDepartment(""); setCategory("");
    setDateFrom(""); setDateTo("");
    setPage(1);
  }

  const hasDateFilter = dateFrom || dateTo;

  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const th = "px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground";

  return (
    <>
      <TopBar />
      <main className="flex-1 overflow-y-auto bg-background">
        <div className="space-y-4 px-4 py-6 animate-in-up">
          {/* Header */}
          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
            <div>
              <h1 className="flex items-center gap-2 text-2xl font-extrabold tracking-tight text-foreground">
                <span className="grid h-9 w-9 place-items-center rounded-xl bg-brand/10 text-brand">
                  <TicketIcon className="h-5 w-5" />
                </span>
                {t("tickets.title")}
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                {t("tickets.subtitle")}
              </p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              {/* Date range */}
              <div className="flex items-center gap-1.5 rounded-lg border border-border bg-card px-2 py-1.5 shadow-card">
                <CalendarDays className="h-4 w-4 text-muted-foreground" />
                <Input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => { setPage(1); setDateFrom(e.target.value); }}
                  className="h-7 w-[130px] border-0 px-1 text-xs shadow-none focus-visible:ring-0"
                  aria-label="From date"
                />
                <span className="text-xs text-muted-foreground">→</span>
                <Input
                  type="date"
                  value={dateTo}
                  onChange={(e) => { setPage(1); setDateTo(e.target.value); }}
                  className="h-7 w-[130px] border-0 px-1 text-xs shadow-none focus-visible:ring-0"
                  aria-label="To date"
                />
                {hasDateFilter && (
                  <button
                    onClick={() => { setDateFrom(""); setDateTo(""); setPage(1); }}
                    className="ml-0.5 grid h-5 w-5 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
                    aria-label="Clear dates"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
              <div className="relative w-full sm:w-72">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search ticket #, name, mobile, headline…"
                  onChange={(e) => onSearchChange(e.target.value)}
                  className="pl-9"
                />
              </div>
            </div>
          </div>

          {/* Status segments with live counts */}
          <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-border bg-card p-1.5 shadow-card">
            {SEGMENTS.map((s) => {
              const active = status === s.key;
              const count = counts[s.key];
              return (
                <button
                  key={s.key || "all"}
                  onClick={() => { setStatus(s.key); setPage(1); }}
                  className={cn(
                    "flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors",
                    active ? "bg-brand text-brand-foreground shadow-card" : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                >
                  {t(s.tKey)}
                  <span className={cn(
                    "min-w-[20px] rounded-full px-1.5 py-0.5 text-[11px] font-bold tabular-nums",
                    active ? "bg-white/20 text-white" : "bg-muted text-muted-foreground"
                  )}>
                    {count ?? "·"}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Secondary filters */}
          <FilterStrip
            onClearAll={clearAll}
            groups={[
              { key: "priority",   label: t("label.priority"),   value: priority,   onChange: v => { setPage(1); setPriority(v); },   options: priorityOptions },
              { key: "urgency",    label: t("label.urgency"),    value: urgency,    onChange: v => { setPage(1); setUrgency(v); },    options: urgencyOptions },
              { key: "department", label: t("label.department"), value: department, onChange: v => { setPage(1); setDepartment(v); }, options: deptOptions },
              { key: "category",   label: t("label.category"),   value: category,   onChange: v => { setPage(1); setCategory(v); },   options: categoryOptions },
            ]}
          />

          {/* Table */}
          <Card className="overflow-hidden p-0">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[980px] text-sm">
                <thead className="bg-muted/60">
                  <tr className="border-b border-border">
                    <th className={cn(th, "w-[150px]")}>{t("tickets.colTicket")}</th>
                    <th className={th}>{t("tickets.colCitizen")}</th>
                    <th className={th}>{t("label.summary")}</th>
                    <th className={th}>{t("label.department")}</th>
                    <th className={cn(th, "w-20")}>{t("tickets.colPriority")}</th>
                    <th className={cn(th, "w-32")}>{t("tickets.colStatus")}</th>
                    <th className={cn(th, "w-28")}>{t("drawer.assignedTo")}</th>
                    <th className={cn(th, "w-28 text-right")}>{t("tickets.colOpenFor")}</th>
                    <th className="w-8" />
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    Array.from({ length: 8 }).map((_, i) => (
                      <tr key={i} className="border-b border-border/60">
                        <td className="px-4 py-3"><Skeleton className="h-4 w-24" /></td>
                        <td className="px-4 py-3"><div className="flex items-center gap-2"><Skeleton className="h-7 w-7 rounded-full" /><Skeleton className="h-4 w-20" /></div></td>
                        <td className="px-4 py-3"><Skeleton className="h-4 w-64" /></td>
                        <td className="px-4 py-3"><Skeleton className="h-4 w-32" /></td>
                        <td className="px-4 py-3"><Skeleton className="h-5 w-8 rounded" /></td>
                        <td className="px-4 py-3"><Skeleton className="h-5 w-16 rounded-full" /></td>
                        <td className="px-4 py-3"><Skeleton className="h-7 w-7 rounded-full" /></td>
                        <td className="px-4 py-3"><Skeleton className="ml-auto h-4 w-8" /></td>
                        <td />
                      </tr>
                    ))
                  ) : rows.length === 0 ? (
                    <tr><td colSpan={9} className="px-4 py-16 text-center">
                      <TicketIcon className="mx-auto mb-3 h-10 w-10 text-muted-foreground/30" />
                      <div className="text-sm font-medium text-foreground">{t("tickets.noTickets")}</div>
                      <div className="text-xs text-muted-foreground">Try clearing filters or switching status.</div>
                    </td></tr>
                  ) : rows.map((r) => (
                    <tr
                      key={r.id}
                      onClick={() => setOpenId(r.id)}
                      className="group cursor-pointer border-b border-border/60 transition-colors hover:bg-muted/50"
                    >
                      <td className="py-3 pl-4 pr-2">
                        <div className="flex items-center gap-2.5">
                          <span className={cn("h-7 w-1 rounded-full", PRIORITY_RAIL[r.priority ?? ""] ?? "bg-transparent")} />
                          <span className="font-mono text-xs font-semibold text-brand">{r.ticket_number}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2.5">
                          <InitialsAvatar name={r.citizen_name} />
                          <div className="min-w-0">
                            <div className="truncate font-medium text-foreground">{r.citizen_name ?? "—"}</div>
                            <div className="text-[11px] text-muted-foreground">{r.token ?? ""}</div>
                          </div>
                        </div>
                      </td>
                      <td className="max-w-md px-4 py-3">
                        <div className="truncate text-foreground/80">{r.headline ?? <span className="italic text-muted-foreground/60">No headline</span>}</div>
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">{r.department_label ?? "—"}</td>
                      <td className="px-4 py-3">
                        {r.priority
                          ? <span className={cn("rounded px-2 py-0.5 text-[11px] font-bold", PRIORITY_COLOR[r.priority])}>{r.priority}</span>
                          : <span className="text-muted-foreground/40">—</span>}
                      </td>
                      <td className="px-4 py-3">
                        <span className={cn("rounded-full border px-2.5 py-0.5 text-[11px] font-semibold", TICKET_STATUS_COLOR[r.status])}>
                          {TICKET_STATUS_DISPLAY[r.status] ?? r.status}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {r.assigned_to_pa
                          ? <div className="flex items-center gap-2"><InitialsAvatar name={r.assigned_to_pa} /><span className="text-xs text-foreground">{r.assigned_to_pa}</span></div>
                          : <span className="text-xs italic text-muted-foreground/50">Unassigned</span>}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className={cn("text-xs tabular-nums", slaColor(r.created_at, r.status, r.priority))}>
                          {formatAge(r.created_at)}
                        </div>
                        <div className="text-[10px] uppercase tracking-wider text-muted-foreground/60">
                          {slaLabel(r.priority)}
                        </div>
                      </td>
                      <td className="pr-3">
                        <RowChevron className="h-4 w-4 text-muted-foreground/0 transition-colors group-hover:text-muted-foreground" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between border-t border-border px-4 py-3 text-sm">
              <div className="text-muted-foreground">
                {total > 0 ? `${total} ${t("tickets.colTicket")}` : t("tickets.noTickets")}
                {total > PAGE_SIZE && ` · ${t("tickets.page")} ${page} ${t("tickets.of")} ${lastPage}`}
              </div>
              {total > PAGE_SIZE && (
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
                    <ChevronLeft className="h-4 w-4" /> Prev
                  </Button>
                  <Button variant="outline" size="sm" disabled={page === lastPage} onClick={() => setPage((p) => p + 1)}>
                    Next <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              )}
            </div>
          </Card>
        </div>
      </main>

      <TicketDetailDrawer
        ticketId={openId}
        onClose={() => setOpenId(null)}
        onMutated={() => { load(); loadCounts(); }}
      />
    </>
  );
}
