"use client";

import { useEffect, useState } from "react";
import { CalendarClock, Send } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function RescheduleModal({
  open, citizenName, onClose, onSubmit,
}: {
  open: boolean;
  citizenName: string;
  onClose: () => void;
  onSubmit: (when: string, sms: string) => Promise<void> | void;
}) {
  const [datetime, setDatetime] = useState("");
  const [sms, setSms] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDatetime(new Date().toISOString().slice(0, 16));
    setSms(
      `Dear ${citizenName},\n\n` +
      "Your petition appointment has been rescheduled. " +
      "Please check your portal for the new timings.\n\n" +
      "- Public Grievances Dept."
    );
  }, [open, citizenName]);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-amber-100 text-amber-600">
              <CalendarClock className="h-4 w-4" />
            </span>
            Reschedule Appointment
          </DialogTitle>
          <DialogDescription>
            Pick a new slot and review the SMS the citizen will receive.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-1">
          <div className="space-y-1.5">
            <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              New Date &amp; Time
            </label>
            <Input
              type="datetime-local"
              value={datetime}
              onChange={(e) => setDatetime(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              SMS Notification
            </label>
            <textarea
              value={sms}
              onChange={(e) => setSms(e.target.value)}
              className="h-24 w-full resize-none rounded-lg border border-input bg-card px-3 py-2 text-sm shadow-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
            />
            <p className="text-[11px] text-muted-foreground">
              Sent to the citizen's registered mobile number.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try { await onSubmit(datetime, sms); } finally { setBusy(false); }
            }}
          >
            <Send className="h-4 w-4" /> {busy ? "Sending…" : "Send & Reschedule"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
