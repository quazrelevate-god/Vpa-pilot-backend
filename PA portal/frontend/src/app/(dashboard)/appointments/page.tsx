"use client";

import { memo, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Download, Search, ChevronLeft, ChevronRight, ChevronRight as RowChevron,
  CalendarClock, CalendarDays, CalendarRange, X, ArrowUpDown, ArrowDownNarrowWide,
  ArrowDownAZ, ArrowUpAZ, SlidersHorizontal, MoreVertical, Clock,
  CalendarCheck, RotateCw, Users, Eye,
} from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import { motion } from "framer-motion";

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
import { fetchAppointments, fetchAppointmentCounts, updateAppointmentStatus, type AppointmentListOpts } from "@/lib/api";
import type { AppointmentRow, AppointmentStatus } from "@/lib/types";
import { priorityOptions, deptOptions, CATEGORY_DISPLAY_TA, CATEGORY_DISPLAY_EN } from "@/lib/enums";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

// Appointments is meeting-centric. Direct petitions (Awaiting Review / Reviewed)
// live in Petition Review, so the tabs here are meeting states only.
const TABS = ["Scheduled", "Waiting", "Rescheduled", "All"] as const;
type Tab = (typeof TABS)[number];
const DEFAULT_TAB: Tab = "Scheduled";
const PAGE_SIZE_OPTIONS = [10, 25, 50];

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

const TAB_KEYS: Record<Tab, string> = {
  "Scheduled": "appts.tabScheduled",
  "Waiting": "appts.tabWaiting",
  "Rescheduled": "appts.tabRescheduled",
  "All": "appts.tabAll",
};

const STATUS_OPTIONS: AppointmentStatus[] = ["Scheduled", "Waiting", "Rescheduled"];

type QuickChip = "today" | "tomorrow" | "this_week";

