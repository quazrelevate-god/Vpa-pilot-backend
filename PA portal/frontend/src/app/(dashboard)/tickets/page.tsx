"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Search, ChevronLeft, ChevronRight, Ticket as TicketIcon,
  CalendarCheck, CalendarRange, AlarmClockOff, SlidersHorizontal, X, Download,
} from "lucide-react";
import { motion } from "framer-motion";
import { toast } from "sonner";

import TopBar from "@/components/TopBar";
import { useLang } from "@/lib/lang-context";
import TicketDetailDrawer from "@/components/TicketDetailDrawer";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DateRangePill } from "@/components/ui/date-range-pill";
import { Skeleton } from "@/components/ui/skeleton";
import { InitialsAvatar } from "@/components/ui/avatar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { fetchTickets, fetchTicketsCounts, type TicketListFilters } from "@/lib/api";
import type { TicketRow } from "@/lib/types";
import {
  TICKET_STATUS_DISPLAY, TICKET_STATUS_COLOR, PRIORITY_DISPLAY,
  priorityOptions, ministryOptions, categoryOptions, MINISTRY_DISPLAY,
  schoolDepartmentOptions, sourceOptions,
  CATEGORY_DISPLAY_EN, CATEGORY_DISPLAY_TA,
} from "@/lib/enums";

const PAGE_SIZE = 25;   // Fixed server page size (backend caps at 25/page).

// All first (matches the reference), then the status queue, then the
// assignment view. Status tabs set `status`; the Assigned tab is a special
// client-side view (backend has no assigned/unassigned filter).
const SEGMENTS: { key: string; tKey: string }[] = [
  { key: "",                  tKey: "tickets.segAll" },
  { key: "open",              tKey: "tickets.segOpen" },
  { key: "in_progress",       tKey: "tickets.segProgress" },
  { key: "forwarded_to_dept", tKey: "tickets.segFwd" },
  { key: "resolved",          tKey: "tickets.segResolved" },
  { key: "closed",            tKey: "tickets.segClosed" },
  { key: "assigned",          tKey: "tickets.tabAssigned" },
];

const PRIORITY_RAIL: Record<string, string> = {
  critical: "bg-red-500", high: "bg-orange-500", medium: "bg-amber-400", low: "bg-slate-300",
};

// Soft Aurora priority pills (vs the saturated fills from enums).
const PRIORITY_PILL: Record<string, string> = {
  critical: "bg-red-100 text-red-700",
  high:     "bg-orange-100 text-orange-700",
  medium:   "bg-amber-100 text-amber-700",
  low:      "bg-slate-100 text-slate-600",
};

// SLA target days by AI-review priority.
const SLA_DAYS: Record<string, number> = { critical: 3, high: 7, medium: 14, low: 28 };

type DateChip = "today" | "yesterday" | "this_week" | "this_month" | "custom";

function catLabel(key: string | null | undefined, lang: string): string {
  if (!key) return "—";
  const k = key.toLowerCase();
  return (lang === "ta" ? CATEGORY_DISPLAY_TA[k] : CATEGORY_DISPLAY_EN[k]) ?? key.replace(/_/g, " ");
}

// Localized status + priority — reuse the same translation keys the detail
// drawer uses so the whole app switches together. Falls back to the English
// display map for any unmapped value.
const STATUS_TKEY: Record<string, string> = {
  open: "tkt.stOpen", triaged: "tkt.stTriaged", assigned: "tkt.stAssigned",
  in_progress: "tkt.stInProgress", forwarded_to_dept: "tkt.stForwarded",
  pending_citizen: "tkt.stPendingCitizen", resolved: "tkt.stResolved",
  closed: "tkt.stClosed", reopened: "tkt.stReopened",
};
const PRIORITY_TKEY: Record<string, string> = {
  low: "petition.urgencyLow", medium: "petition.urgencyMedium",
  high: "petition.urgencyHigh", critical: "petition.urgencyCritical",
};
function statusText(s: string, t: (k: string) => string): string {
  const k = STATUS_TKEY[s];
  return k ? t(k) : (TICKET_STATUS_DISPLAY[s] ?? s);
}
function priorityText(p: string, t: (k: string) => string): string {
  const k = PRIORITY_TKEY[p];
  return k ? t(k) : (PRIORITY_DISPLAY[p] ?? p);
}

/**
 * Who a ticket is assigned to. Routing to a school department is what flips a
 * ticket to status `assigned`, so the department is the primary answer here —
 * matching what the detail drawer's "Assign" field shows. Falls back to the PA
 * owner when a ticket is held by a person rather than routed on.
 */
function assigneeLabel(row: TicketRow): string | null {
  return row.assigned_department_label || row.assigned_department || row.assigned_to_pa || null;
}
function isBreached(row: TicketRow): boolean {
  if (row.status === "resolved" || row.status === "closed") return false;
  const target = SLA_DAYS[row.priority ?? ""];
  if (!target) return false;
  const days = (Date.now() - new Date(row.created_at).getTime()) / 86_400_000;
  return days >= target;
}

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
  if (hrs < 24) return `${hrs}h ${mins % 60}m`;
  const days = Math.floor(hrs / 24);
  return `${days}d ${hrs % 24}h`;
}

