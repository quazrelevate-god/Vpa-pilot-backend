"use client";

import { useMemo, useState } from "react";
import { CalendarDays, Clock, MapPin, Sparkles, AlertTriangle, CheckCircle2, TrendingUp, ChevronRight, CalendarRange } from "lucide-react";
import { Card } from "@/components/ui/card";
import { ChartCard, BarBreakdown, TrendArea, StatTile } from "@/components/insights/DashboardKit";
import { cn } from "@/lib/utils";
import { useT } from "../_lib/i18n";
import { api } from "../_lib/api";
import { useOverview } from "../_lib/useOverview";
import { ScreenState, KpiGrid, human } from "./kit";
import { type EventItem, displayTitle, pickVenue, typeMeta } from "../_lib/types";
import EventDetail from "./EventDetail";

type View = "overview" | "timeline";

function fmtDay(iso: string | null, lang: "en" | "ta"): string {
  if (!iso) return lang === "ta" ? "தேதி இல்லை" : "No date";
  try {
    return new Date(iso + "T00:00:00").toLocaleDateString(lang === "ta" ? "ta-IN" : "en-IN",
      { weekday: "long", day: "numeric", month: "long" });
  } catch { return iso; }
}

function EventRow({ e, onOpen }: { e: EventItem; onOpen: () => void }) {
  const { lang } = useT();
  const tm = typeMeta(e.event_type);
  const venue = pickVenue(e, lang);
  return (
    <button onClick={onOpen}
      className="flex w-full items-center gap-3 rounded-xl border border-border bg-card px-3.5 py-3 text-left transition-colors hover:bg-accent/60">
      <span className="h-9 w-1 shrink-0 rounded-full" style={{ background: tm.color }} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[14.5px] font-semibold text-foreground">{displayTitle(e, lang)}</div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[12px] text-muted-foreground">
          {e.start_time && <span className="inline-flex items-center gap-1 num"><Clock className="h-3 w-3" />{e.start_time}</span>}
          {venue && <span className="inline-flex min-w-0 items-center gap-1"><MapPin className="h-3 w-3 shrink-0" /><span className="truncate">{venue}</span></span>}
        </div>
      </div>
      {e.is_approved && <CheckCircle2 className="h-4 w-4 shrink-0 text-[#0F8B4C]" />}
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/60" />
    </button>
  );
}

// ── Overview view ─────────────────────────────────────────────────────────────
function EventsOverviewView({ onOpen }: { onOpen: (e: EventItem) => void }) {
  const { t, lang } = useT();
  const { data, err, loading } = useOverview(api.eventsOverview);

  const byType = useMemo(
    () => (data?.by_type_this_week ?? []).map((x) => {
      const tm = typeMeta(x.type);
      return { key: x.type, label: lang === "ta" ? tm.ta : tm.en, count: x.count };
    }),
    [data, lang],
  );
  const volume = useMemo(
    () => (data?.volume_last_8_weeks ?? []).map((v) => ({ date: v.week_start, received: v.count })),
    [data],
  );
  const attend = data?.attendance_last_30d;

  return (
    <ScreenState loading={loading} err={err}>
      {data && (
        <div className="space-y-3">
          <KpiGrid>
            <StatTile icon={CalendarDays} tone="brand" label={t("Today", "இன்று")} value={human(data.today)} />
            <StatTile icon={CalendarRange} tone="violet" label={t("This week", "இந்த வாரம்")}
              value={human(data.this_week)} caption={t(`${human(data.this_week_confirmed)} confirmed`, `${human(data.this_week_confirmed)} உறுதி`)} />
            <StatTile icon={TrendingUp} tone="mint" label={t("Upcoming", "வரவிருக்கும்")} value={human(data.upcoming)} />
            <StatTile icon={Sparkles} tone="amber" label={t("Awaiting confirm", "உறுதிக்காக")}
              value={human(data.awaiting_approval)} highlight={data.awaiting_approval > 0} />
            <StatTile icon={CheckCircle2} tone="mint" label={t("Attendance 30d", "வருகை 30நா")}
              value={attend?.rate != null ? `${attend.rate}%` : "—"}
              caption={attend ? t(`${human(attend.attended)}/${human(attend.total)}`, `${human(attend.attended)}/${human(attend.total)}`) : undefined} />
            <StatTile icon={AlertTriangle} tone="rose" label={t("Needs attention", "கவனம் தேவை")}
              value={human(data.needs_attention)} highlight={data.needs_attention > 0} />
          </KpiGrid>

          <ChartCard icon={CalendarDays} title={t("Next up", "அடுத்து")} sub={t("The Minister's next events", "அடுத்த நிகழ்வுகள்")}>
            {data.next_events.length === 0 ? (
              <p className="py-4 text-center text-[13px] text-muted-foreground">{t("Nothing upcoming.", "வரவிருக்கும் நிகழ்வுகள் இல்லை.")}</p>
            ) : (
              <div className="space-y-2">
                {data.next_events.map((e) => <EventRow key={e.id} e={e} onOpen={() => onOpen(e)} />)}
              </div>
            )}
          </ChartCard>

          <ChartCard icon={CalendarRange} title={t("This week by type", "வாரம் — வகை வாரியாக")}>
            <BarBreakdown data={byType} empty={t("Nothing this week", "இந்த வாரம் இல்லை")} />
          </ChartCard>

          <ChartCard icon={TrendingUp} title={t("Volume", "அளவு")} sub={t("Last 8 weeks", "கடந்த 8 வாரங்கள்")}>
            <TrendArea data={volume} label={t("Events", "நிகழ்வுகள்")} />
          </ChartCard>
        </div>
      )}
    </ScreenState>
  );
}

