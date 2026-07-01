"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  Calendar, Users, Clock, CheckCircle, AlertCircle,
  Lock, Unlock, RefreshCw, Plus, CalendarClock,
} from "lucide-react";
import { toast } from "sonner";

import TopBar from "@/components/TopBar";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter, DialogClose,
} from "@/components/ui/dialog";
import { useLang } from "@/lib/lang-context";
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
  rescheduled_today: number;
  oldest_waiting_days: number;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function isAdminClosed(s: Slot): boolean {
  return s.status === "FULL" && s.booked_count < s.max_capacity;
}

function slotColor(s: Slot): string {
  if (s.status === "BLOCKED")   return "border-slate-300 bg-slate-100 text-slate-400 hover:bg-slate-200 cursor-pointer";
  if (s.status === "FULL")      return "border-red-400 bg-red-50 text-red-700 hover:bg-red-100 cursor-pointer";
  if (s.booked_count === 0)     return "border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100 cursor-pointer";
  if (s.remaining === 0)        return "border-red-400 bg-red-50 text-red-700 hover:bg-red-100 cursor-pointer";
  return "border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100 cursor-pointer";
}

function slotBadge(s: Slot, t: (k: string) => string): { label: string; cls: string } {
  if (s.status === "BLOCKED")  return { label: t("sched.badgeBlocked"), cls: "bg-slate-200 text-slate-500" };
  if (isAdminClosed(s))        return { label: t("sched.badgeClosed"),  cls: "bg-red-100 text-red-700 ring-1 ring-red-300" };
  if (s.remaining === 0)       return { label: t("sched.badgeFull"),    cls: "bg-red-100 text-red-600" };
  if (s.booked_count > 0)      return { label: `${s.remaining} ${t("sched.leftLabel")}`, cls: "bg-amber-100 text-amber-700" };
  return                              { label: t("sched.badgeOpen"),    cls: "bg-emerald-100 text-emerald-700" };
}

