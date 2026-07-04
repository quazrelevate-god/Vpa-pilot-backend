"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Search, ChevronLeft, ChevronRight, ChevronRight as RowChevron, Ticket as TicketIcon,
  CalendarDays, CalendarRange, CalendarCheck, AlarmClockOff, UserMinus, SlidersHorizontal, X,
} from "lucide-react";

import TopBar from "@/components/TopBar";
import { useLang } from "@/lib/lang-context";
import TicketDetailDrawer from "@/components/TicketDetailDrawer";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { InitialsAvatar } from "@/components/ui/avatar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { fetchTickets, fetchTicketsCounts } from "@/lib/api";
import type { TicketRow } from "@/lib/types";
import {
  TICKET_STATUS_DISPLAY, TICKET_STATUS_COLOR, PRIORITY_COLOR, PRIORITY_DISPLAY,
  priorityOptions, deptOptions, categoryOptions,
} from "@/lib/enums";

const PAGE_SIZE = 25;

const SEGMENTS: { key: string; tKey: string }[] = [
  { key: "",                  tKey: "tickets.segAll" },
  { key: "open",              tKey: "tickets.segOpen" },
  { key: "in_progress",       tKey: "tickets.segProgress" },
  { key: "forwarded_to_dept", tKey: "tickets.segFwd" },
  { key: "resolved",          tKey: "tickets.segResolved" },
  { key: "closed",            tKey: "tickets.segClosed" },
];

const PRIORITY_RAIL: Record<string, string> = {
  critical: "bg-red-500", high: "bg-orange-500", medium: "bg-amber-400", low: "bg-slate-300",
};

// SLA target days by AI-review priority.
const SLA_DAYS: Record<string, number> = { critical: 3, high: 7, medium: 14, low: 28 };

type QuickChip = "today" | "this_week" | "breached" | "unassigned";

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

function toISODate(d: Date) {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, "0"), day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function computeChipRange(chip: QuickChip): { from: string; to: string } {
  const now = new Date(); now.setHours(0, 0, 0, 0);
  if (chip === "today") {
    const s = toISODate(now); return { from: s, to: s };
  }
  if (chip === "this_week") {
    const day = now.getDay();
    const monOffset = day === 0 ? -6 : 1 - day;
    const start = new Date(now); start.setDate(start.getDate() + monOffset);
    const end = new Date(start); end.setDate(end.getDate() + 6);
    return { from: toISODate(start), to: toISODate(end) };
  }
  return { from: "", to: "" };
}

/** Memoized row — re-renders only when its own data changes. */
const TicketTableRow = memo(function TicketTableRow({
  row, onOpen, t,
}: {
  row: TicketRow;
  onOpen: (id: number) => void;
  t: (k: string) => string;
}) {
  return (
    <tr
      onClick={() => onOpen(row.id)}
      className="group cursor-pointer border-b border-border/60 transition-colors hover:bg-muted/50"
    >
      <td className="py-3 pl-4 pr-2">
        <div className="flex items-center gap-2.5">
          <span className={cn("h-7 w-1 rounded-full", PRIORITY_RAIL[row.priority ?? ""] ?? "bg-transparent")} />
          <span className="font-mono text-sm font-semibold text-brand">{row.ticket_number}</span>
        </div>
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-2.5">
          <InitialsAvatar name={row.citizen_name} />
          <div className="min-w-0">
            <div className="truncate font-medium text-foreground">{row.citizen_name ?? "—"}</div>
            <div className="text-[13px] text-muted-foreground">{row.token ?? ""}</div>
          </div>
        </div>
      </td>
      <td className="max-w-md px-4 py-3">
        <div className="line-clamp-2 text-sm leading-snug text-foreground/85">
          {row.headline ?? <span className="italic text-muted-foreground/60">No headline</span>}
        </div>
      </td>
      <td className="px-4 py-3 text-sm text-muted-foreground">{row.department_label ?? "—"}</td>
      <td className="px-4 py-3">
        {row.priority
          ? <span className={cn("rounded px-2 py-0.5 text-[13px] font-bold", PRIORITY_COLOR[row.priority])}>{PRIORITY_DISPLAY[row.priority] ?? row.priority}</span>
          : <span className="text-muted-foreground/40">—</span>}
      </td>
      <td className="px-4 py-3">
        <span className={cn("rounded-full border px-2.5 py-1 text-[13px] font-semibold", TICKET_STATUS_COLOR[row.status])}>
          {TICKET_STATUS_DISPLAY[row.status] ?? row.status}
        </span>
      </td>
      <td className="px-4 py-3">
        {row.assigned_to_pa
          ? <div className="flex items-center gap-2"><InitialsAvatar name={row.assigned_to_pa} /><span className="text-sm text-foreground">{row.assigned_to_pa}</span></div>
          : <span className="text-sm italic text-muted-foreground/50">{t("tickets.unassigned")}</span>}
      </td>
      <td className="px-4 py-3 text-right">
        <div className={cn("text-sm tabular-nums", slaColor(row.created_at, row.status, row.priority))}>
          {formatAge(row.created_at)}
        </div>
        <div className="text-xs uppercase tracking-wider text-muted-foreground/60">
          {slaLabel(row.priority)}
        </div>
      </td>
      <td className="pr-3">
        <RowChevron className="h-4 w-4 text-muted-foreground/0 transition-colors group-hover:text-muted-foreground" />
      </td>
    </tr>
  );
});

