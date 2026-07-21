"use client";

// Teams-like week grid: hour gutter × 7 day columns, events absolutely
// positioned by their start/end minutes, greedy column-assignment for
// overlapping events, an all-day strip for date-only events, and a red
// "now" line on today.

import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import type { EventItem } from "../_lib/types";
import { typeMeta } from "../_lib/types";
import { dayName, fmtTime, pad2, sameDay, toISO, toMinutes, weekDays } from "../_lib/dates";
import { useT } from "../_lib/i18n";

const DAY_START = 6 * 60;   // grid shows 06:00 …
const DAY_END = 22 * 60;    // … 22:00
const HOUR_H = 48;          // px per hour
const COL_W = 110;          // min px per day column
const GUTTER_W = 48;

type Placed = {
  event: EventItem;
  startMin: number;
  endMin: number;
  col: number;
  cols: number;
};

/** Greedy interval layout: cluster transitively-overlapping events, assign
 *  each the lowest free column, size blocks to the cluster's column count. */
function layoutDay(events: EventItem[]): Placed[] {
  const timed = events
    .filter((e) => toMinutes(e.start_time) !== null)
    .map((e) => {
      const start = toMinutes(e.start_time)!;
      const end = Math.max(toMinutes(e.end_time) ?? start + 60, start + 30);
      return { event: e, startMin: start, endMin: end };
    })
    .sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);

  const placed: Placed[] = [];
  let cluster: typeof timed = [];
  let clusterEnd = -1;

  const flush = () => {
    if (!cluster.length) return;
    const colEnds: number[] = [];
    const items = cluster.map((it) => {
      let col = colEnds.findIndex((end) => end <= it.startMin);
      if (col === -1) { col = colEnds.length; colEnds.push(0); }
      colEnds[col] = it.endMin;
      return { ...it, col, cols: 0 };
    });
    for (const it of items) it.cols = colEnds.length;
    placed.push(...items);
    cluster = [];
  };

  for (const it of timed) {
    if (cluster.length && it.startMin >= clusterEnd) flush();
    cluster.push(it);
    clusterEnd = Math.max(clusterEnd, it.endMin);
  }
  flush();
  return placed;
}

function EventBlock({ placed, onOpen }: { placed: Placed; onOpen: (e: EventItem) => void }) {
  const { event: e, startMin, endMin, col, cols } = placed;
  const meta = typeMeta(e.event_type);
  const top = ((Math.max(startMin, DAY_START) - DAY_START) / 60) * HOUR_H;
  const height = Math.max(((Math.min(endMin, DAY_END) - Math.max(startMin, DAY_START)) / 60) * HOUR_H, 24);
  const width = 100 / cols;
  const processing = e.status === "QUEUED" || e.status === "PROCESSING";

  if (endMin <= DAY_START || startMin >= DAY_END) return null;

  return (
    <button
      onClick={() => onOpen(e)}
      style={{
        top, height,
        left: `${col * width}%`,
        width: `calc(${width}% - 2px)`,
        backgroundColor: `${meta.color}1A`,
        borderColor: meta.color,
      }}
      className={cn(
        "absolute overflow-hidden rounded-md border-l-[3px] px-1.5 py-1 text-left",
        processing && "animate-pulse",
      )}>
      <div className="truncate text-[0.68rem] font-bold leading-tight text-slate-800">
        {e.display_title}
      </div>
      <div className="truncate font-mono text-[0.6rem] font-medium tabular-nums text-slate-500">
        {fmtTime(e.start_time)}
      </div>
    </button>
  );
}

