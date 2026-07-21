"use client";

// Bottom sheet listing one day's events — reached from a month cell or "+N".

import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import type { EventItem } from "../_lib/types";
import { typeMeta } from "../_lib/types";
import { fmtLongDate, fmtTime, toMinutes } from "../_lib/dates";
import { useT } from "../_lib/i18n";
import { Clock, MapPin } from "../_lib/icons";

export default function DaySheet({ dateISO, events, onClose, onOpen }: {
  dateISO: string | null;
  events: EventItem[];
  onClose: () => void;
  onOpen: (e: EventItem) => void;
}) {
  const { t, lang } = useT();
  const sorted = [...events].sort(
    (a, b) => (toMinutes(a.start_time) ?? -1) - (toMinutes(b.start_time) ?? -1),
  );

  return (
    <Sheet open={!!dateISO} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent side="bottom" className="mx-auto max-w-[560px] rounded-t-2xl pb-[calc(1rem+env(safe-area-inset-bottom))]">
        <SheetTitle className="text-left font-mono text-base tabular-nums">
          {dateISO ? fmtLongDate(dateISO, lang) : ""}
        </SheetTitle>

        <div className="mt-2 max-h-[55vh] space-y-2 overflow-y-auto">
          {sorted.length === 0 && (
            <div className="py-6 text-center text-sm text-slate-400">
              {t("No events this day.", "இந்த நாளில் நிகழ்வுகள் இல்லை.")}
            </div>
          )}
          {sorted.map((e) => {
            const meta = typeMeta(e.event_type);
            return (
              <button key={e.id} onClick={() => onOpen(e)}
                style={{ borderColor: meta.color }}
                className="block w-full rounded-lg border border-slate-200 border-l-[3px] bg-white p-3 text-left shadow-sm active:bg-slate-50">
                <div className="truncate text-sm font-bold text-slate-900">{e.display_title}</div>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-slate-500">
                  <span className="inline-flex items-center gap-1 font-mono tabular-nums">
                    <Clock className="h-3 w-3" strokeWidth={1.75} />
                    {e.start_time
                      ? `${fmtTime(e.start_time)}${e.end_time ? ` – ${fmtTime(e.end_time)}` : ""}`
                      : t("All day", "நாள் முழுதும்")}
                  </span>
                  {e.venue && (
                    <span className="inline-flex min-w-0 items-center gap-1">
                      <MapPin className="h-3 w-3 shrink-0" strokeWidth={1.75} />
                      <span className="truncate">{e.venue}</span>
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </SheetContent>
    </Sheet>
  );
}