function slaLabel(priority: string | null | undefined): string {
  if (!priority || !SLA_DAYS[priority]) return "—";
  const d = SLA_DAYS[priority];
  return d >= 7 ? `SLA: ${d / 7}w` : `SLA: ${d}d`;
}

function toISODate(d: Date) {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, "0"), day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function computeDateChip(chip: DateChip): { from: string; to: string } {
  const now = new Date(); now.setHours(0, 0, 0, 0);
  if (chip === "today") { const s = toISODate(now); return { from: s, to: s }; }
  if (chip === "yesterday") {
    const y = new Date(now); y.setDate(y.getDate() - 1); const s = toISODate(y);
    return { from: s, to: s };
  }
  if (chip === "this_week") {
    const day = now.getDay(); const monOffset = day === 0 ? -6 : 1 - day;
    const start = new Date(now); start.setDate(start.getDate() + monOffset);
    const end = new Date(start); end.setDate(end.getDate() + 6);
    return { from: toISODate(start), to: toISODate(end) };
  }
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return { from: toISODate(start), to: toISODate(end) };
}


/** Numbered pagination — 1 … current−1 current current+1 … last. */
function pageList(current: number, last: number): (number | "…")[] {
  if (last <= 7) return Array.from({ length: last }, (_, i) => i + 1);
  const wanted = [1, current - 1, current, current + 1, last].filter((p) => p >= 1 && p <= last);
  const sorted = [...new Set(wanted)].sort((a, b) => a - b);
  const out: (number | "…")[] = [];
  let prev = 0;
  for (const p of sorted) {
    if (p - prev > 1) out.push("…");
    out.push(p);
    prev = p;
  }
  return out;
}

/** Memoized row — re-renders only when its own data changes. */
const TicketTableRow = memo(function TicketTableRow({
  row, active, onOpen, t, lang,
}: {
  row: TicketRow;
  active: boolean;
  onOpen: (id: number) => void;
  t: (k: string) => string;
  lang: string;
}) {
  const assignee = assigneeLabel(row);
  return (
    <tr
      onClick={() => onOpen(row.id)}
      className={cn(
        "group cursor-pointer border-b border-border/60 transition-[background-color,box-shadow] duration-150",
        active
          ? "bg-brand/[0.05] shadow-[inset_3px_0_0_hsl(var(--accent-blue)),inset_0_0_0_1px_hsl(var(--accent-blue)/0.14)]"
          : "hover:bg-[#EFF3FB] hover:shadow-[inset_3px_0_0_hsl(var(--accent-blue)/0.45)]",
      )}
    >
      <td className="py-4 pl-4 pr-2">
        <div className="flex items-center gap-2.5">
          <span className={cn("h-8 w-1 rounded-full", PRIORITY_RAIL[row.priority ?? ""] ?? "bg-transparent")} />
          <span className="font-mono text-[13px] font-semibold leading-tight text-brand">{row.ticket_number}</span>
        </div>
      </td>
      <td className="px-4 py-4">
        <div className="flex items-center gap-2.5">
          <InitialsAvatar name={row.citizen_name ?? "—"} className="h-9 w-9 rounded-lg text-xs" />
          <div className="min-w-0">
            <div className="type-table-row truncate text-foreground">{row.citizen_name ?? "—"}</div>
            <div className="font-mono text-[13px] text-muted-foreground">{row.citizen_mobile ?? row.token ?? ""}</div>
          </div>
        </div>
      </td>
      <td className="max-w-md px-4 py-4">
        <div className="line-clamp-2 text-sm leading-snug text-foreground/85">
          {row.citizen_ask ?? <span className="italic text-muted-foreground/60">{t("tickets.colSummary")}</span>}
        </div>
      </td>
      <td className="px-4 py-4 text-[15px] font-semibold text-foreground">{catLabel(row.category, lang)}</td>
      <td className="px-4 py-4">
        {row.priority
          ? <span className={cn("rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide", PRIORITY_PILL[row.priority] ?? "bg-muted text-muted-foreground")}>{priorityText(row.priority, t)}</span>
          : <span className="text-muted-foreground/40">—</span>}
      </td>
      <td className="px-4 py-4">
        {assignee
          ? <span className="text-sm text-foreground">{assignee}</span>
          : <span className="text-sm italic text-muted-foreground/50">{t("tickets.unassigned")}</span>}
      </td>
      <td className="px-4 py-4 text-right">
        <div className={cn("text-sm tabular-nums", slaColor(row.created_at, row.status, row.priority))}>
          {formatAge(row.created_at)}
        </div>
        <div className="text-[11px] uppercase tracking-wider text-muted-foreground/60">
          {slaLabel(row.priority)}
        </div>
      </td>
    </tr>
  );
});