export default function WeekView({ anchor, byDay, onOpen }: {
  anchor: Date;
  byDay: Map<string, EventItem[]>;
  onOpen: (e: EventItem) => void;
}) {
  const { t, lang } = useT();
  const days = useMemo(() => weekDays(anchor), [anchor]);
  const today = new Date();
  const scrollRef = useRef<HTMLDivElement>(null);

  // Red "now" line, re-computed every minute.
  const [nowMin, setNowMin] = useState(() => today.getHours() * 60 + today.getMinutes());
  useEffect(() => {
    const id = setInterval(() => {
      const n = new Date();
      setNowMin(n.getHours() * 60 + n.getMinutes());
    }, 60_000);
    return () => clearInterval(id);
  }, []);

  // On mount: scroll the grid down to 08:00.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 2 * HOUR_H });
  }, []);

  const hours = useMemo(
    () => Array.from({ length: (DAY_END - DAY_START) / 60 }, (_, i) => DAY_START / 60 + i),
    [],
  );
  const layouts = useMemo(
    () => days.map((d) => layoutDay(byDay.get(toISO(d)) ?? [])),
    [days, byDay],
  );
  const allDay = useMemo(
    () => days.map((d) => (byDay.get(toISO(d)) ?? []).filter((e) => toMinutes(e.start_time) === null)),
    [days, byDay],
  );
  const hasAllDay = allDay.some((l) => l.length > 0);
  const gridMinWidth = GUTTER_W + 7 * COL_W;

  return (
    <div className="overflow-x-auto">
      <div style={{ minWidth: gridMinWidth }}>
        {/* Day headers */}
        <div className="sticky top-0 z-10 flex border-b border-slate-200 bg-[#F3F5F8]">
          <div style={{ width: GUTTER_W }} className="shrink-0" />
          {days.map((d, i) => {
            const isToday = sameDay(d, today);
            return (
              <div key={i} className="flex-1 py-1.5 text-center" style={{ minWidth: COL_W }}>
                <div className="text-[0.6rem] font-bold uppercase tracking-wide text-slate-400">
                  {dayName(i, lang)}
                </div>
                <div className={cn(
                  "mx-auto grid h-6 w-6 place-items-center rounded-full font-mono text-xs font-bold tabular-nums",
                  isToday ? "bg-[#2F6FED] text-white" : "text-slate-700",
                )}>
                  {d.getDate()}
                </div>
              </div>
            );
          })}
        </div>

        {/* All-day strip (date, no time) */}
        {hasAllDay && (
          <div className="flex border-b border-slate-200 bg-white/60">
            <div style={{ width: GUTTER_W }}
              className="shrink-0 py-1 pr-1 text-right text-[0.55rem] font-bold uppercase text-slate-400">
              {t("All day", "நாள் முழுதும்")}
            </div>
            {allDay.map((list, i) => (
              <div key={i} className="flex-1 space-y-0.5 p-0.5" style={{ minWidth: COL_W }}>
                {list.map((e) => {
                  const meta = typeMeta(e.event_type);
                  const processing = e.status === "QUEUED" || e.status === "PROCESSING";
                  return (
                    <button key={e.id} onClick={() => onOpen(e)}
                      style={{ backgroundColor: `${meta.color}1A`, borderColor: meta.color }}
                      className={cn(
                        "block w-full truncate rounded-md border-l-[3px] px-1.5 py-0.5 text-left text-[0.65rem] font-bold text-slate-800",
                        processing && "animate-pulse",
                      )}>
                      {e.display_title}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        )}

        {/* Time grid */}
        <div ref={scrollRef} className="overflow-y-auto" style={{ maxHeight: "62vh" }}>
          <div className="relative flex" style={{ height: ((DAY_END - DAY_START) / 60) * HOUR_H }}>
            {/* Hour gutter */}
            <div style={{ width: GUTTER_W }} className="relative shrink-0">
              {hours.map((h) => (
                <div key={h}
                  style={{ top: (h - DAY_START / 60) * HOUR_H }}
                  className="absolute right-1 -translate-y-1/2 font-mono text-[0.6rem] font-medium tabular-nums text-slate-400">
                  {h === DAY_START / 60 ? "" : `${pad2(h)}:00`}
                </div>
              ))}
            </div>

            {/* Day columns */}
            {days.map((d, i) => {
              const isToday = sameDay(d, today);
              const showNow = isToday && nowMin >= DAY_START && nowMin <= DAY_END;
              return (
                <div key={i}
                  className={cn("relative flex-1 border-l border-slate-200", isToday && "bg-[#2F6FED]/[0.04]")}
                  style={{ minWidth: COL_W }}>
                  {/* hour lines */}
                  {hours.map((h) => (
                    <div key={h}
                      style={{ top: (h - DAY_START / 60) * HOUR_H }}
                      className="absolute inset-x-0 border-t border-slate-100" />
                  ))}
                  {/* events */}
                  {layouts[i].map((p) => (
                    <EventBlock key={p.event.id} placed={p} onOpen={onOpen} />
                  ))}
                  {/* now line */}
                  {showNow && (
                    <div
                      style={{ top: ((nowMin - DAY_START) / 60) * HOUR_H }}
                      className="pointer-events-none absolute inset-x-0 z-10 border-t-2 border-[#B2372D]">
                      <span className="absolute -left-1 -top-[5px] h-2 w-2 rounded-full bg-[#B2372D]" />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
