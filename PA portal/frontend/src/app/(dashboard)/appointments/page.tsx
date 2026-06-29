"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Download, Search, ChevronLeft, ChevronRight, ChevronRight as RowChevron,
  CalendarClock, CalendarDays, CalendarRange, X, Users, ArrowUpDown, ArrowDownNarrowWide,
} from "lucide-react";
import { toast } from "sonner";

import TopBar from "@/components/TopBar";
import PriorityBadge from "@/components/PriorityBadge";
import { useLang } from "@/lib/lang-context";
import RescheduleModal from "@/components/RescheduleModal";
import AppointmentDetailDrawer from "@/components/AppointmentDetailDrawer";
import FilterStrip from "@/components/FilterStrip";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { InitialsAvatar } from "@/components/ui/avatar";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { cn, formatDateTime } from "@/lib/utils";
import { fetchAppointments, updateAppointmentStatus } from "@/lib/api";
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

const STATUS_OPTIONS: AppointmentStatus[] = [
  "Scheduled", "Waiting", "Rescheduled",
];

function statusClass(s: string) {
  return ({
    Scheduled: "s-Scheduled",
    Rescheduled: "s-Rescheduled",
    Reviewed: "s-Reviewed",
    Waiting: "s-Waiting",
    "Awaiting Review": "s-AwaitingReview",
  } as Record<string, string>)[s] ?? "";
}

