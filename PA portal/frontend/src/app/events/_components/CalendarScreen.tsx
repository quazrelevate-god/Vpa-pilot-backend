"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { api } from "../_lib/api";
import type { EventItem } from "../_lib/types";
import {
  addDays, fromISO, monthCells, monthLabel, toISO, weekDays, weekRangeLabel,
} from "../_lib/dates";
import { useT } from "../_lib/i18n";
import { ChevronLeft, ChevronRight } from "../_lib/icons";
import WeekView from "./WeekView";
import MonthView from "./MonthView";
import GlanceView from "./GlanceView";
import CaptureFab from "./CaptureFab";

type Mode = "week" | "month" | "glance";

export default function CalendarScreen({ refreshKey, onOpen, onSent }: {
  refreshKey: number;
  onOpen: (e: EventItem) => void;
  onSent: () => void;
}) {
  const { t, lang } = useT();
  const [mode, setMode] = useState<Mode>("week");
  const [anchor, setAnchor] = useState(() => new Date());
  const [events, setEvents] = useState<EventItem[]>([]);
  const [loading, setLoading] = useState(true);
  // Day the week view should scroll into view (set by tapping a month cell).
  const [focusISO, setFocusISO] = useState<string | null>(null);
  // Bumped every time the Today button is pressed. WeekView listens on this
  // (not on `anchor`) so pressing Today still snaps to today's column even
  // when the anchor is already on today's week — the Sat/Sun-scrolled-off
  // case where the button would otherwise feel dead.
  const [todayJumpNonce, setTodayJumpNonce] = useState(0);

  // Visible span (inclusive) for the current mode + anchor.
  const span = useMemo(() => {
    if (mode === "week") {
      const days = weekDays(anchor);
      return { start: toISO(days[0]), end: toISO(days[6]) };
    }
    const cells = monthCells(anchor);
    return { start: toISO(cells[0]), end: toISO(cells[41]) };
  }, [mode, anchor]);

  // Request-sequence guard: rapid prev/next taps start overlapping range
  // fetches; without this the LAST-resolving (possibly older) response wins
  // and paints the wrong period — which then sticks if nothing visible is
  // processing (the poll is gated on that). Only the newest request applies.
  const reqSeq = useRef(0);
  const load = useCallback((silent = false) => {
    if (!silent) setLoading(true);
    const seq = ++reqSeq.current;
    api.range(span.start, span.end)
      .then((d) => { if (seq === reqSeq.current) setEvents(d.items); })
      .catch(() => {})
      .finally(() => { if (seq === reqSeq.current) setLoading(false); });
  }, [span.start, span.end]);

  useEffect(() => { load(); }, [load, refreshKey]);

  // Poll quietly while anything visible is still being extracted.
  const processing = events.some((e) => e.status === "QUEUED" || e.status === "PROCESSING");
  const pollRef = useRef(processing);
  pollRef.current = processing;
  useEffect(() => {
    const id = setInterval(() => { if (pollRef.current) load(true); }, 15_000);
    return () => clearInterval(id);
  }, [load]);

  function navigate(dir: -1 | 0 | 1) {
    setFocusISO(null);
    if (dir === 0) {
      setAnchor(new Date());
      // Bump nonce so WeekView re-runs its scroll-to-today effect even when
      // the anchor is already on today's week (React skips the anchor state
      // update when the two Date values are ===, but pressing Today should
      // still yank the view onto today's column regardless).
      setTodayJumpNonce((n) => n + 1);
      return;
    }
    setAnchor((a) => mode === "month"
      ? new Date(a.getFullYear(), a.getMonth() + dir, 1)
      : addDays(a, dir * 7));
  }

  /** Month cell tapped → open that date in week mode, scrolled into view. */
  function jumpToDate(iso: string) {
    setAnchor(fromISO(iso));
    setFocusISO(iso);
    setMode("week");
  }

  const byDay = useMemo(() => {
    const map = new Map<string, EventItem[]>();
    for (const e of events) {
      if (!e.date) continue;
      const list = map.get(e.date) ?? [];
      list.push(e);
      map.set(e.date, list);
    }
    return map;
  }, [events]);

  return (
    // Full height of <main>; the two control rows sit at the top as their
    // natural height, and the active view (WeekView / GlanceView / MonthView)
    // takes the remaining space via `flex-1 min-h-0` on its own container.
    // Only the WeekView timeline actually scrolls inside that space — the
    // shell doesn't scroll at all.
    <div className="flex h-full min-h-0 flex-col">
      {/* Row 1 — mode selector on the left, Today anchored to the right.
          `ml-auto` on Today keeps it flush right on any width; both items
          wrap to a second line only when there's truly no room. */}
      <div className="flex flex-wrap items-center gap-3 px-4 pb-2 pt-3">
        <div className="inline-flex items-center rounded-lg border border-[#E1E5EB] bg-[#EAEEF3] p-0.5">
          {(["week", "glance", "month"] as const).map((m) => (
            <button key={m} type="button"
              onClick={() => { setFocusISO(null); setMode(m); }} aria-pressed={mode === m}
              className={cn("rounded-md px-3 py-1.5 text-sm font-bold transition-colors",
                mode === m ? "bg-white text-[#21395B] shadow-sm" : "text-[#5A6472]")}>
              {m === "week" ? t("Week", "வாரம்") : m === "glance" ? t("Glance", "பார்வை") : t("Month", "மாதம்")}
            </button>
          ))}
        </div>

        <button onClick={() => navigate(0)}
          className="ml-auto h-11 rounded-lg border border-slate-200 bg-white px-4 text-base font-bold text-[#21395B] active:bg-slate-50">
          {t("Today", "இன்று")}
        </button>
      </div>

      {/* Row 2 — range label on the left, prev/next arrows anchored to the
          right. Arrows sit as a right-side group (like Today above) so the
          two rows read as a consistent "context on the left, action on the
          right" pair on any screen width. */}
      <div className="flex flex-wrap items-center gap-3 px-4 pb-2">
        <div className="font-mono text-base font-semibold tabular-nums text-slate-600">
          {mode === "month" ? monthLabel(anchor, lang) : weekRangeLabel(anchor, lang)}
          {loading && <span className="ml-2 inline-block h-4 w-4 animate-spin rounded-full border-2 border-[#21395B] border-t-transparent align-middle" />}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button onClick={() => navigate(-1)} aria-label={t("Previous", "முந்தைய")}
            className="grid h-10 w-10 place-items-center rounded-lg border border-slate-200 bg-white text-slate-500 active:bg-slate-50">
            <ChevronLeft className="h-5 w-5" strokeWidth={1.75} />
          </button>
          <button onClick={() => navigate(1)} aria-label={t("Next", "அடுத்த")}
            className="grid h-10 w-10 place-items-center rounded-lg border border-slate-200 bg-white text-slate-500 active:bg-slate-50">
            <ChevronRight className="h-5 w-5" strokeWidth={1.75} />
          </button>
        </div>
      </div>

      {/* Active view fills the remaining space. `min-h-0` is the flex-child
          escape hatch that lets WeekView's inner `overflow-auto` actually
          bound against this container's height instead of the content's
          natural height. */}
      <div className="min-h-0 flex-1">
        {mode === "week" ? (
          <WeekView anchor={anchor} byDay={byDay} onOpen={onOpen} focusISO={focusISO} todayJumpNonce={todayJumpNonce} />
        ) : mode === "glance" ? (
          <GlanceView anchor={anchor} byDay={byDay} onOpen={onOpen} />
        ) : (
          <MonthView anchor={anchor} byDay={byDay} onOpen={onOpen} onOpenDay={jumpToDate} />
        )}
      </div>

      <CaptureFab onSent={onSent} />
    </div>
  );
}