// ── Timeline view ─────────────────────────────────────────────────────────────
function TimelineView({ onOpen }: { onOpen: (e: EventItem) => void }) {
  const { t, lang } = useT();
  const { data, err, loading } = useOverview((s) => api.timeline(undefined, undefined, s));

  // Group by day, preserving the backend's date-ordered sequence.
  const groups = useMemo(() => {
    const items = data?.items ?? [];
    const out: { date: string | null; items: EventItem[] }[] = [];
    for (const e of items) {
      const last = out[out.length - 1];
      if (last && last.date === e.date) last.items.push(e);
      else out.push({ date: e.date, items: [e] });
    }
    return out;
  }, [data]);

  return (
    <ScreenState loading={loading} err={err}>
      {data && (
        groups.length === 0 ? (
          <Card className="flex flex-col items-center gap-2 py-14 text-center">
            <CalendarDays className="h-8 w-8 text-muted-foreground/40" />
            <p className="text-[14px] font-medium text-foreground">{t("No upcoming events", "வரவிருக்கும் நிகழ்வுகள் இல்லை")}</p>
            <p className="text-[12.5px] text-muted-foreground">{t("Approved events appear here as they're added.", "அங்கீகரிக்கப்பட்ட நிகழ்வுகள் இங்கே தோன்றும்.")}</p>
          </Card>
        ) : (
          <div className="space-y-4">
            {groups.map((g, i) => (
              <div key={i}>
                <div className="mb-1.5 px-1 text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {fmtDay(g.date, lang)}
                </div>
                <div className="space-y-2">
                  {g.items.map((e) => <EventRow key={e.id} e={e} onOpen={() => onOpen(e)} />)}
                </div>
              </div>
            ))}
          </div>
        )
      )}
    </ScreenState>
  );
}

// ── Screen shell (segmented toggle) ─────────────────────────────────────────────
export default function EventsScreen() {
  const { t } = useT();
  const [view, setView] = useState<View>("overview");
  const [selected, setSelected] = useState<EventItem | null>(null);

  return (
    <div className="space-y-3">
      <div className="flex rounded-xl bg-muted p-1">
        {([["overview", t("Overview", "மேலோட்டம்")], ["timeline", t("Timeline", "காலவரிசை")]] as const).map(([k, label]) => (
          <button key={k} onClick={() => setView(k)}
            className={cn("flex-1 rounded-lg px-3 py-2 text-[13px] font-semibold transition-colors",
              view === k ? "bg-card text-foreground shadow-card" : "text-muted-foreground")}>
            {label}
          </button>
        ))}
      </div>

      {view === "overview" ? <EventsOverviewView onOpen={setSelected} /> : <TimelineView onOpen={setSelected} />}

      {selected && <EventDetail e={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
