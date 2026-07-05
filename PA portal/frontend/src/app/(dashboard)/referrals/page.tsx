"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  UserPlus, RefreshCw, Plus, QrCode, Lock, Unlock, Users, CalendarDays,
  ExternalLink, ChevronRight, Download, CalendarPlus,
} from "lucide-react";
import { toast } from "sonner";

import TopBar from "@/components/TopBar";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose,
} from "@/components/ui/dialog";
import { useLang } from "@/lib/lang-context";
import { cn, formatDateTime } from "@/lib/utils";

// ── Types ────────────────────────────────────────────────────────────────────
interface Slot {
  id: number; slot_number: number; label: string; start: string; end: string;
  status: "AVAILABLE" | "FULL" | "BLOCKED";
  booked_count: number; max_capacity: number; remaining: number; available: boolean;
}
interface SlotGrid {
  has_availability: boolean; date?: string; date_label?: string;
  total_slots?: number; total_capacity?: number; booked_total?: number;
  blocked_slots?: number; remaining_total?: number; slots: Slot[];
}
interface OpenDate { id: number; date: string; date_label: string; total_capacity: number; booked: number; remaining: number; }
interface Booking {
  id: number; token: string; name: string; mobile: string | null;
  num_persons: number; referred_by: string; reason: string;
  slot: string; booked_at: string | null; status?: string;
}
interface QrData { qr_url: string; date: string; date_label: string; }

const PERSON_OPTIONS = [2, 4, 6, 8, 10, 12, 15, 20];

function todayIso() { return new Date().toISOString().split("T")[0]; }

// admin-closed = FULL but seats remain
function isAdminClosed(s: Slot) { return s.status === "FULL" && s.booked_count < s.max_capacity; }

/** Container tint for a slot card, keyed on its live state. */
function slotColor(s: Slot): string {
  if (s.status === "BLOCKED") return "border-slate-200 bg-slate-50 hover:border-slate-300";
  if (s.status === "FULL" || s.remaining === 0) return "border-red-200 bg-red-50/50 hover:border-red-300";
  if (s.booked_count === 0) return "border-emerald-200 bg-emerald-50/40 hover:border-emerald-300";
  return "border-amber-200 bg-amber-50/50 hover:border-amber-300";
}
function slotBadge(s: Slot, t: (k: string) => string): { label: string; cls: string } {
  if (s.status === "BLOCKED") return { label: t("ref.slotBlocked"), cls: "text-slate-500" };
  if (isAdminClosed(s))       return { label: t("ref.slotClosed"),  cls: "text-red-600" };
  if (s.remaining === 0)      return { label: t("ref.slotFull"),    cls: "text-red-600" };
  if (s.booked_count > 0)     return { label: `${s.remaining} ${t("ref.slotLeft")}`, cls: "text-amber-600" };
  return                             { label: t("ref.slotOpen"),    cls: "text-emerald-600" };
}
function barColor(s: Slot): string {
  if (s.status === "BLOCKED") return "bg-slate-400";
  if (s.status === "FULL" || s.remaining === 0) return "bg-red-500";
  if (s.booked_count > 0) return "bg-amber-500";
  return "bg-emerald-500";
}

function bookingStatus(status: string | undefined, t: (k: string) => string): { label: string; cls: string } {
  switch ((status || "").toUpperCase()) {
    case "CAME":     return { label: t("ref.stCame"),    cls: "bg-emerald-100 text-emerald-700" };
    case "NOT_CAME": return { label: t("ref.stNotCame"), cls: "bg-red-100 text-red-700" };
    default:         return { label: t("ref.stPending"), cls: "bg-slate-100 text-slate-600" };
  }
}