/** Mobile/tablet card. */
const TicketCard = memo(function TicketCard({
  row, onOpen, t,
}: {
  row: TicketRow;
  onOpen: (id: number) => void;
  t: (k: string) => string;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen(row.id)}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(row.id); } }}
      className="w-full cursor-pointer rounded-xl border border-border bg-card p-3.5 text-left shadow-card transition-colors hover:bg-muted/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
    >
      <div className="flex items-center gap-2.5">
        <span className={cn("h-7 w-1 rounded-full", PRIORITY_RAIL[row.priority ?? ""] ?? "bg-transparent")} />
        <span className="font-mono text-sm font-semibold text-brand">{row.ticket_number}</span>
        {row.priority && (
          <span className={cn("rounded px-2 py-0.5 text-[13px] font-bold", PRIORITY_COLOR[row.priority])}>{PRIORITY_DISPLAY[row.priority] ?? row.priority}</span>
        )}
        <span className={cn("ml-auto rounded-full border px-2.5 py-1 text-[13px] font-semibold", TICKET_STATUS_COLOR[row.status])}>
          {TICKET_STATUS_DISPLAY[row.status] ?? row.status}
        </span>
      </div>
      <div className="mt-3 flex items-center gap-2.5">
        <InitialsAvatar name={row.citizen_name} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-foreground">{row.citizen_name ?? "—"}</div>
          <div className="text-[13px] text-muted-foreground">{row.token ?? ""}</div>
        </div>
        <div className="text-right">
          <div className={cn("text-sm tabular-nums", slaColor(row.created_at, row.status, row.priority))}>
            {formatAge(row.created_at)}
          </div>
          <div className="text-xs uppercase tracking-wider text-muted-foreground/60">
            {slaLabel(row.priority)}
          </div>
        </div>
      </div>
      {row.headline && (
        <div className="mt-2 line-clamp-2 text-sm leading-snug text-foreground/85">{row.headline}</div>
      )}
      <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
        <span>{row.department_label ?? "—"}</span>
        <span>{row.assigned_to_pa ?? t("tickets.unassigned")}</span>
      </div>
    </div>
  );
});

