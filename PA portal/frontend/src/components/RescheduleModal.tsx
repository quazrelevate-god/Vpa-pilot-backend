"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { CalendarDays, Loader2, ExternalLink } from "lucide-react";

import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

// Two backend endpoints this modal talks to. Kept literal here (rather than a
// shared api-client method) because it's the only PA-portal caller and the
// crowd PWA has its own copy — sharing them would drag one route group into
// another for no real reuse.
type OpenDate = { date: string; date_label: string; open?: number };
type Slot = {
  id: number;
  slot_number: number;
  label: string;
  start: string;
  end: string;
  available: boolean;
  booked_count: number;
  max_capacity: number;
  remaining: number;
  status: string;
};

export default function RescheduleModal({
  open, appointmentId, onClose, onRebooked,
}: {
  open: boolean;
  appointmentId: number | null;
  onClose: () => void;
  /** Called with the new date + time when the reschedule succeeds. */
  onRebooked: (info: { scheduled_date: string; scheduled_time: string }) => void;
}) {
  const [dates, setDates] = useState<OpenDate[] | null>(null);
  const [date, setDate] = useState<string | null>(null);
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [slot, setSlot] = useState<Slot | null>(null);
  const [busy, setBusy] = useState(false);

  // Reset when the modal opens for a new appointment.
  useEffect(() => {
    if (!open) return;
    setDates(null); setDate(null); setSlots(null); setSlot(null); setBusy(false);

    (async () => {
      try {
        const r = await fetch("/api/v1/scheduling/open-dates", { credentials: "include" });
        const ds = (await r.json()) as OpenDate[];
        setDates(Array.isArray(ds) ? ds : []);
        if (Array.isArray(ds) && ds.length) setDate(ds[0].date);
      } catch {
        setDates([]);
      }
    })();
  }, [open]);

  // Load slots whenever the picked date changes.
  useEffect(() => {
    if (!open || !date) return;
    setSlots(null); setSlot(null);
    (async () => {
      try {
        const r = await fetch(`/api/v1/scheduling/slots/available?target_date=${date}`, { credentials: "include" });
        const d = await r.json() as { slots?: Slot[] };
        setSlots(d.slots ?? []);
      } catch {
        setSlots([]);
      }
    })();
  }, [open, date]);

  const submit = useCallback(async () => {
    if (!appointmentId || !date || !slot) return;
    setBusy(true);
    try {
      const dt = `${date}T${slot.start}`;
      const resp = await fetch(`/api/v1/scheduling/admin/reschedule/${appointmentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ new_datetime: dt }),
      });
      const body = await resp.json().catch(() => ({} as Record<string, unknown>));
      if (!resp.ok) {
        // 409 = slot conflict / past date / no open dates. The row stays on
        // the Rescheduled tab; PA needs to pick again. Refresh the grid so
        // any newly-full slots are visible immediately.
        if (resp.status === 409) {
          toast.error((body as { error?: string }).error || "That slot just became unavailable. Pick another.");
          try {
            const rr = await fetch(`/api/v1/scheduling/slots/available?target_date=${date}`, { credentials: "include" });
            const dd = await rr.json() as { slots?: Slot[] };
            setSlots(dd.slots ?? []);
            setSlot(null);
          } catch {}
          return;
        }
        toast.error((body as { error?: string }).error || `Reschedule failed (${resp.status})`);
        return;
      }
      toast.success("Rescheduled", { description: `${date}, ${slot.label}` });
      onRebooked({
        scheduled_date: (body as { scheduled_date?: string }).scheduled_date || date,
        scheduled_time: (body as { scheduled_time?: string }).scheduled_time || slot.start,
      });
      onClose();
    } catch (e) {
      toast.error("Network error", { description: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }, [appointmentId, date, slot, onRebooked, onClose]);

  const openCount = (slots ?? []).filter((s) => s.available && s.remaining > 0).length;
  const noDates = dates !== null && dates.length === 0;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg">
            <CalendarDays className="h-5 w-5 text-brand" />
            Reschedule to a new slot
          </DialogTitle>
        </DialogHeader>

        {noDates ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
            <p className="font-semibold">No days are open for bookings.</p>
            <p className="mt-1 text-amber-700">
              Open a new date on the Scheduling page, then come back here to rebook.
            </p>
            <a href="/scheduling"
               className="mt-3 inline-flex items-center gap-1 text-xs font-bold text-brand hover:underline">
              <ExternalLink className="h-3.5 w-3.5" /> Go to Scheduling
            </a>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Date chips */}
            <div>
              <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                Select a date
              </div>
              {!dates ? (
                <div className="flex gap-2">
                  <Skeleton className="h-16 w-16 rounded-lg" />
                  <Skeleton className="h-16 w-16 rounded-lg" />
                  <Skeleton className="h-16 w-16 rounded-lg" />
                </div>
              ) : (
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {dates.map((d) => {
                    const dt = new Date(d.date + "T00:00:00");
                    const on = date === d.date;
                    return (
                      <button key={d.date} type="button" onClick={() => setDate(d.date)}
                        className={cn("min-w-[76px] shrink-0 rounded-lg border p-2 text-center transition-colors",
                          on ? "border-brand bg-brand text-brand-foreground" : "border-border bg-card hover:bg-muted")}>
                        <div className={cn("text-[10px] font-bold uppercase", on ? "text-white/85" : "text-muted-foreground")}>
                          {dt.toLocaleDateString(undefined, { weekday: "short" })}
                        </div>
                        <div className="text-lg font-black leading-tight">{dt.getDate()}</div>
                        <div className={cn("text-[10px] font-bold", on ? "text-white/85" : "text-muted-foreground")}>
                          {dt.toLocaleDateString(undefined, { month: "short" })}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Slot grid */}
            <div>
              <div className="mb-1.5 flex items-baseline justify-between">
                <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                  Select a time slot
                </div>
                {slots && (
                  <span className={cn("text-[11px] font-bold uppercase",
                    openCount > 0 ? "text-emerald-600" : "text-amber-600")}>
                    {openCount > 0 ? `${openCount} open` : "All full"}
                  </span>
                )}
              </div>
              {!slots ? (
                <Skeleton className="h-32 rounded-lg" />
              ) : (
                <div className="grid max-h-72 grid-cols-2 gap-2 overflow-y-auto pr-1">
                  {slots.map((s) => {
                    const ok = s.available && s.remaining > 0;
                    const sel = slot?.id === s.id;
                    return (
                      <button key={s.id} type="button" disabled={!ok && !sel} onClick={() => ok && setSlot(s)}
                        className={cn("rounded-lg border p-2.5 text-left text-sm transition-colors",
                          sel ? "border-brand bg-brand/10"
                            : ok ? "border-border bg-card hover:bg-muted"
                              : "cursor-not-allowed border-border bg-muted/50 opacity-60")}>
                        <div className={cn("font-bold", ok || sel ? "text-foreground" : "text-muted-foreground")}>
                          {s.label}
                        </div>
                        <div className={cn("mt-0.5 text-[11px] font-bold",
                          ok ? "text-emerald-600" : "uppercase text-muted-foreground")}>
                          {ok ? `${s.remaining}/${s.max_capacity} seats`
                            : s.status === "BLOCKED" ? "Blocked" : "Full"}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        <div className="mt-2 flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={submit} disabled={busy || !slot || noDates}
            className="min-w-[9rem]">
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {busy ? "Booking…" : "Confirm reschedule"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