export default function ReferralsPage() {
  const { t, lang } = useLang();
  const [selectedDate, setSelectedDate] = useState(todayIso());
  const [grid, setGrid]         = useState<SlotGrid | null>(null);
  const [openDates, setOpenDates] = useState<OpenDate[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [qr, setQr]             = useState<QrData | null>(null);
  const [loadingGrid, setLoadingGrid] = useState(false);
  const [opening, setOpening]   = useState(false);
  const [maxCapacity, setMaxCapacity] = useState(6);
  const [confirmSlot, setConfirmSlot] = useState<Slot | null>(null);
  const [busyId, setBusyId]     = useState<number | null>(null);

  const qrBoxRef = useRef<HTMLDivElement | null>(null);
  const dateInputRef = useRef<HTMLInputElement | null>(null);

  // ── Loaders ─────────────────────────────────────────────────────────────────
  const loadGrid = useCallback(async (d: string) => {
    setLoadingGrid(true);
    try {
      const res = await fetch(`/api/v1/referral/admin/slots?target_date=${d}`);
      setGrid(await res.json() as SlotGrid);
    } catch { toast.error("Failed to load slots."); }
    finally { setLoadingGrid(false); }
  }, []);
  const loadOpenDates = useCallback(async () => {
    try { const r = await fetch("/api/v1/referral/admin/dates"); const d = await r.json(); if (Array.isArray(d)) setOpenDates(d); } catch {}
  }, []);
  const loadBookings = useCallback(async (d: string) => {
    try { const r = await fetch(`/api/v1/referral/admin/bookings?target_date=${d}`); const data = await r.json(); if (Array.isArray(data)) setBookings(data); } catch {}
  }, []);
  const loadQr = useCallback(async () => {
    try { const r = await fetch("/api/v1/referral/admin/qr"); const d = await r.json(); if (!d.error) setQr(d); } catch {}
  }, []);

  useEffect(() => { loadGrid(selectedDate); loadBookings(selectedDate); }, [selectedDate, loadGrid, loadBookings]);
  useEffect(() => { loadOpenDates(); loadQr(); }, [loadOpenDates, loadQr]);

  // ── Render QR client-side via qrcodejs CDN ──────────────────────────────────
  useEffect(() => {
    if (!qr?.qr_url || !qrBoxRef.current) return;
    const box = qrBoxRef.current;
    const render = () => {
      box.innerHTML = "";
      // @ts-expect-error — global from CDN script
      if (window.QRCode) {
        // @ts-expect-error — global
        new window.QRCode(box, { text: qr.qr_url, width: 160, height: 160, correctLevel: window.QRCode.CorrectLevel.M });
      }
    };
    // @ts-expect-error — global
    if (window.QRCode) { render(); return; }
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js";
    s.onload = render;
    document.body.appendChild(s);
  }, [qr?.qr_url]);

  // ── Actions ─────────────────────────────────────────────────────────────────
  async function handleOpenDate() {
    setOpening(true);
    try {
      const res = await fetch("/api/v1/referral/admin/open-date", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: selectedDate, max_capacity: maxCapacity }),
      });
      const d = await res.json();
      if (res.ok) { toast.success("Date opened", { description: d.message }); loadGrid(selectedDate); loadOpenDates(); }
      else toast.error(d.error || "Failed to open date.");
    } catch { toast.error("Network error."); }
    finally { setOpening(false); }
  }

  async function dispatchAction(action: "block" | "unblock" | "close" | "reopen") {
    if (!confirmSlot) return;
    const slot = confirmSlot; setConfirmSlot(null); setBusyId(slot.id);
    try {
      const res = await fetch(`/api/v1/referral/admin/slots/${slot.id}/${action}`, { method: "POST" });
      const d = await res.json();
      if (res.ok) { toast.success(`Slot ${action}ed.`); loadGrid(selectedDate); loadBookings(selectedDate); }
      else toast.error(d.error || `Failed to ${action}.`);
    } catch { toast.error("Network error."); }
    finally { setBusyId(null); }
  }

  function focusOpenDate() {
    dateInputRef.current?.focus();
    dateInputRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function exportBookings() {
    if (!bookings.length) { toast.error("No bookings to export."); return; }
    const headers = ["Token", "Name", "Mobile", "Persons", "Referred by", "Reason", "Slot", "Booked at", "Status"];
    const lines = bookings.map((b) => [
      b.token, b.name, b.mobile ?? "", b.num_persons, b.referred_by, b.reason, b.slot,
      b.booked_at ?? "", bookingStatus(b.status, t).label,
    ]);
    const csv = [headers, ...lines].map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = "data:text/csv;charset=utf-8," + encodeURIComponent(csv);
    a.download = `referral_bookings_${selectedDate}.csv`;
    a.click();
  }

  function getDialog(slot: Slot) {
    const lbl = `${slot.start} – ${slot.end}`;
    const counts = `${slot.booked_count}/${slot.max_capacity} booked`;
    const block = { key: "ref.actBlock", action: "block" as const, cls: "bg-slate-700 hover:bg-slate-800 text-white" };
    if (slot.status === "BLOCKED") return {
      titleKey: "ref.dlgBlocked", desc: `${lbl} is blocked (${counts}). Unblock to allow bookings.`,
      actions: [{ key: "ref.actUnblock", action: "unblock" as const, cls: "bg-emerald-600 hover:bg-emerald-700 text-white" }],
    };
    if (slot.status === "FULL" && slot.booked_count < slot.max_capacity) return {
      titleKey: "ref.dlgClosed", desc: `${lbl} was closed early (${counts}). Reopen or block it.`,
      actions: [{ key: "ref.actReopen", action: "reopen" as const, cls: "bg-emerald-600 hover:bg-emerald-700 text-white" }, block],
    };
    if (slot.status === "FULL" || slot.booked_count >= slot.max_capacity) return {
      titleKey: "ref.dlgFull", desc: `${lbl} is full (${counts}). Block it to prevent rebooking.`,
      actions: [block],
    };
    if (slot.booked_count > 0) return {
      titleKey: "ref.dlgPartial", desc: `${lbl} has ${counts}. Close it (stop new bookings) or block it.`,
      actions: [{ key: "ref.actClose", action: "close" as const, cls: "bg-orange-500 hover:bg-orange-600 text-white" }, block],
    };
    return {
      titleKey: "ref.dlgBlock", desc: `${lbl} has no bookings. Block it from citizens.`,
      actions: [block],
    };
  }

  const dlg = confirmSlot ? getDialog(confirmSlot) : null;
  const dateLabel = grid?.date_label ?? selectedDate;

  return (
    <>
      <TopBar
        title={t("ref.title")}
        subtitle={t("ref.topSubtitle")}
        icon={<UserPlus className="h-5 w-5" />}
      />
      <main className="flex-1 overflow-y-auto bg-background xl:overflow-hidden">
        <div className="mx-auto flex max-w-[1440px] flex-col gap-4 px-4 py-6 animate-in-up xl:h-full">
          <p className="shrink-0 text-sm text-muted-foreground">{t("ref.subtitle")}</p>

          {/* Top row — QR · Open a date · Open dates */}
          <div className="grid shrink-0 grid-cols-1 gap-4 lg:grid-cols-3">
            {/* QR card */}
            <Card className="flex flex-col p-5 shadow-card-md">
              <CardHead icon={QrCode} title={t("ref.qrTitle")} sub={t("ref.qrSubtitle")} />
              <div className="flex flex-1 flex-col items-center justify-center gap-3 pt-4">
                <div ref={qrBoxRef} className="grid h-[160px] w-[160px] place-items-center rounded-xl border border-border bg-white p-2 shadow-card">
                  {!qr && <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />}
                </div>
                <div className="text-center">
                  <div className="font-mono text-sm font-bold text-foreground">{qr?.date_label ?? "—"}</div>
                  <div className="mt-0.5 text-[12px] text-muted-foreground">{t("ref.qrResets")}</div>
                </div>
                {qr?.qr_url && (
                  <a href={qr.qr_url} target="_blank" rel="noreferrer"
                     className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-card px-3.5 py-2 text-[13px] font-semibold text-brand transition-colors hover:bg-accent/60">
                    <ExternalLink className="h-3.5 w-3.5" /> {t("ref.openForm")}
                  </a>
                )}
              </div>
            </Card>

            {/* Open a date */}
            <Card className="flex flex-col p-5 shadow-card-md">
              <CardHead icon={CalendarDays} title={t("ref.openDate")} sub={t("ref.openDateSub")} />
              <div className="flex flex-1 flex-col gap-4 pt-4">
                <div>
                  <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.09em] text-muted-foreground">{t("ref.date")}</label>
                  <Input ref={dateInputRef} type="date" value={selectedDate} min={todayIso()}
                    onChange={e => setSelectedDate(e.target.value)} className="h-11 rounded-xl text-sm" />
                </div>
                <div>
                  <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.09em] text-muted-foreground">{t("ref.personsPerSlot")}</label>
                  <Select value={String(maxCapacity)} onValueChange={(v) => setMaxCapacity(Number(v))}>
                    <SelectTrigger className="h-11 rounded-xl text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {PERSON_OPTIONS.map((n) => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <Button className="aurora-primary mt-auto h-11 w-full rounded-xl" onClick={handleOpenDate} disabled={opening || !selectedDate}>
                  <Plus className="mr-1.5 h-4 w-4" /> {opening ? t("ref.opening") : t("ref.openThisDate")}
                </Button>
              </div>
            </Card>

            {/* Open dates list */}
            <Card className="flex flex-col p-5 shadow-card-md">
              <div className="mb-1 flex items-center justify-between">
                <CardHead icon={CalendarDays} title={t("ref.openDates")} />
                {openDates.length > 0 && (
                  <span className="text-[13px] font-semibold text-muted-foreground tabular-nums">{openDates.length}</span>
                )}
              </div>
              <div className="flex flex-1 flex-col gap-2 pt-3">
                {openDates.map((d) => {
                  const active = selectedDate === d.date;
                  return (
                    <button key={d.id} onClick={() => setSelectedDate(d.date)}
                      className={cn(
                        "flex items-center gap-3 rounded-xl border px-3.5 py-3 text-left transition-colors",
                        active ? "border-emerald-300 bg-emerald-50/60 ring-1 ring-emerald-200" : "border-border bg-card hover:bg-muted/50",
                      )}>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-sm font-semibold text-foreground">{d.date_label}</span>
                          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">{t("ref.openBadge")}</span>
                        </div>
                        <div className="mt-0.5 text-[12px] text-muted-foreground tabular-nums">
                          {d.booked}/{d.total_capacity} {t("ref.booked")} · {d.remaining} {t("ref.slotsLeft")}
                        </div>
                      </div>
                      <ChevronRight className={cn("h-4 w-4 shrink-0", active ? "text-emerald-600" : "text-muted-foreground/50")} />
                    </button>
                  );
                })}
                <button onClick={focusOpenDate}
                  className="flex flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-border py-5 text-center transition-colors hover:border-brand/40 hover:bg-accent/40">
                  <span className="grid h-8 w-8 place-items-center rounded-full bg-accent text-brand"><CalendarPlus className="h-4 w-4" /></span>
                  <span className="text-[13px] font-semibold text-foreground">{t("ref.noMoreDates")}</span>
                  <span className="text-[12px] text-muted-foreground">{t("ref.openNewDate")}</span>
                </button>
              </div>
            </Card>
          </div>

          {/* Slot grid */}
          <Card className="shrink-0 p-5 shadow-card-md">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <h2 className="type-card-heading text-foreground">{t("ref.slotsFor")} {dateLabel}</h2>
                {grid?.has_availability && (
                  <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">{t("ref.openBadge")}</span>
                )}
              </div>
              <button onClick={() => loadGrid(selectedDate)}
                className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-card px-3 py-1.5 text-[13px] font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
                <RefreshCw className={cn("h-3.5 w-3.5", loadingGrid && "animate-spin")} /> {t("ref.refresh")}
              </button>
            </div>

            <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-[12px]">
              {[
                { cls: "bg-emerald-500", label: t("ref.legendAvailable") },
                { cls: "bg-amber-500",   label: t("ref.legendPartial") },
                { cls: "bg-red-500",     label: t("ref.legendFull") },
                { cls: "bg-slate-400",   label: t("ref.legendBlocked") },
              ].map((l) => (
                <span key={l.label} className="flex items-center gap-1.5 text-muted-foreground">
                  <span className={cn("inline-block h-2.5 w-2.5 rounded-full", l.cls)} /> {l.label}
                </span>
              ))}
              <span className="text-muted-foreground/70">· {t("ref.clickSlot")}</span>
            </div>

            {!grid?.has_availability ? (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {["11:00 – 11:30", "11:30 – 12:00", "12:00 – 12:30", "12:30 – 01:00"].map((tm) => (
                  <div key={tm} className="flex h-24 flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-border text-center text-[12px] text-muted-foreground/50">
                    <span className="font-semibold">{tm}</span>
                    <span>{loadingGrid ? t("ref.loading") : t("ref.notOpen")}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {(grid.slots ?? []).map((slot) => {
                  const badge = slotBadge(slot, t);
                  const loading = busyId === slot.id;
                  return (
                    <button key={slot.id} onClick={() => setConfirmSlot(slot)}
                      className={cn("relative flex flex-col gap-2 rounded-xl border p-3.5 text-left transition-all", slotColor(slot), loading && "pointer-events-none opacity-60")}>
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-semibold text-foreground">{slot.start} – {slot.end}</span>
                        {slot.status === "BLOCKED" ? <Lock className="h-3.5 w-3.5 text-slate-400" />
                          : isAdminClosed(slot) ? <Lock className="h-3.5 w-3.5 text-red-500" />
                          : <Unlock className="h-3.5 w-3.5 text-muted-foreground/30" />}
                      </div>
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-black/[0.07]">
                        <div className={cn("h-full rounded-full transition-all", barColor(slot))}
                          style={{ width: `${Math.min(100, (slot.booked_count / Math.max(1, slot.max_capacity)) * 100)}%` }} />
                      </div>
                      <div className="flex items-baseline justify-between">
                        <span className={cn("text-[13px] font-semibold", badge.cls)}>{badge.label}</span>
                        <span className="text-[12px] tabular-nums text-muted-foreground">{slot.booked_count} / {slot.max_capacity} {t("ref.bookingsWord")}</span>
                      </div>
                      {loading && <div className="absolute inset-0 grid place-items-center rounded-xl bg-white/60"><RefreshCw className="h-4 w-4 animate-spin text-brand" /></div>}
                    </button>
                  );
                })}
              </div>
            )}
          </Card>

          {/* Bookings table — fills the remaining height; body scrolls */}
          <Card className="overflow-hidden p-0 shadow-card-md xl:flex xl:min-h-0 xl:flex-1 xl:flex-col">
            <div className="flex shrink-0 items-center gap-2 border-b border-border px-5 py-4">
              <Users className="h-4 w-4 text-brand" />
              <h2 className="type-card-heading text-foreground">{t("ref.bookingsFor")} — {dateLabel}</h2>
              <span className="ml-auto text-[13px] text-muted-foreground tabular-nums">{bookings.length} {t("ref.bookingCount")}</span>
              <Button variant="outline" onClick={exportBookings} disabled={!bookings.length} className="h-9 rounded-xl">
                <Download className="h-4 w-4 text-brand" /> {t("ref.export")}
              </Button>
            </div>
            <div className="overflow-x-auto xl:min-h-0 xl:flex-1 xl:overflow-y-auto">
              <table className="w-full min-w-[860px] text-left text-sm">
                <thead className="sticky top-0 z-10 bg-card text-[11px] font-semibold uppercase tracking-[0.09em] text-muted-foreground/80">
                  <tr>
                    <th className="px-4 py-3">{t("ref.colToken")}</th>
                    <th className="px-4 py-3">{t("ref.colName")}</th>
                    <th className="px-4 py-3">{t("ref.colMobile")}</th>
                    <th className="px-4 py-3 text-center">{t("ref.colPersons")}</th>
                    <th className="px-4 py-3">{t("ref.colReferredBy")}</th>
                    <th className="px-4 py-3">{t("ref.colReason")}</th>
                    <th className="px-4 py-3">{t("ref.colSlot")}</th>
                    <th className="px-4 py-3">{t("ref.colBookedAt")}</th>
                    <th className="px-4 py-3">{t("ref.colStatus")}</th>
                  </tr>
                </thead>
                <tbody>
                  {bookings.length === 0 ? (
                    <tr><td colSpan={9} className="px-4 py-12 text-center">
                      <div className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-2xl bg-accent/60"><Users className="h-6 w-6 text-brand/50" /></div>
                      <div className="text-base font-semibold text-foreground">{t("ref.noBookings")}</div>
                      <div className="mt-0.5 text-sm text-muted-foreground">{t("ref.noBookingsSub")}</div>
                    </td></tr>
                  ) : bookings.map((b) => {
                    const st = bookingStatus(b.status, t);
                    return (
                      <tr key={b.id} className="border-t border-border/60 transition-colors hover:bg-muted/30">
                        <td className="px-4 py-3 font-mono text-[13px] font-semibold text-brand">{b.token}</td>
                        <td className="px-4 py-3 font-medium text-foreground">{b.name}</td>
                        <td className="px-4 py-3 font-mono text-[13px] text-muted-foreground">{b.mobile ?? "—"}</td>
                        <td className="px-4 py-3 text-center font-semibold tabular-nums">{b.num_persons}</td>
                        <td className="px-4 py-3 text-muted-foreground">{b.referred_by}</td>
                        <td className="max-w-[220px] px-4 py-3">
                          <span className="block truncate text-muted-foreground" title={b.reason}>{b.reason}</span>
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 tabular-nums">{b.slot}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-[13px] text-muted-foreground">{b.booked_at ? formatDateTime(b.booked_at) : "—"}</td>
                        <td className="px-4 py-3">
                          <span className={cn("rounded-full px-2.5 py-1 text-[12px] font-semibold", st.cls)}>{st.label}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      </main>

      {/* Slot action dialog */}
      <Dialog open={confirmSlot !== null} onOpenChange={(o) => { if (!o) setConfirmSlot(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{dlg ? t(dlg.titleKey) : ""}</DialogTitle>
            <DialogDescription>{dlg?.desc}</DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex flex-col gap-2 sm:flex-row">
            <DialogClose asChild><Button variant="outline" size="sm" className="w-full sm:w-auto">{t("ref.dlgCancel")}</Button></DialogClose>
            {dlg?.actions.map((a) => (
              <Button key={a.action} size="sm" className={cn("w-full sm:w-auto", a.cls)} onClick={() => dispatchAction(a.action)}>{t(a.key)}</Button>
            ))}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/* ── Local components ─────────────────────────────────────────────────── */

function CardHead({ icon: Icon, title, sub }: { icon: React.ElementType; title: string; sub?: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-accent text-brand">
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0">
        <div className="type-card-heading leading-tight text-foreground">{title}</div>
        {sub && <div className="text-[12px] text-muted-foreground">{sub}</div>}
      </div>
    </div>
  );
}
