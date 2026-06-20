"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Search, ChevronDown } from "lucide-react";

import TopBar from "@/components/TopBar";
import FilterStrip from "@/components/FilterStrip";
import TicketDetailDrawer from "@/components/TicketDetailDrawer";
import { fetchTickets } from "@/lib/api";
import type { TicketRow } from "@/lib/types";
import {
  TICKET_STATUS_DISPLAY, TICKET_STATUS_COLOR, PRIORITY_COLOR,
  ticketStatusOptions, priorityOptions, urgencyOptions, deptOptions, categoryOptions,
} from "@/lib/enums";

const PAGE_SIZE = 25;

export default function TicketsPage() {
  const [rows, setRows] = useState<TicketRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);

  const [status, setStatus] = useState("");
  const [priority, setPriority] = useState("");
  const [urgency, setUrgency] = useState("");
  const [department, setDepartment] = useState("");
  const [category, setCategory] = useState("");
  const [search, setSearch] = useState("");

  const [openId, setOpenId] = useState<number | null>(null);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await fetchTickets({
        status, priority, urgency, department, category,
        search, page,
      });
      setRows(d.items); setTotal(d.total);
    } catch (e) {
      console.error(e);
    } finally { setLoading(false); }
  }, [status, priority, urgency, department, category, search, page]);

  useEffect(() => { load(); }, [load]);

  function onSearchChange(v: string) {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => { setPage(1); setSearch(v); }, 300);
  }

  function clearAll() {
    setStatus(""); setPriority(""); setUrgency(""); setDepartment(""); setCategory("");
    setPage(1);
  }

  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <>
      <TopBar />
      <main className="flex-1 overflow-y-auto p-6 space-y-4 bg-slate-50">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-extrabold text-slate-900">Tickets</h1>
            <p className="text-sm text-slate-500 mt-0.5">
              Case-management tracking for every petition. {total} tickets total.
            </p>
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              placeholder="Search ticket #, name, mobile, headline…"
              onChange={e => onSearchChange(e.target.value)}
              className="border border-slate-300 rounded-lg pl-9 pr-3 py-2 text-sm w-80 focus:outline-none focus:ring-2 focus:ring-brand/30 bg-white"
            />
          </div>
        </div>

        <FilterStrip
          onClearAll={clearAll}
          groups={[
            { key: "status",     label: "Status",     value: status,     onChange: v => { setPage(1); setStatus(v); },     options: ticketStatusOptions },
            { key: "priority",   label: "Priority",   value: priority,   onChange: v => { setPage(1); setPriority(v); },   options: priorityOptions },
            { key: "urgency",    label: "Urgency",    value: urgency,    onChange: v => { setPage(1); setUrgency(v); },    options: urgencyOptions },
            { key: "department", label: "Department", value: department, onChange: v => { setPage(1); setDepartment(v); }, options: deptOptions },
            { key: "category",   label: "Category",   value: category,   onChange: v => { setPage(1); setCategory(v); },   options: categoryOptions },
          ]}
        />

        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600 text-[11px] uppercase tracking-wider">
              <tr>
                <th className="text-left px-4 py-2.5 font-semibold">Ticket #</th>
                <th className="text-left px-4 py-2.5 font-semibold">Citizen</th>
                <th className="text-left px-4 py-2.5 font-semibold">Headline</th>
                <th className="text-left px-4 py-2.5 font-semibold">Department</th>
                <th className="text-left px-4 py-2.5 font-semibold">Priority</th>
                <th className="text-left px-4 py-2.5 font-semibold">Status</th>
                <th className="text-left px-4 py-2.5 font-semibold">Assigned</th>
                <th className="text-left px-4 py-2.5 font-semibold">Age</th>
              </tr>
            </thead>
            <tbody>
              {loading && rows.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-10 text-center text-slate-400">Loading…</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-10 text-center text-slate-400">No tickets match the current filters.</td></tr>
              ) : rows.map(r => (
                <tr key={r.id} onClick={() => setOpenId(r.id)}
                    className="border-t border-slate-100 hover:bg-slate-50 cursor-pointer">
                  <td className="px-4 py-2.5 font-mono text-xs text-brand">{r.ticket_number}</td>
                  <td className="px-4 py-2.5">
                    <div className="font-medium text-slate-800">{r.citizen_name ?? "—"}</div>
                    <div className="text-[11px] text-slate-400">{r.token ?? ""}</div>
                  </td>
                  <td className="px-4 py-2.5 max-w-md">
                    <div className="text-slate-700 truncate">{r.headline ?? "—"}</div>
                  </td>
                  <td className="px-4 py-2.5 text-[12px] text-slate-600">{r.department_label ?? "—"}</td>
                  <td className="px-4 py-2.5">
                    {r.priority && (
                      <span className={`text-[11px] font-bold px-2 py-0.5 rounded ${PRIORITY_COLOR[r.priority]}`}>
                        {r.priority}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    <span className={`text-[11px] font-semibold px-2 py-0.5 rounded border ${TICKET_STATUS_COLOR[r.status]}`}>
                      {TICKET_STATUS_DISPLAY[r.status] ?? r.status}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-[12px] text-slate-600">{r.assigned_to_pa ?? <span className="text-slate-300 italic">—</span>}</td>
                  <td className="px-4 py-2.5 text-[12px] text-slate-500">{formatAge(r.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {/* Pagination */}
          {total > PAGE_SIZE && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100 text-sm">
              <div className="text-slate-500">Page {page} of {lastPage} · {total} tickets</div>
              <div className="flex gap-2">
                <button disabled={page === 1} onClick={() => setPage(p => p - 1)}
                  className="px-3 py-1 border border-slate-300 rounded disabled:opacity-30">Prev</button>
                <button disabled={page === lastPage} onClick={() => setPage(p => p + 1)}
                  className="px-3 py-1 border border-slate-300 rounded disabled:opacity-30">Next</button>
              </div>
            </div>
          )}
        </div>
      </main>

      <TicketDetailDrawer
        ticketId={openId}
        onClose={() => setOpenId(null)}
        onMutated={load}
      />
    </>
  );
}

function formatAge(iso: string): string {
  const created = new Date(iso).getTime();
  const ms = Date.now() - created;
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  return `${days}d`;
}
