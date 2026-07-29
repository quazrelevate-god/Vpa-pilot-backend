"use client";

// Overview: event-first briefing screen for the Head of Advisors + PAs.
//
// Layout (top → bottom):
//   • Hero card — today's date, count of events today, next-up card
//   • KPI row — Today / This week / Awaiting approval / Needs attention
//   • Agenda — Next up to 5 approved upcoming events (tap opens EventPopup)
//   • Charts — This-week type distribution (donut) + attendance-this-month pill
//   • Volume — Last-8-weeks sparkline (small BarChart)
//   • Collapsed: office-wide petition/ticket totals from the PA portal side,
//     kept here so advisors who want the whole office snapshot can still get it.
//
// All numeric values render in mono (IBM Plex Mono, per DESIGN.md).

import { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  BarChart, Bar, PieChart, Pie, Cell, ResponsiveContainer, XAxis, Tooltip,
} from "recharts";
import { api } from "../_lib/api";
import type { EventItem, EventsOverview, OverviewData } from "../_lib/types";
import { EVENT_TYPE_META, displayTitle, pickVenue, typeMeta } from "../_lib/types";
import { fmtLongDate, fmtTime, fromISO, monthLabel, toISO } from "../_lib/dates";
import { useT } from "../_lib/i18n";
import {
  AlertTriangle, Building2, CalendarCheck, CalendarDays, CheckCircle2,
  ChevronDown, Clock, FileText, Handshake, MapPin, Ticket,
} from "../_lib/icons";
import EventPopup from "./EventPopup";

// Design-system tones (see DESIGN.md palette).
const TONE = {
  brand:  { bg: "bg-[#2F6FED]/10", fg: "text-[#2F6FED]" },
  navy:   { bg: "bg-[#21395B]/10", fg: "text-[#21395B]" },
  mint:   { bg: "bg-[#DCFAE6]",    fg: "text-[#0F8B4C]" },
  amber:  { bg: "bg-[#FEF0D9]",    fg: "text-[#B45309]" },
  rose:   { bg: "bg-[#FEE4E2]",    fg: "text-[#C0362C]" },
  violet: { bg: "bg-[#EDE9FE]",    fg: "text-[#6D28D9]" },
} as const;

type Tone = keyof typeof TONE;

function KpiTile({
  icon: Icon, tone, label, value, caption,
}: {
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  tone: Tone; label: string; value: number; caption?: string;
}) {
  const t = TONE[tone];
  return (
    <Card className="flex flex-col gap-3 rounded-2xl border-slate-100 p-4 shadow-sm">
      <span className={cn("grid h-9 w-9 place-items-center rounded-xl", t.bg, t.fg)}>
        <Icon className="h-[18px] w-[18px]" strokeWidth={1.75} />
      </span>
      <div className="min-w-0">
        <div className="text-[0.75rem] font-semibold leading-snug text-slate-500">{label}</div>
        <div className="font-mono text-[26px] font-bold leading-tight tracking-tight tabular-nums text-slate-900">
          {value.toLocaleString("en-IN")}
        </div>
        {caption && (
          <div className="text-[0.7rem] leading-snug text-slate-400">{caption}</div>
        )}
      </div>
    </Card>
  );
}