function statusClass(s: string) {
  return ({
    Scheduled: "s-Scheduled",
    Rescheduled: "s-Rescheduled",
    Reviewed: "s-Reviewed",
    Waiting: "s-Waiting",
    "Awaiting Review": "s-AwaitingReview",
    "Courtesy Done": "s-CourtesyDone",
    "Not Came": "s-NotCame",
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
  // this_week — Mon–Sun spanning the current week.
  const day = now.getDay(); // 0=Sun
  const monOffset = day === 0 ? -6 : 1 - day;
  const start = new Date(now); start.setDate(start.getDate() + monOffset);
  const end = new Date(start); end.setDate(end.getDate() + 6);
  return { from: toISODate(start), to: toISODate(end) };
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
  // Terminal for invitation/greetings that were handed over in person.
  "Courtesy Done": "appts.statusCourtesyDone",
  "Not Came": "appts.statusNotCame",
};

/** Status pill — read-only visual indicator, real actions live in the row kebab. */
function StatusPill({ status, t }: { status: string; t: (k: string) => string }) {
  const label = STATUS_LABEL_KEY[status] ? t(STATUS_LABEL_KEY[status]) : status;
  return (
    <span className={cn(
      "inline-flex items-center rounded-lg px-2.5 py-1 text-[12px] font-semibold",
      statusClass(status),
    )}>
      {label}
    </span>
  );
}

/** Categories whose "ask" is a courtesy voice message, not a grievance. */
const COURTESY_CATEGORIES = new Set(["invitation", "greetings"]);

/**
 * Picks the "what they're asking for" line for the Appointments table.
 *
 * Rules:
 *  1. Courtesy (invitation/greetings) — show the STT transcript verbatim.
 *  2. Walk-in with no description and no image attachment — show "Walk-in".
 *  3. Everything else — AI ask → headline → citizen's own description.
 */
function pickAskText(row: AppointmentRow, lang: string): string {
  const ta = lang === "ta";
  const cat = (row.category || "").toLowerCase();
  const isWalkIn = row.source === "manual_staff";
  const hasImage = (row.attachments ?? []).some((a) => a.type === "IMAGE");
  const rawDesc = (row.description ?? "").trim();
  // Floor intake fills description with a placeholder like "Walk-in petition
  // registered by floor:display." when the staff didn't type anything —
  // treat that as "no citizen-provided description" for display purposes.
  const desc = isWalkIn && /^Walk-in (appointment|petition) registered by /i.test(rawDesc)
    ? ""
    : rawDesc;

  if (COURTESY_CATEGORIES.has(cat)) {
    const transcript = (row.transcript ?? "").trim();
    if (transcript) return transcript;
    // Courtesy still transcribing (or no audio uploaded from the floor PWA).
    return "Voice message";
  }

  if (isWalkIn && !desc && !hasImage) return "Walk-in";

  const ask = ta ? (row.citizen_ask_ta ?? row.citizen_ask) : row.citizen_ask;
  if (ask && ask.trim()) return ask.trim();
  const head = ta ? (row.headline_ta ?? row.headline) : row.headline;
  if (head && head.trim()) return head.trim();
  if (desc) return desc;
  return isWalkIn ? "Walk-in" : "";
}

/** Category label in the active language (falls back to the English label). */
function categoryText(row: AppointmentRow, lang: string): string {
  const key = (row.category || "").toLowerCase();
  if (lang === "ta") return CATEGORY_DISPLAY_TA[key] ?? row.category_label ?? row.category ?? "—";
  return row.category_label ?? CATEGORY_DISPLAY_EN[key] ?? row.category ?? "—";
}

/** Citizen name in the active language — PA-entered Tamil name when set. */
function nameText(row: Pick<AppointmentRow, "name" | "name_ta">, lang: string): string {
  if (lang === "ta" && row.name_ta && row.name_ta.trim()) return row.name_ta.trim();
  return row.name || "—";
}

/** Memoized row — re-renders only when its own row payload changes. */
const AppointmentTableRow = memo(function AppointmentTableRow({
  row, index, active, onOpen, onStatusChange,
}: {
  row: AppointmentRow;
  index: number;
  active: boolean;
  onOpen: (row: AppointmentRow) => void;
  onStatusChange: (row: AppointmentRow, next: AppointmentStatus) => void;
}) {
  const { lang, t } = useLang();

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

  // Slot duration chip, e.g. "30m" — derived from the slot window text.
  const durationLabel = useMemo(() => {
    const m = (row.slot_window ?? "").match(/(\d{1,2}):(\d{2})\s*[–—-]\s*(\d{1,2}):(\d{2})/);
    if (!m) return null;
    let mins = parseInt(m[3]) * 60 + parseInt(m[4]) - (parseInt(m[1]) * 60 + parseInt(m[2]));
    if (mins <= 0) mins += 12 * 60;
    if (mins <= 0 || mins > 12 * 60) return null;
    return mins >= 60 ? `${Math.floor(mins / 60)}h${mins % 60 ? ` ${mins % 60}m` : ""}` : `${mins}m`;
  }, [row.slot_window]);

  return (
    <motion.tr
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, ease: [0.25, 0.8, 0.35, 1], delay: Math.min(index * 0.015, 0.24) }}
      onClick={() => onOpen(row)}
      className={cn(
        "group cursor-pointer border-b border-border/60",
        "transition-[background-color,box-shadow] duration-150 [transition-timing-function:cubic-bezier(0.25,0.8,0.35,1)]",
        active
          ? "bg-brand/[0.05] shadow-[inset_3px_0_0_hsl(var(--accent-blue)),inset_0_0_0_1px_hsl(var(--accent-blue)/0.14)]"
          : "hover:bg-[#FBFAF8] hover:shadow-[inset_3px_0_0_hsl(var(--accent-blue)/0.45),0_1px_3px_rgba(23,23,28,0.05)]"
      )}
    >
      <td className="px-4 py-4">
        <div className="flex items-center gap-3">
          <InitialsAvatar name={row.name} className="h-9 w-9 rounded-lg text-xs" />
          <div className="min-w-0">
            <div className="type-table-row truncate text-foreground">{nameText(row, lang)}</div>
            <div className="font-mono text-[13px] font-semibold text-brand">{row.token}</div>
          </div>
        </div>
      </td>
      <td className="px-4 py-4 text-[15px] font-semibold text-foreground">{categoryText(row, lang)}</td>
      <td className="px-4 py-4">
        {apptDateLabel ? (
          <div>
            <div className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
              <CalendarDays className="h-3.5 w-3.5 text-muted-foreground" />
              {apptDateLabel}
            </div>
            {(row.slot_window || apptTimeLabel) && (
              <div className="mt-1 flex items-center gap-1.5 pl-5 text-[13px] text-muted-foreground">
                <span>
                  {row.slot_window}
                  {apptTimeLabel && <> · {apptTimeLabel}</>}
                </span>
                {durationLabel && (
                  <span className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-semibold text-muted-foreground">
                    {durationLabel}
                  </span>
                )}
              </div>
            )}
          </div>
        ) : <span className="text-muted-foreground/40">—</span>}
      </td>
      <td className="px-4 py-4">
        {row.num_persons != null ? (
          <div className="flex items-center justify-center gap-1.5 text-[15px] font-medium tabular-nums text-foreground">
            <Users className="h-4 w-4 text-muted-foreground" />
            {row.num_persons}
          </div>
        ) : <div className="text-center text-muted-foreground/40">—</div>}
      </td>
      <td className="px-4 py-4"><StatusPill status={row.status} t={t} /></td>
      <td className="pr-3" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-end gap-1">
          <button
            onClick={() => onOpen(row)}
            aria-label={t("appts.openDetails")}
            className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground/70 transition-colors hover:bg-accent hover:text-brand"
          >
            <Eye className="h-4 w-4" />
          </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              aria-label={t("label.actions")}
              className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground/60 transition-colors hover:bg-muted hover:text-foreground"
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
        </div>
      </td>
    </motion.tr>
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
              <div className="truncate text-base font-semibold text-foreground">{nameText(row, lang)}</div>
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
            <PriorityBadge priority={row.priority} />
          </div>
          <div className="mt-2 text-sm text-muted-foreground">{categoryText(row, lang)}</div>
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
  // sort: "" | "priority" | "appt_date_asc" | "appt_date_desc"
  const [sort, setSort] = useState<string>("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [rows, setRows] = useState<AppointmentRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [openRow, setOpenRow] = useState<AppointmentRow | null>(null);

  const [priority, setPriority] = useState("");
  const [department, setDepartment] = useState("");
  const [category, setCategory] = useState("");   // driven by the distribution chart
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [apptDateFrom, setApptDateFrom] = useState("");
  const [apptDateTo, setApptDateTo] = useState("");
  const [activeChip, setActiveChip] = useState<QuickChip | null>(null);
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [exporting, setExporting] = useState(false);

  const [rescheduleFor, setRescheduleFor] = useState<{ id: number; name: string } | null>(null);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);

  // Aurora Recall — ⌘K / Ctrl-K summons the search from anywhere on the page.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const advancedFilterCount =
    (priority ? 1 : 0) + (department ? 1 : 0) + (category ? 1 : 0) +
    (dateFrom || dateTo ? 1 : 0) + (!activeChip && (apptDateFrom || apptDateTo) ? 1 : 0);

  const anyFilterActive = Boolean(
    search || priority || department || category ||
    dateFrom || dateTo || apptDateFrom || apptDateTo || activeChip
  );

  // Full scope — table + counts (includes the chart-selected category).
  const secondary = useMemo(() => ({
    kind: "meeting" as const,
    search: search || undefined,
    priority: priority || undefined, department: department || undefined, category: category || undefined,
    dateFrom: dateFrom || undefined, dateTo: dateTo || undefined,
    apptDateFrom: apptDateFrom || undefined, apptDateTo: apptDateTo || undefined,
    sort: sort || undefined,
  }), [search, priority, department, category, dateFrom, dateTo, apptDateFrom, apptDateTo, sort]);

  // Chart scope — same filters WITHOUT category, so the distribution keeps
  // showing every category even while one is selected to filter the table.
  const chartScope = useMemo(() => ({
    kind: "meeting" as const,
    search: search || undefined,
    priority: priority || undefined, department: department || undefined,
    dateFrom: dateFrom || undefined, dateTo: dateTo || undefined,
    apptDateFrom: apptDateFrom || undefined, apptDateTo: apptDateTo || undefined,
  }), [search, priority, department, dateFrom, dateTo, apptDateFrom, apptDateTo]);

  const load = useCallback(async (signal: AbortSignal) => {
    setLoading(true);
    try {
      const data = await fetchAppointments({ status: tab, page, pageSize, ...secondary }, signal);
      if (signal.aborted) return;
      setRows(data.items);
      setTotal(data.total);
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      toast.error(t("appts.loadFailed"), { description: (e as Error).message });
    } finally {
      if (!signal.aborted) setLoading(false);
    }
  }, [tab, page, pageSize, secondary, t]);

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
    setPriority(""); setDepartment(""); setCategory("");
    setDateFrom(""); setDateTo(""); setApptDateFrom(""); setApptDateTo("");
    setActiveChip(null); setSearch(""); setPage(1);
  }, []);

  const toggleApptSort = useCallback(() => {
    setPage(1);
    setSort((s) => s === "appt_date_asc" ? "appt_date_desc" : s === "appt_date_desc" ? "" : "appt_date_asc");
  }, []);

  const lastPage = Math.max(1, Math.ceil(total / pageSize));
  const offset = (page - 1) * pageSize;

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
      const data = await fetchAppointments({ status: tab, page: 1, pageSize: allRows ? 5000 : pageSize, ...secondary });
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
    const hi = Math.min(offset + pageSize, total);
    return `${lo}–${hi} ${t("appts.of")} ${total}`;
  }, [total, offset, t]);

  const th = "px-4 py-3.5 text-left text-[11px] font-semibold uppercase tracking-[0.09em] text-muted-foreground/80";

  const quickChips: { key: QuickChip; label: string; icon: React.ReactNode }[] = [
    { key: "today",     label: t("appts.chipToday"),    icon: <CalendarCheck className="h-3.5 w-3.5" /> },
    { key: "tomorrow",  label: t("appts.chipTomorrow"), icon: <CalendarDays className="h-3.5 w-3.5" /> },
    { key: "this_week", label: t("appts.chipThisWeek"), icon: <CalendarRange className="h-3.5 w-3.5" /> },
  ];

  return (
    <>
      <TopBar
        title={t("appts.title")}
        subtitle={t("appts.subtitle")}
        icon={<CalendarClock className="h-5 w-5" />}
        searchSlot={
          <div className="relative w-full">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={searchRef}
              defaultValue={search}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder={t("appts.searchPlaceholder")}
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
          {/* Unified toolbar — tabs · quick chips · filters trigger · export */}
          <Card className="flex shrink-0 flex-col gap-3 p-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap items-center gap-1.5">
              {TABS.map((tabItem) => {
                const active = tabItem === tab;
                const count = counts[tabItem];
                return (
                  <button
                    key={tabItem}
                    onClick={() => setActiveTab(tabItem)}
                    className={cn(
                      "relative flex items-center gap-2 rounded-[10px] px-3.5 py-2 text-[15px] font-semibold transition-colors duration-150",
                      active ? "text-brand" : "text-muted-foreground hover:bg-muted hover:text-foreground"
                    )}
                  >
                    {active && (
                      <motion.span
                        layoutId="appts-tab-pill"
                        className="aurora-tab-active absolute inset-0 rounded-[10px]"
                        transition={{ type: "spring", stiffness: 420, damping: 38 }}
                      />
                    )}
                    <span className="relative z-[1]">{t(TAB_KEYS[tabItem])}</span>
                    <span className={cn(
                      "relative z-[1] min-w-[22px] rounded-md px-1.5 py-0.5 text-center text-[12px] font-bold tabular-nums",
                      active ? "bg-white text-brand shadow-card" : "bg-muted text-muted-foreground"
                    )}>
                      {count ?? "·"}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {/* Quick date presets — separate bordered pills (per reference) */}
              {quickChips.map((c) => {
                const active = activeChip === c.key;
                return (
                  <button
                    key={c.key}
                    onClick={() => applyQuickChip(c.key)}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-sm font-medium transition-colors",
                      active
                        ? "border-[#E4DCFC] bg-accent text-brand"
                        : "border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground"
                    )}
                  >
                    {c.icon}{c.label}
                  </button>
                );
              })}
              {anyFilterActive && (
                <button
                  onClick={clearAllFilters}
                  className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm font-medium text-muted-foreground transition-colors hover:text-destructive"
                >
                  <X className="h-3.5 w-3.5" /> {t("appts.clearAll")}
                </button>
              )}
              <Button variant="outline" onClick={() => setShowExportDialog(true)} className="h-[38px] rounded-xl">
                <Download className="h-4 w-4 text-brand" /> {t("action.export")}
              </Button>
            </div>
          </Card>

          {/* Two-column workspace: table (left) · filters + insights rail (right) */}
          <div className="grid gap-4 xl:min-h-0 xl:flex-1 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="flex min-w-0 flex-col gap-4 xl:min-h-0">
          {/* Desktop table — fills to the bottom of the page; body scrolls */}
          <Card className="hidden overflow-hidden p-0 shadow-card-md md:block xl:flex xl:min-h-0 xl:flex-1 xl:flex-col">
            {/* In-card header — title */}
            <div className="flex shrink-0 items-center gap-3 border-b border-border px-5 py-4">
              <h2 className="type-card-heading text-foreground">{t("appts.tableTitle")}</h2>
            </div>
            <div className="overflow-x-auto xl:min-h-0 xl:flex-1 xl:overflow-y-auto">
              <table className="w-full min-w-[720px] text-base">
                <thead className="sticky top-0 z-10 bg-card">
                  <tr className="border-b border-border">
                    <th className={th}>{t("appts.colName")}</th>
                    <th className={cn(th, "w-40")}>{t("appts.colCategory")}</th>
                    <th className={cn(th, "w-48")}>
                      <SortButton
                        active={sort === "appt_date_asc" || sort === "appt_date_desc"}
                        direction={sort === "appt_date_asc" ? "asc" : sort === "appt_date_desc" ? "desc" : null}
                        label={t("appts.colSchedule")}
                        onClick={toggleApptSort}
                      />
                    </th>
                    <th className={cn(th, "w-24 text-center")}>{t("appts.colPeople")}</th>
                    <th className={cn(th, "w-[130px]")}>{t("appts.colStatus")}</th>
                    <th className={cn(th, "w-24 text-right")}>{t("appts.colActions")}</th>
                  </tr>
                </thead>
                <tbody key={`${tab}-${page}`}>
                  {loading ? (
                    Array.from({ length: 3 }).map((_, i) => (
                      <tr key={i} className="border-b border-border/60">
                        <td className="px-4 py-3"><div className="flex items-center gap-2.5"><Skeleton className="h-9 w-9 rounded-lg" /><div className="space-y-1.5"><Skeleton className="h-3.5 w-28" /><Skeleton className="h-3 w-20" /></div></div></td>
                        <td className="px-4 py-3"><Skeleton className="h-4 w-24" /></td>
                        <td className="px-4 py-3"><div className="space-y-1.5"><Skeleton className="h-3.5 w-28" /><Skeleton className="h-3 w-20" /></div></td>
                        <td className="px-4 py-3"><Skeleton className="mx-auto h-4 w-6" /></td>
                        <td className="px-4 py-3"><Skeleton className="h-6 w-20 rounded-lg" /></td>
                        <td className="px-4 py-3"><Skeleton className="ml-auto h-6 w-14 rounded-lg" /></td>
                      </tr>
                    ))
                  ) : rows.length === 0 ? (
                    <tr><td colSpan={6} className="px-4 py-16 text-center">
                      <CalendarClock className="mx-auto mb-3 h-10 w-10 text-muted-foreground/30" />
                      <div className="text-base font-semibold text-foreground">{t("appts.noAppts")}</div>
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
                  ) : rows.map((row, i) => (
                    <AppointmentTableRow
                      key={row.id}
                      row={row}
                      index={i}
                      active={openRow?.id === row.id}
                      onOpen={setOpenRow}
                      onStatusChange={onStatusChange}
                    />
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination — numbered pages + rows-per-page (per reference) */}
            <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3 text-sm">
              <span className="text-muted-foreground">
                {total > 0 ? `${t("appts.showing")} ${pagedInfo}` : t("appts.noAppts")}
              </span>
              {lastPage > 1 && (
                <div className="flex items-center gap-1">
                  <button
                    disabled={page <= 1}
                    onClick={() => setPage(page - 1)}
                    aria-label={t("appts.prev")}
                    className="grid h-9 w-9 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  {pageList(page, lastPage).map((p, i) =>
                    p === "…" ? (
                      <span key={`e${i}`} className="px-1.5 text-muted-foreground">…</span>
                    ) : (
                      <button
                        key={p}
                        onClick={() => setPage(p)}
                        className={cn(
                          "grid h-9 min-w-9 place-items-center rounded-lg px-1 text-sm font-semibold tabular-nums transition-colors",
                          p === page
                            ? "aurora-primary"
                            : "text-muted-foreground hover:bg-muted hover:text-foreground"
                        )}
                      >
                        {p}
                      </button>
                    )
                  )}
                  <button
                    disabled={page >= lastPage}
                    onClick={() => setPage(page + 1)}
                    aria-label={t("appts.next")}
                    className="grid h-9 w-9 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              )}
              <div className="flex items-center gap-2 text-muted-foreground">
                {t("appts.rowsPerPage")}
                <Select value={String(pageSize)} onValueChange={(v) => { setPage(1); setPageSize(Number(v)); }}>
                  <SelectTrigger className="h-9 w-[76px] rounded-lg text-sm font-semibold text-foreground">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PAGE_SIZE_OPTIONS.map((n) => (
                      <SelectItem key={n} value={String(n)}>{n}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
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
                <div className="text-base font-semibold text-foreground">{t("appts.noAppts")}</div>
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
                {total > pageSize && (
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
          </div>{/* left column */}

          {/* Right rail — Filters + Category Distribution */}
          <aside className="flex flex-col gap-4 xl:min-h-0">
            {/* Filters — persistent panel, drives the table */}
            <Card className="flex flex-col p-5 shadow-card-md xl:min-h-0 xl:flex-1">
              <div className="mb-4 flex shrink-0 items-center justify-between">
                <h3 className="type-card-heading flex items-center gap-2 text-foreground">
                  <SlidersHorizontal className="h-4 w-4 text-brand" />
                  {t("appts.filters")}
                  {advancedFilterCount > 0 && (
                    <span className="grid h-5 min-w-[20px] place-items-center rounded-full bg-brand px-1 text-[11px] font-bold text-brand-foreground">
                      {advancedFilterCount}
                    </span>
                  )}
                </h3>
                {anyFilterActive && (
                  <button
                    onClick={clearAllFilters}
                    className="inline-flex items-center gap-1 text-[13px] font-semibold text-muted-foreground transition-colors hover:text-destructive"
                  >
                    <X className="h-3.5 w-3.5" /> {t("appts.clearAll")}
                  </button>
                )}
              </div>
              <div className="-mr-2 flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pr-2">
                <FilterSelect label={t("label.priority")} value={priority}
                              onChange={(v) => { setPage(1); setPriority(v); }} options={priorityOptions} />
                <FilterSelect label={t("label.ministry")} value={department}
                              onChange={(v) => { setPage(1); setDepartment(v); }} options={deptOptions} />
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
              </div>
            </Card>
            <CategoryDistributionCard
              tab={tab}
              secondary={chartScope}
              activeCategory={category}
              onSelect={(key) => { setPage(1); setCategory((c) => (c === key ? "" : key)); }}
              className="xl:min-h-0 xl:flex-1"
            />
          </aside>
          </div>{/* two-column grid */}
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
              {t("appts.exportCurrentPage")} <span className="text-muted-foreground">({Math.min(pageSize, total)})</span>
            </button>
            <button
              disabled={exporting}
              onClick={() => doExport(true)}
              className="aurora-primary rounded-lg px-4 py-2.5 text-left text-base font-semibold disabled:opacity-50"
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
        appointmentId={rescheduleFor?.id ?? null}
        onClose={() => setRescheduleFor(null)}
        onRebooked={() => {
          // Backend flipped the row back to SCHEDULED with the new date. The
          // parent list overlay follows suit so the row doesn't hang on the
          // Rescheduled tab until the next fetch.
          if (rescheduleFor) {
            setRows((prev) => prev.map((r) => (r.id === rescheduleFor.id ? { ...r, status: "Scheduled" as const } : r)));
          }
          setRescheduleFor(null);
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
    <div className="flex flex-col gap-1.5">
      <label className="text-[11px] font-semibold uppercase tracking-[0.09em] text-muted-foreground">{label}</label>
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
    </div>
  );
}

function DateRangePill({
  label, from, to, onFrom, onTo,
}: {
  label: string;
  from: string; to: string;
  onFrom: (v: string) => void; onTo: (v: string) => void; onClear?: () => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-[11px] font-semibold uppercase tracking-[0.09em] text-muted-foreground">{label}</label>
      <div className="flex h-11 w-full items-center gap-1.5 rounded-xl border border-border bg-card px-3">
        <Input type="date" value={from} onChange={(e) => onFrom(e.target.value)}
          className="h-7 min-w-0 flex-1 border-0 p-0 text-sm shadow-none focus-visible:ring-0" aria-label={`${label} from`} />
        <span className="shrink-0 px-0.5 text-sm text-muted-foreground">→</span>
        <Input type="date" value={to} onChange={(e) => onTo(e.target.value)}
          className="h-7 min-w-0 flex-1 border-0 p-0 text-sm shadow-none focus-visible:ring-0" aria-label={`${label} to`} />
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

/* ── Right rail ───────────────────────────────────────────────────────── */

// Bar palette — cycled across the category list.
const DONUT_PALETTE = ["#7C5CF6", "#4C82F2", "#EE9A3C", "#34A26C", "#E5484D", "#35839B"];

/** Category Distribution — donut over the CURRENT tab's meeting appointments
 *  only (not tickets/petitions). Rescopes when the tab or filters change. */
function CategoryDistributionCard({
  tab, secondary, className, activeCategory, onSelect,
}: {
  tab: Tab; secondary: AppointmentListOpts; className?: string;
  activeCategory?: string; onSelect?: (key: string) => void;
}) {
  const { lang, t } = useLang();
  const [cats, setCats] = useState<{ key: string; count: number }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const ctrl = new AbortController();
    setLoading(true);
    // Pull every appointment in the current scope (tab + active filters) and
    // aggregate by category KEY client-side — keeps the donut appointment-scoped,
    // in lockstep with the visible tab, and language-agnostic (labels render live).
    fetchAppointments({ status: tab, page: 1, pageSize: 2000, ...secondary }, ctrl.signal)
      .then((d) => {
        const m = new Map<string, number>();
        for (const r of d.items) {
          const key = (r.category || "—").toLowerCase();
          m.set(key, (m.get(key) ?? 0) + 1);
        }
        setCats(Array.from(m, ([key, count]) => ({ key, count })));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, [tab, secondary]);

  const catLabel = (key: string) =>
    (lang === "ta" ? CATEGORY_DISPLAY_TA[key] : CATEGORY_DISPLAY_EN[key]) ?? key;

  const total = cats.reduce((a, c) => a + c.count, 0);
  // ALL categories, largest first — one horizontal bar each.
  const bars = [...cats]
    .sort((a, b) => b.count - a.count)
    .map((c, i) => ({ key: c.key, label: catLabel(c.key), count: c.count, color: DONUT_PALETTE[i % DONUT_PALETTE.length] }));
  const max = Math.max(1, ...bars.map((b) => b.count));

  return (
    <Card className={cn("flex flex-col p-5 shadow-card-md", className)}>
      <div className="mb-4 flex shrink-0 items-center justify-between">
        <h3 className="type-card-heading text-foreground">{t("appts.categoryDistribution")}</h3>
        <Link href="/overview" className="text-[13px] font-semibold text-brand hover:underline">
          {t("appts.viewAll")}
        </Link>
      </div>
      {loading ? (
        <div className="grid flex-1 place-items-center"><Skeleton className="h-40 w-full rounded-lg" /></div>
      ) : total === 0 ? (
        <div className="grid flex-1 place-items-center text-center text-sm text-muted-foreground">{t("appts.noData")}</div>
      ) : (
        <div className="-mr-2 flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-2">
          <div className="shrink-0 text-[13px] text-muted-foreground">
            {t("appts.total")}: <span className="font-semibold tabular-nums text-foreground">{total}</span>
          </div>
          {/* Horizontal bar list — click a bar to filter the table by category */}
          <ul className="space-y-1.5">
            {bars.map((b) => {
              const share = total ? Math.round((b.count / total) * 100) : 0;
              const isActive = activeCategory === b.key;
              const dimmed = Boolean(activeCategory) && !isActive;
              return (
                <li key={b.key}>
                  <button
                    onClick={() => onSelect?.(b.key)}
                    aria-pressed={isActive}
                    title={isActive ? `${b.label} — click to clear filter` : `Filter by ${b.label}`}
                    className={cn(
                      "w-full rounded-lg px-2 py-1.5 text-left transition-all",
                      isActive ? "bg-accent ring-1 ring-[#D6C9F5]" : "hover:bg-muted/60",
                      dimmed && "opacity-45 hover:opacity-100",
                    )}
                  >
                    <div className="mb-1 flex items-center gap-2 text-[13px]">
                      <span className="shrink-0 font-semibold tabular-nums text-foreground">{b.count}</span>
                      <span className={cn("min-w-0 flex-1 truncate", isActive ? "font-semibold text-brand" : "text-foreground")}>{b.label}</span>
                      <span className="shrink-0 tabular-nums text-muted-foreground">{share}%</span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full transition-all" style={{ width: `${(b.count / max) * 100}%`, backgroundColor: b.color }} />
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </Card>
  );
}