function todayIso(): string {
  return new Date().toISOString().split("T")[0];
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function SchedulingPage() {
  const { t } = useLang();
  const router = useRouter();

  const [selectedDate, setSelectedDate] = useState(todayIso());
  const [grid,         setGrid]         = useState<SlotGrid | null>(null);
  const [openDates,    setOpenDates]    = useState<OpenDate[]>([]);
  const [stats,        setStats]        = useState<Stats | null>(null);
  const [loadingGrid,  setLoadingGrid]  = useState(false);
  const [openingDate,  setOpeningDate]  = useState(false);
  const [blockingId,   setBlockingId]   = useState<number | null>(null);
  const [showCancel,   setShowCancel]   = useState(false);
  const [cancelling,   setCancelling]   = useState(false);
  const [confirmSlot,  setConfirmSlot]  = useState<Slot | null>(null);
  const [showAllocate, setShowAllocate] = useState(false);
  const [allocating,   setAllocating]   = useState(false);
  const [maxCapacity,  setMaxCapacity]  = useState(6);
  const [availFrom,    setAvailFrom]    = useState("14:00");
  const [availTo,      setAvailTo]      = useState("16:00");

  // ── Data loaders ──────────────────────────────────────────────────────────

  const loadGrid = useCallback(async (d: string, signal?: AbortSignal) => {
    setLoadingGrid(true);
    try {
      const res  = await fetch(`/api/v1/scheduling/admin/slots?target_date=${d}`, { signal });
      if (signal?.aborted) return;
      const data = await res.json() as SlotGrid;
      setGrid(data);
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      toast.error("Failed to load slot grid.");
    } finally {
      if (!signal?.aborted) setLoadingGrid(false);
    }
  }, []);

  const loadOpenDates = useCallback(async (signal?: AbortSignal) => {
    try {
      const res  = await fetch("/api/v1/scheduling/admin/dates", { signal });
      if (signal?.aborted) return;
      const data = await res.json();
      if (Array.isArray(data)) setOpenDates(data);
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
    }
  }, []);

  const loadStats = useCallback(async (signal?: AbortSignal) => {
    try {
      const res  = await fetch("/api/v1/scheduling/admin/statistics", { signal });
      if (signal?.aborted) return;
      const data = await res.json();
      if (!data.error) setStats(data);
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
    }
  }, []);

  // One controller per effect run — cancels all three loaders together.
  const ctrlRef = useRef<AbortController | null>(null);
  useEffect(() => {
    ctrlRef.current?.abort();
    const ctrl = new AbortController();
    ctrlRef.current = ctrl;
    loadGrid(selectedDate, ctrl.signal);
    loadOpenDates(ctrl.signal);
    loadStats(ctrl.signal);
    return () => ctrl.abort();
  }, [selectedDate, loadGrid, loadOpenDates, loadStats]);

  // ── Actions ───────────────────────────────────────────────────────────────

  async function handleOpenDate() {
    setOpeningDate(true);
    try {
      const res  = await fetch("/api/v1/scheduling/admin/open-date", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mla_id: 1,
          date: selectedDate,
          max_capacity: maxCapacity,
          available_from: availFrom,
          available_to: availTo,
        }),
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

  async function handleAutoAllocate() {
    setAllocating(true);
    try {
      const res  = await fetch("/api/v1/scheduling/admin/auto-allocate", { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        toast.success("Auto-allocate complete", {
          description: `${data.allocated} allocated, ${data.remaining_in_queue} remaining in queue.`,
        });
        loadGrid(selectedDate);
        loadStats();
      } else {
        toast.error(data.error || "Failed to auto-allocate.");
      }
    } catch { toast.error("Network error."); }
    finally  { setAllocating(false); setShowAllocate(false); }
  }

  function onSlotClick(slot: Slot) {
    setConfirmSlot(slot);
  }

  async function dispatchSlotAction(action: "block" | "unblock" | "close" | "reopen") {
    if (!confirmSlot) return;
    const slot = confirmSlot;
    setConfirmSlot(null);
    setBlockingId(slot.id);
    try {
      const res  = await fetch(`/api/v1/scheduling/admin/slots/${slot.id}/${action}`, { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        const messages: Record<string, string> = {
          block:   "Slot blocked. Existing bookings moved to queue or other slots.",
          unblock: "Slot unblocked.",
          close:   "Slot closed — no new bookings accepted.",
          reopen:  "Slot reopened for new bookings.",
        };
        toast.success(messages[action] ?? "Done.");
        loadGrid(selectedDate);
        loadStats();
      } else {
        toast.error(data.error || `Failed to ${action} slot.`);
      }
    } catch { toast.error("Network error."); }
    finally  { setBlockingId(null); }
  }

  function getSlotDialog(slot: Slot) {
    const { status, booked_count, max_capacity, start, end } = slot;
    const label   = `${start} – ${end}`;
    const counts  = `${booked_count}/${max_capacity} booked`;

    if (status === "BLOCKED") return {
      icon:    <Unlock className="h-5 w-5 text-emerald-600" />,
      title:   "Blocked Slot",
      desc:    `${label} is currently blocked (${counts}). Unblocking will allow new bookings.`,
      actions: [{ label: "Unblock", action: "unblock" as const, cls: "bg-emerald-600 hover:bg-emerald-700 text-white" }],
    };
    if (status === "FULL" && booked_count < max_capacity) return {
      icon:    <Lock className="h-5 w-5 text-orange-600" />,
      title:   "Manually Closed Slot",
      desc:    `${label} was closed early (${counts}). Reopen to accept more bookings, or block to relocate existing citizens.`,
      actions: [
        { label: "Reopen", action: "reopen" as const, cls: "bg-emerald-600 hover:bg-emerald-700 text-white" },
        { label: "Block (relocate bookings)", action: "block" as const, cls: "bg-slate-700 hover:bg-slate-800 text-white" },
      ],
    };
    if (status === "FULL" || booked_count >= max_capacity) return {
      icon:    <Lock className="h-5 w-5 text-red-600" />,
      title:   "Full Slot",
      desc:    `${label} is naturally full (${counts}). Block it to prevent rebooking if a citizen cancels.`,
      actions: [
        { label: "Block (prevent rebooking)", action: "block" as const, cls: "bg-slate-700 hover:bg-slate-800 text-white" },
      ],
    };
    if (booked_count > 0) return {
      icon:    <AlertCircle className="h-5 w-5 text-amber-600" />,
      title:   "Partially Booked Slot",
      desc:    `${label} has ${counts}. Close it to stop new bookings without moving existing citizens, or block it to relocate them.`,
      actions: [
        { label: "Close (stop new bookings)", action: "close" as const, cls: "bg-orange-500 hover:bg-orange-600 text-white" },
        { label: "Block (relocate all)", action: "block" as const, cls: "bg-slate-700 hover:bg-slate-800 text-white" },
      ],
    };
    return {
      icon:    <Lock className="h-5 w-5 text-slate-600" />,
      title:   "Block Empty Slot?",
      desc:    `${label} has no bookings. It will be blocked and unavailable to citizens.`,
      actions: [
        { label: "Block", action: "block" as const, cls: "bg-slate-700 hover:bg-slate-800 text-white" },
      ],
    };
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
        { icon: Users,         value: stats.waiting_count,        label: t("sched.waitingQueue"),         color: "text-amber-600",   bg: "bg-amber-50",   tab: "Waiting" },
        { icon: CheckCircle,   value: stats.scheduled_today,      label: t("sched.scheduledToday"),       color: "text-emerald-600", bg: "bg-emerald-50", tab: "Scheduled" },
        { icon: CalendarClock, value: stats.rescheduled_today,    label: t("sched.statRescheduledToday"), color: "text-violet-600",  bg: "bg-violet-50",  tab: "Rescheduled" },
        { icon: AlertCircle,   value: stats.oldest_waiting_days,  label: t("sched.oldestWaiting"),        color: "text-red-600",     bg: "bg-red-50",     tab: null },
      ]
    : [];

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <>
      <TopBar
        title={t("sched.slotMgmtTitle")}
        subtitle={t("sched.slotMgmtSubtitle")}
        icon={<Clock className="h-5 w-5" />}
      />
      <main className="flex-1 overflow-y-auto bg-background">
        <div className="mx-auto max-w-[1200px] space-y-6 p-6 animate-in-up">

          {/* Page actions row */}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
            {showCancel ? (
              <div className="flex items-center gap-2">
                <span className="text-base font-medium text-red-600">{t("sched.cancelAllConfirm")}</span>
                <Button size="sm" variant="outline" onClick={() => setShowCancel(false)}>{t("sched.no")}</Button>
                <Button size="sm" className="bg-red-600 hover:bg-red-700 text-white" onClick={handleCancelAll} disabled={cancelling}>
                  {cancelling ? t("sched.cancelling") : t("sched.yesCancelAll")}
                </Button>
              </div>
            ) : (
              <Button size="sm" variant="outline" className="border-red-200 text-red-600 hover:bg-red-50" onClick={() => setShowCancel(true)}>
                <AlertCircle className="h-4 w-4 mr-1" /> {t("sched.cancelAllToday")}
              </Button>
            )}
          </div>

          {/* Stats */}
          {statCards.length > 0 && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {statCards.map(s => (
                <Card
                  key={s.label}
                  className={cn("flex items-center gap-3 p-4", s.tab && "cursor-pointer hover:shadow-md transition-shadow")}
                  onClick={() => s.tab && router.push(`/appointments?tab=${s.tab}`)}
                >
                  <div className={cn("grid h-11 w-11 place-items-center rounded-xl", s.bg)}>
                    <s.icon className={cn("h-5 w-5", s.color)} />
                  </div>
                  <div className="flex-1">
                    <div className="text-[26px] font-extrabold leading-none tabular-nums">{s.value}</div>
                    <div className="mt-1 text-sm text-muted-foreground">{s.label}</div>
                  </div>
                  {s.label === t("sched.waitingQueue") && s.value > 0 && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="ml-auto border-amber-300 text-amber-700 hover:bg-amber-50"
                      disabled={allocating}
                      onClick={(e) => { e.stopPropagation(); setShowAllocate(true); }}
                    >
                      <RefreshCw className={cn("h-3.5 w-3.5 mr-1", allocating && "animate-spin")} />
                      {t("sched.allocate")}
                    </Button>
                  )}
                </Card>
              ))}
            </div>
          )}

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-4">

            {/* Left panel — date picker + open dates list */}
            <div className="space-y-4 lg:col-span-1">
              <Card className="p-5 space-y-4">
                <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">{t("sched.selectDate")}</h2>

                <input
                  type="date"
                  value={selectedDate}
                  min={todayIso()}
                  onChange={e => setSelectedDate(e.target.value)}
                  className="w-full rounded-lg border border-input bg-card px-3 py-2 text-base focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
                />

                <div>
                  <label className="mb-1.5 block text-[13px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {t("sched.availableWindow")}
                  </label>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="time"
                      value={availFrom}
                      onChange={e => setAvailFrom(e.target.value)}
                      className="flex-1 rounded-lg border border-input bg-card px-2 py-1.5 text-sm focus:border-brand focus:outline-none"
                    />
                    <span className="text-sm text-muted-foreground">–</span>
                    <input
                      type="time"
                      value={availTo}
                      onChange={e => setAvailTo(e.target.value)}
                      className="flex-1 rounded-lg border border-input bg-card px-2 py-1.5 text-sm focus:border-brand focus:outline-none"
                    />
                  </div>
                  <p className="mt-1.5 text-xs text-muted-foreground">{t("sched.windowHint")}</p>
                </div>

                <div>
                  <label className="mb-1.5 block text-[13px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {t("sched.personsPerSlot")}
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={maxCapacity}
                    onChange={e => setMaxCapacity(Math.max(1, Math.min(100, Number(e.target.value))))}
                    className="w-full rounded-lg border border-input bg-card px-3 py-1.5 text-base focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
                  />
                </div>

                <Button
                  className="w-full"
                  onClick={handleOpenDate}
                  disabled={openingDate || !selectedDate || availFrom >= availTo}
                >
                  <Plus className="mr-2 h-4 w-4" />
                  {openingDate ? t("sched.opening") : t("sched.openThisDate")}
                </Button>
              </Card>

              <Card className="p-5">
                <h2 className="mb-3 flex items-center gap-1 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                  <Calendar className="h-4 w-4" /> {t("sched.openDates")}
                </h2>
                {openDates.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t("sched.noOpenDates")}</p>
                ) : (
                  <ul className="space-y-2">
                    {openDates.map(d => (
                      <li key={d.id}>
                        <button
                          onClick={() => setSelectedDate(d.date)}
                          className={cn(
                            "w-full rounded-lg border px-3 py-2 text-left text-base transition-colors",
                            selectedDate === d.date
                              ? "border-brand bg-brand/5 font-semibold text-brand"
                              : "border-slate-200 hover:border-brand/40 hover:bg-slate-50"
                          )}
                        >
                          <div className="font-medium">{d.date_label}</div>
                          <div className="text-[13px] text-muted-foreground">
                            {d.booked}/{d.total_capacity} {t("sched.bookedLabel")} · {d.remaining} {t("sched.leftLabel")}
                          </div>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </div>

            {/* Right panel — 20-slot grid */}
            <Card className="p-6 lg:col-span-3">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-bold">
                    {grid?.date_label ?? selectedDate}
                  </h2>
                  {grid?.has_availability ? (
                    <p className="text-sm text-muted-foreground">
                      {grid.booked_total ?? 0}/{grid.total_capacity ?? 120} {t("sched.bookedLabel")} ·{" "}
                      {grid.blocked_slots ?? 0} {t("sched.blockedLabel")} ·{" "}
                      {grid.remaining_total ?? 120} {t("sched.remainingLabel")}
                    </p>
                  ) : (
                    <p className="text-sm text-amber-600">
                      {loadingGrid ? t("sched.loadingDots") : t("sched.dateNotOpen")}
                    </p>
                  )}
                </div>
                <button
                  onClick={() => loadGrid(selectedDate)}
                  className="rounded-lg p-2 hover:bg-muted"
                  title={t("sched.refresh")}
                  aria-label={t("sched.refresh")}
                >
                  <RefreshCw className={cn("h-4 w-4 text-muted-foreground", loadingGrid && "animate-spin")} />
                </button>
              </div>

              {/* Legend */}
              <div className="mb-4 flex flex-wrap gap-3 text-[13px]">
                {[
                  { cls: "bg-emerald-100 border border-emerald-300", label: t("sched.legendOpen") },
                  { cls: "bg-amber-100 border border-amber-300",     label: t("sched.legendPartial") },
                  { cls: "bg-red-100 border border-red-400",         label: t("sched.legendFull") },
                  { cls: "bg-slate-100 border border-slate-300",     label: t("sched.legendBlocked") },
                ].map(l => (
                  <span key={l.label} className="flex items-center gap-1">
                    <span className={cn("inline-block h-3 w-3 rounded-sm", l.cls)} />
                    {l.label}
                  </span>
                ))}
                <span className="text-muted-foreground ml-2">{t("sched.clickToManage")}</span>
              </div>

              {!grid?.has_availability ? (
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {Array.from({ length: 20 }).map((_, i) => (
                    <div key={i} className="flex h-16 items-center justify-center rounded-lg border border-dashed border-slate-200 text-sm text-slate-300">
                      {String(8 + Math.floor(i / 2)).padStart(2, "0")}:{i % 2 === 0 ? "00" : "30"}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-4">
                  {(grid.slots ?? []).map(slot => {
                    const badge     = slotBadge(slot, t);
                    const canToggle = slot.status === "BLOCKED" || slot.status === "AVAILABLE" || slot.status === "FULL" || slot.booked_count >= 0;
                    const isLoading = blockingId === slot.id;
                    return (
                      <div
                        key={slot.id}
                        onClick={() => canToggle && onSlotClick(slot)}
                        className={cn(
                          "relative flex flex-col gap-1 rounded-lg border px-3 py-2.5 transition-all",
                          slotColor(slot),
                          !canToggle && "cursor-default",
                          isLoading && "opacity-60 pointer-events-none"
                        )}
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-[13px] font-semibold">{slot.start} – {slot.end}</span>
                          {slot.status === "BLOCKED"
                            ? <Lock className="h-3.5 w-3.5 shrink-0 opacity-60" />
                            : isAdminClosed(slot)
                              ? <Lock className="h-3.5 w-3.5 shrink-0 text-red-500 opacity-80" />
                              : <Unlock className="h-3.5 w-3.5 shrink-0 opacity-30" />}
                        </div>

                        <div className="h-1.5 w-full rounded-full bg-black/10 overflow-hidden">
                          <div
                            className={cn(
                              "h-full rounded-full transition-all",
                              slot.status === "FULL" || slot.remaining === 0
                                ? "bg-red-500"
                                : slot.booked_count > 0
                                  ? "bg-amber-500"
                                  : "bg-emerald-500"
                            )}
                            style={{ width: `${(slot.booked_count / slot.max_capacity) * 100}%` }}
                          />
                        </div>

                        <span className={cn("mt-0.5 self-start rounded px-1.5 py-0.5 text-xs font-semibold", badge.cls)}>
                          {badge.label}
                        </span>

                        <div className="text-xs opacity-70">
                          {slot.booked_count}/{slot.max_capacity} {t("sched.bookedLabel")}
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

      {/* Smart slot action dialog */}
      {(() => {
        const cfg = confirmSlot ? getSlotDialog(confirmSlot) : null;
        return (
          <Dialog open={confirmSlot !== null} onOpenChange={(o) => { if (!o) setConfirmSlot(null); }}>
            <DialogContent className="w-[calc(100%-2rem)] sm:max-w-lg">
              <DialogHeader className="space-y-3">
                <DialogTitle className="flex items-center gap-2">
                  {cfg?.icon} {cfg?.title}
                </DialogTitle>
                <DialogDescription className="leading-relaxed">{cfg?.desc}</DialogDescription>
              </DialogHeader>
              <DialogFooter className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
                <DialogClose asChild>
                  <Button variant="outline" size="sm" className="w-full sm:w-auto">{t("sched.cancel")}</Button>
                </DialogClose>
                {cfg?.actions.map(a => (
                  <Button
                    key={a.action}
                    size="sm"
                    className={cn("w-full sm:w-auto", a.cls)}
                    onClick={() => dispatchSlotAction(a.action)}
                  >
                    {a.label}
                  </Button>
                ))}
              </DialogFooter>
            </DialogContent>
          </Dialog>
        );
      })()}

      {/* Auto-allocate confirmation dialog */}
      <Dialog open={showAllocate} onOpenChange={(o) => { if (!o) setShowAllocate(false); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <RefreshCw className="h-5 w-5 text-amber-600" /> {t("sched.allocateTitle")}
            </DialogTitle>
            <DialogDescription>
              {t("sched.allocateConfirm")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <DialogClose asChild>
              <Button variant="outline" size="sm">{t("sched.cancel")}</Button>
            </DialogClose>
            <Button
              size="sm"
              className="bg-amber-600 hover:bg-amber-700 text-white"
              disabled={allocating}
              onClick={handleAutoAllocate}
            >
              {allocating ? t("sched.allocating") : t("sched.allocateYes")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
