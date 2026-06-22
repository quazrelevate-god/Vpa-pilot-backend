"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Calendar, Users, Clock, CheckCircle, AlertCircle,
  Lock, Unlock, RefreshCw, Plus,
} from "lucide-react";
import { toast } from "sonner";

import TopBar from "@/components/TopBar";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// ── Types ────────────────────────────────────────────────────────────────────

interface Slot {
  id: number;
  slot_number: number;
  label: string;
  start: string;
  end: string;
  status: "AVAILABLE" | "FULL" | "BLOCKED";
  booked_count: number;
  max_capacity: number;
  remaining: number;
  available: boolean;
}

interface SlotGrid {
  has_availability: boolean;
  availability_id?: number;
  date?: string;
  date_label?: string;
  total_slots?: number;
  total_capacity?: number;
  booked_total?: number;
  blocked_slots?: number;
  remaining_total?: number;
  slots: Slot[];
}

interface OpenDate {
  id: number;
  date: string;
  date_label: string;
  total_slots: number;
  total_capacity: number;
  booked: number;
  blocked_slots: number;
  remaining: number;
}

interface Stats {
  waiting_count: number;
  scheduled_today: number;
  oldest_waiting_days: number;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function slotColor(s: Slot): string {
  if (s.status === "BLOCKED")        return "border-slate-300 bg-slate-100 text-slate-400";
  if (s.booked_count === 0)          return "border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100 cursor-pointer";
  if (s.remaining === 0)             return "border-red-300 bg-red-50 text-red-700";
  return "border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100 cursor-pointer";
}

function slotBadge(s: Slot): { label: string; cls: string } {
  if (s.status === "BLOCKED") return { label: "Blocked",   cls: "bg-slate-200 text-slate-500" };
  if (s.remaining === 0)      return { label: "Full",      cls: "bg-red-100 text-red-600" };
  if (s.booked_count > 0)     return { label: `${s.remaining} left`, cls: "bg-amber-100 text-amber-700" };
  return                             { label: "Open",      cls: "bg-emerald-100 text-emerald-700" };
}

function todayIso(): string {
  return new Date().toISOString().split("T")[0];
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function SchedulingPage() {
  const [selectedDate, setSelectedDate] = useState(todayIso());
  const [grid,         setGrid]         = useState<SlotGrid | null>(null);
  const [openDates,    setOpenDates]    = useState<OpenDate[]>([]);
  const [stats,        setStats]        = useState<Stats | null>(null);
  const [loadingGrid,  setLoadingGrid]  = useState(false);
  const [openingDate,  setOpeningDate]  = useState(false);
  const [blockingId,   setBlockingId]   = useState<number | null>(null);
  const [showCancel,   setShowCancel]   = useState(false);
  const [cancelling,   setCancelling]   = useState(false);

  // ── Data loaders ──────────────────────────────────────────────────────────

  const loadGrid = useCallback(async (d: string) => {
    setLoadingGrid(true);
    try {
      const res  = await fetch(`/api/v1/scheduling/admin/slots?target_date=${d}`);
      const data = await res.json() as SlotGrid;
      setGrid(data);
    } catch { toast.error("Failed to load slot grid."); }
    finally   { setLoadingGrid(false); }
  }, []);

  const loadOpenDates = useCallback(async () => {
    try {
      const res  = await fetch("/api/v1/scheduling/admin/dates");
      const data = await res.json();
      if (Array.isArray(data)) setOpenDates(data);
    } catch { /* silent */ }
  }, []);

  const loadStats = useCallback(async () => {
    try {
      const res  = await fetch("/api/v1/scheduling/admin/statistics");
      const data = await res.json();
      if (!data.error) setStats(data);
    } catch { /* silent */ }
  }, []);

  useEffect(() => {
    loadGrid(selectedDate);
    loadOpenDates();
    loadStats();
  }, [selectedDate, loadGrid, loadOpenDates, loadStats]);

  // ── Actions ───────────────────────────────────────────────────────────────

  async function handleOpenDate() {
    setOpeningDate(true);
    try {
      const res  = await fetch("/api/v1/scheduling/admin/open-date", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mla_id: 1, date: selectedDate }),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success("Date opened!", { description: data.message });
        loadGrid(selectedDate);
        loadOpenDates();
      } else {
        toast.error(data.error || "Failed to open date.");
      }
    } catch { toast.error("Network error."); }
    finally  { setOpeningDate(false); }
  }