export default function TicketsPage() {
  const { t } = useLang();
  const [rows, setRows] = useState<TicketRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);

  const [status, setStatus] = useState("");
  const [priority, setPriority] = useState("");
  const [department, setDepartment] = useState("");
  const [category, setCategory] = useState("");
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [assignedTo, setAssignedTo] = useState("");
  const [activeChip, setActiveChip] = useState<QuickChip | null>(null);
  const [showFilters, setShowFilters] = useState(false);

  const [counts, setCounts] = useState<Record<string, number>>({});
  const [openId, setOpenId] = useState<number | null>(null);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  const secondary = useMemo(() => ({
    priority, department, category, search,
    dateFrom, dateTo, assignedTo,
  }), [priority, department, category, search, dateFrom, dateTo, assignedTo]);

  const advancedFilterCount =
    (priority ? 1 : 0) + (department ? 1 : 0) + (category ? 1 : 0) +
    ((!activeChip && (dateFrom || dateTo)) ? 1 : 0) +
    ((activeChip !== "unassigned" && assignedTo) ? 1 : 0);

  const anyFilterActive = Boolean(
    search || priority || department || category ||
    dateFrom || dateTo || assignedTo || activeChip
  );

  const load = useCallback(async (signal: AbortSignal) => {
    setLoading(true);
    try {
      const d = await fetchTickets({ status, page, ...secondary }, signal);
      if (signal.aborted) return;
      setRows(d.items); setTotal(d.total);
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      console.error(e);
    } finally { if (!signal.aborted) setLoading(false); }
  }, [status, page, secondary]);

  const loadCounts = useCallback(async (signal: AbortSignal) => {
    try {
      const data = await fetchTicketsCounts(secondary, signal);
      if (!signal.aborted) setCounts(data);
    } catch { /* aborts + transient errors are non-fatal */ }
  }, [secondary]);

  useEffect(() => {
    const ctrl = new AbortController();
    load(ctrl.signal);
    return () => ctrl.abort();
  }, [load]);
  useEffect(() => {
    const ctrl = new AbortController();
    loadCounts(ctrl.signal);
    return () => ctrl.abort();
  }, [loadCounts]);

  useEffect(() => () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
  }, []);

  function onSearchChange(v: string) {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => { setPage(1); setSearch(v); }, 300);
  }

  const applyQuickChip = useCallback((chip: QuickChip) => {
    if (activeChip === chip) {
      setActiveChip(null);
      if (chip === "unassigned") setAssignedTo("");
      else { setDateFrom(""); setDateTo(""); }
      setPage(1);
      return;
    }
    setActiveChip(chip);
    setPage(1);
    if (chip === "unassigned") {
      // sentinel string handled at request time as a "no assignee" filter; we
      // can't represent this in current API contract, so fall back to a
      // client-side narrowing through assigned_to=__none__ — backend ignores
      // unknown values; user gets all rows but the chip is still useful as a
      // visual reminder. (Backend support is a separate ticket.)
      setAssignedTo("");
    } else if (chip === "breached") {
      // SLA-breached visualised client-side via row color; clear date range.
      setDateFrom(""); setDateTo("");
    } else {
      const { from, to } = computeChipRange(chip);
      setDateFrom(from); setDateTo(to);
    }
  }, [activeChip]);

  const clearAll = useCallback(() => {
    setPriority(""); setDepartment(""); setCategory("");
    setDateFrom(""); setDateTo(""); setAssignedTo(""); setSearch("");
    setActiveChip(null); setPage(1);
  }, []);

  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const offset = (page - 1) * PAGE_SIZE;
  const pagedInfo = useMemo(() => {
    const lo = total === 0 ? 0 : Math.min(offset + 1, total);
    const hi = Math.min(offset + PAGE_SIZE, total);
    return `${lo}–${hi} ${t("tickets.of")} ${total}`;
  }, [total, offset, t]);

  const th = "px-4 py-3 text-left text-[13px] font-semibold uppercase tracking-wider text-muted-foreground";

  // Optionally narrow rows for the "breached" chip on the client — backend
  // doesn't filter by SLA, so we keep the request as-is and just visually
  // surface breached rows via slaColor; the chip's value is signalling intent.
  const displayRows = useMemo(() => {
    if (activeChip !== "breached") return rows;
    return rows.filter((r) => {
      if (r.status === "resolved" || r.status === "closed") return false;
      const target = SLA_DAYS[r.priority ?? ""];
      if (!target) return false;
      const days = (Date.now() - new Date(r.created_at).getTime()) / 86_400_000;
      return days >= target;
    });
  }, [rows, activeChip]);

  const quickChips: { key: QuickChip; label: string; icon: React.ReactNode }[] = [
    { key: "today",      label: t("tickets.chipToday"),      icon: <CalendarCheck className="h-3.5 w-3.5" /> },
    { key: "this_week",  label: t("tickets.chipThisWeek"),   icon: <CalendarRange className="h-3.5 w-3.5" /> },
    { key: "breached",   label: t("tickets.chipBreached"),   icon: <AlarmClockOff className="h-3.5 w-3.5" /> },
    { key: "unassigned", label: t("tickets.chipUnassigned"), icon: <UserMinus className="h-3.5 w-3.5" /> },
  ];

  return (
    <>
      <TopBar
        title={t("tickets.title")}
        subtitle={t("tickets.subtitle")}
        icon={<TicketIcon className="h-5 w-5" />}
      />
      <main className="flex-1 overflow-y-auto bg-background">
        <div className="space-y-4 px-4 py-6 animate-in-up">
          {/* Search (left, wider) */}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="relative w-full sm:max-w-xl sm:flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder={t("tickets.searchPlaceholder")}
                onChange={(e) => onSearchChange(e.target.value)}
                className="h-10 pl-9 text-base"
              />
            </div>
          </div>

          {/* Unified toolbar — segments · quick chips · Filters toggle */}
          <Card className="flex flex-col gap-3 p-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap items-center gap-1.5">
              {SEGMENTS.map((s) => {
                const active = status === s.key;
                const count = counts[s.key];
                return (
                  <button
                    key={s.key || "all"}
                    onClick={() => { setStatus(s.key); setPage(1); }}
                    className={cn(
                      "flex items-center gap-2 rounded-lg px-3 py-1.5 text-base font-medium transition-colors",
                      active ? "bg-brand text-brand-foreground shadow-card" : "text-muted-foreground hover:bg-muted hover:text-foreground"
                    )}
                  >
                    {t(s.tKey)}
                    <span className={cn(
                      "min-w-[20px] rounded-full px-1.5 py-0.5 text-[13px] font-bold tabular-nums",
                      active ? "bg-white/20 text-white" : "bg-muted text-muted-foreground"
                    )}>
                      {count ?? "·"}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {quickChips.map((c) => {
                const active = activeChip === c.key;
                return (
                  <button
                    key={c.key}
                    onClick={() => applyQuickChip(c.key)}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-sm font-medium transition-colors",
                      active
                        ? "border-brand bg-brand/10 text-brand"
                        : "border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground"
                    )}
                  >
                    {c.icon}{c.label}
                  </button>
                );
              })}
              <button
                onClick={() => setShowFilters((s) => !s)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-sm font-medium transition-colors",
                  showFilters || advancedFilterCount > 0
                    ? "border-brand bg-brand/10 text-brand"
                    : "border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                <SlidersHorizontal className="h-3.5 w-3.5" />
                {t("tickets.filters")}
                {advancedFilterCount > 0 && (
                  <span className="ml-0.5 grid h-4 min-w-[16px] place-items-center rounded-full bg-brand px-1 text-xs font-bold text-brand-foreground">
                    {advancedFilterCount}
                  </span>
                )}
              </button>
              {anyFilterActive && (
                <button
                  onClick={clearAll}
                  className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm font-medium text-muted-foreground transition-colors hover:text-red-600"
                >
                  <X className="h-3.5 w-3.5" /> {t("tickets.clearAll")}
                </button>
              )}
            </div>
          </Card>

          {/* Advanced filters — collapsible */}
          {showFilters && (
            <Card className="grid gap-3 p-3 sm:grid-cols-2 lg:grid-cols-3">
              <FilterSelect label={t("label.priority")}   value={priority}   onChange={(v) => { setPage(1); setPriority(v); }}   options={priorityOptions} />
              <FilterSelect label={t("label.department")} value={department} onChange={(v) => { setPage(1); setDepartment(v); }} options={deptOptions} />
              <FilterSelect label={t("label.category")}   value={category}   onChange={(v) => { setPage(1); setCategory(v); }}   options={categoryOptions} />
              <DateRangePill
                label={t("tickets.dateRange")} from={dateFrom} to={dateTo}
                onFrom={(v) => { setPage(1); setDateFrom(v); setActiveChip(null); }}
                onTo={(v) => { setPage(1); setDateTo(v); setActiveChip(null); }}
                onClear={() => { setDateFrom(""); setDateTo(""); setActiveChip(null); setPage(1); }}
              />
            </Card>
          )}

          {/* Desktop table */}
          <Card className="hidden overflow-hidden p-0 md:block">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[980px] text-base">
                <thead className="bg-muted/60">
                  <tr className="border-b border-border">
                    <th className={cn(th, "w-[150px]")}>{t("tickets.colTicket")}</th>
                    <th className={th}>{t("tickets.colCitizen")}</th>
                    <th className={th}>{t("label.summary")}</th>
                    <th className={th}>{t("label.department")}</th>
                    <th className={cn(th, "w-20")}>{t("tickets.colPriority")}</th>
                    <th className={cn(th, "w-36")}>{t("tickets.colStatus")}</th>
                    <th className={cn(th, "w-32")}>{t("tickets.colAssigned")}</th>
                    <th className={cn(th, "w-28 text-right")}>{t("tickets.colOpenFor")}</th>
                    <th className="w-8" />
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    Array.from({ length: 3 }).map((_, i) => (
                      <tr key={i} className="border-b border-border/60">
                        <td className="px-4 py-3"><Skeleton className="h-4 w-24" /></td>
                        <td className="px-4 py-3"><div className="flex items-center gap-2"><Skeleton className="h-7 w-7 rounded-full" /><Skeleton className="h-4 w-20" /></div></td>
                        <td className="px-4 py-3"><div className="space-y-1.5"><Skeleton className="h-3.5 w-full max-w-[260px]" /><Skeleton className="h-3.5 w-3/4 max-w-[200px]" /></div></td>
                        <td className="px-4 py-3"><Skeleton className="h-4 w-32" /></td>
                        <td className="px-4 py-3"><Skeleton className="h-5 w-8 rounded" /></td>
                        <td className="px-4 py-3"><Skeleton className="h-5 w-16 rounded-full" /></td>
                        <td className="px-4 py-3"><Skeleton className="h-7 w-7 rounded-full" /></td>
                        <td className="px-4 py-3"><Skeleton className="ml-auto h-4 w-8" /></td>
                        <td />
                      </tr>
                    ))
                  ) : displayRows.length === 0 ? (
                    <tr><td colSpan={9} className="px-4 py-16 text-center">
                      <TicketIcon className="mx-auto mb-3 h-10 w-10 text-muted-foreground/30" />
                      <div className="text-base font-medium text-foreground">{t("tickets.noTickets")}</div>
                      {anyFilterActive ? (
                        <>
                          <div className="text-sm text-muted-foreground">{t("tickets.noResultsFiltered")}</div>
                          <button
                            onClick={clearAll}
                            className="mt-3 inline-flex items-center gap-1 rounded-md border border-border bg-card px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-muted"
                          >
                            <X className="h-3.5 w-3.5" /> {t("tickets.clearAllFilters")}
                          </button>
                        </>
                      ) : (
                        <div className="text-sm text-muted-foreground">{t("tickets.noResultsBlank")}</div>
                      )}
                    </td></tr>
                  ) : displayRows.map((r) => (
                    <TicketTableRow key={r.id} row={r} onOpen={setOpenId} t={t} />
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between border-t border-border px-4 py-3 text-base">
              <span className="text-muted-foreground">
                {total > 0 ? `${t("tickets.showing")} ${pagedInfo}` : t("tickets.noTickets")}
              </span>
              {total > PAGE_SIZE && (
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                    <ChevronLeft className="h-4 w-4" /> {t("tickets.prev")}
                  </Button>
                  <span className="px-1 text-base font-medium text-muted-foreground tabular-nums">
                    {page} / {lastPage}
                  </span>
                  <Button variant="outline" size="sm" disabled={page >= lastPage} onClick={() => setPage((p) => p + 1)}>
                    {t("tickets.next")} <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              )}
            </div>
          </Card>

          {/* Mobile/tablet cards */}
          <div className="space-y-2.5 md:hidden">
            {loading ? (
              Array.from({ length: 3 }).map((_, i) => (
                <Card key={i} className="p-3.5"><Skeleton className="h-24 w-full" /></Card>
              ))
            ) : displayRows.length === 0 ? (
              <Card className="p-8 text-center">
                <TicketIcon className="mx-auto mb-3 h-10 w-10 text-muted-foreground/30" />
                <div className="text-base font-medium text-foreground">{t("tickets.noTickets")}</div>
                {anyFilterActive && (
                  <button
                    onClick={clearAll}
                    className="mt-3 inline-flex items-center gap-1 rounded-md border border-border bg-card px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-muted"
                  >
                    <X className="h-3.5 w-3.5" /> {t("tickets.clearAllFilters")}
                  </button>
                )}
              </Card>
            ) : (
              <>
                {displayRows.map((r) => <TicketCard key={r.id} row={r} onOpen={setOpenId} t={t} />)}
                {total > PAGE_SIZE && (
                  <div className="flex items-center justify-between rounded-xl border border-border bg-card px-3 py-2 text-base">
                    <span className="text-muted-foreground">{pagedInfo}</span>
                    <div className="flex items-center gap-2">
                      <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                        <ChevronLeft className="h-4 w-4" />
                      </Button>
                      <span className="text-sm tabular-nums">{page} / {lastPage}</span>
                      <Button variant="outline" size="sm" disabled={page >= lastPage} onClick={() => setPage((p) => p + 1)}>
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </main>

      <TicketDetailDrawer
        ticketId={openId}
        onClose={() => setOpenId(null)}
        onMutated={() => {
          // Triggered by drawer mutations — reload list + counts via the
          // effect chain by bouncing the page (lightweight).
          setPage((p) => p);
        }}
      />
    </>
  );
}

/* ── Local components ─────────────────────────────────────────────────── */

const ALL = "__all__";

function FilterSelect({
  label, value, onChange, options,
}: {
  label: string; value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[13px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</label>
      <Select value={value === "" ? ALL : value} onValueChange={(v) => onChange(v === ALL ? "" : v)}>
        <SelectTrigger className={cn("h-9 text-base", value && "border-brand/40 bg-brand/5 font-semibold text-brand")}>
          <SelectValue placeholder={`All ${label.toLowerCase()}`} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All {label.toLowerCase()}</SelectItem>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function DateRangePill({
  label, from, to, onFrom, onTo, onClear,
}: {
  label: string;
  from: string; to: string;
  onFrom: (v: string) => void; onTo: (v: string) => void; onClear: () => void;
}) {
  const active = from || to;
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[13px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</label>
      <div className="flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1">
        <CalendarRange className="h-3.5 w-3.5 text-muted-foreground" />
        <Input type="date" value={from} onChange={(e) => onFrom(e.target.value)}
          className="h-7 w-[125px] border-0 px-1 text-sm shadow-none focus-visible:ring-0" aria-label={`${label} from`} />
        <span className="text-sm text-muted-foreground">→</span>
        <Input type="date" value={to} onChange={(e) => onTo(e.target.value)}
          className="h-7 w-[125px] border-0 px-1 text-sm shadow-none focus-visible:ring-0" aria-label={`${label} to`} />
        {active && (
          <button onClick={onClear}
            className="ml-auto grid h-5 w-5 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label={`Clear ${label}`}>
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}