/** Mobile/tablet card. */
const TicketCard = memo(function TicketCard({
  row, onOpen, t, lang,
}: {
  row: TicketRow;
  onOpen: (id: number) => void;
  t: (k: string) => string;
  lang: string;
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
          <span className={cn("rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide", PRIORITY_PILL[row.priority] ?? "bg-muted text-muted-foreground")}>{priorityText(row.priority, t)}</span>
        )}
        <span className={cn("ml-auto rounded-full border px-2.5 py-1 text-[13px] font-semibold", TICKET_STATUS_COLOR[row.status])}>
          {statusText(row.status, t)}
        </span>
      </div>
      <div className="mt-3 flex items-center gap-2.5">
        <InitialsAvatar name={row.citizen_name ?? "—"} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-foreground">{row.citizen_name ?? "—"}</div>
          <div className="text-[13px] text-muted-foreground">{row.citizen_mobile ?? row.token ?? ""}</div>
        </div>
        <div className="text-right">
          <div className={cn("text-sm tabular-nums", slaColor(row.created_at, row.status, row.priority))}>
            {formatAge(row.created_at)}
          </div>
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground/60">
            {slaLabel(row.priority)}
          </div>
        </div>
      </div>
      {row.citizen_ask && (
        <div className="mt-2 line-clamp-2 text-sm leading-snug text-foreground/85">{row.citizen_ask}</div>
      )}
      <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
        <span>{catLabel(row.category, lang)}</span>
        <span>{assigneeLabel(row) ?? t("tickets.unassigned")}</span>
      </div>
    </div>
  );
});

