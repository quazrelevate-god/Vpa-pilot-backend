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

  // Visible span (inclusive) for the current mode + anchor.
  const span = useMemo(() => {
    if (mode === "week") {
      const days = weekDays(anchor);
      return { start: toISO(days[0]), end: toISO(days[6]) };
    }
    const cells = monthCells(anchor);
    return { start: toISO(cells[0]), end: toISO(cells[41]) };
  }, [mode, anchor]);

  const load = useCallback((silent = false) => {
    if (!silent) setLoading(true);
    api.range(span.start, span.end)
      .then((d) => setEvents(d.items))
      .catch(() => {})
      .finally(() => setLoading(false));
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
    if (dir === 0) { setAnchor(new Date()); return; }
    setAnchor((a) => mode === "week"
      ? addDays(a, dir * 7)
      : new Date(a.getFullYear(), a.getMonth() + dir, 1));
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
    <div className="flex flex-col">
      {/* Controls */}
      <div className="flex items-center gap-2 px-4 pb-2 pt-3">
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

        <div className="ml-auto flex items-center gap-1.5">
          <button onClick={() => navigate(-1)} aria-label={t("Previous", "முந்தைய")}
            className="grid h-11 w-11 place-items-center rounded-lg border border-slate-200 bg-white text-slate-500 active:bg-slate-50">
            <ChevronLeft className="h-6 w-6" strokeWidth={1.75} />
          </button>
          <button onClick={() => navigate(0)}
            className="h-11 rounded-lg border border-slate-200 bg-white px-4 text-base font-bold text-[#21395B] active:bg-slate-50">
            {t("Today", "இன்று")}
          </button>
          <button onClick={() => navigate(1)} aria-label={t("Next", "அடுத்த")}
            className="grid h-11 w-11 place-items-center rounded-lg border border-slate-200 bg-white text-slate-500 active:bg-slate-50">
            <ChevronRight className="h-6 w-6" strokeWidth={1.75} />
          </button>
        </div>
      </div>

      {/* Range label */}
      <div className="px-4 pb-2 font-mono text-base font-semibold tabular-nums text-slate-600">
        {mode === "month" ? monthLabel(anchor, lang) : weekRangeLabel(anchor, lang)}
        {loading && <span className="ml-2 inline-block h-3 w-3 animate-spin rounded-full border border-slate-300 border-t-transparent align-middle" />}
      </div>

      {mode === "week" ? (
        <WeekView anchor={anchor} byDay={byDay} onOpen={onOpen} focusISO={focusISO} />
      ) : mode === "glance" ? (
        <GlanceView anchor={anchor} byDay={byDay} onOpen={onOpen} />
      ) : (
        <MonthView anchor={anchor} byDay={byDay} onOpen={onOpen} onOpenDay={jumpToDate} />
      )}

      <CaptureFab onSent={onSent} />
    </div>
  );
}