/** Compact inline date-range control — replaces the old full-width boxes. */
function DateRangePill({
  label, from, to, onFrom, onTo, onClear,
}: {
  label: string;
  from: string; to: string;
  onFrom: (v: string) => void; onTo: (v: string) => void; onClear: () => void;
}) {
  const active = from || to;
  return (
    <div className="flex items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-1.5 shadow-card">
      <span className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
        <CalendarRange className="h-3.5 w-3.5" /> {label}
      </span>
      <Input type="date" value={from} onChange={(e) => onFrom(e.target.value)}
        className="h-7 w-[125px] border-0 px-1 text-xs shadow-none focus-visible:ring-0" aria-label={`${label} from`} />
      <span className="text-xs text-muted-foreground">→</span>
      <Input type="date" value={to} onChange={(e) => onTo(e.target.value)}
        className="h-7 w-[125px] border-0 px-1 text-xs shadow-none focus-visible:ring-0" aria-label={`${label} to`} />
      {active && (
        <button onClick={onClear}
          className="grid h-5 w-5 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label={`Clear ${label}`}>
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

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
  const [sortByUrgency, setSortByUrgency] = useState(false);
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
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [exporting, setExporting] = useState(false);

  const [rescheduleFor, setRescheduleFor] = useState<{ id: number; name: string } | null>(null);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  const secondary = useMemo(() => ({
    kind: "meeting" as const,
    search: search || undefined,
    urgency: urgency || undefined, department: department || undefined, category: category || undefined,
    dateFrom: dateFrom || undefined, dateTo: dateTo || undefined,
    apptDateFrom: apptDateFrom || undefined, apptDateTo: apptDateTo || undefined,
    sort: sortByUrgency ? "urgency" : undefined,
  }), [search, urgency, department, category, dateFrom, dateTo, apptDateFrom, apptDateTo, sortByUrgency]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchAppointments({ status: tab, page, ...secondary });
      setRows(data.items);
      setTotal(data.total);
    } catch (e) {
      toast.error(`Load failed: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, [tab, page, secondary]);

  // Live per-tab counts, honouring the active secondary filters.
  const loadCounts = useCallback(async () => {
    try {
      const results = await Promise.all(
        TABS.map((tb) =>
          fetchAppointments({ status: tb, page: 1, pageSize: 1, ...secondary })
            .then((r) => [tb, r.total] as const)
            .catch(() => [tb, 0] as const)
        )
      );
      setCounts(Object.fromEntries(results));
    } catch { /* ignore */ }
  }, [secondary]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadCounts(); }, [loadCounts]);

  function onSearchChange(v: string) {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => { setPage(1); setSearch(v); }, 350);
  }

  async function onStatusChange(row: AppointmentRow, newStatus: AppointmentStatus) {
    if (newStatus === "Rescheduled") {
      setRescheduleFor({ id: row.id, name: row.name });
      return;
    }
    await commitStatus(row.id, newStatus);
  }

  async function commitStatus(id: number, newStatus: AppointmentStatus) {
    try {
      await updateAppointmentStatus(id, newStatus);
      setRows((prev) => prev.map((r) => (r.id === id ? { ...r, status: newStatus } : r)));
      toast.success("Status updated", { description: `Changed to "${newStatus}" successfully.` });
    } catch {
      toast.error("Update failed", { description: "Could not update status. Please try again." });
    }
  }

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
      toast.success("Export ready", { description: `${data.items.length} rows downloaded.` });
    } catch { toast.error("Export failed."); }
    finally { setExporting(false); setShowExportDialog(false); }
  }

  const pagedInfo = useMemo(() => {
    const lo = total === 0 ? 0 : Math.min(offset + 1, total);
    const hi = Math.min(offset + PAGE_SIZE, total);
    return `${lo}–${hi} of ${total}`;
  }, [total, offset]);

  const th = "px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground";

  return (
    <>
      <TopBar />
      <main className="flex-1 overflow-y-auto bg-background">
        <div className="space-y-4 px-4 py-6 animate-in-up">
          {/* Header */}
          <div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-center">
            <div>
              <h1 className="flex items-center gap-2 text-2xl font-extrabold tracking-tight text-foreground">
                <span className="grid h-9 w-9 place-items-center rounded-xl bg-brand/10 text-brand">
                  <CalendarClock className="h-5 w-5" />
                </span>
                {t("appts.title")}
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">{t("appts.subtitle")}</p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <div className="relative w-full sm:w-72">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  defaultValue={search}
                  onChange={(e) => onSearchChange(e.target.value)}
                  placeholder="Search name, token, mobile…"
                  className="pl-9"
                />
              </div>
              <Button variant="outline" onClick={() => setShowExportDialog(true)}>
                <Download className="h-4 w-4 text-brand" /> {t("action.export")}
              </Button>
            </div>
          </div>

          {/* Status segments with live counts */}
          <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-border bg-card p-1.5 shadow-card">
            {TABS.map((tabItem) => {
              const active = tabItem === tab;
              const count = counts[tabItem];
              return (
                <button
                  key={tabItem}
                  onClick={() => { setTab(tabItem); setPage(1); router.replace("/appointments"); }}
                  className={cn(
                    "flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors",
                    active ? "bg-brand text-brand-foreground shadow-card" : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                >
                  {t(TAB_KEYS[tabItem])}
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
            onClearAll={() => {
              setUrgency(""); setDepartment(""); setCategory("");
              setDateFrom(""); setDateTo(""); setApptDateFrom(""); setApptDateTo(""); setPage(1);
            }}
            groups={[
              { key: "urgency",    label: t("label.urgency"),    value: urgency,    onChange: (v) => { setPage(1); setUrgency(v); },    options: urgencyOptions },
              { key: "department", label: t("label.department"), value: department, onChange: (v) => { setPage(1); setDepartment(v); }, options: deptOptions },
              { key: "category",   label: t("label.category"),   value: category,   onChange: (v) => { setPage(1); setCategory(v); },   options: categoryOptions },
            ]}
          />

          {/* Date ranges — compact pills */}
          <div className="flex flex-wrap items-center gap-2">
            <DateRangePill
              label="Submitted" from={dateFrom} to={dateTo}
              onFrom={(v) => { setPage(1); setDateFrom(v); }} onTo={(v) => { setPage(1); setDateTo(v); }}
              onClear={() => { setDateFrom(""); setDateTo(""); setPage(1); }}
            />
            <DateRangePill
              label="Appt. date" from={apptDateFrom} to={apptDateTo}
              onFrom={(v) => { setPage(1); setApptDateFrom(v); }} onTo={(v) => { setPage(1); setApptDateTo(v); }}
              onClear={() => { setApptDateFrom(""); setApptDateTo(""); setPage(1); }}
            />
          </div>

          {/* Table */}
          <Card className="overflow-hidden p-0">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[920px] text-sm">
                <thead className="bg-muted/60">
                  <tr className="border-b border-border">
                    <th className={th}>{t("appts.colName")}</th>
                    <th className={cn(th, "w-40")}>{t("appts.colCategory")}</th>
                    <th className={cn(th, "w-24")}>
                      <button
                        onClick={() => { setPage(1); setSortByUrgency((s) => !s); }}
                        className={cn(
                          "inline-flex items-center gap-1 font-semibold uppercase tracking-wider transition-colors hover:text-foreground",
                          sortByUrgency ? "text-brand" : "text-muted-foreground"
                        )}
                        title={sortByUrgency ? "Sorted by urgency (Critical first) — click to reset" : "Sort by urgency"}
                      >
                        {t("appts.colUrgency")}
                        {sortByUrgency
                          ? <ArrowDownNarrowWide className="h-3.5 w-3.5" />
                          : <ArrowUpDown className="h-3 w-3 opacity-60" />}
                      </button>
                    </th>
                    <th className={cn(th, "w-32")}>{t("label.date")}</th>
                    <th className={cn(th, "w-44")}>{t("appts.colAppointment")}</th>
                    <th className={cn(th, "w-20 text-center")}><Users className="mx-auto h-3.5 w-3.5" /></th>
                    <th className={cn(th, "w-[150px]")}>{t("appts.colStatus")}</th>
                    <th className="w-8" />
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    Array.from({ length: 8 }).map((_, i) => (
                      <tr key={i} className="border-b border-border/60">
                        <td className="px-4 py-3"><div className="flex items-center gap-2.5"><Skeleton className="h-8 w-8 rounded-full" /><div className="space-y-1.5"><Skeleton className="h-3.5 w-28" /><Skeleton className="h-3 w-20" /></div></div></td>
                        <td className="px-4 py-3"><Skeleton className="h-4 w-24" /></td>
                        <td className="px-4 py-3"><Skeleton className="h-5 w-16 rounded-full" /></td>
                        <td className="px-4 py-3"><Skeleton className="h-4 w-20" /></td>
                        <td className="px-4 py-3"><Skeleton className="h-4 w-28" /></td>
                        <td className="px-4 py-3"><Skeleton className="mx-auto h-4 w-6" /></td>
                        <td className="px-4 py-3"><Skeleton className="h-8 w-[130px] rounded-md" /></td>
                        <td />
                      </tr>
                    ))
                  ) : rows.length === 0 ? (
                    <tr><td colSpan={8} className="px-4 py-16 text-center">
                      <CalendarClock className="mx-auto mb-3 h-10 w-10 text-muted-foreground/30" />
                      <div className="text-sm font-medium text-foreground">{t("appts.noAppts")}</div>
                      <div className="text-xs text-muted-foreground">Try clearing filters or switching tabs.</div>
                    </td></tr>
                  ) : rows.map((row) => (
                    <tr
                      key={row.id}
                      onClick={() => setOpenRow(row)}
                      className="group cursor-pointer border-b border-border/60 transition-colors hover:bg-muted/50"
                    >
                      {/* Citizen */}
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2.5">
                          <InitialsAvatar name={row.name} />
                          <div className="min-w-0">
                            <div className="truncate font-medium text-foreground">{row.name || "—"}</div>
                            <div className="font-mono text-[11px] font-semibold text-brand">{row.token}</div>
                          </div>
                        </div>
                      </td>
                      {/* Category */}
                      <td className="px-4 py-3 text-sm text-muted-foreground">{row.category_label ?? row.category}</td>
                      {/* Urgency */}
                      <td className="px-4 py-3"><PriorityBadge urgency={row.urgency} /></td>
                      {/* Submitted */}
                      <td className="px-4 py-3 text-xs text-muted-foreground">{formatDateTime(row.created_at)}</td>
                      {/* Appointment — date + slot/time */}
                      <td className="px-4 py-3">
                        {row.scheduled_date ? (
                          <div>
                            <div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                              <CalendarDays className="h-3.5 w-3.5 text-muted-foreground" />
                              {new Date(row.scheduled_date + "T00:00:00").toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}
                            </div>
                            {(row.slot_window || row.appointment_time) && (
                              <div className="mt-0.5 pl-5 text-[11px] text-muted-foreground">
                                {row.slot_window}
                                {row.appointment_time && (
                                  <> · {new Date(row.appointment_time).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: true })}</>
                                )}
                              </div>
                            )}
                          </div>
                        ) : <span className="text-muted-foreground/40">—</span>}
                      </td>
                      {/* Persons */}
                      <td className="px-4 py-3 text-center text-sm font-medium tabular-nums text-foreground">
                        {row.num_persons ?? <span className="text-muted-foreground/40">—</span>}
                      </td>
                      {/* Status */}
                      <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                        <Select value={row.status} onValueChange={(v) => onStatusChange(row, v as AppointmentStatus)}>
                          <SelectTrigger className={cn("h-8 w-[140px] text-xs font-semibold", statusClass(row.status))}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {STATUS_OPTIONS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </td>
                      <td className="pr-3">
                        <RowChevron className="h-4 w-4 text-muted-foreground/0 transition-colors group-hover:text-muted-foreground" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            <div className="flex items-center justify-between border-t border-border px-4 py-3 text-sm">
              <span className="text-muted-foreground">
                {total > 0 ? `Showing ${pagedInfo}` : t("appts.noAppts")}
              </span>
              {total > PAGE_SIZE && (
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                    <ChevronLeft className="h-4 w-4" /> Prev
                  </Button>
                  <span className="px-1 text-sm font-medium text-muted-foreground tabular-nums">
                    {page} / {lastPage}
                  </span>
                  <Button variant="outline" size="sm" disabled={page >= lastPage} onClick={() => setPage(page + 1)}>
                    Next <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              )}
            </div>
          </Card>
        </div>
      </main>

      {/* Export dialog */}
      <Dialog open={showExportDialog} onOpenChange={setShowExportDialog}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Export appointments</DialogTitle>
            <DialogDescription>
              {total} row{total === 1 ? "" : "s"} match the current filters. Choose what to download.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <button
              disabled={exporting}
              onClick={() => doExport(false)}
              className="rounded-lg border border-border px-4 py-2.5 text-left text-sm font-medium transition-colors hover:bg-muted disabled:opacity-50"
            >
              Current page <span className="text-muted-foreground">({Math.min(PAGE_SIZE, total)} rows)</span>
            </button>
            <button
              disabled={exporting}
              onClick={() => doExport(true)}
              className="rounded-lg bg-brand px-4 py-2.5 text-left text-sm font-semibold text-brand-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {exporting ? "Exporting…" : `All filtered rows (${total} rows)`}
            </button>
          </div>
          <DialogFooter>
            <Button variant="outline" className="w-full" onClick={() => setShowExportDialog(false)}>Cancel</Button>
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
            toast.error("Reschedule failed", { description: err.error || "Please try again." });
            return;
          }
          setRows((prev) => prev.map((r) => (r.id === rescheduleFor.id ? { ...r, status: "Rescheduled" as const } : r)));
          setRescheduleFor(null);
          toast.success("Appointment rescheduled", { description: "New slot booked and SMS notification sent." });
        }}
      />
    </>
  );
}
