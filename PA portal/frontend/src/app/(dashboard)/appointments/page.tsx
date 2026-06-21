"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Download, Search, ChevronLeft, ChevronRight, ChevronRight as RowChevron } from "lucide-react";
import { toast } from "sonner";

import TopBar from "@/components/TopBar";
import PriorityBadge from "@/components/PriorityBadge";
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

const TABS = ["All", "Scheduled", "Waiting", "Rescheduled", "Submitted"] as const;
const PAGE_SIZE = 25;

function statusClass(s: string) {
  return ({ Scheduled: "s-Scheduled", Rescheduled: "s-Rescheduled", Submitted: "s-Submitted", Waiting: "s-Waiting" } as Record<string, string>)[s] ?? "";
}

export default function AppointmentsPage() {
  const [tab, setTab] = useState<(typeof TABS)[number]>("All");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<AppointmentRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [openRow, setOpenRow] = useState<AppointmentRow | null>(null);

  const [urgency, setUrgency] = useState("");
  const [department, setDepartment] = useState("");
  const [category, setCategory] = useState("");

  const [rescheduleFor, setRescheduleFor] = useState<{ id: number; name: string } | null>(null);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchAppointments({ status: tab, search, page, urgency, department, category });
      setRows(data.items);
      setTotal(data.total);
    } catch (e) {
      toast.error(`Load failed: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, [tab, search, page, urgency, department, category]);

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

  async function exportCSV() {
    const data = await fetchAppointments({ status: tab, search, page: 1 });
    const out: (string | number)[][] = [["Token", "Name", "Mobile", "Category", "Status", "Submitted"]];
    data.items.forEach((r) => out.push([r.token, r.name, r.mobile, r.category, r.status, r.created_at]));
    const csv = out.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = "data:text/csv;charset=utf-8," + encodeURIComponent(csv);
    a.download = "appointments.csv";
    a.click();
    toast.success("Export ready", { description: `${data.items.length} rows downloaded.` });
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
              <h1 className="text-2xl font-extrabold tracking-tight text-foreground">Appointments</h1>
              <p className="mt-0.5 text-sm text-muted-foreground">
                Citizens who have submitted petitions via the QR flow.
              </p>
            </div>
            <Button variant="outline" onClick={exportCSV}>
              <Download className="h-4 w-4 text-brand" /> Export
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
                {TABS.map((t) => {
                  const active = t === tab;
                  return (
                    <button
                      key={t}
                      onClick={() => { setTab(t); setPage(1); }}
                      className={cn(
                        "whitespace-nowrap rounded-lg px-3.5 py-1.5 text-sm font-medium transition-colors",
                        active
                          ? "bg-brand/10 text-brand"
                          : "text-muted-foreground hover:bg-muted hover:text-foreground"
                      )}
                    >
                      {t}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Derived filters */}
            <div className="border-b border-border px-4 py-3">
              <FilterStrip
                onClearAll={() => { setUrgency(""); setDepartment(""); setCategory(""); setPage(1); }}
                groups={[
                  { key: "urgency",    label: "Urgency",    value: urgency,    onChange: v => { setPage(1); setUrgency(v); },    options: urgencyOptions },
                  { key: "department", label: "Department", value: department, onChange: v => { setPage(1); setDepartment(v); }, options: deptOptions },
                  { key: "category",   label: "Category",   value: category,   onChange: v => { setPage(1); setCategory(v); },   options: categoryOptions },
                ]}
              />
            </div>

            {/* Table */}
            <div className="min-h-0 flex-1 overflow-auto">
              <table className="w-full min-w-[960px] border-collapse text-left">
                <thead className="sticky top-0 z-10 bg-muted/60 backdrop-blur">
                  <tr className="border-b border-border">
                    <th className={cn(th, "w-10")}>#</th>
                    <th className={cn(th, "w-28")}>Token</th>
                    <th className={cn(th, "w-40")}>Name</th>
                    <th className={cn(th, "w-36")}>Category</th>
                    <th className={cn(th, "w-36")}>Submitted</th>
                    <th className={cn(th, "w-36")}>Appt. Time</th>
                    <th className={cn(th, "w-24")}>Priority</th>
                    <th className={cn(th, "w-36")}>Status</th>
                    <th className="w-8" />
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr><td colSpan={9} className="py-12 text-center text-sm text-muted-foreground">Loading…</td></tr>
                  ) : rows.length === 0 ? (
                    <tr><td colSpan={9} className="py-12 text-center text-sm text-muted-foreground">No appointments found.</td></tr>
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
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {row.appointment_time ? formatDateTime(row.appointment_time) : <span className="text-muted-foreground/40">—</span>}
                      </td>
                      <td className="px-4 py-3"><PriorityBadge urgency={row.urgency} /></td>
                      <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                        <Select value={row.status} onValueChange={(v) => onStatusChange(row, v as AppointmentStatus)}>
                          <SelectTrigger className={cn("h-8 w-[130px] text-xs font-semibold", statusClass(row.status))}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="Scheduled">Scheduled</SelectItem>
                            <SelectItem value="Waiting">Waiting</SelectItem>
                            <SelectItem value="Rescheduled">Rescheduled</SelectItem>
                            <SelectItem value="Submitted">Submitted</SelectItem>
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
        onSubmit={async () => {
          if (!rescheduleFor) return;
          await commitStatus(rescheduleFor.id, "Rescheduled");
          setRescheduleFor(null);
          toast.success("Appointment rescheduled", { description: "SMS notification sent to the citizen." });
        }}
      />
    </>
  );
}
