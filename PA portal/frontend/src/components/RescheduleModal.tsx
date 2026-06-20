"use client";

import { useEffect, useState } from "react";
import { CalendarClock, Send, X } from "lucide-react";

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

  if (!open) return null;
  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6 border border-slate-200">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
            <CalendarClock className="w-5 h-5 text-orange-500" />
            Reschedule Appointment
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">
              New Date &amp; Time
            </label>
            <input
              type="datetime-local"
              value={datetime}
              onChange={(e) => setDatetime(e.target.value)}
              className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:border-brand"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">
              SMS Notification
            </label>
            <textarea
              value={sms}
              onChange={(e) => setSms(e.target.value)}
              className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm h-24 resize-none focus:outline-none focus:border-brand"
            />
            <p className="text-[10px] text-slate-400 mt-1">
              Sent to the citizen's registered mobile number.
            </p>
          </div>
        </div>
        <div className="mt-6 flex justify-end gap-3 pt-4 border-t border-slate-100">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-md"
          >
            Cancel
          </button>
          <button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try { await onSubmit(datetime, sms); } finally { setBusy(false); }
            }}
            className="px-4 py-2 bg-brand text-white text-sm font-medium rounded-md hover:bg-blue-700 flex items-center gap-2 shadow-sm disabled:opacity-60"
          >
            <Send className="w-4 h-4" /> {busy ? "Sending…" : "Send & Reschedule"}
          </button>
        </div>
      </div>
    </div>
  );
}
