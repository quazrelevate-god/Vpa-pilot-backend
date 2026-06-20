"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Download, Search } from "lucide-react";

import TopBar from "@/components/TopBar";
import PriorityBadge from "@/components/PriorityBadge";
import Toast from "@/components/Toast";
import RescheduleModal from "@/components/RescheduleModal";
import AppointmentExpand from "@/components/AppointmentExpand";
import { fetchAppointments, updateAppointmentStatus } from "@/lib/api";
import type { AppointmentRow, AppointmentStatus } from "@/lib/types";

const TABS = ["All", "Scheduled", "Waiting", "Rescheduled", "Submitted", "Closed"] as const;
const PAGE_SIZE = 25;

function statusClass(s: string) {
  return ({ Scheduled: "s-Scheduled", Rescheduled: "s-Rescheduled", Submitted: "s-Submitted", Closed: "s-Closed", Waiting: "s-Waiting" } as Record<string, string>)[s] ?? "";
}

export default function AppointmentsPage() {
  const [tab, setTab] = useState<(typeof TABS)[number]>("All");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<AppointmentRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [toast, setToast] = useState<string | null>(null);

  const [rescheduleFor, setRescheduleFor] = useState<{ id: number; name: string } | null>(null);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchAppointments({ status: tab, search, page });
      setRows(data.items);
      setTotal(data.total);
    } catch (e) {
      setToast(`Load failed: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, [tab, search, page]);

  useEffect(() => { load(); }, [load]);

  function onSearchChange(v: string) {
    setSearch(v);
    setPage(1);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => load(), 350);
  }

  function toggleExpand(id: number) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
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
      setToast(`Status changed to "${newStatus}" successfully.`);
    } catch {
      setToast("Failed to update status. Please try again.");
    }
  }

  const maxPage = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const offset = (page - 1) * PAGE_SIZE;

  // Export current view as CSV (everything on this filter, up to 10k rows)
  async function exportCSV() {
    const data = await fetchAppointments({ status: tab, search, page: 1 });
    const rows: (string | number)[][] = [["Token", "Name", "Mobile", "Category", "Status", "Submitted"]];
    data.items.forEach((r) =>
      rows.push([r.token, r.name, r.mobile, r.category, r.status, r.created_at])
    );
    const csv = rows
      .map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const a = document.createElement("a");
    a.href = "data:text/csv;charset=utf-8," + encodeURIComponent(csv);
    a.download = "appointments.csv";
    a.click();
  }

  const pagedInfo = useMemo(() => {
    const lo = total === 0 ? 0 : Math.min(offset + 1, total);
    const hi = Math.min(offset + PAGE_SIZE, total);
    return `Showing ${lo}–${hi} of ${total}`;
  }, [total, offset]);

  return (
    <>
      <TopBar />
      <main className="flex-1 overflow-x-hidden overflow-y-auto p-6 flex flex-col bg-slate-50">
        {/* Page header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-5">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 mb-0.5">Appointments</h1>
            <p className="text-sm text-slate-500">Citizens who have submitted petitions via the QR flow.</p>
          </div>
          <button
            onClick={exportCSV}
            className="px-4 py-2 bg-white border shadow-sm text-sm font-medium text-slate-700 rounded-md hover:bg-slate-50 transition-colors flex items-center gap-2"
          >
            <Download className="w-4 h-4 text-brand" /> Export
          </button>
        </div>

        {/* Panel */}
        <div className="bg-white rounded-lg shadow-sm border border-slate-200 flex flex-col flex-1 min-h-0">
          {/* Filters */}
          <div className="p-4 border-b border-slate-100 flex flex-col sm:flex-row gap-3 flex-wrap items-end">
            <div className="relative">
              <input
                type="text"
                value={search}
                onChange={(e) => onSearchChange(e.target.value)}
                placeholder="Search name, token, mobile…"
                className="w-56 pl-3 pr-9 py-2 border rounded-md text-sm text-slate-700 focus:border-brand focus:outline-none"
              />
              <Search className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2" />
            </div>
          </div>

          {/* Tabs */}
          <div className="border-b border-slate-200 px-5 pt-2 flex gap-5 overflow-x-auto flex-shrink-0">
            {TABS.map((t) => {
              const active = t === tab;
              return (
                <button
                  key={t}
                  onClick={() => { setTab(t); setPage(1); }}
                  className={[
                    "whitespace-nowrap pb-3 text-sm font-medium border-b-2 focus:outline-none transition-colors",
                    active
                      ? "text-brand border-brand font-semibold"
                      : "text-slate-500 border-transparent hover:border-slate-300",
                  ].join(" ")}
                >
                  {t}
                </button>
              );
            })}
          </div>

          {/* Table */}
          <div className="flex-1 overflow-auto">
            <table className="w-full text-left border-collapse min-w-[900px]">
              <thead className="sticky top-0 bg-slate-50 z-10">
                <tr className="border-b border-slate-200">
                  <th className="py-3 px-4 text-xs font-semibold text-slate-600 w-10">#</th>
                  <th className="py-3 px-4 text-xs font-semibold text-slate-600 w-28">Token</th>
                  <th className="py-3 px-4 text-xs font-semibold text-slate-600 w-40">Name</th>
                  <th className="py-3 px-4 text-xs font-semibold text-slate-600 w-36">Category</th>
                  <th className="py-3 px-4 text-xs font-semibold text-slate-600 w-36">Submitted Time</th>
                  <th className="py-3 px-4 text-xs font-semibold text-slate-600 w-36">Appt. Time</th>
                  <th className="py-3 px-4 text-xs font-semibold text-slate-600 w-24">Priority</th>
                  <th className="py-3 px-4 text-xs font-semibold text-slate-600 w-36">Status</th>
                  <th className="py-3 px-4 text-xs font-semibold text-slate-600 text-center w-16">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  <tr><td colSpan={9} className="py-10 text-center text-slate-400 text-sm">Loading…</td></tr>
                ) : rows.length === 0 ? (
                  <tr><td colSpan={9} className="py-10 text-center text-slate-400 text-sm">No appointments found.</td></tr>
                ) : rows.map((row, idx) => {
                  const isOpen = expanded.has(row.id);
                  return (
                    <Fragment key={row.id}>
                      <tr className="hover:bg-slate-50 transition-colors bg-white">
                        <td className="py-3 px-4 text-sm text-slate-500">{offset + idx + 1}</td>
                        <td className="py-3 px-4 text-sm font-medium text-slate-800">{row.token}</td>
                        <td className="py-3 px-4 text-sm text-slate-800">{row.name}</td>
                        <td className="py-3 px-4 text-sm text-slate-600">{row.category}</td>
                        <td className="py-3 px-4 text-xs text-slate-500">{row.created_at}</td>
                        <td className="py-3 px-4 text-xs text-slate-500">
                          {row.appointment_time ?? <span className="text-slate-300">—</span>}
                        </td>
                        <td className="py-3 px-4"><PriorityBadge urgency={row.urgency} /></td>
                        <td className="py-3 px-4">
                          <select
                            className={`status-select ${statusClass(row.status)}`}
                            value={row.status}
                            onChange={(e) => onStatusChange(row, e.target.value as AppointmentStatus)}
                          >
                            <option value="Scheduled">Scheduled</option>
                            <option value="Waiting">Waiting</option>
                            <option value="Rescheduled">Rescheduled</option>
                            <option value="Submitted">Submitted</option>
                            <option value="Closed">Closed</option>
                          </select>
                        </td>
                        <td className="py-3 px-4 text-center">
                          <button
                            onClick={() => toggleExpand(row.id)}
                            className="p-1 text-slate-400 hover:text-brand hover:bg-blue-50 rounded transition-all"
                            aria-label="Expand"
                          >
                            <ChevronDown className={`w-5 h-5 transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`} />
                          </button>
                        </td>
                      </tr>
                      {isOpen && (
                        <tr className="bg-slate-50/80 border-b border-slate-200">
                          <AppointmentExpand row={row} />
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="p-4 border-t border-slate-100 flex items-center justify-between bg-white rounded-b-lg flex-shrink-0">
            <span className="text-sm text-slate-500">{pagedInfo}</span>
            <div className="flex items-center gap-2">
              <button
                disabled={page <= 1}
                onClick={() => setPage(page - 1)}
                className="px-3 py-1.5 text-sm border rounded hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                ← Prev
              </button>
              <span className="text-sm text-slate-600">Page {page} of {maxPage}</span>
              <button
                disabled={page >= maxPage}
                onClick={() => setPage(page + 1)}
                className="px-3 py-1.5 text-sm border rounded hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Next →
              </button>
            </div>
          </div>
        </div>
      </main>

      {/* Reschedule modal */}
      <RescheduleModal
        open={!!rescheduleFor}
        citizenName={rescheduleFor?.name ?? ""}
        onClose={() => setRescheduleFor(null)}
        onSubmit={async () => {
          if (!rescheduleFor) return;
          await commitStatus(rescheduleFor.id, "Rescheduled");
          setRescheduleFor(null);
          setToast("Appointment rescheduled and SMS sent.");
        }}
      />

      {/* Toast */}
      <Toast message={toast} onClose={() => setToast(null)} />
    </>
  );
}
