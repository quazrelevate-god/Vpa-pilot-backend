"use client";

// Teams-like week grid, full day 12am → 12am: hour gutter × 7 day columns,
// events absolutely positioned by their start/end minutes, greedy
// column-assignment for overlapping events, an all-day strip for date-only
// events, and a red "now" line on today. When focusISO is set (tapped from
// month view), the grid scrolls that day's column — and its first event —
// into view.
//
// Layout: ONE scroll container (both axes). The hour gutter is `sticky left-0`
// inside it and the day-header row is `sticky top-0`, so gutter labels and
// grid rows can never drift apart — they are the same row of the same
// scrolling content. (A previous version froze the gutter in its own column
// and synced scrollTop with a JS listener; the listener attached before the
// scroller ref existed and the spacer heights didn't match the real header,
// so labels and events misaligned.)

import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import type { EventItem } from "../_lib/types";
import { typeMeta } from "../_lib/types";
import { dayName, fmtTime, pad2, sameDay, toISO, toMinutes, weekDays } from "../_lib/dates";
import { useT } from "../_lib/i18n";

const DAY_START = 0 * 60;    // grid shows 00:00 …
const DAY_END   = 24 * 60;   // … 24:00 (midnight to midnight)
const HOUR_H    = 40;        // px per hour — compact to show more rows at once
const COL_W     = 88;        // min px per day column
const GUTTER_W  = 58;   // wide enough for 12-hour labels with breathing room
const GRID_H    = ((DAY_END - DAY_START) / 60) * HOUR_H;

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
  const top    = ((Math.max(startMin, DAY_START) - DAY_START) / 60) * HOUR_H;
  const height = Math.max(((Math.min(endMin, DAY_END) - Math.max(startMin, DAY_START)) / 60) * HOUR_H, 30);
  const width  = 100 / cols;
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
        "absolute overflow-hidden rounded-md border-l-4 px-1.5 py-1 text-left",
        processing && "animate-pulse",
      )}>
      <div className="truncate text-[0.75rem] font-bold leading-tight text-slate-800">
        {e.display_title}
      </div>
      <div className="truncate font-mono text-[0.68rem] font-medium tabular-nums text-slate-500">
        {fmtTime(e.start_time)}
      </div>
    </button>
  );
}

export default function WeekView({ anchor, byDay, onOpen, focusISO }: {
  anchor: Date;
  byDay: Map<string, EventItem[]>;
  onOpen: (e: EventItem) => void;
  focusISO?: string | null;
}) {
  const { t, lang } = useT();
  const days  = useMemo(() => weekDays(anchor), [anchor]);
  const today = new Date();
  // Single scroll container — gutter, headers and columns all live inside it.
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

  // Scroll once to focusISO column / first event, or default to 08:00.
  // Each scroll applies ONCE — byDay changes identity on silent polls and
  // re-scrolling then would yank the user's position mid-reading.
  const appliedFocus  = useRef<string | null>(null);
  const didInitScroll = useRef(false);
  useEffect(() => {
    const dayISOs = days.map(toISO);
    const idx = focusISO ? dayISOs.indexOf(focusISO) : -1;
    if (idx >= 0 && appliedFocus.current !== focusISO) {
      appliedFocus.current = focusISO ?? null;
      didInitScroll.current = true;
      const first = (byDay.get(focusISO!) ?? [])
        .map((e) => toMinutes(e.start_time))
        .filter((m): m is number => m !== null)
        .sort((a, b) => a - b)[0];
      const targetMin = first ?? 8 * 60;
      scrollRef.current?.scrollTo({
        left: Math.max(0, idx * COL_W - COL_W / 2),
        top: Math.max(0, ((targetMin - DAY_START) / 60) * HOUR_H - HOUR_H / 2),
      });
    } else if (idx < 0 && !didInitScroll.current) {
      didInitScroll.current = true;
      scrollRef.current?.scrollTo({ top: (8 * 60 - DAY_START) / 60 * HOUR_H }); // default to 08:00
    }
  }, [focusISO, days, byDay]);

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

  const gutterCell = "sticky left-0 z-20 shrink-0 bg-[#F3F5F8]";

  return (
    <div ref={scrollRef} className="overflow-auto overscroll-contain" style={{ maxHeight: "72vh" }}>
      <div style={{ minWidth: GUTTER_W + 7 * COL_W }}>

        {/* ── Day headers (sticky top; corner cell also sticky left) ────────── */}
        <div className="sticky top-0 z-30 flex border-b border-slate-200 bg-[#F3F5F8]">
          <div style={{ width: GUTTER_W, minWidth: GUTTER_W }} className={gutterCell} />
          {days.map((d, i) => {
            const isToday = sameDay(d, today);
            const isFocus = focusISO === toISO(d);
            return (
              <div key={i} className="flex-1 py-2 text-center" style={{ minWidth: COL_W }}>
                <div className="text-[0.72rem] font-bold uppercase tracking-wide text-slate-400">
                  {dayName(i, lang)}
                </div>
                <div className={cn(
                  "mx-auto grid h-8 w-8 place-items-center rounded-full font-mono text-base font-bold tabular-nums",
                  isToday ? "bg-[#2F6FED] text-white"
                    : isFocus ? "ring-2 ring-[#2F6FED] text-[#2F6FED]" : "text-slate-700",
                )}>
                  {d.getDate()}
                </div>
              </div>
            );
          })}
        </div>

        {/* ── All-day strip (date, no time) ─────────────────────────────────── */}
        {hasAllDay && (
          <div className="flex border-b border-slate-200 bg-white/60">
            <div style={{ width: GUTTER_W, minWidth: GUTTER_W }}
              className={cn(gutterCell, "py-1 pr-1 text-right text-[0.55rem] font-bold uppercase leading-tight text-slate-400")}>
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
                        "block w-full truncate rounded-md border-l-4 px-1.5 py-1 text-left text-[0.8rem] font-bold text-slate-800",
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

        {/* ── Time grid: gutter + day columns in the SAME row ───────────────── */}
        <div className="flex" style={{ height: GRID_H }}>
          {/* Hour gutter — sticky left, same height as the columns, so each
              label sits exactly on its grid line. */}
          <div style={{ width: GUTTER_W, minWidth: GUTTER_W }} className={cn(gutterCell, "relative")}>
            {hours.map((h) => (
              <div key={h}
                style={{ top: (h - DAY_START / 60) * HOUR_H }}
                className="absolute inset-x-0 -translate-y-1/2 pl-1.5 pr-1.5 text-right font-mono text-[0.72rem] font-medium tabular-nums text-slate-400">
                {h === DAY_START / 60 ? "" : `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? "AM" : "PM"}`}
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
  );
}
