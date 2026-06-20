"use client";

import { useEffect } from "react";
import { Check, X } from "lucide-react";

export default function Toast({
  message, onClose, autoCloseMs = 3500,
}: { message: string | null; onClose: () => void; autoCloseMs?: number }) {
  useEffect(() => {
    if (!message) return;
    const t = setTimeout(onClose, autoCloseMs);
    return () => clearTimeout(t);
  }, [message, autoCloseMs, onClose]);

  if (!message) return null;
  return (
    <div className="fixed bottom-6 right-6 z-50">
      <div className="flex items-center gap-3 bg-slate-900 text-white px-5 py-3.5 rounded-xl shadow-2xl">
        <div className="w-6 h-6 rounded-full bg-green-500 flex items-center justify-center flex-shrink-0">
          <Check className="w-3.5 h-3.5 text-white" />
        </div>
        <div>
          <div className="text-sm font-semibold">Status Updated</div>
          <div className="text-xs text-slate-400">{message}</div>
        </div>
        <button onClick={onClose} className="ml-2 text-slate-400 hover:text-white" aria-label="Close">
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