/** "elementary_education" → "Elementary Education" */
function prettyName(raw: string): string {
  return raw.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function OverviewScreen() {
  const { t, lang } = useT();
  const [data, setData] = useState<OverviewData | null>(null);
  const [openEvent, setOpenEvent] = useState<EventItem | null>(null);
  const [officeOpen, setOfficeOpen] = useState(false);

  useEffect(() => {
    let live = true;
    const load = () => api.overview()
      .then((d) => { if (live) setData(d); })
      .catch(() => {});
    load();
    const id = setInterval(load, 60_000);
    return () => { live = false; clearInterval(id); };
  }, []);

  if (!data) {
    return (
      <div className="space-y-3 px-4 pt-4">
        <Skeleton className="h-[136px] rounded-2xl" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-[124px] rounded-2xl" />)}
        </div>
        <Skeleton className="h-[220px] rounded-2xl" />
        <Skeleton className="h-[220px] rounded-2xl" />
      </div>
    );
  }

  return (
    <div className="space-y-6 px-4 pb-8 pt-4">
      <Hero events={data.events} lang={lang} t={t} onOpen={setOpenEvent} />

      {/* ── KPI row — 4 tiles ── */}
      <section>
        <SectionLabel icon={CalendarDays}>
          {t("At a glance", "நோட்டமிட")}
        </SectionLabel>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <KpiTile icon={CalendarDays} tone="brand"
            label={t("Today", "இன்று")} value={data.events.today}
            caption={t("scheduled today", "இன்று திட்டமிடப்பட்டவை")} />
          <KpiTile icon={CalendarCheck} tone="navy"
            label={t("This week", "இந்த வாரம்")} value={data.events.this_week}
            caption={weekRangeCaption(data.events.week_range, lang)} />
          <KpiTile icon={Clock} tone="amber"
            label={t("Awaiting approval", "ஒப்புதலுக்கு காத்திருக்கிறது")} value={data.events.awaiting_approval}
            caption={t("ready, pending Minister", "தயார், அமைச்சர் ஒப்புதலுக்காக")} />
          <KpiTile icon={AlertTriangle} tone="rose"
            label={t("Needs attention", "கவனம் தேவை")} value={data.events.needs_attention}
            caption={t("failed / undated / no time", "தோல்வி / தேதி / நேரம் இல்லை")} />
        </div>
      </section>

      {/* ── Next up: agenda card ── */}
      <NextUp events={data.events.next_events} lang={lang} t={t} onOpen={setOpenEvent} />

      {/* ── Two-column: by-type donut + attendance pill ── */}
      <section className="grid gap-4 md:grid-cols-2">
        <ByTypeCard rows={data.events.by_type_this_week} lang={lang} t={t} />
        <AttendanceCard data={data.events.attendance_this_month} lang={lang} t={t} />
      </section>

      {/* ── Volume sparkline ── */}
      <VolumeCard rows={data.events.volume_last_8_weeks} lang={lang} t={t} />

      {/* ── Collapsed office totals ── */}
      <section>
        <button
          onClick={() => setOfficeOpen((v) => !v)}
          className="flex w-full items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3 text-left shadow-sm transition-colors hover:bg-slate-50"
        >
          <span className="flex items-center gap-2 text-sm font-bold text-slate-700">
            <Building2 className="h-4 w-4 text-slate-400" strokeWidth={1.75} />
            {t("Office totals", "அலுவலக மொத்தம்")}
            <span className="ml-1.5 text-[0.7rem] font-medium text-slate-400">
              {t("(tickets, petitions, appointments)", "(டிக்கெட், மனுக்கள், சந்திப்புகள்)")}
            </span>
          </span>
          <ChevronDown
            className={cn("h-4 w-4 text-slate-400 transition-transform", officeOpen && "rotate-180")}
            strokeWidth={2}
          />
        </button>
        {officeOpen && <OfficeTotals data={data} lang={lang} t={t} />}
      </section>

      <EventPopup
        event={openEvent}
        onClose={() => setOpenEvent(null)}
        onChanged={(u) => setOpenEvent(u)}
        onDeleted={() => setOpenEvent(null)}
      />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Sub-components
// ═══════════════════════════════════════════════════════════════════════════

function SectionLabel({ icon: Icon, children }: {
  icon?: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  children: React.ReactNode;
}) {
  return (
    <h2 className="mb-3 flex items-center gap-1.5 text-[0.7rem] font-extrabold uppercase tracking-widest text-slate-400">
      {Icon && <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />}
      {children}
    </h2>
  );
}

/** Hero — today's date + "Events today: N" + a next-up chip. Blue gradient
 *  card, higher visual weight than KPI tiles, so an advisor gets the
 *  briefing headline before anything else. */
function Hero({
  events, lang, t, onOpen,
}: {
  events: EventsOverview; lang: "en" | "ta"; t: (en: string, ta: string) => string;
  onOpen: (e: EventItem) => void;
}) {
  const today = new Date();
  const dateLabel = fmtLongDate(toISO(today), lang);
  const nextEvent = events.next_events[0];
  return (
    <Card className="overflow-hidden rounded-2xl border-0 bg-gradient-to-br from-[#21395B] to-[#2F6FED] p-0 shadow-md">
      <div className="grid gap-5 p-5 sm:grid-cols-[1fr_auto] sm:items-center">
        <div className="min-w-0">
          <div className="text-[0.7rem] font-bold uppercase tracking-widest text-white/60">
            {dateLabel}
          </div>
          <div className="mt-1 flex items-baseline gap-3">
            <span className="font-mono text-[52px] font-bold leading-none tabular-nums text-white">
              {events.today}
            </span>
            <span className="text-base font-semibold leading-tight text-white/85">
              {events.today === 1
                ? t("event today", "இன்று 1 நிகழ்வு")
                : t("events today", "இன்று நிகழ்வுகள்")}
            </span>
          </div>
          <div className="mt-1 text-[0.85rem] text-white/70">
            {events.upcoming > 0
              ? t(
                  `${events.upcoming} upcoming · ${events.this_month} this month`,
                  `${events.upcoming} வரவிருக்கிறது · ${events.this_month} இந்த மாதம்`,
                )
              : t("Nothing scheduled ahead", "வரவுள்ள நிகழ்வு இல்லை")}
          </div>
        </div>

        {nextEvent ? (
          <button
            onClick={() => onOpen(nextEvent)}
            className="group flex min-w-0 items-start gap-3 rounded-xl bg-white/12 p-3 text-left transition-colors hover:bg-white/20 sm:max-w-[320px]"
          >
            <span
              className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: typeMeta(nextEvent.event_type).color }}
            />
            <div className="min-w-0">
              <div className="text-[0.65rem] font-bold uppercase tracking-widest text-white/60">
                {t("Next up", "அடுத்தது")}
              </div>
              <div className="mt-0.5 truncate text-[0.95rem] font-bold text-white">
                {displayTitle(nextEvent, lang)}
              </div>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-2 font-mono text-[11px] tabular-nums text-white/75">
                <span>{shortDate(nextEvent.date, lang)}</span>
                {nextEvent.start_time && <span>· {fmtTime(nextEvent.start_time)}</span>}
              </div>
              {pickVenue(nextEvent, lang) && (
                <div className="mt-0.5 truncate text-[11px] text-white/60">
                  {pickVenue(nextEvent, lang)}
                </div>
              )}
            </div>
          </button>
        ) : (
          <div className="rounded-xl bg-white/10 p-3 text-center text-[0.8rem] text-white/70 sm:max-w-[220px]">
            {t("Calendar clear.", "நாட்காட்டி வெறுமை.")}
          </div>
        )}
      </div>
    </Card>
  );
}

function NextUp({
  events, lang, t, onOpen,
}: {
  events: EventItem[]; lang: "en" | "ta"; t: (en: string, ta: string) => string;
  onOpen: (e: EventItem) => void;
}) {
  return (
    <section>
      <SectionLabel icon={CalendarCheck}>
        {t("Next up", "வரவிருக்கும் நிகழ்வுகள்")}
        {events.length > 0 && (
          <span className="ml-1 font-mono font-black text-slate-500">· {events.length}</span>
        )}
      </SectionLabel>
      <Card className="overflow-hidden rounded-2xl border-slate-100 p-0 shadow-sm">
        {events.length === 0 ? (
          <div className="grid place-items-center gap-2 py-10 text-center text-sm text-slate-400">
            <CalendarDays className="h-8 w-8 text-slate-300" strokeWidth={1.5} />
            {t("Nothing scheduled ahead.", "வரவுள்ள நிகழ்வு இல்லை.")}
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {events.map((e) => {
              const meta = typeMeta(e.event_type);
              return (
                <li key={e.id}>
                  <button
                    onClick={() => onOpen(e)}
                    className="grid w-full grid-cols-[auto_1fr_auto] items-center gap-3 px-4 py-3 text-left hover:bg-slate-50"
                  >
                    {/* Date bubble */}
                    <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-slate-200 bg-white text-center">
                      <span className="font-mono text-[9px] font-black uppercase tabular-nums text-slate-400 leading-none">
                        {monthShort(e.date, lang)}
                      </span>
                      <span className="font-mono text-[16px] font-bold tabular-nums text-slate-800 leading-none">
                        {dayNum(e.date)}
                      </span>
                    </span>

                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span
                          className="h-1.5 w-1.5 shrink-0 rounded-full"
                          style={{ backgroundColor: meta.color }}
                        />
                        <span className="truncate text-[0.9rem] font-bold text-slate-800">
                          {displayTitle(e, lang)}
                        </span>
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11.5px] text-slate-500">
                        <span className="inline-flex items-center gap-1">
                          <Clock className="h-3 w-3" strokeWidth={2} />
                          <span className="font-mono tabular-nums">
                            {e.start_time ? fmtTime(e.start_time) : "--:--"}
                            {e.end_time && ` – ${fmtTime(e.end_time)}`}
                          </span>
                        </span>
                        {pickVenue(e, lang) && (
                          <span className="inline-flex min-w-0 items-center gap-1">
                            <MapPin className="h-3 w-3 shrink-0" strokeWidth={2} />
                            <span className="truncate">{pickVenue(e, lang)}</span>
                          </span>
                        )}
                      </div>
                    </div>

                    <span
                      className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold"
                      style={{
                        backgroundColor: `${meta.color}18`,
                        color: meta.color,
                      }}
                    >
                      {t(meta.en, meta.ta)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </section>
  );
}

function ByTypeCard({
  rows, lang, t,
}: {
  rows: { type: string; count: number }[]; lang: "en" | "ta";
  t: (en: string, ta: string) => string;
}) {
  const total = useMemo(() => rows.reduce((a, r) => a + r.count, 0), [rows]);
  const data = useMemo(
    () => rows.map((r) => {
      const meta = typeMeta(r.type);
      return { name: t(meta.en, meta.ta), value: r.count, color: meta.color, key: r.type };
    }),
    [rows, lang, t],
  );

  return (
    <Card className="rounded-2xl border-slate-100 p-4 shadow-sm">
      <SectionLabel icon={CalendarDays}>
        {t("This week by type", "இந்த வாரம் வகை வாரியாக")}
      </SectionLabel>
      {total === 0 ? (
        <div className="grid place-items-center gap-2 py-10 text-center text-sm text-slate-400">
          {t("No events this week yet.", "இந்த வாரம் நிகழ்வுகள் இல்லை.")}
        </div>
      ) : (
        <div className="grid grid-cols-[140px_1fr] items-center gap-4">
          {/* Donut with the total in the middle */}
          <div className="relative h-[140px] w-[140px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={data}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={44}
                  outerRadius={66}
                  paddingAngle={2}
                  stroke="none"
                  isAnimationActive={false}
                >
                  {data.map((d) => <Cell key={d.key} fill={d.color} />)}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-0 grid place-items-center">
              <div className="text-center">
                <div className="font-mono text-2xl font-bold tabular-nums text-slate-900 leading-none">
                  {total}
                </div>
                <div className="mt-0.5 text-[0.62rem] font-bold uppercase tracking-wider text-slate-400">
                  {t("total", "மொத்தம்")}
                </div>
              </div>
            </div>
          </div>

          {/* Legend */}
          <ul className="space-y-1.5 min-w-0">
            {data.map((d) => {
              const pct = total > 0 ? Math.round((d.value / total) * 100) : 0;
              return (
                <li key={d.key} className="flex items-center gap-2 text-[12.5px]">
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-sm"
                    style={{ backgroundColor: d.color }}
                  />
                  <span className="truncate text-slate-700">{d.name}</span>
                  <span className="ml-auto shrink-0 font-mono font-bold tabular-nums text-slate-900">
                    {d.value}
                    <span className="ml-1 font-normal text-slate-400">({pct}%)</span>
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </Card>
  );
}

function AttendanceCard({
  data, lang, t,
}: {
  data: { attended: number; not_attended: number };
  lang: "en" | "ta"; t: (en: string, ta: string) => string;
}) {
  const total = data.attended + data.not_attended;
  const monthName = monthLabel(new Date(), lang);
  const attendedPct = total > 0 ? Math.round((data.attended / total) * 100) : 0;

  return (
    <Card className="rounded-2xl border-slate-100 p-4 shadow-sm">
      <SectionLabel icon={CheckCircle2}>
        {t("This month attendance", "இந்த மாத வருகை")}
        <span className="ml-1.5 font-medium text-slate-400 normal-case tracking-normal">
          · {monthName}
        </span>
      </SectionLabel>

      {total === 0 ? (
        <div className="grid place-items-center gap-2 py-10 text-center text-sm text-slate-400">
          {t("Nothing to score yet.", "இன்னும் மதிப்பிட எதுவும் இல்லை.")}
        </div>
      ) : (
        <>
          {/* Attendance rate — the headline number */}
          <div className="flex items-baseline gap-2">
            <span className="font-mono text-[36px] font-bold leading-none tabular-nums text-[#0F8B4C]">
              {attendedPct}%
            </span>
            <span className="text-sm font-semibold text-slate-500">
              {t("attended", "வருகை பதிந்தது")}
            </span>
          </div>

          {/* Stacked bar */}
          <div className="mt-4 flex h-3 w-full overflow-hidden rounded-full bg-slate-100">
            {data.attended > 0 && (
              <div
                className="h-full bg-[#0F8B4C]"
                style={{ width: `${(data.attended / total) * 100}%` }}
              />
            )}
            {data.not_attended > 0 && (
              <div
                className="h-full bg-[#C0362C]"
                style={{ width: `${(data.not_attended / total) * 100}%` }}
              />
            )}
          </div>

          {/* Legend chips — now binary: attended vs not attended. The old
              "not marked" bucket was tied to the dropped attendance column
              and is always zero under the new is_approved-as-attended model. */}
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[12px]">
            <LegendChip color="#0F8B4C" label={t("Attended", "வருகை")} value={data.attended} />
            <LegendChip color="#C0362C" label={t("Not attended", "வரவில்லை")} value={data.not_attended} />
          </div>
        </>
      )}
    </Card>
  );
}

function LegendChip({ color, label, value }: { color: string; label: string; value: number }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: color }} />
      <span className="text-slate-600">{label}</span>
      <span className="font-mono font-bold tabular-nums text-slate-900">{value}</span>
    </span>
  );
}

function VolumeCard({
  rows, lang, t,
}: {
  rows: { week_start: string; count: number }[]; lang: "en" | "ta";
  t: (en: string, ta: string) => string;
}) {
  const total = useMemo(() => rows.reduce((a, r) => a + r.count, 0), [rows]);
  const data = useMemo(
    () => rows.map((r) => ({
      key: r.week_start,
      count: r.count,
      // Short label — "Jul 20" — for the x-axis tick.
      label: shortDate(r.week_start, lang),
    })),
    [rows, lang],
  );

  return (
    <Card className="rounded-2xl border-slate-100 p-4 shadow-sm">
      <SectionLabel icon={CalendarDays}>
        {t("Last 8 weeks", "கடந்த 8 வாரங்கள்")}
        <span className="ml-1.5 font-mono font-black text-slate-500">· {total}</span>
      </SectionLabel>
      {total === 0 ? (
        <div className="grid place-items-center gap-2 py-8 text-center text-sm text-slate-400">
          {t("No history in this window.", "இந்த காலத்தில் வரலாறு இல்லை.")}
        </div>
      ) : (
        <div className="h-[140px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 10, right: 4, bottom: 0, left: 4 }}>
              <XAxis
                dataKey="label"
                axisLine={false}
                tickLine={false}
                tick={{ fontSize: 10, fill: "#94A3B8", fontFamily: "IBM Plex Mono, monospace" }}
                interval={0}
              />
              <Tooltip
                cursor={{ fill: "#F1F5F9" }}
                contentStyle={{
                  border: "1px solid #E2E8F0",
                  borderRadius: 8,
                  fontSize: 12,
                  padding: "6px 10px",
                }}
                labelFormatter={(v) => `${t("Week of", "வாரம்")} ${v}`}
                formatter={(v: number) => [v, t("events", "நிகழ்வுகள்")]}
              />
              <Bar dataKey="count" fill="#2F6FED" radius={[4, 4, 0, 0]} maxBarSize={28} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </Card>
  );
}

function OfficeTotals({
  data, lang, t,
}: {
  data: OverviewData; lang: "en" | "ta"; t: (en: string, ta: string) => string;
}) {
  const maxDept = Math.max(1, ...data.departments.map((d) => d.count));
  const barColors = ["#2F6FED", "#21395B", "#0F8B4C", "#B45309", "#6D28D9", "#0E7490", "#C0362C", "#5A6472"];

  return (
    <div className="mt-3 space-y-5 rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
      <div>
        <SectionLabel>{t("Today", "இன்று")}</SectionLabel>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <KpiTile icon={Ticket} tone="brand"
            label={t("Tickets", "டிக்கெட்")} value={data.today.tickets}
            caption={t("raised today", "இன்று எழுப்பப்பட்டவை")} />
          <KpiTile icon={CalendarCheck} tone="mint"
            label={t("Appointments", "சந்திப்புகள்")} value={data.today.appointments}
            caption={t("scheduled today", "இன்று திட்டமிடப்பட்டவை")} />
          <KpiTile icon={FileText} tone="amber"
            label={t("Petitions", "மனுக்கள்")} value={data.today.petitions_received}
            caption={t("received today", "இன்று பெறப்பட்டவை")} />
        </div>
      </div>

      <div>
        <SectionLabel>{t("Overall", "மொத்தம்")}</SectionLabel>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <KpiTile icon={Ticket} tone="brand"
            label={t("Tickets", "டிக்கெட்")} value={data.totals.tickets}
            caption={t("all time", "மொத்தமாக")} />
          <KpiTile icon={CalendarCheck} tone="mint"
            label={t("Appointments", "சந்திப்புகள்")} value={data.totals.appointments}
            caption={t("all time", "மொத்தமாக")} />
          <KpiTile icon={Handshake} tone="violet"
            label={t("Meetings", "கூட்டங்கள்")} value={data.totals.meetings}
            caption={t("slot-booked", "நேரம் ஒதுக்கப்பட்டவை")} />
          <KpiTile icon={FileText} tone="amber"
            label={t("Petitions", "மனுக்கள்")} value={data.totals.petitions_received}
            caption={t("all time", "மொத்தமாக")} />
          <KpiTile icon={Clock} tone="rose"
            label={t("Awaiting review", "மதிப்பாய்வு நிலுவை")} value={data.totals.petitions_awaiting}
            caption={t("pending PA review", "PA மதிப்பாய்வு நிலுவை")} />
          <KpiTile icon={CheckCircle2} tone="mint"
            label={t("Reviewed", "மதிப்பாய்வு")} value={data.totals.petitions_reviewed}
            caption={t("all time", "மொத்தமாக")} />
        </div>
      </div>

      <div>
        <SectionLabel icon={Building2}>
          {t("Tickets by department", "துறை வாரியாக டிக்கெட்")}
        </SectionLabel>
        {data.departments.length === 0 ? (
          <div className="py-6 text-center text-base text-slate-400">
            {t("No tickets routed to departments yet.", "இன்னும் துறைகளுக்கு டிக்கெட் இல்லை.")}
          </div>
        ) : (
          <div className="space-y-3">
            {data.departments.map((d, i) => (
              <div key={d.name}>
                <div className="mb-1 flex items-baseline justify-between gap-2">
                  <span className="min-w-0 truncate text-[0.9rem] font-semibold text-slate-700">
                    {prettyName(d.name)}
                  </span>
                  <span className="shrink-0 font-mono text-[0.9rem] font-bold tabular-nums text-slate-900">
                    {d.count}
                  </span>
                </div>
                <div className="h-2.5 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${Math.max(6, (d.count / maxDept) * 100)}%`,
                      backgroundColor: barColors[i % barColors.length],
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Small formatting helpers
// ═══════════════════════════════════════════════════════════════════════════

const MONTHS_EN_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const MONTHS_TA_SHORT = ["ஜன","பிப்","மார்","ஏப்","மே","ஜூன்","ஜூலை","ஆக","செப்","அக்","நவ","டிச"];

function monthShort(iso: string | null, lang: "en" | "ta"): string {
  if (!iso) return "—";
  const d = fromISO(iso);
  return (lang === "ta" ? MONTHS_TA_SHORT : MONTHS_EN_SHORT)[d.getMonth()];
}
function dayNum(iso: string | null): string {
  if (!iso) return "—";
  return String(fromISO(iso).getDate());
}
function shortDate(iso: string | null, lang: "en" | "ta"): string {
  if (!iso) return "—";
  const d = fromISO(iso);
  const m = (lang === "ta" ? MONTHS_TA_SHORT : MONTHS_EN_SHORT)[d.getMonth()];
  return `${m} ${d.getDate()}`;
}
function weekRangeCaption(range: { start: string; end: string }, lang: "en" | "ta"): string {
  const a = fromISO(range.start);
  const b = fromISO(range.end);
  const months = lang === "ta" ? MONTHS_TA_SHORT : MONTHS_EN_SHORT;
  if (a.getMonth() === b.getMonth()) {
    return `${a.getDate()}–${b.getDate()} ${months[a.getMonth()]}`;
  }
  return `${a.getDate()} ${months[a.getMonth()]} – ${b.getDate()} ${months[b.getMonth()]}`;
}
