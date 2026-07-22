"use client";

// Teams-like week grid: hour gutter × 7 day columns, events absolutely
// positioned by their start/end minutes, greedy column-assignment for
// overlapping events, an all-day strip for date-only events, and a red
// "now" line on today. When focusISO is set (tapped from month view), the
// grid scrolls that day's column — and its first event — into view.
//
// Layout: the time gutter is sticky-left inside the single scroll container
// so it stays visible during horizontal scrolling while sharing the same
// vertical scroll position as the day columns.

import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import type { EventItem } from "../_lib/types";
import { typeMeta } from "../_lib/types";
import { dayName, fmtTime, pad2, sameDay, toISO, toMinutes, weekDays } from "../_lib/dates";
import { useT } from "../_lib/i18n";

const DAY_START = 0 * 60;    // grid shows 00:00 …
const DAY_END   = 24 * 60;   // … 24:00
const HOUR_H    = 40;        // px per hour — compact to show more rows at once
const COL_W     = 88;        // min px per day column — narrower so ~4 days fit without scrolling
const GUTTER_W  = 44;

type Placed = {
  event: EventItem;
  startMin: number;
  endMin: number;
  col: number;
  cols: number;
};

/** Greedy interval layout — unchanged from original. */
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
  const days    = useMemo(() => weekDays(anchor), [anchor]);
  const today   = new Date();
  // Single scroll container — both gutter and columns move together vertically.
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
  const appliedFocus   = useRef<string | null>(null);
  const didInitScroll  = useRef(false);
  useEffect(() => {
    const dayISOs = days.map(toISO);
    const idx = focusISO ? dayISOs.indexOf(focusISO) : -1;
    if (idx >= 0 && appliedFocus.current !== focusISO) {
      appliedFocus.current = focusISO ?? null;
      didInitScroll.current = true;
      scrollRef.current?.scrollTo({ left: Math.max(0, idx * COL_W - COL_W / 2) });
      const first = (byDay.get(focusISO!) ?? [])
        .map((e) => toMinutes(e.start_time))
        .filter((m): m is number => m !== null)
        .sort((a, b) => a - b)[0];
      const targetMin = first ?? 8 * 60;
      scrollRef.current?.scrollTo({ top: Math.max(0, (targetMin / 60) * HOUR_H - HOUR_H / 2) });
    } else if (idx < 0 && !didInitScroll.current) {
      didInitScroll.current = true;
      scrollRef.current?.scrollTo({ top: 8 * HOUR_H }); // default to 08:00
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
  const hasAllDay    = allDay.some((l) => l.length > 0);
  const gridMinWidth = 7 * COL_W; // gutter is outside the scroll, so not counted here

  return (
    // Outer wrapper: flex row — frozen gutter on the left, scrollable area on the right.
    <div className="flex overflow-hidden">

      {/* ── Frozen left gutter ───────────────────────────────────────────────── */}
      <div
        style={{ width: GUTTER_W, minWidth: GUTTER_W }}
        className="relative z-10 shrink-0 bg-[#F3F5F8]"
      >
        {/* Blank cell aligning with the day-header row height (40px) */}
        <div className="h-10 border-b border-slate-200" />

        {/* Blank cell aligning with the all-day strip (only when visible) */}
        {hasAllDay && <div className="border-b border-slate-200 py-1" style={{ minHeight: 32 }} />}

        {/* Hour labels — scroll in sync because this div is the same height
            as the time grid and sits inside the same outer flex row.
            We use a separate overflow-hidden div that mirrors the scroll
            position of scrollRef via onScroll forwarding below. */}
        <div
          ref={(el) => {
            // Keep the gutter labels vertically in sync with scrollRef.
            if (!el) return;
            const scroller = scrollRef.current;
            if (!scroller) return;
            const sync = () => { el.scrollTop = scroller.scrollTop; };
            scroller.addEventListener("scroll", sync, { passive: true });
            // cleanup handled by component unmount (ref callback limitation)
          }}
          className="overflow-hidden"
          style={{ height: "72vh" }}
        >
          <div style={{ height: ((DAY_END - DAY_START) / 60) * HOUR_H }} className="relative">
            {hours.map((h) => (
              <div
                key={h}
                style={{ top: (h - DAY_START / 60) * HOUR_H }}
                className="absolute right-1.5 -translate-y-1/2 font-mono text-[0.72rem] font-medium tabular-nums text-slate-400"
              >
                {h === 0 ? "" : `${pad2(h)}:00`}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Scrollable area (horizontal + vertical) ──────────────────────────── */}
      <div
        ref={scrollRef}
        className="overflow-auto flex-1"
        style={{ maxHeight: "calc(72vh + 40px + 1px)" /* header + grid, matches gutter */ }}
      >
        <div style={{ minWidth: gridMinWidth }}>

          {/* Day headers */}
          <div className="sticky top-0 z-10 flex border-b border-slate-200 bg-[#F3F5F8]">
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

          {/* All-day strip */}
          {hasAllDay && (
            <div className="flex border-b border-slate-200 bg-white/60">
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

          {/* Time grid — no gutter here, it lives in the frozen column */}
          <div style={{ height: ((DAY_END - DAY_START) / 60) * HOUR_H }} className="relative flex">
            {days.map((d, i) => {
              const isToday  = sameDay(d, today);
              const showNow  = isToday && nowMin >= DAY_START && nowMin <= DAY_END;
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
