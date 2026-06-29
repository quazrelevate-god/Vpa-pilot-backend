"use client";

import { memo, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Download, Search, ChevronLeft, ChevronRight, ChevronRight as RowChevron,
  CalendarClock, CalendarDays, CalendarRange, X, ArrowUpDown, ArrowDownNarrowWide,
  ArrowDownAZ, ArrowUpAZ, SlidersHorizontal, MoreVertical, Clock, AlarmClockOff,
  CalendarCheck, RotateCw,
} from "lucide-react";
import { toast } from "sonner";

import TopBar from "@/components/TopBar";
import PriorityBadge from "@/components/PriorityBadge";
import { useLang } from "@/lib/lang-context";
import RescheduleModal from "@/components/RescheduleModal";
import AppointmentDetailDrawer from "@/components/AppointmentDetailDrawer";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { InitialsAvatar } from "@/components/ui/avatar";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn, formatDateTime } from "@/lib/utils";
import { fetchAppointments, fetchAppointmentCounts, updateAppointmentStatus } from "@/lib/api";
import type { AppointmentRow, AppointmentStatus } from "@/lib/types";
import { urgencyOptions, deptOptions, categoryOptions } from "@/lib/enums";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

// Appointments is meeting-centric. Direct petitions (Awaiting Review / Reviewed)
// live in Petition Review, so the tabs here are meeting states only.
const TABS = ["Scheduled", "Waiting", "Rescheduled", "All"] as const;
type Tab = (typeof TABS)[number];
const DEFAULT_TAB: Tab = "Scheduled";
const PAGE_SIZE = 25;

const TAB_KEYS: Record<Tab, string> = {
  "Scheduled": "appts.tabScheduled",
  "Waiting": "appts.tabWaiting",
  "Rescheduled": "appts.tabRescheduled",
  "All": "appts.tabAll",
};

const STATUS_OPTIONS: AppointmentStatus[] = ["Scheduled", "Waiting", "Rescheduled"];

type QuickChip = "today" | "tomorrow" | "this_week" | "overdue";

function statusClass(s: string) {
  return ({
    Scheduled: "s-Scheduled",
    Rescheduled: "s-Rescheduled",
    Reviewed: "s-Reviewed",
    Waiting: "s-Waiting",
    "Awaiting Review": "s-AwaitingReview",
  } as Record<string, string>)[s] ?? "";
}

function toISODate(d: Date) {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, "0"), day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Quick appointment-date presets — the 80% case for PA staff. */
function computeChipRange(chip: QuickChip): { from: string; to: string } {
  const now = new Date(); now.setHours(0, 0, 0, 0);
  if (chip === "today") {
    const s = toISODate(now);
    return { from: s, to: s };
  }
  if (chip === "tomorrow") {
    const t = new Date(now); t.setDate(t.getDate() + 1);
    const s = toISODate(t);
    return { from: s, to: s };
  }
  if (chip === "this_week") {
    // Mon–Sun
    const day = now.getDay(); // 0=Sun
    const monOffset = day === 0 ? -6 : 1 - day;
    const start = new Date(now); start.setDate(start.getDate() + monOffset);
    const end = new Date(start); end.setDate(end.getDate() + 6);
    return { from: toISODate(start), to: toISODate(end) };
  }
  // overdue → appt before today
  const yest = new Date(now); yest.setDate(yest.getDate() - 1);
  return { from: "", to: toISODate(yest) };
}

/** Locale-aware date/time formatting hook. */
function dateLocale(lang: string): string {
  return lang === "ta" ? "ta-IN" : undefined as unknown as string;
}

/** Maps an AppointmentStatus enum value to its translation key. */
const STATUS_LABEL_KEY: Record<string, string> = {
  Scheduled: "appts.statusScheduled",
  Waiting: "appts.statusWaiting",
  Rescheduled: "appts.statusRescheduled",
};

