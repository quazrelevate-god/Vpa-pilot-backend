"use client";

// Glance view: 7-row accordion table for the current week.
// Columns: Day (expandable) | Date | Event count
// Expanding a day lists all events. Clicking an event opens EventPopup.

import { useState } from "react";
import { cn } from "@/lib/utils";
import type { EventItem } from "../_lib/types";
import { displayTitle, typeMeta } from "../_lib/types";
import { AttendanceDot } from "./AttendanceDot";
import { fmtTime, sameDay, toISO, weekDays } from "../_lib/dates";
import { useT } from "../_lib/i18n";
import { ChevronDown } from "../_lib/icons";

const FULL_DAYS_EN = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"];
const FULL_DAYS_TA = ["திங்கட்","செவ்வாய்","புதன்","வியாழன்","வெள்ளி","சனி","ஞாயிறு"];
const MONTHS_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

export default function GlanceView({ anchor, byDay, onOpen }: {
  anchor: Date;
  byDay: Map<string, EventItem[]>;
  onOpen: (e: EventItem) => void;
}) {
  const { t, lang } = useT();
  const days = weekDays(anchor);
  const today = new Date();
  const todayISO = toISO(today);

  // Auto-expand today if it has events
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    const s = new Set<string>();
    if (byDay.has(todayISO)) s.add(todayISO);
    return s;
  });

  function toggle(iso: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(iso) ? next.delete(iso) : next.add(iso);
      return next;
    });
  }

  return (
    <div className="px-4 pt-2 pb-4">
      {/* Column headers */}
      <div className="mb-1.5 grid grid-cols-[1fr_64px_76px] gap-x-2 px-3">
        <span className="text-[0.68rem] font-bold uppercase tracking-wide text-slate-400">{t("Day", "நாள்")}</span>
        <span className="text-center text-[0.68rem] font-bold uppercase tracking-wide text-slate-400">{t("Date", "தேதி")}</span>
        <span className="text-right text-[0.68rem] font-bold uppercase tracking-wide text-slate-400">{t("Events", "நிகழ்வுகள்")}</span>
      </div>

      <div className="space-y-1.5">
        {days.map((d, i) => {
          const iso = toISO(d);
          const isToday = sameDay(d, today);
          const evts = byDay.get(iso) ?? [];
          const count = evts.length;
          const isOpen = expanded.has(iso);
          const hasEvents = count > 0;

          const sorted = [...evts].sort((a, b) => {
            if (!a.start_time && !b.start_time) return 0;
            if (!a.start_time) return 1;
            if (!b.start_time) return -1;
            return a.start_time.localeCompare(b.start_time);
          });

          const dayLabel = lang === "ta" ? FULL_DAYS_TA[i] : FULL_DAYS_EN[i];
          const dateLabel = `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`;

          return (
            <div key={iso} className={cn(
              "overflow-hidden rounded-xl border transition-colors",
              isToday ? "border-[#2F6FED]/40 bg-[#2F6FED]/[0.04]" : "border-slate-200 bg-white",
            )}>
              {/* Row — clickable only when there are events */}
              <button
                onClick={() => hasEvents && toggle(iso)}
                disabled={!hasEvents}
                className={cn(
                  "grid w-full grid-cols-[1fr_64px_76px] items-center gap-x-2 px-3 py-3 text-left",
                  hasEvents ? "cursor-pointer active:bg-slate-50" : "cursor-default",
                )}
                aria-expanded={isOpen}
              >
                {/* Day name + chevron */}
                <span className="flex min-w-0 items-center gap-1.5">
                  <ChevronDown
                    className={cn(
                      "h-4 w-4 shrink-0 text-slate-400 transition-transform duration-200",
                      isOpen && "rotate-180",
                      !hasEvents && "opacity-0",
                    )}
                    strokeWidth={2}
                  />
                  <span className={cn(
                    "truncate text-sm font-bold",
                    isToday ? "text-[#2F6FED]" : "text-slate-800",
                  )}>
                    {dayLabel}
                    {isToday && (
                      <span className="ml-1.5 inline-block rounded-full bg-[#2F6FED] px-1.5 py-0.5 text-[0.6rem] font-black uppercase tracking-wide text-white align-middle">
                        {t("Today", "இன்று")}
                      </span>
                    )}
                  </span>
                </span>

                {/* Date */}
                <span className={cn(
                  "text-center font-mono text-sm tabular-nums",
                  isToday ? "font-bold text-[#2F6FED]" : "text-slate-500",
                )}>
                  {dateLabel}
                </span>

                {/* Count */}
                <span className="text-right">
                  {hasEvents ? (
                    <span className={cn(
                      "inline-block rounded-full px-2 py-0.5 text-xs font-bold",
                      isToday ? "bg-[#2F6FED]/15 text-[#2F6FED]" : "bg-slate-100 text-slate-600",
                    )}>
                      {count} {count === 1 ? t("event", "நிகழ்வு") : t("events", "நிகழ்வுகள்")}
                    </span>
                  ) : (
                    <span className="text-xs font-semibold text-slate-400">{t("No event", "இல்லை")}</span>
                  )}
                </span>
              </button>

              {/* Expanded list */}
              {isOpen && hasEvents && (
                <div className="border-t border-slate-100 px-3 pb-2 pt-1">
                  <ol className="space-y-0.5">
                    {sorted.map((e, idx) => {
                      const meta = typeMeta(e.event_type);
                      const processing = e.status === "QUEUED" || e.status === "PROCESSING";
                      return (
                        <li key={e.id}>
                          <button
                            onClick={() => onOpen(e)}
                            className="flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-slate-50 active:bg-slate-100"
                          >
                            <span className="mt-0.5 w-4 shrink-0 text-right font-mono text-xs font-bold tabular-nums text-slate-400">
                              {idx + 1}.
                            </span>
                            <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: meta.color }} />
                            <span className="min-w-0 flex-1">
                              <span className={cn("flex items-center gap-1.5 truncate text-sm font-bold text-slate-800", processing && "animate-pulse")}>
                                <AttendanceDot value={e.attendance} />
                                <span className="truncate">{displayTitle(e, lang)}</span>
                              </span>
                              <span className="font-mono text-xs tabular-nums text-slate-500">
                                {e.start_time ? fmtTime(e.start_time) : t("All day", "நாள் முழுதும்")}
                                {e.end_time && ` – ${fmtTime(e.end_time)}`}
                              </span>
                            </span>
                            <span
                              className="mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-[0.65rem] font-bold"
                              style={{ backgroundColor: `${meta.color}1A`, color: meta.color }}
                            >
                              {t(meta.en, meta.ta)}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ol>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