  async function handleToggleBlock(slot: Slot) {
    if (slot.status !== "BLOCKED" && slot.booked_count > 0) return; // can't block occupied
    setBlockingId(slot.id);
    const action = slot.status === "BLOCKED" ? "unblock" : "block";
    try {
      const res  = await fetch(`/api/v1/scheduling/admin/slots/${slot.id}/${action}`, { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        toast.success(action === "block" ? "Slot blocked." : "Slot unblocked.");
        loadGrid(selectedDate);
      } else {
        toast.error(data.error || `Failed to ${action} slot.`);
      }
    } catch { toast.error("Network error."); }
    finally  { setBlockingId(null); }
  }

  async function handleCancelAll() {
    setCancelling(true);
    try {
      const res  = await fetch("/api/v1/scheduling/admin/cancel-all-scheduled", { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        toast.success("Cancelled", { description: data.message });
        loadGrid(selectedDate);
        loadOpenDates();
        loadStats();
      } else {
        toast.error(data.error || "Failed.");
      }
    } catch { toast.error("Network error."); }
    finally  { setCancelling(false); setShowCancel(false); }
  }

  // ── Derived stats ─────────────────────────────────────────────────────────

  const statCards = stats
    ? [
        { icon: Users,        value: stats.waiting_count,       label: "Waiting in Queue",       color: "text-amber-600",   bg: "bg-amber-50" },
        { icon: CheckCircle,  value: stats.scheduled_today,     label: "Scheduled Today",         color: "text-emerald-600", bg: "bg-emerald-50" },
        { icon: AlertCircle,  value: stats.oldest_waiting_days, label: "Oldest Waiting (days)",   color: "text-red-600",     bg: "bg-red-50" },
      ]
    : [];

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <>
      <TopBar />
      <main className="flex-1 overflow-y-auto bg-background">
        <div className="mx-auto max-w-[1200px] space-y-6 p-6 animate-in-up">

          {/* Header */}
          <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h1 className="flex items-center gap-2 text-2xl font-extrabold tracking-tight">
                <Clock className="h-6 w-6 text-brand" /> Slot Management
              </h1>
              <p className="mt-0.5 text-sm text-muted-foreground">
                Fixed slots: 08:00 – 18:00 · 20 slots/day · 6 citizens/slot
              </p>
            </div>
            {showCancel ? (
              <div className="flex items-center gap-2">
                <span className="text-sm text-red-600 font-medium">Cancel all today's bookings?</span>
                <Button size="sm" variant="outline" onClick={() => setShowCancel(false)}>No</Button>
                <Button size="sm" className="bg-red-600 hover:bg-red-700 text-white" onClick={handleCancelAll} disabled={cancelling}>
                  {cancelling ? "Cancelling…" : "Yes, cancel all"}
                </Button>
              </div>
            ) : (
              <Button size="sm" variant="outline" className="border-red-200 text-red-600 hover:bg-red-50" onClick={() => setShowCancel(true)}>
                <AlertCircle className="h-4 w-4 mr-1" /> Cancel All Today
              </Button>
            )}
          </div>

          {/* Stats */}
          {statCards.length > 0 && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              {statCards.map(s => (
                <Card key={s.label} className="flex items-center gap-3 p-4">
                  <div className={cn("grid h-10 w-10 place-items-center rounded-xl", s.bg)}>
                    <s.icon className={cn("h-5 w-5", s.color)} />
                  </div>
                  <div>
                    <div className="text-2xl font-extrabold tabular-nums">{s.value}</div>
                    <div className="text-xs text-muted-foreground">{s.label}</div>
                  </div>
                </Card>
              ))}
            </div>
          )}

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-4">

            {/* Left panel — date picker + open dates list */}
            <div className="space-y-4 lg:col-span-1">
              <Card className="p-4">
                <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">Select Date</h2>
                <input
                  type="date"
                  value={selectedDate}
                  min={todayIso()}
                  onChange={e => setSelectedDate(e.target.value)}
                  className="w-full rounded-lg border border-input bg-card px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
                />
                <Button
                  className="mt-3 w-full"
                  onClick={handleOpenDate}
                  disabled={openingDate || !selectedDate}
                >
                  <Plus className="mr-2 h-4 w-4" />
                  {openingDate ? "Opening…" : "Open This Date"}
                </Button>
              </Card>

              {/* Open dates list */}
              <Card className="p-4">
                <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                  <Calendar className="h-4 w-4" /> Open Dates
                </h2>
                {openDates.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No upcoming open dates.</p>
                ) : (
                  <ul className="space-y-2">
                    {openDates.map(d => (
                      <li key={d.id}>
                        <button
                          onClick={() => setSelectedDate(d.date)}
                          className={cn(
                            "w-full rounded-lg border px-3 py-2 text-left text-sm transition-colors",
                            selectedDate === d.date
                              ? "border-brand bg-brand/5 font-semibold text-brand"
                              : "border-slate-200 hover:border-brand/40 hover:bg-slate-50"
                          )}
                        >
                          <div className="font-medium">{d.date_label}</div>
                          <div className="text-[11px] text-muted-foreground">
                            {d.booked}/{d.total_capacity} booked · {d.remaining} left
                          </div>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </div>

            {/* Right panel — 20-slot grid */}
            <Card className="p-5 lg:col-span-3">
              {/* Grid header */}
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <h2 className="text-base font-bold">
                    {grid?.date_label ?? selectedDate}
                  </h2>
                  {grid?.has_availability ? (
                    <p className="text-xs text-muted-foreground">
                      {grid.booked_total ?? 0}/{grid.total_capacity ?? 120} booked ·{" "}
                      {grid.blocked_slots ?? 0} blocked ·{" "}
                      {grid.remaining_total ?? 120} remaining
                    </p>
                  ) : (
                    <p className="text-xs text-amber-600">
                      {loadingGrid ? "Loading…" : "Date not open — click \"Open This Date\" to create slots."}
                    </p>
                  )}
                </div>
                <button
                  onClick={() => loadGrid(selectedDate)}
                  className="rounded-lg p-2 hover:bg-muted"
                  title="Refresh"
                >
                  <RefreshCw className={cn("h-4 w-4 text-muted-foreground", loadingGrid && "animate-spin")} />
                </button>
              </div>

              {/* Legend */}
              <div className="mb-4 flex flex-wrap gap-3 text-[11px]">
                {[
                  { cls: "bg-emerald-100 border border-emerald-300", label: "Available" },
                  { cls: "bg-amber-100 border border-amber-300",     label: "Partially booked" },
                  { cls: "bg-red-100 border border-red-300",         label: "Full" },
                  { cls: "bg-slate-100 border border-slate-300",     label: "Blocked" },
                ].map(l => (
                  <span key={l.label} className="flex items-center gap-1">
                    <span className={cn("inline-block h-3 w-3 rounded-sm", l.cls)} />
                    {l.label}
                  </span>
                ))}
                <span className="text-muted-foreground ml-2">Click available/blocked slot to toggle block</span>
              </div>

              {/* Slot grid */}
              {!grid?.has_availability ? (
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {Array.from({ length: 20 }).map((_, i) => (
                    <div key={i} className="flex h-16 items-center justify-center rounded-lg border border-dashed border-slate-200 text-xs text-slate-300">
                      {String(8 + Math.floor(i / 2)).padStart(2, "0")}:{i % 2 === 0 ? "00" : "30"}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {(grid.slots ?? []).map(slot => {
                    const badge     = slotBadge(slot);
                    const canToggle = slot.status === "BLOCKED" || slot.booked_count === 0;
                    const isLoading = blockingId === slot.id;
                    return (
                      <div
                        key={slot.id}
                        onClick={() => canToggle && handleToggleBlock(slot)}
                        className={cn(
                          "relative flex flex-col gap-0.5 rounded-lg border px-3 py-2.5 transition-all",
                          slotColor(slot),
                          !canToggle && "cursor-default",
                          isLoading && "opacity-60 pointer-events-none"
                        )}
                      >
                        {/* Time label */}
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] font-semibold">{slot.start} – {slot.end}</span>
                          {slot.status === "BLOCKED" ? (
                            <Lock    className="h-3 w-3 shrink-0 opacity-60" />
                          ) : (
                            <Unlock  className="h-3 w-3 shrink-0 opacity-30" />
                          )}
                        </div>

                        {/* Capacity bar */}
                        <div className="h-1.5 w-full rounded-full bg-black/10 overflow-hidden">
                          <div
                            className={cn(
                              "h-full rounded-full transition-all",
                              slot.booked_count === slot.max_capacity
                                ? "bg-red-500"
                                : slot.booked_count > 0
                                  ? "bg-amber-500"
                                  : "bg-emerald-500"
                            )}
                            style={{ width: `${(slot.booked_count / slot.max_capacity) * 100}%` }}
                          />
                        </div>

                        {/* Status badge */}
                        <span className={cn("mt-0.5 self-start rounded px-1.5 py-0.5 text-[10px] font-semibold", badge.cls)}>
                          {badge.label}
                        </span>

                        {/* Seat count */}
                        <div className="text-[10px] opacity-70">
                          {slot.booked_count}/{slot.max_capacity} booked
                        </div>

                        {isLoading && (
                          <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-white/60">
                            <RefreshCw className="h-4 w-4 animate-spin text-brand" />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>
          </div>
        </div>
      </main>
    </>
  );
}
