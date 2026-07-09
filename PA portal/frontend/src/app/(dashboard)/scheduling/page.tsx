"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  Users, Clock, CheckCircle2, AlertCircle, CalendarClock, CalendarDays,
  Lock, Unlock, RefreshCw, Plus, Info, ChevronRight, Trash2,
} from "lucide-react";
import { toast } from "sonner";

import TopBar from "@/components/TopBar";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter, DialogClose,
} from "@/components/ui/dialog";
import { useLang } from "@/lib/lang-context";
import { cn } from "@/lib/utils";

// ── Types ────────────────────────────────────────────────────────────────────

interface Slot {
  id: number; slot_number: number; label: string; start: string; end: string;
  status: "AVAILABLE" | "FULL" | "BLOCKED";
  booked_count: number; max_capacity: number; remaining: number; available: boolean;
}
interface SlotGrid {
  has_availability: boolean; availability_id?: number; date?: string; date_label?: string;
  total_slots?: number; total_capacity?: number; booked_total?: number;
  blocked_slots?: number; remaining_total?: number; slots: Slot[];
}
interface OpenDate {
  id: number; date: string; date_label: string; total_slots: number;
  total_capacity: number; booked: number; blocked_slots: number; remaining: number;
}
interface Stats {
  waiting_count: number; scheduled_today: number;
  rescheduled_today: number; oldest_waiting_days: number;
}

const PERSON_OPTIONS = [2, 4, 6, 8, 10, 12, 15, 20];

// ── Helpers ──────────────────────────────────────────────────────────────────