export default function TicketsPage() {
  const { t, lang } = useLang();
  const [rows, setRows] = useState<TicketRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);

  // Default to 'open' — the PA's queue-of-attention. All / Assigned reachable
  // via the tabs. "assigned" is a real ticket status (auto-set when the PA
  // routes a ticket to a department), so it's a normal server-side filter.
  const [status, setStatus] = useState("open");
  const [priority, setPriority] = useState("");
  const [deptValue, setDeptValue] = useState("");   // AI ministry | forwarded_to_dept per tab
  // Assigned school department (Ticket.department). Only shown on the
  // Assigned / In Progress / Closed / Resolved tabs since those are the
  // only states where a department has actually taken ownership.
  const [assignedDept, setAssignedDept] = useState("");
  // Intake channel (Appointment.source). Shown on every tab except
  // Forwarded — forwarded tickets are filtered by target ministry, not by
  // how the citizen originally submitted.
  const [sourceValue, setSourceValue] = useState("");
  const [category, setCategory] = useState("");   // driven by the distribution chart
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [dateChip, setDateChip] = useState<DateChip | null>(null);
  const [breachedOnly, setBreachedOnly] = useState(false);
  // Bumped from onMutated so the list + counts always refetch after a drawer
  // action, even when no other filter changed. The previous approach
  // (`setPage((p) => p)`) is a no-op — React skips state updates that
  // resolve to Object.is-equal values, so the effect chain wouldn't re-run
  // and reverted/closed/reopened tickets stayed visible until manual refresh.
  const [refreshTick, setRefreshTick] = useState(0);
  const [showRail, setShowRail] = useState(true);

  const [counts, setCounts] = useState<Record<string, number>>({});
  const [breachedCount, setBreachedCount] = useState(0);   // breached across all statuses
  const [openId, setOpenId] = useState<number | null>(null);
  const [exporting, setExporting] = useState(false);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);

  // Ministry filter (ministryOptions, per the rest of the UI).
  //  · All        → rail select filters by the AI-routed ministry
  //  · Forwarded  → NO rail select; the Ministry Distribution chart drives it
  //                 (filters by forwarded-to ministry), so `field` stays set
  //                 while `show` is false
  //  · every other tab → hidden
  const isForwarded = status === "forwarded_to_dept";
  const deptFilter = useMemo<{ show: boolean; field: "ministry" | "forwarded_to_dept" | null; label: string }>(() => {
    switch (status) {
      case "":                  return { show: true,  field: "ministry",          label: "label.ministry" };
      case "forwarded_to_dept": return { show: false, field: "forwarded_to_dept", label: "label.ministry" };
      default:                  return { show: false, field: null,                label: "label.ministry" };
    }
  }, [status]);

  const deptParams = useMemo(() => ({
    ministry: deptFilter.field === "ministry" ? (deptValue || undefined) : undefined,
    forwardedToDept: deptFilter.field === "forwarded_to_dept" ? (deptValue || undefined) : undefined,
  }), [deptFilter, deptValue]);

  // Assigned-department filter is only meaningful once a ticket has been
  // routed to a department, i.e. Assigned / In Progress / Closed / Resolved.
  const showAssignedDeptFilter =
    status === "assigned" || status === "in_progress" || status === "closed" || status === "resolved";
  // Source (intake channel) filter is meaningful everywhere except the
  // Forwarded tab, where the operator is thinking about ministry routing,
  // not how the citizen submitted.
  const showSourceFilter = status !== "forwarded_to_dept";

  // Filters sent to the backend (table + counts). Category is chart-driven.
  const secondary = useMemo<Omit<TicketListFilters, "status" | "page">>(() => ({
    priority, ...deptParams,
    department: showAssignedDeptFilter ? (assignedDept || undefined) : undefined,
    source: showSourceFilter ? (sourceValue || undefined) : undefined,
    category, search, dateFrom, dateTo,
  }), [priority, deptParams, showAssignedDeptFilter, assignedDept, showSourceFilter, sourceValue, category, search, dateFrom, dateTo]);

  // The distribution chart shows category bars on most tabs, but ministry bars
  // on the Forwarded tab (where it also drives the ministry filter).
  const chartMode: "category" | "ministry" = isForwarded ? "ministry" : "category";

  // Chart scope excludes the field the chart itself drives, so every bar stays
  // visible: category on most tabs, forwarded-to ministry on the Forwarded tab.
  const chartScope = useMemo<Omit<TicketListFilters, "status" | "page">>(() => (
    isForwarded
      ? { priority, search, dateFrom, dateTo }
      : { priority, ...deptParams, search, dateFrom, dateTo }
  ), [isForwarded, priority, deptParams, search, dateFrom, dateTo]);

  const advancedFilterCount =
    (priority ? 1 : 0)
    + (deptValue ? 1 : 0)
    + (showAssignedDeptFilter && assignedDept ? 1 : 0)
    + (showSourceFilter && sourceValue ? 1 : 0)
    + (category ? 1 : 0)
    + ((dateFrom || dateTo) ? 1 : 0);

  const anyFilterActive = Boolean(
    search || priority || deptValue
      || (showAssignedDeptFilter && assignedDept)
      || (showSourceFilter && sourceValue)
      || category || dateFrom || dateTo || breachedOnly,
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
    // refreshTick intentionally in deps — see onMutated below.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, page, secondary, refreshTick]);

  // Counts: the /counts endpoint only aggregates the five main statuses, so the
  // "assigned" tab count comes from a parallel filtered list call (total only).
  const loadCounts = useCallback(async (signal: AbortSignal) => {
    try {
      const [data, assignedRes] = await Promise.all([
        fetchTicketsCounts(secondary, signal),
        fetchTickets({ status: "assigned", page: 1, ...secondary }, signal),
      ]);
      if (!signal.aborted) setCounts({ ...data, assigned: assignedRes.total });
    } catch { /* aborts + transient errors are non-fatal */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [secondary, refreshTick]);

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

  // Breached count — across all statuses (not the active tab), honouring the
  // global filters only, so the SLA-breached badge is meaningful everywhere.
  // (SLA-breach is computed client-side; the backend has no SLA filter.)
  useEffect(() => {
    const ctrl = new AbortController();
    fetchTickets({ status: "", page: 1, priority, search, dateFrom, dateTo }, ctrl.signal)
      .then((d) => { if (!ctrl.signal.aborted) setBreachedCount(d.items.filter(isBreached).length); })
      .catch(() => {});
    return () => ctrl.abort();
  }, [priority, search, dateFrom, dateTo]);

  // Aurora Recall — ⌘K focuses the header search from anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault(); searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
  }, []);

  function onSearchChange(v: string) {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => { setPage(1); setSearch(v); }, 300);
  }

  const applyDateChip = useCallback((chip: DateChip) => {
    setPage(1);
    if (chip === "custom") { setDateChip("custom"); return; }
    if (dateChip === chip) { setDateChip(null); setDateFrom(""); setDateTo(""); return; }
    const { from, to } = computeDateChip(chip);
    setDateChip(chip); setDateFrom(from); setDateTo(to);
  }, [dateChip]);

  const clearAll = useCallback(() => {
    setPriority(""); setDeptValue(""); setAssignedDept(""); setSourceValue(""); setCategory("");
    setDateFrom(""); setDateTo(""); setDateChip(null); setSearch("");
    setBreachedOnly(false); setPage(1);
  }, []);

  // SLA-breached is the one view the backend can't express — narrow the loaded
  // page client-side. (Assigned is now a real server-side status filter.)
  const displayRows = useMemo(() => {
    if (!breachedOnly) return rows;
    return rows.filter(isBreached);
  }, [rows, breachedOnly]);

  const clientNarrowed = breachedOnly;
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const offset = (page - 1) * PAGE_SIZE;
  const lo = total === 0 ? 0 : Math.min(offset + 1, total);
  const hi = Math.min(offset + PAGE_SIZE, total);

  async function doExport() {
    setExporting(true);
    try {
      const all: TicketRow[] = [];
      const maxPages = Math.min(lastPage, 40);   // safety cap ≈ 1000 tickets
      for (let p = 1; p <= maxPages; p++) {
        const d = await fetchTickets({ status, page: p, ...secondary });
        all.push(...d.items);
      }
      let exportRows = all;
      if (breachedOnly) exportRows = exportRows.filter(isBreached);
      const headers = ["Ticket", "Citizen", "Mobile", "Category", "Priority", "Status", "Assigned", "Created"];
      const lines = exportRows.map((r) => [
        r.ticket_number, r.citizen_name ?? "", r.citizen_mobile ?? "",
        catLabel(r.category, "en"), r.priority ?? "",
        TICKET_STATUS_DISPLAY[r.status] ?? r.status, assigneeLabel(r) ?? "", r.created_at,
      ]);
      const csv = [headers, ...lines].map((row) => row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
      const a = document.createElement("a");
      a.href = "data:text/csv;charset=utf-8," + encodeURIComponent(csv);
      a.download = `tickets_${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      toast.success(`${exportRows.length} ${t("tickets.results")}`);
    } catch { toast.error("Export failed"); }
    finally { setExporting(false); }
  }

  const th = "px-4 py-3.5 text-left text-[11px] font-semibold uppercase tracking-[0.09em] text-muted-foreground/80";

  return (
    <>
      <TopBar
        title={t("tickets.title")}
        subtitle={t("tickets.subtitle")}
        icon={<TicketIcon className="h-5 w-5" />}
        searchSlot={
          <div className="relative w-full">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={searchRef}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder={t("tickets.searchPlaceholder")}
              className="peer h-10 rounded-full border-transparent bg-muted/70 pl-10 pr-14 text-sm transition-all duration-200 focus-visible:border-border focus-visible:bg-card focus-visible:shadow-[0_0_0_3px_hsl(var(--accent-blue)/0.14),0_2px_8px_rgba(28,30,41,0.06)]"
            />
            <kbd className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 font-mono text-[11px] font-semibold text-muted-foreground transition-all duration-200 peer-focus-visible:scale-90 peer-focus-visible:opacity-0">
              ⌘ K
            </kbd>
          </div>
        }
      />
      <main className="flex-1 overflow-y-auto bg-background xl:overflow-hidden">
        <div className="flex flex-col gap-4 px-4 py-6 animate-in-up xl:h-full">
          {/* Tabs (left) · SLA breached · Filters toggle · Export (right) */}
          <div className="flex shrink-0 flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap items-center gap-1.5">
              {SEGMENTS.map((s) => {
                const active = status === s.key;
                const count = counts[s.key];
                return (
                  <button
                    key={s.key || "all"}
                    onClick={() => { setStatus(s.key); setDeptValue(""); setCategory(""); setBreachedOnly(false); setPage(1); }}
                    className={cn(
                      "relative flex items-center gap-2 rounded-[10px] px-3.5 py-2 text-[15px] font-semibold transition-colors duration-150",
                      active ? "text-brand" : "text-muted-foreground hover:bg-muted hover:text-foreground",
                    )}
                  >
                    {active && (
                      <motion.span
                        layoutId="tickets-tab-pill"
                        className="aurora-tab-active absolute inset-0 rounded-[10px]"
                        transition={{ type: "spring", stiffness: 420, damping: 38 }}
                      />
                    )}
                    <span className="relative z-[1]">{t(s.tKey)}</span>
                    <span className={cn(
                      "relative z-[1] min-w-[22px] rounded-md px-1.5 py-0.5 text-center text-[12px] font-bold tabular-nums",
                      active ? "bg-white text-brand shadow-card" : "bg-muted text-muted-foreground",
                    )}>
                      {count ?? "·"}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {([
                ["today", t("tickets.chipToday"), CalendarCheck],
                ["this_week", t("tickets.chipThisWeek"), CalendarRange],
              ] as [DateChip, string, React.ElementType][]).map(([key, label, Icon]) => (
                <button
                  key={key}
                  onClick={() => applyDateChip(key)}
                  className={cn(
                    "inline-flex h-[38px] items-center gap-1.5 rounded-xl border px-3.5 text-sm font-semibold transition-colors",
                    dateChip === key
                      ? "border-[#CFE0FB] bg-accent text-brand"
                      : "border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  <Icon className="h-4 w-4" /> {label}
                </button>
              ))}
              <button
                // Acts as an action, not a passive toggle: jump to the All tab
                // and filter to breached; click again to clear.
                onClick={() => {
                  if (breachedOnly) { setBreachedOnly(false); setPage(1); return; }
                  setStatus(""); setDeptValue(""); setCategory(""); setBreachedOnly(true); setPage(1);
                }}
                className={cn(
                  "inline-flex h-[38px] items-center gap-1.5 rounded-xl border px-3.5 text-sm font-semibold transition-colors",
                  breachedOnly
                    ? "border-red-600 bg-red-600 text-white shadow-card"
                    : breachedCount > 0
                      ? "border-red-300 bg-red-50 text-red-700 hover:bg-red-100"
                      : "border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                <AlarmClockOff className="h-4 w-4" /> {t("tickets.chipBreached")}
                <span className={cn(
                  "grid h-5 min-w-[20px] place-items-center rounded-full px-1 text-[11px] font-bold tabular-nums",
                  breachedOnly ? "bg-white/25 text-white" : breachedCount > 0 ? "bg-red-600 text-white" : "bg-muted text-muted-foreground",
                )}>
                  {breachedCount}
                </span>
              </button>
              <button
                onClick={() => setShowRail((s) => !s)}
                className={cn(
                  "inline-flex h-[38px] items-center gap-1.5 rounded-xl border px-3.5 text-sm font-semibold transition-colors",
                  showRail || advancedFilterCount > 0
                    ? "border-[#CFE0FB] bg-accent text-brand"
                    : "border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                <SlidersHorizontal className="h-4 w-4" />
                {t("tickets.filters")}
                {advancedFilterCount > 0 && (
                  <span className="grid h-5 min-w-[20px] place-items-center rounded-full bg-brand px-1 text-[11px] font-bold text-brand-foreground">
                    {advancedFilterCount}
                  </span>
                )}
              </button>
              <Button variant="outline" onClick={doExport} disabled={exporting} className="h-[38px] rounded-xl">
                <Download className="h-4 w-4 text-brand" /> {t("tickets.export")}
              </Button>
            </div>
          </div>

          {/* Two-column workspace: table (left) · filters + insights rail (right) */}
          <div className={cn(
            "grid gap-4 xl:min-h-0 xl:flex-1",
            showRail ? "xl:grid-cols-[minmax(0,1fr)_360px]" : "xl:grid-cols-1",
          )}>
            <div className="flex min-w-0 flex-col gap-4 xl:min-h-0">
              {/* Desktop table — fills to the bottom of the page; body scrolls */}
              <Card className="hidden overflow-hidden p-0 shadow-card-md md:block xl:flex xl:min-h-0 xl:flex-1 xl:flex-col">
                <div className="overflow-x-auto xl:min-h-0 xl:flex-1 xl:overflow-y-auto">
                  <table className="w-full min-w-[980px] text-base">
                    <thead className="sticky top-0 z-10 bg-card">
                      <tr className="border-b border-border">
                        <th className={cn(th, "w-[150px]")}>{t("tickets.colTicket")}</th>
                        <th className={th}>{t("tickets.colCitizen")}</th>
                        <th className={th}>{t("tickets.colSummary")}</th>
                        <th className={cn(th, "w-40")}>{t("label.category")}</th>
                        <th className={cn(th, "w-24")}>{t("tickets.colPriority")}</th>
                        <th className={cn(th, "w-40")}>{t("tickets.colAssigned")}</th>
                        <th className={cn(th, "w-32 text-right")}>{t("tickets.colOpenFor")}</th>
                      </tr>
                    </thead>
                    <tbody key={`${status}-${page}`}>
                      {loading ? (
                        Array.from({ length: 4 }).map((_, i) => (
                          <tr key={i} className="border-b border-border/60">
                            <td className="px-4 py-4"><Skeleton className="h-4 w-24" /></td>
                            <td className="px-4 py-4"><div className="flex items-center gap-2.5"><Skeleton className="h-9 w-9 rounded-lg" /><div className="space-y-1.5"><Skeleton className="h-3.5 w-24" /><Skeleton className="h-3 w-16" /></div></div></td>
                            <td className="px-4 py-4"><div className="space-y-1.5"><Skeleton className="h-3.5 w-full max-w-[260px]" /><Skeleton className="h-3.5 w-3/4 max-w-[200px]" /></div></td>
                            <td className="px-4 py-4"><Skeleton className="h-4 w-24" /></td>
                            <td className="px-4 py-4"><Skeleton className="h-5 w-14 rounded" /></td>
                            <td className="px-4 py-4"><Skeleton className="h-4 w-24" /></td>
                            <td className="px-4 py-4"><Skeleton className="ml-auto h-4 w-12" /></td>
                            <td />
                          </tr>
                        ))
                      ) : displayRows.length === 0 ? (
                        <tr><td colSpan={7} className="px-4 py-16 text-center">
                          <TicketIcon className="mx-auto mb-3 h-10 w-10 text-muted-foreground/30" />
                          <div className="text-base font-semibold text-foreground">{t("tickets.noTickets")}</div>
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
                        <TicketTableRow key={r.id} row={r} active={openId === r.id} onOpen={setOpenId} t={t} lang={lang} />
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Pagination */}
                <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3 text-sm">
                  <span className="text-muted-foreground">
                    {total > 0
                      ? clientNarrowed
                        ? `${t("tickets.showing")} ${displayRows.length} ${t("tickets.results")}`
                        : `${t("tickets.showing")} ${lo} ${t("tickets.to")} ${hi} ${t("tickets.of")} ${total} ${t("tickets.results")}`
                      : t("tickets.noTickets")}
                  </span>
                  {!clientNarrowed && lastPage > 1 && (
                    <div className="flex items-center gap-1">
                      <button disabled={page <= 1} onClick={() => setPage(page - 1)} aria-label={t("tickets.prev")}
                        className="grid h-9 w-9 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40">
                        <ChevronLeft className="h-4 w-4" />
                      </button>
                      {pageList(page, lastPage).map((p, i) =>
                        p === "…" ? (
                          <span key={`e${i}`} className="px-1.5 text-muted-foreground">…</span>
                        ) : (
                          <button key={p} onClick={() => setPage(p)}
                            className={cn(
                              "grid h-9 min-w-9 place-items-center rounded-lg px-1 text-sm font-semibold tabular-nums transition-colors",
                              p === page ? "aurora-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground",
                            )}>
                            {p}
                          </button>
                        )
                      )}
                      <button disabled={page >= lastPage} onClick={() => setPage(page + 1)} aria-label={t("tickets.next")}
                        className="grid h-9 w-9 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40">
                        <ChevronRight className="h-4 w-4" />
                      </button>
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
                    <div className="text-base font-semibold text-foreground">{t("tickets.noTickets")}</div>
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
                    {displayRows.map((r) => <TicketCard key={r.id} row={r} onOpen={setOpenId} t={t} lang={lang} />)}
                    {!clientNarrowed && lastPage > 1 && (
                      <div className="flex items-center justify-between rounded-xl border border-border bg-card px-3 py-2 text-base">
                        <span className="text-muted-foreground">{lo}–{hi} {t("tickets.of")} {total}</span>
                        <div className="flex items-center gap-2">
                          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}><ChevronLeft className="h-4 w-4" /></Button>
                          <span className="text-sm tabular-nums">{page} / {lastPage}</span>
                          <Button variant="outline" size="sm" disabled={page >= lastPage} onClick={() => setPage(page + 1)}><ChevronRight className="h-4 w-4" /></Button>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>{/* left column */}

            {/* Right rail — Filters + Category Distribution */}
            {showRail && (
              <aside className="flex flex-col gap-4 xl:min-h-0">
                <Card className="flex flex-col p-5 shadow-card-md xl:min-h-0 xl:flex-1">
                  <div className="mb-4 flex shrink-0 items-center justify-between">
                    <h3 className="type-card-heading flex items-center gap-2 text-foreground">
                      <button onClick={() => setShowRail(false)} aria-label={t("tickets.filters")}
                        className="grid h-6 w-6 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
                        <ChevronLeft className="h-4 w-4" />
                      </button>
                      {t("tickets.filters")}
                      {advancedFilterCount > 0 && (
                        <span className="grid h-5 min-w-[20px] place-items-center rounded-full bg-brand px-1 text-[11px] font-bold text-brand-foreground">
                          {advancedFilterCount}
                        </span>
                      )}
                    </h3>
                    {anyFilterActive && (
                      <button onClick={clearAll}
                        className="inline-flex items-center gap-1 text-[13px] font-semibold text-muted-foreground transition-colors hover:text-destructive">
                        <X className="h-3.5 w-3.5" /> {t("tickets.clearAll")}
                      </button>
                    )}
                  </div>

                  <div className="-mr-2 flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto pr-2">
                    {/* Priority */}
                    <div className="flex flex-col gap-2">
                      <FilterSectionLabel label={t("label.priority")} onReset={priority ? () => { setPage(1); setPriority(""); } : undefined} resetLabel={t("tickets.reset")} />
                      <FilterSelect label={t("label.priority")} value={priority}
                        onChange={(v) => { setPage(1); setPriority(v); }} options={priorityOptions} />
                    </div>

                    {/* Ministry — routing ministry (All) or forwarded-to ministry
                        (Forwarded); hidden on every other tab. */}
                    {deptFilter.show && (
                      <div className="flex flex-col gap-2">
                        <FilterSectionLabel label={t(deptFilter.label)} onReset={deptValue ? () => { setPage(1); setDeptValue(""); } : undefined} resetLabel={t("tickets.reset")} />
                        <FilterSelect label={t(deptFilter.label)} value={deptValue}
                          onChange={(v) => { setPage(1); setDeptValue(v); }} options={ministryOptions} />
                      </div>
                    )}

                    {/* Assigned department — Assigned / In Progress / Closed /
                        Resolved only. Filters by the school department the PA
                        routed the ticket to (Ticket.department). */}
                    {showAssignedDeptFilter && (
                      <div className="flex flex-col gap-2">
                        <FilterSectionLabel label={t("tickets.assignedDepartment")}
                          onReset={assignedDept ? () => { setPage(1); setAssignedDept(""); } : undefined}
                          resetLabel={t("tickets.reset")} />
                        <FilterSelect label={t("tickets.assignedDepartment")} value={assignedDept}
                          onChange={(v) => { setPage(1); setAssignedDept(v); }} options={schoolDepartmentOptions} />
                      </div>
                    )}

                    {/* Source — everywhere except the Forwarded tab. Intake
                        channel the petition came in through. */}
                    {showSourceFilter && (
                      <div className="flex flex-col gap-2">
                        <FilterSectionLabel label={t("tickets.source")}
                          onReset={sourceValue ? () => { setPage(1); setSourceValue(""); } : undefined}
                          resetLabel={t("tickets.reset")} />
                        <FilterSelect label={t("tickets.source")} value={sourceValue}
                          onChange={(v) => { setPage(1); setSourceValue(v); }} options={sourceOptions} />
                      </div>
                    )}

                    {/* Created date — picker only (Today / This week live in the
                        top toolbar next to SLA breached). */}
                    <div className="flex flex-col gap-2.5">
                      <FilterSectionLabel label={t("tickets.dateRange")}
                        onReset={(dateFrom || dateTo || dateChip) ? () => { setPage(1); setDateFrom(""); setDateTo(""); setDateChip(null); } : undefined}
                        resetLabel={t("tickets.reset")} />
                      <DateRangePill
                        from={dateFrom} to={dateTo}
                        onFrom={(v) => { setPage(1); setDateFrom(v); setDateChip("custom"); }}
                        onTo={(v) => { setPage(1); setDateTo(v); setDateChip("custom"); }}
                        ariaFromLabel={`${t("tickets.dateRange")} from`}
                        ariaToLabel={`${t("tickets.dateRange")} to`}
                      />
                    </div>
                  </div>
                </Card>

                <DistributionCard
                  status={status}
                  scope={chartScope}
                  lang={lang}
                  mode={chartMode}
                  activeKey={isForwarded ? deptValue : category}
                  onSelect={(key) => {
                    setPage(1);
                    if (isForwarded) setDeptValue((v) => (v === key ? "" : key));
                    else setCategory((c) => (c === key ? "" : key));
                  }}
                  className="xl:min-h-0 xl:flex-1"
                />
              </aside>
            )}
          </div>{/* two-column grid */}
        </div>
      </main>

      <TicketDetailDrawer
        ticketId={openId}
        onClose={() => setOpenId(null)}
        onMutated={() => {
          // Triggered by drawer mutations (close / reopen / revert / priority
          // edit / assign). Bump refreshTick — load() and loadCounts() both
          // depend on it, so the list + counts refetch. The previous
          // `setPage((p) => p)` was a no-op because React skips state
          // updates that resolve to the same value.
          setRefreshTick((t) => t + 1);
        }}
      />
    </>
  );
}

/* ── Local components ─────────────────────────────────────────────────── */

const ALL = "__all__";

function FilterSectionLabel({ label, onReset, resetLabel }: { label: string; onReset?: () => void; resetLabel: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[11px] font-semibold uppercase tracking-[0.09em] text-muted-foreground">{label}</span>
      {onReset && (
        <button onClick={onReset} className="text-[12px] font-semibold text-brand transition-colors hover:underline">{resetLabel}</button>
      )}
    </div>
  );
}

function FilterSelect({
  label, value, onChange, options,
}: {
  label: string; value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <Select value={value === "" ? ALL : value} onValueChange={(v) => onChange(v === ALL ? "" : v)}>
      <SelectTrigger className={cn("h-11 rounded-xl text-sm", value && "border-brand/40 bg-brand/5 font-semibold text-brand")}>
        <SelectValue placeholder={`All ${label.toLowerCase()}`} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>All {label.toLowerCase()}</SelectItem>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

const BAR_PALETTE = ["#1E40AF", "#4C82F2", "#EE9A3C", "#34A26C", "#E5484D", "#35839B"];

/** Category Distribution — self-fetches the current scope (minus category) so
 *  every bar stays visible while one is selected to filter the table. Backend
 *  has no category-breakdown endpoint and caps pages at 25, so this aggregates
 *  the first page of the current scope — a live snapshot, clickable to filter. */
function DistributionCard({ status, scope, lang, mode, activeKey, onSelect, className }: {
  status: string;
  scope: Omit<TicketListFilters, "status" | "page">;
  lang: string;
  mode: "category" | "ministry";
  activeKey: string;
  onSelect: (key: string) => void;
  className?: string;
}) {
  const { t } = useLang();
  const [bars, setBars] = useState<{ key: string; count: number }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const ctrl = new AbortController();
    setLoading(true);
    fetchTickets({ status, page: 1, ...scope }, ctrl.signal)
      .then((d) => {
        const m = new Map<string, number>();
        for (const r of d.items) {
          const k = mode === "ministry" ? (r.forwarded_to_dept || "other") : (r.category || "other").toLowerCase();
          m.set(k, (m.get(k) ?? 0) + 1);
        }
        setBars(Array.from(m, ([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, [status, scope, mode]);

  const total = bars.reduce((a, b) => a + b.count, 0);
  const labelOf = (k: string) => mode === "ministry" ? (MINISTRY_DISPLAY[k] ?? k.replace(/_/g, " ")) : catLabel(k, lang);

  return (
    <Card className={cn("flex flex-col p-5 shadow-card-md", className)}>
      <div className="mb-4 flex shrink-0 items-center justify-between">
        <h3 className="type-card-heading text-foreground">
          {mode === "ministry" ? t("tickets.ministryDistribution") : t("tickets.categoryDistribution")}
        </h3>
        <span className="text-[13px] text-muted-foreground">
          {t("tickets.total")}: <span className="font-semibold tabular-nums text-foreground">{total}</span>
        </span>
      </div>
      {loading ? (
        <div className="grid flex-1 place-items-center"><Skeleton className="h-40 w-full rounded-lg" /></div>
      ) : bars.length === 0 ? (
        <div className="grid flex-1 place-items-center text-center text-sm text-muted-foreground">{t("tickets.noData")}</div>
      ) : (
        <>
          <div className="-mr-2 flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-2">
            {bars.map((b, i) => {
              // Bar width is the SHARE of the total (so a 50% category is a
              // half-full bar) — not relative to the largest bar.
              const pct = total ? (b.count / total) * 100 : 0;
              const share = Math.round(pct);
              const isActive = activeKey === b.key;
              const dimmed = Boolean(activeKey) && !isActive;
              return (
                <button
                  key={b.key}
                  onClick={() => onSelect(b.key)}
                  aria-pressed={isActive}
                  className={cn(
                    "w-full rounded-lg px-2 py-1.5 text-left transition-all",
                    isActive ? "bg-accent ring-1 ring-[#BBD3FA]" : "hover:bg-muted/60",
                    dimmed && "opacity-45 hover:opacity-100",
                  )}
                >
                  <div className="mb-1 flex items-center gap-2 text-[13px]">
                    <span className="shrink-0 font-semibold tabular-nums text-foreground">{b.count}</span>
                    <span className={cn("min-w-0 flex-1 truncate", isActive ? "font-semibold text-brand" : "text-foreground")}>{labelOf(b.key)}</span>
                    <span className="shrink-0 tabular-nums text-muted-foreground">{share}%</span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full transition-all"
                      style={{ width: `${pct}%`, backgroundColor: BAR_PALETTE[i % BAR_PALETTE.length] }} />
                  </div>
                </button>
              );
            })}
          </div>
          <div className="mt-3 flex shrink-0 items-center gap-1.5 border-t border-border pt-3 text-[12px] text-muted-foreground">
            <SlidersHorizontal className="h-3.5 w-3.5" /> {mode === "ministry" ? t("tickets.clickMinistryHint") : t("tickets.clickCategoryHint")}
          </div>
        </>
      )}
    </Card>
  );
}
