"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  UserPlus, RefreshCw, Plus, QrCode, Lock, Unlock, Users, Calendar, ExternalLink,
} from "lucide-react";
import { toast } from "sonner";

import TopBar from "@/components/TopBar";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose,
} from "@/components/ui/dialog";
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
  slot: string; booked_at: string | null;
}
interface QrData { qr_url: string; date: string; date_label: string; }

function todayIso() { return new Date().toISOString().split("T")[0]; }

// admin-closed = FULL but seats remain
function isAdminClosed(s: Slot) { return s.status === "FULL" && s.booked_count < s.max_capacity; }

function slotColor(s: Slot): string {
  if (s.status === "BLOCKED") return "border-slate-300 bg-slate-100 text-slate-400 hover:bg-slate-200 cursor-pointer";
  if (s.status === "FULL")    return "border-red-400 bg-red-50 text-red-700 hover:bg-red-100 cursor-pointer";
  if (s.booked_count === 0)   return "border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100 cursor-pointer";
  if (s.remaining === 0)      return "border-red-400 bg-red-50 text-red-700 hover:bg-red-100 cursor-pointer";
  return "border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100 cursor-pointer";
}
function slotBadge(s: Slot): { label: string; cls: string } {
  if (s.status === "BLOCKED") return { label: "Blocked", cls: "bg-slate-200 text-slate-500" };
  if (isAdminClosed(s))       return { label: "Closed",  cls: "bg-red-100 text-red-700 ring-1 ring-red-300" };
  if (s.remaining === 0)      return { label: "Full",    cls: "bg-red-100 text-red-600" };
  if (s.booked_count > 0)     return { label: `${s.remaining} left`, cls: "bg-amber-100 text-amber-700" };
  return                             { label: "Open",    cls: "bg-emerald-100 text-emerald-700" };
}

