"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Download, Search, ChevronLeft, ChevronRight, ChevronRight as RowChevron, CalendarRange, X as ClearIcon } from "lucide-react";
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
import { cn, formatDateTime } from "@/lib/utils";
import { fetchAppointments, updateAppointmentStatus } from "@/lib/api";
import type { AppointmentRow, AppointmentStatus } from "@/lib/types";
import { urgencyOptions, deptOptions, categoryOptions } from "@/lib/enums";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const TABS = ["All", "Awaiting Review", "Scheduled", "Waiting", "Rescheduled", "Reviewed"] as const;
const PAGE_SIZE = 25;

function statusClass(s: string) {
  return ({
    Scheduled: "s-Scheduled",
    Rescheduled: "s-Rescheduled",
    Reviewed: "s-Reviewed",
    Waiting: "s-Waiting",
    "Awaiting Review": "s-AwaitingReview",
  } as Record<string, string>)[s] ?? "";
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
  const initialTab = (searchParams.get("tab") as (typeof TABS)[number]) || "All";
  const [tab, setTab] = useState<(typeof TABS)[number]>(
    TABS.includes(initialTab as (typeof TABS)[number]) ? initialTab : "All"
  );
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<AppointmentRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
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

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchAppointments({ status: tab, search, page, urgency, department, category, dateFrom: dateFrom || undefined, dateTo: dateTo || undefined, apptDateFrom: apptDateFrom || undefined, apptDateTo: apptDateTo || undefined });
      setRows(data.items);
      setTotal(data.total);
    } catch (e) {
      toast.error(`Load failed: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, [tab, search, page, urgency, department, category, dateFrom, dateTo, apptDateFrom, apptDateTo]);

  useEffect(() => { load(); }, [load]);

  function onSearchChange(v: string) {
    setSearch(v);
    setPage(1);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => load(), 350);
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

  const maxPage = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const offset = (page - 1) * PAGE_SIZE;

  function buildFilters(pageOverride?: number, pageSizeOverride?: number) {
    return {
      status: tab, search: search || undefined,
      urgency: urgency || undefined, department: department || undefined,
      category: category || undefined,
      dateFrom: dateFrom || undefined, dateTo: dateTo || undefined,
      apptDateFrom: apptDateFrom || undefined, apptDateTo: apptDateTo || undefined,
      page: pageOverride ?? page,
      pageSize: pageSizeOverride,
    };
  }

  function rowsToCsv(items: typeof rows) {
    const headers = ["Token","Name","Mobile","Category","Status","Submitted","Appt Date","Slot","Time"];
    const lines = items.map(r => [
      r.token, r.name, r.mobile,
      r.category_label ?? r.category,
      r.status, r.created_at,
      r.scheduled_date ?? "",
      r.slot_window ?? "",
      r.appointment_time ? new Date(r.appointment_time).toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit',hour12:true}) : "",
    ]);
    return [headers, ...lines].map(row => row.map(v => `"${String(v).replace(/"/g,'""')}"`).join(",")).join("\n");
  }

  async function doExport(allRows: boolean) {
    setExporting(true);
    try {
      const data = await fetchAppointments(buildFilters(1, allRows ? 5000 : PAGE_SIZE));
      const csv = rowsToCsv(data.items);
      const a = document.createElement("a");
      a.href = "data:text/csv;charset=utf-8," + encodeURIComponent(csv);
      a.download = `appointments_${new Date().toISOString().slice(0,10)}.csv`;
      a.click();
      toast.success("Export ready", { description: `${data.items.length} rows downloaded.` });
    } catch { toast.error("Export failed."); }
    finally { setExporting(false); setShowExportDialog(false); }
  }

  const pagedInfo = useMemo(() => {
    const lo = total === 0 ? 0 : Math.min(offset + 1, total);
    const hi = Math.min(offset + PAGE_SIZE, total);
    return `Showing ${lo}–${hi} of ${total}`;
  }, [total, offset]);

  const th = "px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground";

  return (
    <>
      <TopBar />
      <main className="flex flex-1 flex-col overflow-y-auto overflow-x-hidden bg-background">
        <div className="flex min-h-0 flex-1 flex-col gap-5 p-6 animate-in-up">
          {/* Page header */}
          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
            <div>
              <h1 className="text-2xl font-extrabold tracking-tight text-foreground">{t("appts.title")}</h1>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {t("appts.subtitle")}
              </p>
            </div>
            <Button variant="outline" onClick={() => setShowExportDialog(true)}>
              <Download className="h-4 w-4 text-brand" /> {t("action.export")}
            </Button>
          </div>

          {/* Panel */}
          <Card className="flex min-h-0 flex-1 flex-col overflow-hidden p-0">
            {/* Search + tabs */}
            <div className="flex flex-col gap-3 border-b border-border p-4">
              <div className="relative w-full max-w-sm">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => onSearchChange(e.target.value)}
                  placeholder="Search name, token, mobile…"
                  className="pl-9"
                />
              </div>

              <div className="flex items-center gap-1 overflow-x-auto">
                {TABS.map((tabItem) => {
                  const active = tabItem === tab;
                  const TAB_KEYS: Record<string, string> = {
                    "All": "appts.tabAll", "Awaiting Review": "appts.tabAwaiting",
                    "Scheduled": "appts.tabScheduled", "Waiting": "appts.tabWaiting",
                    "Rescheduled": "appts.tabRescheduled", "Reviewed": "appts.tabReviewed",
                  };
                  return (
                    <button
                      key={tabItem}
                      onClick={() => { setTab(tabItem); setPage(1); router.replace("/appointments"); }}
                      className={cn(
                        "whitespace-nowrap rounded-lg px-3.5 py-1.5 text-sm font-medium transition-colors",
                        active
                          ? "bg-brand/10 text-brand"
                          : "text-muted-foreground hover:bg-muted hover:text-foreground"
                      )}
                    >
                      {t(TAB_KEYS[tabItem] ?? tabItem)}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Derived filters */}
            <div className="border-b border-border px-4 py-3 flex flex-col gap-3">
              <FilterStrip
                onClearAll={() => { setUrgency(""); setDepartment(""); setCategory(""); setDateFrom(""); setDateTo(""); setApptDateFrom(""); setApptDateTo(""); setPage(1); }}
                groups={[
                  { key: "urgency",    label: t("label.urgency"),    value: urgency,    onChange: v => { setPage(1); setUrgency(v); },    options: urgencyOptions },
                  { key: "department", label: t("label.department"), value: department, onChange: v => { setPage(1); setDepartment(v); }, options: deptOptions },
                  { key: "category",   label: t("label.category"),   value: category,   onChange: v => { setPage(1); setCategory(v); },   options: categoryOptions },
                ]}
              />
              {/* Submission date filter */}
              <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card p-3 shadow-card">
                <div className="flex items-center gap-1.5 pl-1 pr-1 text-xs font-semibold text-muted-foreground">
                  <CalendarRange className="h-3.5 w-3.5" /> Submitted
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-muted-foreground">From</span>
                  <input type="date" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setPage(1); }}
                    className="h-9 rounded-md border border-input bg-background px-2 text-xs text-foreground" />
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-muted-foreground">To</span>
                  <input type="date" value={dateTo} onChange={e => { setDateTo(e.target.value); setPage(1); }}
                    className="h-9 rounded-md border border-input bg-background px-2 text-xs text-foreground" />
                </div>
                {(dateFrom || dateTo) && (
                  <button onClick={() => { setDateFrom(""); setDateTo(""); setPage(1); }}
                    className="ml-auto flex items-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium text-muted-foreground hover:text-red-600">
                    <ClearIcon className="h-3.5 w-3.5" /> Clear
                  </button>
                )}
              </div>

              {/* Appointment date filter */}
              <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card p-3 shadow-card">
                <div className="flex items-center gap-1.5 pl-1 pr-1 text-xs font-semibold text-muted-foreground">
                  <CalendarRange className="h-3.5 w-3.5" /> Appt. Date
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-muted-foreground">From</span>
                  <input type="date" value={apptDateFrom} onChange={e => { setApptDateFrom(e.target.value); setPage(1); }}
                    className="h-9 rounded-md border border-input bg-background px-2 text-xs text-foreground" />
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-muted-foreground">To</span>
                  <input type="date" value={apptDateTo} onChange={e => { setApptDateTo(e.target.value); setPage(1); }}
                    className="h-9 rounded-md border border-input bg-background px-2 text-xs text-foreground" />
                </div>
                {(apptDateFrom || apptDateTo) && (
                  <button onClick={() => { setApptDateFrom(""); setApptDateTo(""); setPage(1); }}
                    className="ml-auto flex items-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium text-muted-foreground hover:text-red-600">
                    <ClearIcon className="h-3.5 w-3.5" /> Clear
                  </button>
                )}
              </div>
            </div>

            {/* Table */}
            <div className="min-h-0 flex-1 overflow-auto">
              <table className="w-full min-w-[960px] border-collapse text-left">
                <thead className="sticky top-0 z-10 bg-muted/60 backdrop-blur">
                  <tr className="border-b border-border">
                    <th className={cn(th, "w-10")}>#</th>
                    <th className={cn(th, "w-28")}>{t("appts.colToken")}</th>
                    <th className={cn(th, "w-40")}>{t("appts.colName")}</th>
                    <th className={cn(th, "w-36")}>{t("appts.colCategory")}</th>
                    <th className={cn(th, "w-36")}>{t("label.date")}</th>
                    <th className={cn(th, "w-32")}>Appt. Date</th>
                    <th className={cn(th, "w-28")}>Slot</th>
                    <th className={cn(th, "w-20")}>Time</th>
                    <th className={cn(th, "w-16")}>Persons</th>
                    <th className={cn(th, "w-24")}>{t("appts.colUrgency")}</th>
                    <th className={cn(th, "w-36")}>{t("appts.colStatus")}</th>
                    <th className="w-8" />
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr><td colSpan={12} className="py-12 text-center text-sm text-muted-foreground">{t("label.loading")}</td></tr>
                  ) : rows.length === 0 ? (
                    <tr><td colSpan={12} className="py-12 text-center text-sm text-muted-foreground">{t("appts.noAppts")}</td></tr>
                  ) : rows.map((row, idx) => (
                    <tr
                      key={row.id}
                      onClick={() => setOpenRow(row)}
                      className="group cursor-pointer border-b border-border/70 transition-colors hover:bg-muted/40"
                    >
                      <td className="px-4 py-3 text-sm tabular-nums text-muted-foreground">{offset + idx + 1}</td>
                      <td className="px-4 py-3 text-sm font-semibold text-brand">{row.token}</td>
                      <td className="px-4 py-3 text-sm font-medium text-foreground">{row.name}</td>
                      <td className="px-4 py-3 text-sm text-muted-foreground">{row.category_label ?? row.category}</td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">{formatDateTime(row.created_at)}</td>
                      {/* Appointment date column */}
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {row.scheduled_date
                          ? <span className="font-medium text-foreground">
                              {new Date(row.scheduled_date + 'T00:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}
                            </span>
                          : <span className="text-muted-foreground/40">—</span>}
                      </td>
                      {/* Slot column — 30-min window e.g. "08:00 – 08:30" */}
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {row.slot_window
                          ? <span className="font-medium text-foreground">{row.slot_window}</span>
                          : <span className="text-muted-foreground/40">—</span>}
                      </td>
                      {/* Time column — personal sub-slot e.g. "08:02" */}
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {row.appointment_time
                          ? <span className="font-medium text-foreground">
                              {new Date(row.appointment_time).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: true })}
                            </span>
                          : <span className="text-muted-foreground/40">—</span>}
                      </td>
                      <td className="px-4 py-3 text-xs text-center font-medium text-foreground">
                        {row.num_persons ?? <span className="text-muted-foreground/40">—</span>}
                      </td>
                      <td className="px-4 py-3"><PriorityBadge urgency={row.urgency} /></td>
                      <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                        <Select value={row.status} onValueChange={(v) => onStatusChange(row, v as AppointmentStatus)}>
                          <SelectTrigger className={cn("h-8 w-[130px] text-xs font-semibold", statusClass(row.status))}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="Waiting">Waiting</SelectItem>
                            <SelectItem value="Scheduled">Scheduled</SelectItem>
                            <SelectItem value="Awaiting Review">Awaiting Review</SelectItem>
                            <SelectItem value="Reviewed">Reviewed</SelectItem>
                            <SelectItem value="Rescheduled">Rescheduled</SelectItem>
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
            <div className="flex flex-shrink-0 items-center justify-between border-t border-border px-4 py-3">
              <span className="text-sm text-muted-foreground">{pagedInfo}</span>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                  <ChevronLeft className="h-4 w-4" /> Prev
                </Button>
                <span className="px-1 text-sm font-medium text-muted-foreground">
                  Page {page} of {maxPage}
                </span>
                <Button variant="outline" size="sm" disabled={page >= maxPage} onClick={() => setPage(page + 1)}>
                  Next <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </Card>
        </div>
      </main>

      {/* Export dialog */}
      {showExportDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-80 rounded-2xl bg-white p-6 shadow-2xl dark:bg-slate-900">
            <h3 className="mb-1 text-base font-bold text-foreground">Export Appointments</h3>
            <p className="mb-4 text-xs text-muted-foreground">
              {total} rows match current filters. Choose export scope:
            </p>
            <div className="flex flex-col gap-2">
              <button
                disabled={exporting}
                onClick={() => doExport(false)}
                className="rounded-lg border border-border px-4 py-2.5 text-left text-sm font-medium hover:bg-muted disabled:opacity-50"
              >
                📄 Current page <span className="text-muted-foreground">({Math.min(PAGE_SIZE, total)} rows)</span>
              </button>
              <button
                disabled={exporting}
                onClick={() => doExport(true)}
                className="rounded-lg bg-brand px-4 py-2.5 text-left text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
              >
                {exporting ? "⏳ Exporting…" : `📊 All filtered rows (${total} rows)`}
              </button>
            </div>
            <button
              onClick={() => setShowExportDialog(false)}
              className="mt-3 w-full rounded-lg border border-border py-2 text-xs text-muted-foreground hover:bg-muted"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

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
