"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Inbox, Users, Flame, CalendarClock, CheckCircle2, Clock, Layers, Landmark,
  TrendingUp, PieChart, MapPin, Search, X, Gauge, BarChart3, Table2,
} from "lucide-react";
import {
  ChartCard, BarBreakdown, DonutBreakdown, TrendArea,
} from "@/components/insights/DashboardKit";
import TamilNaduMap from "@/components/TamilNaduMap";
import { useT } from "../_lib/i18n";
import { api, Unauthorized, type PetitionRow, type PetitionFilters } from "../_lib/api";
import { toUserMessage } from "@/lib/errors";
import type { DashboardAnalytics, OperationsData } from "../_lib/types";
import { useDetail } from "../_lib/useDetail";
import { DrawerSheet } from "./DrawerSheet";
import { PetitionDrawer } from "./PetitionDrawer";
import { SectionPager, type PagerSection } from "./SectionPager";
import { ScreenState, KpiGrid, MKpi, human, titleCase, DataTable, type Col } from "./kit";

function toBars(rows: { key?: string; label: string; count: number }[] | undefined) {
  return (rows ?? []).map((r) => ({ key: r.key ?? r.label, label: r.label, count: r.count }));
}

type Dim = "category" | "priority" | "ministry" | "district";

export default function DashboardOverview() {
  const { t, lang } = useT();

  const [filters, setFilters] = useState<PetitionFilters>({});
  const [q, setQ] = useState("");
  const [data, setData] = useState<DashboardAnalytics | null>(null);
  const [ops, setOps] = useState<OperationsData | null>(null);
  const [rows, setRows] = useState<PetitionRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const drawer = useDetail(api.appointmentDetail);

  useEffect(() => {
    const ac = new AbortController();
    setLoading(true);
    Promise.all([
      api.dashboard(filters, ac.signal),
      api.operations(filters, ac.signal),
      api.listPetitions(1, 50, filters, ac.signal),
    ])
      .then(([d, o, p]) => { setData(d); setOps(o); setRows(p.items); setErr(null); setLoading(false); })
      .catch((e) => {
        if (ac.signal.aborted) return;
        if (e instanceof Unauthorized) { window.location.href = "/minister/login"; return; }
        setErr(toUserMessage(e, "Couldn't load this view.")); setLoading(false);
      });
    return () => ac.abort();
  }, [filters]);

  const toggle = (dim: Dim) => (key: string) =>
    setFilters((f) => ({ ...f, [dim]: f[dim] === key ? undefined : key }));

  const priorityBars = useMemo(() => {
    const p = data?.priority;
    if (!p) return [];
    return [
      { key: "critical", label: t("Critical", "மிக அவசரம்"), count: p.critical },
      { key: "high",     label: t("High", "அதிகம்"),        count: p.high },
      { key: "medium",   label: t("Medium", "நடுத்தரம்"),    count: p.medium },
      { key: "low",      label: t("Low", "குறைவு"),          count: p.low },
    ].filter((r) => r.count > 0);
  }, [data, t]);

  const trendSeries = useMemo(() => (data?.trend ?? []).map((p) => p.received ?? 0), [data]);

  const districts = ops?.districts ?? [];
  const labelFor = (arr: { key?: string; label: string }[] | undefined, key?: string) =>
    (arr ?? []).find((x) => (x.key ?? x.label) === key)?.label ?? (key ? titleCase(key) : "");

  const chips: { label: string; clear: () => void }[] = [];
  if (filters.category) chips.push({ label: `${t("Category", "வகை")} · ${labelFor(data?.categories, filters.category)}`, clear: () => setFilters((f) => ({ ...f, category: undefined })) });
  if (filters.priority) chips.push({ label: `${t("Priority", "முன்னுரிமை")} · ${titleCase(filters.priority)}`, clear: () => setFilters((f) => ({ ...f, priority: undefined })) });
  if (filters.ministry) chips.push({ label: `${t("Ministry", "அமைச்சகம்")} · ${labelFor(data?.ministries, filters.ministry)}`, clear: () => setFilters((f) => ({ ...f, ministry: undefined })) });
  if (filters.district) chips.push({ label: `${t("District", "மாவட்டம்")} · ${labelFor(districts, filters.district)}`, clear: () => setFilters((f) => ({ ...f, district: undefined })) });
  const anyFilter = chips.length > 0;
  const clearAll = () => setFilters({});

  // Client-side search over the fetched table page (name / ask / token).
  const tableRows = useMemo(() => {
    const s = q.trim().toLowerCase();
    const list = rows ?? [];
    if (!s) return list;
    return list.filter((r) =>
      (r.citizen_name || r.name || "").toLowerCase().includes(s)
      || (r.citizen_ask || "").toLowerCase().includes(s)
      || (r.token || "").toLowerCase().includes(s));
  }, [rows, q]);

  const cols: Col<PetitionRow>[] = [
    { key: "name", label: t("Citizen", "குடிமகன்"),
      render: (r) => (
        <div>
          <div className="font-medium text-foreground">{r.citizen_name || r.name || "—"}</div>
          {r.token && <div className="font-mono text-[11px] font-semibold text-brand">{r.token}</div>}
        </div>
      ) },
    { key: "ask", label: t("Ask", "கோரிக்கை"), className: "w-[48%]",
      render: (r) => {
        const ask = (lang === "ta" ? (r.citizen_ask_ta || r.citizen_ask) : r.citizen_ask) || "";
        return ask ? <span className="line-clamp-2 text-foreground/85">{ask}</span> : <span className="italic text-muted-foreground">{t("No summary yet", "சுருக்கம் இல்லை")}</span>;
      } },
    { key: "cat", label: t("Category", "வகை"), render: (r) => <span className="text-muted-foreground">{r.category_label || titleCase(r.category)}</span> },
  ];

  const filterBar = anyFilter ? (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-brand/20 bg-brand/[0.04] px-3 py-2">
      <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{t("Filtered", "வடிகட்டப்பட்டது")}</span>
      {chips.map((c, i) => (
        <button key={i} onClick={c.clear}
          className="inline-flex items-center gap-1.5 rounded-full border border-brand/30 bg-card px-2.5 py-1 text-[12px] font-medium text-brand transition-colors hover:bg-brand/10">
          {c.label} <X className="h-3 w-3" />
        </button>
      ))}
      <button onClick={clearAll} className="text-[12px] font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
        {t("Clear all", "அனைத்தையும் அழி")}
      </button>
    </div>
  ) : null;

  const sections: PagerSection[] = [
    {
      key: "dashboard", label: t("Dashboard", "டாஷ்போர்டு"), icon: Gauge,
      content: (
      <div className="space-y-3">
        <KpiGrid>
          <MKpi icon={Inbox} tone="brand" label={t("Petitions received", "பெறப்பட்ட மனுக்கள்")}
            value={human(data?.kpis.received)} delta={anyFilter ? null : data?.kpis.growth_pct} series={trendSeries} />
          <MKpi icon={Users} tone="violet" label={t("Unique citizens", "தனித்த குடிமக்கள்")}
            value={human(data?.kpis.citizens)} />
          <MKpi icon={Flame} tone="rose" label={t("Urgent", "அவசரம்")}
            value={human(data?.kpis.urgent)} caption={t("critical + high", "மிக அவசரம் + அதிகம்")} highlight={(data?.kpis.urgent ?? 0) > 0} />
          <MKpi icon={CalendarClock} tone="mint" label={t("Meetings", "சந்திப்புகள்")}
            value={human(data?.kpis.meetings)} caption={t(`${human(data?.kpis.meeting_persons)} people`, `${human(data?.kpis.meeting_persons)} பேர்`)} />
          <MKpi icon={Clock} tone="amber" label={t("Awaiting review", "மதிப்பாய்வில்")}
            value={human(data?.kpis.awaiting_review)} caption={t("on the desk", "மேசையில்")} />
          <MKpi icon={CheckCircle2} tone="mint" label={t("Resolution rate", "தீர்வு விகிதம்")}
            value={`${data?.kpis.resolution_rate ?? 0}%`}
            caption={t(`${human(data?.kpis.resolved)} resolved · ${data?.kpis.on_time_pct ?? 0}% on time`, `${human(data?.kpis.resolved)} தீர்வு · ${data?.kpis.on_time_pct ?? 0}% நேரத்தில்`)} />
        </KpiGrid>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
            <ChartCard icon={Layers} title={t("What citizens ask for", "குடிமக்கள் என்ன கேட்கிறார்கள்")}
              sub={t("Click a bar to filter", "வடிகட்ட தட்டவும்")} className="lg:col-span-2">
              <BarBreakdown data={toBars(data?.categories)} empty={t("No data yet", "தரவு இல்லை")}
                activeKey={filters.category} onPick={toggle("category")} />
            </ChartCard>
            <ChartCard icon={PieChart} title={t("Priority mix", "முன்னுரிமை")} sub={t("Click to filter", "வடிகட்ட தட்டவும்")}>
              <DonutBreakdown data={priorityBars} centerLabel={t("cases", "வழக்குகள்")}
                colors={["#C0362C", "#EE7327", "#D39412", "#4F8A5B"]} empty={t("No priority data yet", "தரவு இல்லை")}
                activeKey={filters.priority} onSlice={toggle("priority")} />
            </ChartCard>
          </div>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
            <ChartCard icon={Landmark} title={t("Routing ministry", "அமைச்சகம்")} sub={t("Click a bar to filter", "வடிகட்ட தட்டவும்")}>
              <BarBreakdown data={toBars(data?.ministries)} color="#6D28D9" max={6} empty={t("No routing yet", "தரவு இல்லை")}
                activeKey={filters.ministry} onPick={toggle("ministry")} />
            </ChartCard>
            <ChartCard icon={TrendingUp} title={t("Received", "பெறப்பட்டது")} sub={t("Recent trend", "சமீபத்திய போக்கு")} className="lg:col-span-2">
              <TrendArea data={(data?.trend ?? []) as { date: string; received: number }[]} label={t("Petitions", "மனுக்கள்")} />
            </ChartCard>
          </div>
          <ChartCard icon={MapPin} title={t("Where petitions come from", "மனுக்கள் எங்கிருந்து")} sub={t("Click a district to focus", "மாவட்டத்தை தட்டவும்")}>
            <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-[minmax(0,1fr)_240px]">
              <TamilNaduMap data={districts} activeKey={filters.district} onSelect={toggle("district")} />
              <div className="flex flex-col">
                <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{t("Ranked by volume", "அளவு வாரியாக")}</div>
                {districts.length > 0 ? (
                  <div className="max-h-[380px] space-y-0.5 overflow-y-auto pr-1">
                    {districts.map((d, i) => (
                      <button key={d.key} onClick={() => toggle("district")(d.key)}
                        className={"flex w-full items-center justify-between rounded-md px-2 py-1.5 text-[12.5px] transition-colors hover:bg-muted/50 " +
                          (filters.district === d.key ? "bg-brand/10 ring-1 ring-brand/20" : "")}>
                        <span className="inline-flex min-w-0 items-center gap-2">
                          <span className="grid h-4 w-4 flex-shrink-0 place-items-center rounded bg-brand/10 font-mono text-[9px] font-bold text-brand">{i + 1}</span>
                          <span className="truncate text-foreground/90">{d.label}</span>
                        </span>
                        <span className="ml-2 flex-shrink-0 font-mono font-bold tabular-nums text-foreground">{human(d.count)}</span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="text-[12.5px] text-muted-foreground">{t("No districts yet", "மாவட்டங்கள் இல்லை")}</div>
                )}
              </div>
            </div>
          </ChartCard>
        </div>
      ),
    },
    {
      key: "records", label: t("Records", "பதிவுகள்"), icon: Table2, count: tableRows.length,
      content: (
        <div className="space-y-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Search citizen / ask / token…", "தேடு…")}
              className="h-9 w-full rounded-xl border border-input bg-card pl-8 pr-3 text-[13px] shadow-card focus:border-brand focus:outline-none sm:w-72" />
          </div>
          <DataTable
            title={t("Every petition", "எல்லா மனுக்கள்")}
            subtitle={t("Most recent first", "சமீபத்தியவை முதலில்")}
            rows={tableRows}
            cols={cols}
            onRowClick={(r) => drawer.setSelectedId(r.appointment_id ?? r.id ?? 0)}
            meta={rows ? t(`${tableRows.length} shown`, `${tableRows.length} காட்டப்படுகிறது`) : undefined}
          />
        </div>
      ),
    },
  ];

  return (
    <ScreenState loading={loading && !data} err={err}>
      {data && (
        <>
          <SectionPager filterBar={filterBar} sections={sections} />
          <DrawerSheet
            open={drawer.selectedId != null}
            onClose={drawer.close}
            loading={drawer.loading}
            detail={drawer.detail}
            render={(d) => <PetitionDrawer d={d} onClose={drawer.close} />}
          />
        </>
      )}
    </ScreenState>
  );
}