/** Status pill — read-only visual indicator, real actions live in the row kebab. */
function StatusPill({ status, t }: { status: string; t: (k: string) => string }) {
  const label = STATUS_LABEL_KEY[status] ? t(STATUS_LABEL_KEY[status]) : status;
  return (
    <span className={cn(
      "inline-flex items-center rounded-full px-2.5 py-1 text-[13px] font-semibold tracking-wide",
      statusClass(status),
    )}>
      {label}
    </span>
  );
}

/** Picks the AI-derived "what they're asking for" line, with EN/TA + fallbacks. */
function pickAskText(row: AppointmentRow, lang: string): string {
  const ta = lang === "ta";
  const ask = ta ? (row.citizen_ask_ta ?? row.citizen_ask) : row.citizen_ask;
  if (ask && ask.trim()) return ask.trim();
  const head = ta ? (row.headline_ta ?? row.headline) : row.headline;
  if (head && head.trim()) return head.trim();
  return (row.description ?? "").trim();
}

/** Memoized row — re-renders only when its own row payload changes. */
const AppointmentTableRow = memo(function AppointmentTableRow({
  row, onOpen, onStatusChange,
}: {
  row: AppointmentRow;
  onOpen: (row: AppointmentRow) => void;
  onStatusChange: (row: AppointmentRow, next: AppointmentStatus) => void;
}) {
  const { lang, t } = useLang();
  const askText = useMemo(() => pickAskText(row, lang), [row, lang]);

  const apptDateLabel = useMemo(() => {
    if (!row.scheduled_date) return null;
    return new Date(row.scheduled_date + "T00:00:00").toLocaleDateString(dateLocale(lang), {
      day: "numeric", month: "short", year: "numeric",
    });
  }, [row.scheduled_date, lang]);
  const apptTimeLabel = useMemo(() => {
    if (!row.appointment_time) return null;
    return new Date(row.appointment_time).toLocaleTimeString(dateLocale(lang), {
      hour: "2-digit", minute: "2-digit", hour12: true,
    });
  }, [row.appointment_time, lang]);

  return (
    <tr
      onClick={() => onOpen(row)}
      className="group cursor-pointer border-b border-border/60 transition-colors hover:bg-muted/50"
    >
      <td className="px-4 py-3">
        <div className="flex items-center gap-2.5">
          <InitialsAvatar name={row.name} />
          <div className="min-w-0">
            <div className="truncate font-medium text-foreground">{row.name || "—"}</div>
            <div className="font-mono text-[13px] font-semibold text-brand">{row.token}</div>
          </div>
        </div>
      </td>
      <td className="px-4 py-3 text-base text-muted-foreground">{row.category_label ?? row.category}</td>
      <td className="px-4 py-3 text-base text-foreground/80">
        {askText ? (
          <span
            className="line-clamp-2 leading-snug"
            title={askText}
          >
            {askText}
          </span>
        ) : <span className="text-muted-foreground/40">—</span>}
      </td>
      <td className="px-4 py-3"><PriorityBadge urgency={row.urgency} /></td>
      <td className="px-4 py-3">
        {apptDateLabel ? (
          <div>
            <div className="flex items-center gap-1.5 text-sm font-medium text-foreground">
              <CalendarDays className="h-3.5 w-3.5 text-muted-foreground" />
              {apptDateLabel}
            </div>
            {(row.slot_window || apptTimeLabel) && (
              <div className="mt-0.5 pl-5 text-[13px] text-muted-foreground">
                {row.slot_window}
                {apptTimeLabel && <> · {apptTimeLabel}</>}
              </div>
            )}
          </div>
        ) : <span className="text-muted-foreground/40">—</span>}
      </td>
      <td className="px-4 py-3 text-center text-base font-medium tabular-nums text-foreground">
        {row.num_persons ?? <span className="text-muted-foreground/40">—</span>}
      </td>
      <td className="px-4 py-3"><StatusPill status={row.status} t={t} /></td>
      <td className="pr-2" onClick={(e) => e.stopPropagation()}>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              aria-label={t("label.actions")}
              className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <MoreVertical className="h-4 w-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuLabel className="text-[13px] uppercase tracking-wider text-muted-foreground">
              {t("appts.changeStatus")}
            </DropdownMenuLabel>
            {STATUS_OPTIONS.filter((s) => s !== row.status).map((s) => (
              <DropdownMenuItem key={s} onSelect={() => onStatusChange(row, s)}>
                {s === "Scheduled" && <CalendarCheck className="h-3.5 w-3.5 text-brand" />}
                {s === "Waiting" && <Clock className="h-3.5 w-3.5 text-amber-500" />}
                {s === "Rescheduled" && <RotateCw className="h-3.5 w-3.5 text-blue-500" />}
                {t("appts.markAs")} {t(STATUS_LABEL_KEY[s] ?? s)}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => onOpen(row)}>
              <RowChevron className="h-3.5 w-3.5" /> {t("appts.openDetails")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </td>
    </tr>
  );
});

/** Mobile/tablet card — replaces the table below md. */
const AppointmentCard = memo(function AppointmentCard({
  row, onOpen, onStatusChange,
}: {
  row: AppointmentRow;
  onOpen: (row: AppointmentRow) => void;
  onStatusChange: (row: AppointmentRow, next: AppointmentStatus) => void;
}) {
  const { lang, t } = useLang();
  const askText = pickAskText(row, lang);

  const apptDateLabel = row.scheduled_date
    ? new Date(row.scheduled_date + "T00:00:00").toLocaleDateString(dateLocale(lang), {
        day: "numeric", month: "short", year: "numeric",
      })
    : null;
  const apptTimeLabel = row.appointment_time
    ? new Date(row.appointment_time).toLocaleTimeString(dateLocale(lang), {
        hour: "2-digit", minute: "2-digit", hour12: true,
      })
    : null;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen(row)}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(row); } }}
      className="w-full cursor-pointer rounded-xl border border-border bg-card p-3.5 text-left shadow-card transition-colors hover:bg-muted/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
    >
      <div className="flex items-start gap-2.5">
        <InitialsAvatar name={row.name} />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="truncate text-base font-semibold text-foreground">{row.name || "—"}</div>
              <div className="font-mono text-[13px] font-semibold text-brand">{row.token}</div>
            </div>
            <div onClick={(e) => e.stopPropagation()}>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    aria-label={t("label.actions")}
                    className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  >
                    <MoreVertical className="h-4 w-4" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  <DropdownMenuLabel className="text-[13px] uppercase tracking-wider text-muted-foreground">
                    {t("appts.changeStatus")}
                  </DropdownMenuLabel>
                  {STATUS_OPTIONS.filter((s) => s !== row.status).map((s) => (
                    <DropdownMenuItem key={s} onSelect={() => onStatusChange(row, s)}>
                      {t("appts.markAs")} {t(STATUS_LABEL_KEY[s] ?? s)}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <StatusPill status={row.status} t={t} />
            <PriorityBadge urgency={row.urgency} />
          </div>
          <div className="mt-2 text-sm text-muted-foreground">{row.category_label ?? row.category}</div>
          {askText && (
            <div className="mt-1.5 line-clamp-2 text-sm leading-snug text-foreground/80">{askText}</div>
          )}
          {apptDateLabel && (
            <div className="mt-2 flex items-center gap-1.5 text-sm font-medium text-foreground">
              <CalendarDays className="h-3.5 w-3.5 text-muted-foreground" />
              {apptDateLabel}
              {(row.slot_window || apptTimeLabel) && (
                <span className="text-muted-foreground">
                  · {row.slot_window}
                  {apptTimeLabel && <> · {apptTimeLabel}</>}
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
});

export default function AppointmentsPage() {
  return (
    <Suspense fallback={null}>
      <AppointmentsPageInner />
    </Suspense>
  );
}

function AppointmentsPageInner() {
  const { t } = useLang();
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialTab = (searchParams.get("tab") as Tab) || DEFAULT_TAB;
  const [tab, setTab] = useState<Tab>(TABS.includes(initialTab) ? initialTab : DEFAULT_TAB);
  const [search, setSearch] = useState("");
  // sort: "" | "urgency" | "appt_date_asc" | "appt_date_desc"
  const [sort, setSort] = useState<string>("");
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<AppointmentRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [openRow, setOpenRow] = useState<AppointmentRow | null>(null);

  const [urgency, setUrgency] = useState("");
  const [department, setDepartment] = useState("");
  const [category, setCategory] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [apptDateFrom, setApptDateFrom] = useState("");
  const [apptDateTo, setApptDateTo] = useState("");
  const [activeChip, setActiveChip] = useState<QuickChip | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [exporting, setExporting] = useState(false);

  const [rescheduleFor, setRescheduleFor] = useState<{ id: number; name: string } | null>(null);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  const advancedFilterCount =
    (urgency ? 1 : 0) + (department ? 1 : 0) + (category ? 1 : 0) +
    (dateFrom || dateTo ? 1 : 0) + (!activeChip && (apptDateFrom || apptDateTo) ? 1 : 0);

  const anyFilterActive = Boolean(
    search || urgency || department || category ||
    dateFrom || dateTo || apptDateFrom || apptDateTo || activeChip
  );

  const secondary = useMemo(() => ({
    kind: "meeting" as const,
    search: search || undefined,
    urgency: urgency || undefined, department: department || undefined, category: category || undefined,
    dateFrom: dateFrom || undefined, dateTo: dateTo || undefined,
    apptDateFrom: apptDateFrom || undefined, apptDateTo: apptDateTo || undefined,
    sort: sort || undefined,
  }), [search, urgency, department, category, dateFrom, dateTo, apptDateFrom, apptDateTo, sort]);

  const load = useCallback(async (signal: AbortSignal) => {
    setLoading(true);
    try {
      const data = await fetchAppointments({ status: tab, page, ...secondary }, signal);
      if (signal.aborted) return;
      setRows(data.items);
      setTotal(data.total);
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      toast.error(t("appts.loadFailed"), { description: (e as Error).message });
    } finally {
      if (!signal.aborted) setLoading(false);
    }
  }, [tab, page, secondary, t]);

  const loadCounts = useCallback(async (signal: AbortSignal) => {
    try {
      const data = await fetchAppointmentCounts(secondary, signal);
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

  // Preserve tab in the URL — earlier code wiped ?tab on every click, defeating deep links.
  const setActiveTab = useCallback((next: Tab) => {
    setTab(next); setPage(1);
    const p = new URLSearchParams(searchParams.toString());
    if (next === DEFAULT_TAB) p.delete("tab"); else p.set("tab", next);
    const qs = p.toString();
    router.replace(qs ? `/appointments?${qs}` : "/appointments");
  }, [router, searchParams]);

  function onSearchChange(v: string) {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => { setPage(1); setSearch(v); }, 350);
  }

  const commitStatus = useCallback(async (id: number, newStatus: AppointmentStatus) => {
    try {
      await updateAppointmentStatus(id, newStatus);
      setRows((prev) => prev.map((r) => (r.id === id ? { ...r, status: newStatus } : r)));
      toast.success(t("appts.statusUpdated"), { description: t("appts.statusUpdatedDesc") });
    } catch {
      toast.error(t("appts.updateFailed"), { description: t("appts.updateFailedDesc") });
    }
  }, [t]);

  const onStatusChange = useCallback(async (row: AppointmentRow, newStatus: AppointmentStatus) => {
    if (newStatus === "Rescheduled") {
      setRescheduleFor({ id: row.id, name: row.name });
      return;
    }
    await commitStatus(row.id, newStatus);
  }, [commitStatus]);

  const applyQuickChip = useCallback((chip: QuickChip) => {
    if (activeChip === chip) {
      // toggle off
      setActiveChip(null);
      setApptDateFrom(""); setApptDateTo("");
    } else {
      const { from, to } = computeChipRange(chip);
      setActiveChip(chip);
      setApptDateFrom(from); setApptDateTo(to);
    }
    setPage(1);
  }, [activeChip]);

  const clearAllFilters = useCallback(() => {
    setUrgency(""); setDepartment(""); setCategory("");
    setDateFrom(""); setDateTo(""); setApptDateFrom(""); setApptDateTo("");
    setActiveChip(null); setSearch(""); setPage(1);
  }, []);

  const toggleApptSort = useCallback(() => {
    setPage(1);
    setSort((s) => s === "appt_date_asc" ? "appt_date_desc" : s === "appt_date_desc" ? "" : "appt_date_asc");
  }, []);

  const toggleUrgencySort = useCallback(() => {
    setPage(1);
    setSort((s) => s === "urgency" ? "" : "urgency");
  }, []);

  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const offset = (page - 1) * PAGE_SIZE;

  function rowsToCsv(items: AppointmentRow[]) {
    const headers = ["Token", "Name", "Mobile", "Category", "Status", "Submitted", "Appt Date", "Slot", "Time"];
    const lines = items.map((r) => [
      r.token, r.name, r.mobile,
      r.category_label ?? r.category,
      r.status, r.created_at,
      r.scheduled_date ?? "",
      r.slot_window ?? "",
      r.appointment_time ? new Date(r.appointment_time).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: true }) : "",
    ]);
    return [headers, ...lines].map((row) => row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
  }

  async function doExport(allRows: boolean) {
    setExporting(true);
    try {
      const data = await fetchAppointments({ status: tab, page: 1, pageSize: allRows ? 5000 : PAGE_SIZE, ...secondary });
      const csv = rowsToCsv(data.items);
      const a = document.createElement("a");
      a.href = "data:text/csv;charset=utf-8," + encodeURIComponent(csv);
      a.download = `appointments_${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      toast.success(t("appts.exportReady"), { description: `${data.items.length} ${t("appts.exportReadyDesc")}` });
    } catch { toast.error(t("appts.exportFailed")); }
    finally { setExporting(false); setShowExportDialog(false); }
  }

  const pagedInfo = useMemo(() => {
    const lo = total === 0 ? 0 : Math.min(offset + 1, total);
    const hi = Math.min(offset + PAGE_SIZE, total);
    return `${lo}–${hi} ${t("appts.of")} ${total}`;
  }, [total, offset, t]);

  const th = "px-4 py-3 text-left text-[13px] font-semibold uppercase tracking-wider text-muted-foreground";

  const quickChips: { key: QuickChip; label: string; icon: React.ReactNode }[] = [
    { key: "today",     label: t("appts.chipToday"),    icon: <CalendarCheck className="h-3.5 w-3.5" /> },
    { key: "tomorrow",  label: t("appts.chipTomorrow"), icon: <CalendarDays className="h-3.5 w-3.5" /> },
    { key: "this_week", label: t("appts.chipThisWeek"), icon: <CalendarRange className="h-3.5 w-3.5" /> },
    { key: "overdue",   label: t("appts.chipOverdue"),  icon: <AlarmClockOff className="h-3.5 w-3.5" /> },
  ];

  return (
    <>
      <TopBar
        title={t("appts.title")}
        subtitle={t("appts.subtitle")}
        icon={<CalendarClock className="h-5 w-5" />}
      />
      <main className="flex-1 overflow-y-auto bg-background">
        <div className="space-y-4 px-4 py-6 animate-in-up">
          {/* Search (left, wider) · Export (right) */}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="relative w-full sm:max-w-xl sm:flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                defaultValue={search}
                onChange={(e) => onSearchChange(e.target.value)}
                placeholder={t("appts.searchPlaceholder")}
                className="h-10 pl-9 text-base"
              />
            </div>
            <Button variant="outline" onClick={() => setShowExportDialog(true)} className="sm:flex-shrink-0">
              <Download className="h-4 w-4 text-brand" /> {t("action.export")}
            </Button>
          </div>

          {/* Unified toolbar — tabs · quick chips · filters trigger */}
          <Card className="flex flex-col gap-3 p-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap items-center gap-1.5">
              {TABS.map((tabItem) => {
                const active = tabItem === tab;
                const count = counts[tabItem];
                return (
                  <button
                    key={tabItem}
                    onClick={() => setActiveTab(tabItem)}
                    className={cn(
                      "flex items-center gap-2 rounded-lg px-3 py-1.5 text-base font-medium transition-colors",
                      active ? "bg-brand text-brand-foreground shadow-card" : "text-muted-foreground hover:bg-muted hover:text-foreground"
                    )}
                  >
                    {t(TAB_KEYS[tabItem])}
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
                {t("appts.filters")}
                {advancedFilterCount > 0 && (
                  <span className="ml-0.5 grid h-4 min-w-[16px] place-items-center rounded-full bg-brand px-1 text-xs font-bold text-brand-foreground">
                    {advancedFilterCount}
                  </span>
                )}
              </button>
              {anyFilterActive && (
                <button
                  onClick={clearAllFilters}
                  className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm font-medium text-muted-foreground transition-colors hover:text-red-600"
                >
                  <X className="h-3.5 w-3.5" /> {t("appts.clearAll")}
                </button>
              )}
            </div>
          </Card>

          {/* Advanced filters — collapsible */}
          {showFilters && (
            <Card className="grid gap-3 p-3 sm:grid-cols-2 lg:grid-cols-3">
              <FilterSelect label={t("label.urgency")}    value={urgency}
                            onChange={(v) => { setPage(1); setUrgency(v); }}    options={urgencyOptions} />
              <FilterSelect label={t("label.department")} value={department}
                            onChange={(v) => { setPage(1); setDepartment(v); }} options={deptOptions} />
              <FilterSelect label={t("label.category")}   value={category}
                            onChange={(v) => { setPage(1); setCategory(v); }}   options={categoryOptions} />
              <DateRangePill
                label={t("appts.dateSubmitted")} from={dateFrom} to={dateTo}
                onFrom={(v) => { setPage(1); setDateFrom(v); }} onTo={(v) => { setPage(1); setDateTo(v); }}
                onClear={() => { setDateFrom(""); setDateTo(""); setPage(1); }}
              />
              <DateRangePill
                label={t("appts.dateAppt")} from={apptDateFrom} to={apptDateTo}
                onFrom={(v) => { setPage(1); setApptDateFrom(v); setActiveChip(null); }}
                onTo={(v) => { setPage(1); setApptDateTo(v); setActiveChip(null); }}
                onClear={() => { setApptDateFrom(""); setApptDateTo(""); setActiveChip(null); setPage(1); }}
              />
            </Card>
          )}

          {/* Desktop table */}
          <Card className="hidden overflow-hidden p-0 md:block">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1080px] text-base">
                <thead className="bg-muted/60">
                  <tr className="border-b border-border">
                    <th className={th}>{t("appts.colName")}</th>
                    <th className={cn(th, "w-36")}>{t("appts.colCategory")}</th>
                    <th className={cn(th, "min-w-[260px]")}>{t("appts.colAsk")}</th>
                    <th className={cn(th, "w-24")}>
                      <SortButton
                        active={sort === "urgency"}
                        direction="active"
                        label={t("appts.colUrgency")}
                        onClick={toggleUrgencySort}
                      />
                    </th>
                    <th className={cn(th, "w-44")}>
                      <SortButton
                        active={sort === "appt_date_asc" || sort === "appt_date_desc"}
                        direction={sort === "appt_date_asc" ? "asc" : sort === "appt_date_desc" ? "desc" : null}
                        label={t("appts.colAppointment")}
                        onClick={toggleApptSort}
                      />
                    </th>
                    <th className={cn(th, "w-20 text-center")}>{t("appts.colPeople")}</th>
                    <th className={cn(th, "w-[130px]")}>{t("appts.colStatus")}</th>
                    <th className="w-8" />
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    Array.from({ length: 3 }).map((_, i) => (
                      <tr key={i} className="border-b border-border/60">
                        <td className="px-4 py-3"><div className="flex items-center gap-2.5"><Skeleton className="h-8 w-8 rounded-full" /><div className="space-y-1.5"><Skeleton className="h-3.5 w-28" /><Skeleton className="h-3 w-20" /></div></div></td>
                        <td className="px-4 py-3"><Skeleton className="h-4 w-24" /></td>
                        <td className="px-4 py-3"><div className="space-y-1.5"><Skeleton className="h-3.5 w-full max-w-[240px]" /><Skeleton className="h-3.5 w-3/4 max-w-[180px]" /></div></td>
                        <td className="px-4 py-3"><Skeleton className="h-5 w-16 rounded-full" /></td>
                        <td className="px-4 py-3"><Skeleton className="h-4 w-28" /></td>
                        <td className="px-4 py-3"><Skeleton className="mx-auto h-4 w-6" /></td>
                        <td className="px-4 py-3"><Skeleton className="h-6 w-20 rounded-full" /></td>
                        <td />
                      </tr>
                    ))
                  ) : rows.length === 0 ? (
                    <tr><td colSpan={8} className="px-4 py-16 text-center">
                      <CalendarClock className="mx-auto mb-3 h-10 w-10 text-muted-foreground/30" />
                      <div className="text-base font-medium text-foreground">{t("appts.noAppts")}</div>
                      {anyFilterActive ? (
                        <>
                          <div className="text-sm text-muted-foreground">{t("appts.noResultsFiltered")}</div>
                          <button
                            onClick={clearAllFilters}
                            className="mt-3 inline-flex items-center gap-1 rounded-md border border-border bg-card px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-muted"
                          >
                            <X className="h-3.5 w-3.5" /> {t("appts.clearAllFilters")}
                          </button>
                        </>
                      ) : (
                        <div className="text-sm text-muted-foreground">{t("appts.noResultsBlank")}</div>
                      )}
                    </td></tr>
                  ) : rows.map((row) => (
                    <AppointmentTableRow
                      key={row.id}
                      row={row}
                      onOpen={setOpenRow}
                      onStatusChange={onStatusChange}
                    />
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            <div className="flex items-center justify-between border-t border-border px-4 py-3 text-base">
              <span className="text-muted-foreground">
                {total > 0 ? `${t("appts.showing")} ${pagedInfo}` : t("appts.noAppts")}
              </span>
              {total > PAGE_SIZE && (
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                    <ChevronLeft className="h-4 w-4" /> {t("appts.prev")}
                  </Button>
                  <span className="px-1 text-base font-medium text-muted-foreground tabular-nums">
                    {page} / {lastPage}
                  </span>
                  <Button variant="outline" size="sm" disabled={page >= lastPage} onClick={() => setPage(page + 1)}>
                    {t("appts.next")} <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              )}
            </div>
          </Card>

          {/* Mobile/tablet cards */}
          <div className="space-y-2.5 md:hidden">
            {loading ? (
              Array.from({ length: 3 }).map((_, i) => (
                <Card key={i} className="p-3.5"><Skeleton className="h-20 w-full" /></Card>
              ))
            ) : rows.length === 0 ? (
              <Card className="p-8 text-center">
                <CalendarClock className="mx-auto mb-3 h-10 w-10 text-muted-foreground/30" />
                <div className="text-base font-medium text-foreground">{t("appts.noAppts")}</div>
                {anyFilterActive && (
                  <button
                    onClick={clearAllFilters}
                    className="mt-3 inline-flex items-center gap-1 rounded-md border border-border bg-card px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-muted"
                  >
                    <X className="h-3.5 w-3.5" /> {t("appts.clearAllFilters")}
                  </button>
                )}
              </Card>
            ) : (
              <>
                {rows.map((row) => (
                  <AppointmentCard key={row.id} row={row} onOpen={setOpenRow} onStatusChange={onStatusChange} />
                ))}
                {total > PAGE_SIZE && (
                  <div className="flex items-center justify-between rounded-xl border border-border bg-card px-3 py-2 text-base">
                    <span className="text-muted-foreground">{pagedInfo}</span>
                    <div className="flex items-center gap-2">
                      <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                        <ChevronLeft className="h-4 w-4" />
                      </Button>
                      <span className="text-sm tabular-nums">{page} / {lastPage}</span>
                      <Button variant="outline" size="sm" disabled={page >= lastPage} onClick={() => setPage(page + 1)}>
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

      {/* Export dialog */}
      <Dialog open={showExportDialog} onOpenChange={setShowExportDialog}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("appts.exportTitle")}</DialogTitle>
            <DialogDescription>
              {total} {total === 1 ? t("appts.exportDescOne") : t("appts.exportDescMany")}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <button
              disabled={exporting}
              onClick={() => doExport(false)}
              className="rounded-lg border border-border px-4 py-2.5 text-left text-base font-medium transition-colors hover:bg-muted disabled:opacity-50"
            >
              {t("appts.exportCurrentPage")} <span className="text-muted-foreground">({Math.min(PAGE_SIZE, total)})</span>
            </button>
            <button
              disabled={exporting}
              onClick={() => doExport(true)}
              className="rounded-lg bg-brand px-4 py-2.5 text-left text-base font-semibold text-brand-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {exporting ? t("appts.exporting") : `${t("appts.exportAllRows")} (${total})`}
            </button>
          </div>
          <DialogFooter>
            <Button variant="outline" className="w-full" onClick={() => setShowExportDialog(false)}>{t("action.cancel")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AppointmentDetailDrawer
        row={openRow}
        onClose={() => setOpenRow(null)}
        onStatusChange={(row, next) => {
          setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, status: next } : r)));
          setOpenRow((curr) => (curr && curr.id === row.id ? { ...curr, status: next } : curr));
        }}
      />

      <RescheduleModal
        open={!!rescheduleFor}
        citizenName={rescheduleFor?.name ?? ""}
        onClose={() => setRescheduleFor(null)}
        onSubmit={async (datetime: string, sms: string) => {
          if (!rescheduleFor) return;
          const res = await fetch(`/api/v1/scheduling/admin/reschedule/${rescheduleFor.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ new_datetime: datetime, sms_text: sms }),
          });
          if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            toast.error(t("appts.rescheduleFail"), { description: err.error || t("appts.rescheduleFailDesc") });
            return;
          }
          setRows((prev) => prev.map((r) => (r.id === rescheduleFor.id ? { ...r, status: "Rescheduled" as const } : r)));
          setRescheduleFor(null);
          toast.success(t("appts.rescheduleOk"), { description: t("appts.rescheduleOkDesc") });
        }}
      />
    </>
  );
}

/* ── Local components ─────────────────────────────────────────────────── */

const ALL = "__all__";

/** Single-select pill used inside the collapsible filters card. */
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

function SortButton({
  active, direction, label, onClick,
}: {
  active: boolean;
  direction: "asc" | "desc" | "active" | null;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1 font-semibold uppercase tracking-wider transition-colors hover:text-foreground",
        active ? "text-brand" : "text-muted-foreground",
      )}
      title={active ? "Click to cycle sort" : `Sort by ${label.toLowerCase()}`}
    >
      {label}
      {direction === "asc" && <ArrowUpAZ className="h-[18px] w-[18px]" />}
      {direction === "desc" && <ArrowDownAZ className="h-[18px] w-[18px]" />}
      {direction === "active" && <ArrowDownNarrowWide className="h-[18px] w-[18px]" />}
      {!direction && <ArrowUpDown className="h-4 w-4 opacity-60" />}
    </button>
  );
}