export default function ReferralsPage() {
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
        new window.QRCode(box, { text: qr.qr_url, width: 200, height: 200, correctLevel: window.QRCode.CorrectLevel.M });
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

  function getDialog(slot: Slot) {
    const lbl = `${slot.start} – ${slot.end}`;
    const counts = `${slot.booked_count}/${slot.max_capacity} booked`;
    if (slot.status === "BLOCKED") return {
      title: "Blocked Slot", desc: `${lbl} is blocked (${counts}). Unblock to allow bookings.`,
      actions: [{ label: "Unblock", action: "unblock" as const, cls: "bg-emerald-600 hover:bg-emerald-700 text-white" }],
    };
    if (slot.status === "FULL" && slot.booked_count < slot.max_capacity) return {
      title: "Closed Slot", desc: `${lbl} was closed early (${counts}). Reopen or block it.`,
      actions: [
        { label: "Reopen", action: "reopen" as const, cls: "bg-emerald-600 hover:bg-emerald-700 text-white" },
        { label: "Block",  action: "block"  as const, cls: "bg-slate-700 hover:bg-slate-800 text-white" },
      ],
    };
    if (slot.status === "FULL" || slot.booked_count >= slot.max_capacity) return {
      title: "Full Slot", desc: `${lbl} is full (${counts}). Block it to prevent rebooking.`,
      actions: [{ label: "Block", action: "block" as const, cls: "bg-slate-700 hover:bg-slate-800 text-white" }],
    };
    if (slot.booked_count > 0) return {
      title: "Partially Booked", desc: `${lbl} has ${counts}. Close it (stop new bookings) or block it.`,
      actions: [
        { label: "Close", action: "close" as const, cls: "bg-orange-500 hover:bg-orange-600 text-white" },
        { label: "Block", action: "block" as const, cls: "bg-slate-700 hover:bg-slate-800 text-white" },
      ],
    };
    return {
      title: "Block Slot?", desc: `${lbl} has no bookings. Block it from citizens.`,
      actions: [{ label: "Block", action: "block" as const, cls: "bg-slate-700 hover:bg-slate-800 text-white" }],
    };
  }

  const dlg = confirmSlot ? getDialog(confirmSlot) : null;

  return (
    <>
      <TopBar />
      <main className="flex-1 overflow-y-auto bg-background">
        <div className="mx-auto max-w-[1200px] space-y-6 p-6 animate-in-up">
          {/* Header */}
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-extrabold tracking-tight">
              <UserPlus className="h-6 w-6 text-teal-600" /> Referrals
            </h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Daily QR + slot booking (11 AM – 1 PM). Separate from petitions.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            {/* QR card */}
            <Card className="p-5">
              <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                <QrCode className="h-4 w-4" /> Today's Referral QR
              </h2>
              <div className="flex flex-col items-center gap-3">
                <div ref={qrBoxRef} className="grid h-[200px] w-[200px] place-items-center rounded-lg border border-border bg-white p-2">
                  {!qr && <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />}
                </div>
                <div className="text-center">
                  <div className="text-sm font-bold">{qr?.date_label ?? "—"}</div>
                  <div className="text-[11px] text-muted-foreground">Resets every day. Share with referred persons.</div>
                </div>
                {qr?.qr_url && (
                  <a href={qr.qr_url} target="_blank" rel="noreferrer"
                     className="flex items-center gap-1 text-xs font-medium text-teal-600 hover:underline">
                    <ExternalLink className="h-3 w-3" /> Open referral form
                  </a>
                )}
              </div>
            </Card>

            {/* Open date controls */}
            <Card className="space-y-3 p-5">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Open a Date</h2>
              <input type="date" value={selectedDate} min={todayIso()}
                onChange={e => setSelectedDate(e.target.value)}
                className="w-full rounded-lg border border-input bg-card px-3 py-2 text-sm focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/20" />
              <div>
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Persons per Slot</label>
                <input type="number" min={1} max={100} value={maxCapacity}
                  onChange={e => setMaxCapacity(Math.max(1, Math.min(100, Number(e.target.value))))}
                  className="w-full rounded-lg border border-input bg-card px-3 py-1.5 text-sm focus:border-teal-500 focus:outline-none" />
              </div>
              <Button className="w-full bg-teal-600 hover:bg-teal-700 text-white" onClick={handleOpenDate} disabled={opening || !selectedDate}>
                <Plus className="mr-2 h-4 w-4" /> {opening ? "Opening…" : "Open This Date"}
              </Button>
            </Card>

            {/* Open dates list */}
            <Card className="p-5">
              <h2 className="mb-3 flex items-center gap-1 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                <Calendar className="h-4 w-4" /> Open Dates
              </h2>
              {openDates.length === 0 ? (
                <p className="text-xs text-muted-foreground">No upcoming open dates.</p>
              ) : (
                <ul className="space-y-2">
                  {openDates.map(d => (
                    <li key={d.id}>
                      <button onClick={() => setSelectedDate(d.date)}
                        className={cn("w-full rounded-lg border px-3 py-2 text-left text-sm transition-colors",
                          selectedDate === d.date ? "border-teal-500 bg-teal-50 font-semibold text-teal-700" : "border-slate-200 hover:border-teal-300 hover:bg-slate-50")}>
                        <div className="font-medium">{d.date_label}</div>
                        <div className="text-[11px] text-muted-foreground">{d.booked}/{d.total_capacity} booked · {d.remaining} left</div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          {/* Slot grid */}
          <Card className="p-5">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-base font-bold">{grid?.date_label ?? selectedDate}</h2>
                {grid?.has_availability ? (
                  <p className="text-xs text-muted-foreground">
                    {grid.booked_total ?? 0}/{grid.total_capacity ?? 0} booked · {grid.blocked_slots ?? 0} blocked · {grid.remaining_total ?? 0} remaining
                  </p>
                ) : (
                  <p className="text-xs text-amber-600">{loadingGrid ? "Loading…" : "Date not open — open it above."}</p>
                )}
              </div>
              <button onClick={() => loadGrid(selectedDate)} className="rounded-lg p-2 hover:bg-muted" title="Refresh">
                <RefreshCw className={cn("h-4 w-4 text-muted-foreground", loadingGrid && "animate-spin")} />
              </button>
            </div>

            <div className="mb-4 flex flex-wrap gap-3 text-[11px]">
              {[
                { cls: "bg-emerald-100 border border-emerald-300", label: "Available" },
                { cls: "bg-amber-100 border border-amber-300", label: "Partially booked" },
                { cls: "bg-red-100 border border-red-400", label: "Full / Closed" },
                { cls: "bg-slate-100 border border-slate-300", label: "Blocked" },
              ].map(l => (
                <span key={l.label} className="flex items-center gap-1">
                  <span className={cn("inline-block h-3 w-3 rounded-sm", l.cls)} /> {l.label}
                </span>
              ))}
              <span className="ml-2 text-muted-foreground">Click any slot to manage</span>
            </div>

            {!grid?.has_availability ? (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {["11:00", "11:30", "12:00", "12:30"].map(t => (
                  <div key={t} className="flex h-16 items-center justify-center rounded-lg border border-dashed border-slate-200 text-xs text-slate-300">{t}</div>
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {(grid.slots ?? []).map(slot => {
                  const badge = slotBadge(slot);
                  const loading = busyId === slot.id;
                  return (
                    <div key={slot.id} onClick={() => setConfirmSlot(slot)}
                      className={cn("relative flex flex-col gap-0.5 rounded-lg border px-3 py-2.5 transition-all", slotColor(slot), loading && "pointer-events-none opacity-60")}>
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-semibold">{slot.start} – {slot.end}</span>
                        {slot.status === "BLOCKED" ? <Lock className="h-3 w-3 opacity-60" />
                          : isAdminClosed(slot) ? <Lock className="h-3 w-3 text-red-500 opacity-80" />
                          : <Unlock className="h-3 w-3 opacity-30" />}
                      </div>
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-black/10">
                        <div className={cn("h-full rounded-full",
                          slot.status === "FULL" || slot.remaining === 0 ? "bg-red-500" : slot.booked_count > 0 ? "bg-amber-500" : "bg-emerald-500")}
                          style={{ width: `${(slot.booked_count / slot.max_capacity) * 100}%` }} />
                      </div>
                      <span className={cn("mt-0.5 self-start rounded px-1.5 py-0.5 text-[10px] font-semibold", badge.cls)}>{badge.label}</span>
                      <div className="text-[10px] opacity-70">{slot.booked_count}/{slot.max_capacity} bookings</div>
                      {loading && <div className="absolute inset-0 grid place-items-center rounded-lg bg-white/60"><RefreshCw className="h-4 w-4 animate-spin text-teal-600" /></div>}
                    </div>
                  );
                })}
              </div>
            )}
          </Card>

          {/* Bookings table */}
          <Card className="p-0 overflow-hidden">
            <div className="flex items-center gap-2 border-b border-border p-4">
              <Users className="h-4 w-4 text-teal-600" />
              <h2 className="text-sm font-bold">Bookings — {grid?.date_label ?? selectedDate}</h2>
              <span className="ml-auto text-xs text-muted-foreground">{bookings.length} booking(s)</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead className="bg-muted/50 text-[11px] uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2.5">Token</th>
                    <th className="px-4 py-2.5">Name</th>
                    <th className="px-4 py-2.5">Mobile</th>
                    <th className="px-4 py-2.5 text-center">Persons</th>
                    <th className="px-4 py-2.5">Referred By</th>
                    <th className="px-4 py-2.5">Reason</th>
                    <th className="px-4 py-2.5">Slot</th>
                    <th className="px-4 py-2.5">Booked At</th>
                  </tr>
                </thead>
                <tbody>
                  {bookings.length === 0 ? (
                    <tr><td colSpan={8} className="px-4 py-10 text-center text-muted-foreground">No referral bookings for this date.</td></tr>
                  ) : bookings.map(b => (
                    <tr key={b.id} className="border-t border-border/70 hover:bg-muted/30">
                      <td className="px-4 py-2.5 font-mono text-xs text-teal-600">{b.token}</td>
                      <td className="px-4 py-2.5 font-medium text-foreground">{b.name}</td>
                      <td className="px-4 py-2.5 text-muted-foreground">{b.mobile ?? "—"}</td>
                      <td className="px-4 py-2.5 text-center font-semibold">{b.num_persons}</td>
                      <td className="px-4 py-2.5 text-muted-foreground">{b.referred_by}</td>
                      <td className="px-4 py-2.5 max-w-[200px]">
                        <span className="block truncate text-muted-foreground" title={b.reason}>{b.reason}</span>
                      </td>
                      <td className="px-4 py-2.5">{b.slot}</td>
                      <td className="px-4 py-2.5 text-xs text-muted-foreground">{b.booked_at ? formatDateTime(b.booked_at) : "—"}</td>
                    </tr>
                  ))}
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
            <DialogTitle>{dlg?.title}</DialogTitle>
            <DialogDescription>{dlg?.desc}</DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex flex-col gap-2 sm:flex-row">
            <DialogClose asChild><Button variant="outline" size="sm" className="w-full sm:w-auto">Cancel</Button></DialogClose>
            {dlg?.actions.map(a => (
              <Button key={a.action} size="sm" className={cn("w-full sm:w-auto", a.cls)} onClick={() => dispatchAction(a.action)}>{a.label}</Button>
            ))}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