function isAdminClosed(s: Slot): boolean {
  return s.status === "FULL" && s.booked_count < s.max_capacity;
}
type SlotState = "blocked" | "full" | "partial" | "available";
function slotState(s: Slot): SlotState {
  if (s.status === "BLOCKED") return "blocked";
  if (s.status === "FULL" || s.remaining === 0) return "full";
  if (s.booked_count > 0) return "partial";
  return "available";
}
const SLOT_STYLE: Record<SlotState, { tint: string; dot: string; text: string; labelKey: string }> = {
  blocked:   { tint: "border-slate-200 bg-slate-50 hover:border-slate-300",         dot: "bg-slate-400",   text: "text-slate-500",   labelKey: "sched.legendBlocked" },
  full:      { tint: "border-red-200 bg-red-50/40 hover:border-red-300",            dot: "bg-red-500",     text: "text-red-600",     labelKey: "sched.legendFull" },
  partial:   { tint: "border-amber-200 bg-amber-50/50 hover:border-amber-300",      dot: "bg-amber-500",   text: "text-amber-600",   labelKey: "sched.legendPartial" },
  available: { tint: "border-emerald-200 bg-emerald-50/30 hover:border-emerald-300", dot: "bg-emerald-500", text: "text-emerald-600", labelKey: "sched.legendOpen" },
};

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
  const [maxCapacity,  setMaxCapacity]  = useState(12);
  const [availFrom,    setAvailFrom]    = useState("14:00");
  const [availTo,      setAvailTo]      = useState("16:00");

  // ── Data loaders ──────────────────────────────────────────────────────────

  const loadGrid = useCallback(async (d: string, signal?: AbortSignal) => {
    setLoadingGrid(true);
    try {
      const res  = await fetch(`/api/v1/scheduling/admin/slots?target_date=${d}`, { signal });
      if (signal?.aborted) return;
      setGrid(await res.json() as SlotGrid);
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
    } catch (e) { if ((e as Error).name === "AbortError") return; }
  }, []);

  const loadStats = useCallback(async (signal?: AbortSignal) => {
    try {
      const res  = await fetch("/api/v1/scheduling/admin/statistics", { signal });
      if (signal?.aborted) return;
      const data = await res.json();
      if (!data.error) setStats(data);
    } catch (e) { if ((e as Error).name === "AbortError") return; }
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
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mla_id: 1, date: selectedDate, max_capacity: maxCapacity,
          available_from: availFrom, available_to: availTo,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success("Date opened!", { description: data.message });
        loadGrid(selectedDate); loadOpenDates();
      } else toast.error(data.error || "Failed to open date.");
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
        loadGrid(selectedDate); loadStats();
      } else toast.error(data.error || "Failed to auto-allocate.");
    } catch { toast.error("Network error."); }
    finally  { setAllocating(false); setShowAllocate(false); }
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
        loadGrid(selectedDate); loadStats();
      } else toast.error(data.error || `Failed to ${action} slot.`);
    } catch { toast.error("Network error."); }
    finally  { setBlockingId(null); }
  }

  function getSlotDialog(slot: Slot) {
    const { status, booked_count, max_capacity, start, end } = slot;
    const label   = `${start} – ${end}`;
    const counts  = `${booked_count}/${max_capacity} booked`;

    if (status === "BLOCKED") return {
      icon: <Unlock className="h-5 w-5 text-emerald-600" />, title: "Blocked Slot",
      desc: `${label} is currently blocked (${counts}). Unblocking will allow new bookings.`,
      actions: [{ label: "Unblock", action: "unblock" as const, cls: "bg-emerald-600 hover:bg-emerald-700 text-white" }],
    };
    if (status === "FULL" && booked_count < max_capacity) return {
      icon: <Lock className="h-5 w-5 text-orange-600" />, title: "Manually Closed Slot",
      desc: `${label} was closed early (${counts}). Reopen to accept more bookings, or block to relocate existing citizens.`,
      actions: [
        { label: "Reopen", action: "reopen" as const, cls: "bg-emerald-600 hover:bg-emerald-700 text-white" },
        { label: "Block (relocate bookings)", action: "block" as const, cls: "bg-slate-700 hover:bg-slate-800 text-white" },
      ],
    };
    if (status === "FULL" || booked_count >= max_capacity) return {
      icon: <Lock className="h-5 w-5 text-red-600" />, title: "Full Slot",
      desc: `${label} is naturally full (${counts}). Block it to prevent rebooking if a citizen cancels.`,
      actions: [{ label: "Block (prevent rebooking)", action: "block" as const, cls: "bg-slate-700 hover:bg-slate-800 text-white" }],
    };
    if (booked_count > 0) return {
      icon: <AlertCircle className="h-5 w-5 text-amber-600" />, title: "Partially Booked Slot",
      desc: `${label} has ${counts}. Close it to stop new bookings without moving existing citizens, or block it to relocate them.`,
      actions: [
        { label: "Close (stop new bookings)", action: "close" as const, cls: "bg-orange-500 hover:bg-orange-600 text-white" },
        { label: "Block (relocate all)", action: "block" as const, cls: "bg-slate-700 hover:bg-slate-800 text-white" },
      ],
    };
    return {
      icon: <Lock className="h-5 w-5 text-slate-600" />, title: "Block Empty Slot?",
      desc: `${label} has no bookings. It will be blocked and unavailable to citizens.`,
      actions: [{ label: "Block", action: "block" as const, cls: "bg-slate-700 hover:bg-slate-800 text-white" }],
    };
  }

  async function handleCancelAll() {
    setCancelling(true);
    try {
      // The "Cancel All" button now cancels the CURRENTLY SELECTED DATE,
      // not always today. Backend still defaults to today if we omit it,
      // but we always send explicitly so it matches the grid on screen.
      const url = `/api/v1/scheduling/admin/cancel-all-scheduled?target_date=${encodeURIComponent(selectedDate)}`;
      const res  = await fetch(url, { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        toast.success("Cancelled", { description: data.message });
        loadGrid(selectedDate); loadOpenDates(); loadStats();
      } else toast.error(data.error || "Failed.");
    } catch { toast.error("Network error."); }
    finally  { setCancelling(false); setShowCancel(false); }
  }

  // ── Derived stats ─────────────────────────────────────────────────────────

  const statCards = stats
    ? [
        { icon: Users,         value: stats.waiting_count,       label: t("sched.waitingQueue"),         color: "text-amber-600",   bg: "bg-amber-100",   tab: "Waiting" },
        { icon: CheckCircle2,  value: stats.scheduled_today,     label: t("sched.scheduledToday"),       color: "text-emerald-600", bg: "bg-emerald-100", tab: "Scheduled" },
        { icon: CalendarClock, value: stats.rescheduled_today,   label: t("sched.statRescheduledToday"), color: "text-brand",       bg: "bg-accent",      tab: "Rescheduled" },
        { icon: AlertCircle,   value: stats.oldest_waiting_days, label: t("sched.oldestWaiting"),        color: "text-red-600",     bg: "bg-red-100",     tab: null as string | null },
      ]
    : [];

  const cfg = confirmSlot ? getSlotDialog(confirmSlot) : null;
  const dateLabel = grid?.date_label ?? selectedDate;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <>
      <TopBar
        title={t("sched.slotMgmtTitle")}
        subtitle={t("sched.slotMgmtSubtitle")}
        icon={<Clock className="h-5 w-5" />}
      />
      <main className="flex-1 overflow-y-auto bg-background xl:overflow-hidden">
        <div className="mx-auto flex max-w-[1440px] flex-col gap-4 px-4 py-6 animate-in-up xl:h-full">

          {/* Cancel all bookings on the currently selected date. Only shown
              when the date is actually open — after cancel, has_availability
              flips to false and the button hides itself so the PA can't
              re-fire a no-op cancel on an already-closed date. */}
          {grid?.has_availability && (
            <div className="flex shrink-0 items-center justify-end gap-2">
              {showCancel ? (
                <>
                  <span className="text-sm font-semibold text-destructive">
                    {t("sched.cancelAllConfirmFor").replace("{date}", dateLabel)}
                  </span>
                  <Button size="sm" variant="outline" className="rounded-xl" onClick={() => setShowCancel(false)}>{t("sched.no")}</Button>
                  <Button size="sm" className="rounded-xl bg-red-600 text-white hover:bg-red-700" onClick={handleCancelAll} disabled={cancelling}>
                    {cancelling ? t("sched.cancelling") : t("sched.yesCancelAll")}
                  </Button>
                </>
              ) : (
                <Button size="sm" variant="outline" className="h-9 rounded-xl border-red-200 text-red-600 hover:bg-red-50" onClick={() => setShowCancel(true)}>
                  <Trash2 className="h-4 w-4" /> {t("sched.cancelAllFor").replace("{date}", dateLabel)}
                </Button>
              )}
            </div>
          )}

          {/* Stats */}
          {statCards.length > 0 && (
            <div className="grid shrink-0 grid-cols-2 gap-4 lg:grid-cols-4">
              {statCards.map((s) => (
                <Card key={s.label}
                  className={cn("flex items-center gap-3 p-4 shadow-card", s.tab && "cursor-pointer transition-shadow hover:shadow-card-md")}
                  onClick={() => s.tab && router.push(`/appointments?tab=${s.tab}`)}>
                  <span className={cn("grid h-11 w-11 shrink-0 place-items-center rounded-xl", s.bg)}>
                    <s.icon className={cn("h-5 w-5", s.color)} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="font-mono text-[26px] font-bold leading-none tabular-nums text-foreground">{s.value}</div>
                    <div className="mt-1 text-[13px] text-muted-foreground">{s.label}</div>
                  </div>
                  {s.tab === "Waiting" && s.value > 0 && (
                    <Button size="sm" variant="outline" className="ml-auto shrink-0 rounded-lg border-amber-300 text-amber-700 hover:bg-amber-50"
                      disabled={allocating} onClick={(e) => { e.stopPropagation(); setShowAllocate(true); }}>
                      <RefreshCw className={cn("h-3.5 w-3.5", allocating && "animate-spin")} /> {t("sched.allocate")}
                    </Button>
                  )}
                </Card>
              ))}
            </div>
          )}

          {/* Workspace — controls (left) · slot grid (right) */}
          <div className="flex flex-col gap-4 xl:min-h-0 xl:flex-1 xl:flex-row">
            {/* Left controls */}
            <div className="flex flex-col gap-4 xl:w-[340px] xl:shrink-0 xl:min-h-0 xl:overflow-y-auto">
              <Card className="flex flex-col gap-4 p-5 shadow-card-md">
                <div>
                  <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.09em] text-muted-foreground">{t("sched.selectDate")}</label>
                  <Input type="date" value={selectedDate} min={todayIso()}
                    onChange={(e) => setSelectedDate(e.target.value)} className="h-11 rounded-xl text-sm" />
                </div>

                <div>
                  <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.09em] text-muted-foreground">{t("sched.availableWindow")}</label>
                  <div className="flex items-center gap-2">
                    <Input type="time" value={availFrom} onChange={(e) => setAvailFrom(e.target.value)} className="h-11 flex-1 rounded-xl text-sm" />
                    <span className="text-sm text-muted-foreground">–</span>
                    <Input type="time" value={availTo} onChange={(e) => setAvailTo(e.target.value)} className="h-11 flex-1 rounded-xl text-sm" />
                  </div>
                  <p className="mt-2 rounded-lg bg-muted/40 px-3 py-2 text-[12px] text-muted-foreground">{t("sched.windowHint")}</p>
                </div>

                <div>
                  <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.09em] text-muted-foreground">{t("sched.personsPerSlot")}</label>
                  <Select value={String(maxCapacity)} onValueChange={(v) => setMaxCapacity(Number(v))}>
                    <SelectTrigger className="h-11 rounded-xl text-sm">
                      <span className="flex items-center gap-2"><Users className="h-4 w-4 text-muted-foreground" /><SelectValue /></span>
                    </SelectTrigger>
                    <SelectContent>
                      {PERSON_OPTIONS.map((n) => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>

                <Button className="aurora-primary h-11 w-full rounded-xl" onClick={handleOpenDate}
                  disabled={openingDate || !selectedDate || availFrom >= availTo}>
                  <Plus className="mr-1.5 h-4 w-4" /> {openingDate ? t("sched.opening") : t("sched.openThisDate")}
                </Button>
              </Card>

              <Card className="p-5 shadow-card-md">
                <h2 className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.09em] text-muted-foreground">
                  <CalendarDays className="h-4 w-4" /> {t("sched.upcomingOpenDates")}
                </h2>
                {openDates.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t("sched.noOpenDates")}</p>
                ) : (
                  <div className="flex flex-col gap-2">
                    {openDates.map((d) => {
                      const active = selectedDate === d.date;
                      return (
                        <button key={d.id} onClick={() => setSelectedDate(d.date)}
                          className={cn("flex items-center gap-3 rounded-xl border px-3.5 py-3 text-left transition-colors",
                            active ? "border-brand/40 bg-brand/5 ring-1 ring-[#CFE0FB]" : "border-border bg-card hover:bg-muted/50")}>
                          <div className="min-w-0 flex-1">
                            <div className="font-mono text-sm font-semibold text-foreground">{d.date_label}</div>
                            <div className="mt-0.5 text-[12px] text-muted-foreground tabular-nums">
                              {d.booked}/{d.total_capacity} {t("sched.bookedLabel")} · {d.remaining} {t("sched.leftLabel")}
                            </div>
                          </div>
                          <ChevronRight className={cn("h-4 w-4 shrink-0", active ? "text-brand" : "text-muted-foreground/50")} />
                        </button>
                      );
                    })}
                  </div>
                )}
              </Card>
            </div>

            {/* Slot grid */}
            <Card className="flex flex-col p-5 shadow-card-md xl:min-h-0 xl:flex-1">
              <div className="mb-3 flex shrink-0 flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <CalendarDays className="h-5 w-5 text-brand" />
                  <h2 className="type-card-heading text-foreground">{dateLabel}</h2>
                  {grid?.has_availability
                    ? <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">{t("sched.legendOpen")}</span>
                    : <span className="text-[13px] font-medium text-amber-600">{loadingGrid ? t("sched.loadingDots") : t("sched.dateNotOpen")}</span>}
                </div>
                <button onClick={() => loadGrid(selectedDate)}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-card px-3 py-1.5 text-[13px] font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
                  <RefreshCw className={cn("h-3.5 w-3.5", loadingGrid && "animate-spin")} /> {t("sched.refresh")}
                </button>
              </div>

              {/* Legend */}
              <div className="mb-4 flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 text-[12px]">
                {[
                  { cls: "bg-emerald-500", label: t("sched.legendOpen") },
                  { cls: "bg-amber-500",   label: t("sched.legendPartial") },
                  { cls: "bg-red-500",     label: t("sched.legendFull") },
                  { cls: "bg-slate-400",   label: t("sched.legendBlocked") },
                ].map((l) => (
                  <span key={l.label} className="flex items-center gap-1.5 text-muted-foreground">
                    <span className={cn("inline-block h-2.5 w-2.5 rounded-full", l.cls)} /> {l.label}
                  </span>
                ))}
                <span className="text-muted-foreground/70">· {t("sched.clickToManage")}</span>
              </div>

              <div className="xl:min-h-0 xl:flex-1 xl:overflow-y-auto">
                {!grid?.has_availability ? (
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                    {Array.from({ length: 20 }).map((_, i) => {
                      const h = String(8 + Math.floor(i / 2)).padStart(2, "0");
                      const m = i % 2 === 0 ? "00" : "30";
                      const eH = String(8 + Math.floor((i + 1) / 2)).padStart(2, "0");
                      const eM = (i + 1) % 2 === 0 ? "00" : "30";
                      return (
                        <div key={i} className="flex h-24 flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-border text-center text-[12px] text-muted-foreground/40">
                          <span className="font-semibold">{h}:{m} – {eH}:{eM}</span>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                    {(grid.slots ?? []).map((slot) => {
                      const st = SLOT_STYLE[slotState(slot)];
                      const isLoading = blockingId === slot.id;
                      return (
                        <button key={slot.id} onClick={() => setConfirmSlot(slot)}
                          className={cn("relative flex flex-col gap-2 rounded-xl border p-3.5 text-left transition-all", st.tint, isLoading && "pointer-events-none opacity-60")}>
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-semibold text-foreground">{slot.start} – {slot.end}</span>
                            {slot.status === "BLOCKED" ? <Lock className="h-3.5 w-3.5 text-slate-400" />
                              : isAdminClosed(slot) ? <Lock className="h-3.5 w-3.5 text-red-500" />
                              : <Unlock className="h-3.5 w-3.5 text-muted-foreground/30" />}
                          </div>
                          <div className="flex items-center gap-1.5">
                            <span className={cn("h-2 w-2 rounded-full", st.dot)} />
                            <span className={cn("text-[13px] font-semibold", st.text)}>{t(st.labelKey)}</span>
                          </div>
                          <div className="text-[12px] tabular-nums text-muted-foreground">
                            {slot.booked_count} / {slot.max_capacity} {t("sched.bookedLabel")}
                          </div>
                          {isLoading && (
                            <div className="absolute inset-0 grid place-items-center rounded-xl bg-white/60">
                              <RefreshCw className="h-4 w-4 animate-spin text-brand" />
                            </div>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </Card>
          </div>

          {/* Note */}
          <div className="flex shrink-0 items-center gap-2 rounded-xl border border-border bg-muted/30 px-4 py-3 text-[13px] text-muted-foreground">
            <Info className="h-4 w-4 shrink-0 text-brand" /> {t("sched.note")}
          </div>
        </div>
      </main>

      {/* Smart slot action dialog */}
      <Dialog open={confirmSlot !== null} onOpenChange={(o) => { if (!o) setConfirmSlot(null); }}>
        <DialogContent className="w-[calc(100%-2rem)] sm:max-w-lg">
          <DialogHeader className="space-y-3">
            <DialogTitle className="flex items-center gap-2">{cfg?.icon} {cfg?.title}</DialogTitle>
            <DialogDescription className="leading-relaxed">{cfg?.desc}</DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
            <DialogClose asChild>
              <Button variant="outline" size="sm" className="w-full sm:w-auto">{t("sched.cancel")}</Button>
            </DialogClose>
            {cfg?.actions.map((a) => (
              <Button key={a.action} size="sm" className={cn("w-full sm:w-auto", a.cls)} onClick={() => dispatchSlotAction(a.action)}>
                {a.label}
              </Button>
            ))}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Auto-allocate confirmation dialog */}
      <Dialog open={showAllocate} onOpenChange={(o) => { if (!o) setShowAllocate(false); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <RefreshCw className="h-5 w-5 text-amber-600" /> {t("sched.allocateTitle")}
            </DialogTitle>
            <DialogDescription>{t("sched.allocateConfirm")}</DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <DialogClose asChild><Button variant="outline" size="sm">{t("sched.cancel")}</Button></DialogClose>
            <Button size="sm" className="bg-amber-600 text-white hover:bg-amber-700" disabled={allocating} onClick={handleAutoAllocate}>
              {allocating ? t("sched.allocating") : t("sched.allocateYes")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
