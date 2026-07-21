"use client";

// Month grid: 7×6 cells (Monday start). Each cell shows up to 3 event chips
// plus a "+N" overflow that opens the DaySheet. Tapping a chip opens the event
// popup directly; tapping cell whitespace opens the DaySheet.

import { useMemo } from "react";
import { cn } from "@/lib/utils";
import type { EventItem } from "../_lib/types";
import { typeMeta } from "../_lib/types";
import { dayName, monthCells, sameDay, toISO } from "../_lib/dates";
import { useT } from "../_lib/i18n";

const MAX_CHIPS = 3;

export default function MonthView({ anchor, byDay, onOpen, onOpenDay }: {
  anchor: Date;
  byDay: Map<string, EventItem[]>;
  onOpen: (e: EventItem) => void;
  onOpenDay: (iso: string) => void;
}) {
  const { lang } = useT();
  const cells = useMemo(() => monthCells(anchor), [anchor]);
  const today = new Date();

  return (
    <div className="px-2">
      {/* Weekday headers */}
      <div className="grid grid-cols-7">
        {Array.from({ length: 7 }, (_, i) => (
          <div key={i} className="py-1 text-center text-[0.6rem] font-bold uppercase tracking-wide text-slate-400">
            {dayName(i, lang)}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 overflow-hidden rounded-lg border border-slate-200 bg-white">
        {cells.map((d, i) => {
          const iso = toISO(d);
          const inMonth = d.getMonth() === anchor.getMonth();
          const isToday = sameDay(d, today);
          const list = byDay.get(iso) ?? [];
          const overflow = list.length - MAX_CHIPS;

          return (
            <div key={i}
              role="button" tabIndex={0}
              onClick={() => list.length && onOpenDay(iso)}
              onKeyDown={(e) => { if (e.key === "Enter" && list.length) onOpenDay(iso); }}
              className={cn(
                "min-h-[76px] border-b border-r border-slate-100 p-1",
                (i + 1) % 7 === 0 && "border-r-0",
                i >= 35 && "border-b-0",
                !inMonth && "bg-slate-50/60",
              )}>
              <div className={cn(
                "mb-0.5 grid h-5 w-5 place-items-center rounded-full font-mono text-[0.65rem] font-bold tabular-nums",
                isToday ? "bg-[#2F6FED] text-white"
                  : inMonth ? "text-slate-700" : "text-slate-300",
              )}>
                {d.getDate()}
              </div>

              <div className="space-y-0.5">
                {list.slice(0, MAX_CHIPS).map((e) => {
                  const meta = typeMeta(e.event_type);
                  const processing = e.status === "QUEUED" || e.status === "PROCESSING";
                  return (
                    <button key={e.id}
                      onClick={(ev) => { ev.stopPropagation(); onOpen(e); }}
                      style={{ backgroundColor: `${meta.color}1A` }}
                      className={cn(
                        "flex w-full items-center gap-1 truncate rounded px-1 py-0.5 text-left text-[0.58rem] font-bold text-slate-800",
                        processing && "animate-pulse",
                      )}>
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: meta.color }} />
                      <span className="truncate">{e.display_title}</span>
                    </button>
                  );
                })}
                {overflow > 0 && (
                  <div className="px-1 font-mono text-[0.58rem] font-bold tabular-nums text-[#2F6FED]">
                    +{overflow}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
