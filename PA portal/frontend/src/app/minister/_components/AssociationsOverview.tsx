"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Users2, Building2, UsersRound, MapPin, Flame, Sparkles, Percent, Timer,
  Layers, Landmark, TrendingUp, Repeat2, ListOrdered, ListChecks, Search, X,
  Gauge, BarChart3, Table2,
} from "lucide-react";
import {
  ChartCard, BarBreakdown, DonutBreakdown, TrendArea, RankedList,
} from "@/components/insights/DashboardKit";
import TamilNaduMap from "@/components/TamilNaduMap";
import { AssociationDrawer } from "@/app/(dashboard)/association-review/_lib/AssociationDrawer";
import { cn } from "@/lib/utils";
import { toUserMessage } from "@/lib/errors";
import { useT } from "../_lib/i18n";
import { api, Unauthorized, type AssociationRow } from "../_lib/api";
import { analyzeAssociations } from "../_lib/analyzeAssoc";
import { useDetail } from "../_lib/useDetail";
import { DrawerSheet } from "./DrawerSheet";
import { SectionPager, type PagerSection } from "./SectionPager";
import { ScreenState, KpiGrid, MKpi, human, titleCase, Pill } from "./kit";

function urgencyPill(u?: string | null) {
  const v = (u || "").toLowerCase();
  if (v === "critical") return "rose" as const;
  if (v === "high") return "orange" as const;
  if (v === "medium") return "amber" as const;
  return "slate" as const;
}
type Dim = "status" | "cat" | "urg" | "rec" | "min" | "dist" | "q";

export default function AssociationsOverview() {
  const { t } = useT();

  const [rows, setRows] = useState<AssociationRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    const ac = new AbortController();
    api.listAssociations(200, 0, ac.signal)
      .then((r) => setRows(r.items))
      .catch((e) => {
        if (ac.signal.aborted) return;
        if (e instanceof Unauthorized) { window.location.href = "/minister/login"; return; }
        setErr(toUserMessage(e, "Couldn't load this view."));
      });
    return () => ac.abort();
  }, []);

  const [fStatus, setFStatus] = useState("");
  const [fCat, setFCat] = useState("");
  const [fUrg, setFUrg] = useState("");
  const [fRec, setFRec] = useState("");
  const [fMin, setFMin] = useState("");
  const [district, setDistrict] = useState<string | undefined>(undefined);
  const [q, setQ] = useState("");

  const drawer = useDetail(api.associationDetail);

  const searchMatch = (r: AssociationRow) => {
    const s = q.trim().toLowerCase();
    if (!s) return true;
    return (r.association_name || "").toLowerCase().includes(s)
      || (r.representative_name || "").toLowerCase().includes(s);
  };

  const matches = (r: AssociationRow, exclude: Dim | null) => {
    if (exclude !== "status" && fStatus && r.status !== fStatus) return false;
    if (exclude !== "cat" && fCat && (r.category || "") !== fCat) return false;
    if (exclude !== "urg" && fUrg && (r.urgency || "").toLowerCase() !== fUrg) return false;
    if (exclude !== "rec" && fRec && (r.ai_recommendation || "") !== fRec) return false;
    if (exclude !== "min" && fMin && (r.ministry || "") !== fMin) return false;
    if (exclude !== "dist" && district && (r.district || "") !== district) return false;
    if (exclude !== "q" && !searchMatch(r)) return false;
    return true;
  };
  const subset = (exclude: Dim | null) => (rows ?? []).filter((r) => matches(r, exclude));

  const filtered = useMemo(() => subset(null), // eslint-disable-line react-hooks/exhaustive-deps
    [rows, fStatus, fCat, fUrg, fRec, fMin, district, q]);
  const view = useMemo(() => analyzeAssociations(filtered), [filtered]);
  const k = view.kpis;
  const trendSeries = useMemo(() => view.trend.map((p) => p.received), [view]);

  const dCat = useMemo(() => analyzeAssociations(subset("cat")).by_category, [rows, fStatus, fUrg, fRec, fMin, district, q]); // eslint-disable-line react-hooks/exhaustive-deps
  const dStatus = useMemo(() => analyzeAssociations(subset("status")).by_status, [rows, fCat, fUrg, fRec, fMin, district, q]); // eslint-disable-line react-hooks/exhaustive-deps
  const dUrg = useMemo(() => analyzeAssociations(subset("urg")).by_urgency, [rows, fStatus, fCat, fRec, fMin, district, q]); // eslint-disable-line react-hooks/exhaustive-deps
  const dRec = useMemo(() => analyzeAssociations(subset("rec")).by_recommendation, [rows, fStatus, fCat, fUrg, fMin, district, q]); // eslint-disable-line react-hooks/exhaustive-deps
  const dMin = useMemo(() => analyzeAssociations(subset("min")).by_ministry, [rows, fStatus, fCat, fUrg, fRec, district, q]); // eslint-disable-line react-hooks/exhaustive-deps
  const dDist = useMemo(() => analyzeAssociations(subset("dist")).by_district, [rows, fStatus, fCat, fUrg, fRec, fMin, q]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (cur: string, set: (v: string) => void) => (key: string) => set(cur === key ? "" : key);
  const clearAll = () => { setFStatus(""); setFCat(""); setFUrg(""); setFRec(""); setFMin(""); setDistrict(undefined); setQ(""); };

  const chips: { label: string; clear: () => void }[] = [];
  if (fStatus) chips.push({ label: `${t("Status", "நிலை")} · ${titleCase(fStatus)}`, clear: () => setFStatus("") });
  if (fCat) chips.push({ label: `${t("Asking for", "கோரிக்கை")} · ${titleCase(fCat)}`, clear: () => setFCat("") });
  if (fUrg) chips.push({ label: `${t("Urgency", "அவசரம்")} · ${titleCase(fUrg)}`, clear: () => setFUrg("") });
  if (fRec) chips.push({ label: `${t("AI", "AI")} · ${titleCase(fRec)}`, clear: () => setFRec("") });
  if (fMin) chips.push({ label: `${t("Ministry", "அமைச்சகம்")} · ${titleCase(fMin)}`, clear: () => setFMin("") });
  if (district) chips.push({ label: `${t("District", "மாவட்டம்")} · ${titleCase(district)}`, clear: () => setDistrict(undefined) });
  if (q.trim()) chips.push({ label: `“${q.trim()}”`, clear: () => setQ("") });
  const anyFilter = chips.length > 0;

  const tableRows = useMemo(
    () => [...filtered].sort((a, b) => (b.created_at || "").localeCompare(a.created_at || "")),
    [filtered],
  );

  const loading = rows == null;

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
      <span className="ml-auto font-mono text-[12px] font-semibold tabular-nums text-foreground">
        {human(filtered.length)} <span className="font-sans font-normal text-muted-foreground">{t(`of ${rows?.length ?? 0}`, `/ ${rows?.length ?? 0}`)}</span>
      </span>
    </div>
  ) : null;

  const sections: PagerSection[] = [
    {
      key: "dashboard", label: t("Dashboard", "டாஷ்போர்டு"), icon: Gauge,
      content: (
        <div className="space-y-3">
          <KpiGrid>
            <MKpi icon={Users2} tone="brand" label={t("Submissions", "சமர்ப்பிப்புகள்")}
              value={human(k.total)} delta={anyFilter ? null : k.growth_pct} series={trendSeries} />
            <MKpi icon={Building2} tone="brand" label={t("Unique bodies", "தனித்த அமைப்புகள்")}
              value={human(k.unique_bodies)}
              caption={k.repeat_bodies > 0 ? t(`${k.repeat_bodies} filed 2+`, `${k.repeat_bodies} மீண்டும்`) : undefined} />
            <MKpi icon={UsersRound} tone="violet" label={t("Members", "உறுப்பினர்கள்")}
              value={human(k.members_represented)}
              caption={t(`${human(k.bodies_with_size)} bodies`, `${human(k.bodies_with_size)} அமைப்புகள்`)} highlight />
            <MKpi icon={MapPin} tone="mint" label={t("Districts", "மாவட்டங்கள்")}
              value={human(k.districts_covered)} caption={t("of 38", "38-இல்")} />
            <MKpi icon={Flame} tone="rose" label={t("Critical + High", "மிக அவசரம் + அதிகம்")}
              value={human(k.critical_high)} highlight={k.critical_high > 0} />
            <MKpi icon={Sparkles} tone="violet" label={t("AI: Engage now", "AI: உடனடி")}
              value={human(k.engage_now)} highlight={k.engage_now > 0} />
          </KpiGrid>
          <KpiGrid>
            <MKpi icon={ListChecks} tone="amber" label={t("Awaiting", "காத்திருக்கிறது")}
              value={human(k.awaiting)} caption={t("on the desk", "மேசையில்")} />
            <MKpi icon={Percent} tone="mint" label={t("Reviewed", "மதிப்பாய்வு")} value={human(k.reviewed)} />
            <MKpi icon={Percent} tone="brand" label={t("Forwarded", "அனுப்பப்பட்டது")}
              value={human(k.forwarded)} caption={t("to departments", "துறைகளுக்கு")} />
            <MKpi icon={Percent} tone="mint" label={t("Decided", "முடிவெடுக்கப்பட்டது")}
              value={`${k.decided_pct}%`} caption={t(`${k.decided} of ${k.total}`, `${k.total}-இல் ${k.decided}`)} />
            <MKpi icon={Timer} tone="brand" label={t("Median decision", "சராசரி முடிவு")}
              value={k.median_days_to_decision != null ? `${k.median_days_to_decision}d` : "—"} caption={t("days", "நாட்கள்")} />
            <MKpi icon={Repeat2} tone="violet" label={t("Received (30d)", "பெறப்பட்டது (30 நாள்)")}
              value={human(k.received_30d)}
              caption={k.growth_pct != null ? t(`${k.growth_pct >= 0 ? "+" : ""}${k.growth_pct}% vs prior 30d`, `${k.growth_pct >= 0 ? "+" : ""}${k.growth_pct}%`) : undefined} />
          </KpiGrid>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
            <ChartCard icon={Layers} title={t("What they ask for", "என்ன கேட்கிறார்கள்")} sub={t("Click a bar to filter", "வடிகட்ட தட்டவும்")} className="lg:col-span-2">
              <BarBreakdown data={dCat} empty={t("No submissions yet", "சமர்ப்பிப்புகள் இல்லை")} activeKey={fCat} onPick={toggle(fCat, setFCat)} />
            </ChartCard>
            <ChartCard icon={ListChecks} title={t("Status", "நிலை")} sub={t("Click to filter", "வடிகட்ட தட்டவும்")}>
              <DonutBreakdown data={dStatus} centerLabel={t("bodies", "அமைப்புகள்")}
                colors={["#B45309", "#0F8B4C", "#2F6FED"]} empty={t("No submissions yet", "தரவு இல்லை")}
                activeKey={fStatus} onSlice={toggle(fStatus, setFStatus)} />
            </ChartCard>
          </div>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
            <ChartCard icon={Flame} title={t("Urgency", "அவசரம்")} sub={t("Click to filter", "வடிகட்ட தட்டவும்")}>
              <DonutBreakdown data={dUrg} centerLabel={t("bodies", "அமைப்புகள்")}
                colors={["#C0362C", "#EE7327", "#D39412", "#64748B"]} empty={t("No urgency data yet", "தரவு இல்லை")}
                activeKey={fUrg} onSlice={toggle(fUrg, setFUrg)} />
            </ChartCard>
            <ChartCard icon={Sparkles} title={t("AI triage", "AI வகைப்பாடு")} sub={t("Click to filter", "வடிகட்ட தட்டவும்")}>
              <DonutBreakdown data={dRec} centerLabel={t("bodies", "அமைப்புகள்")}
                colors={["#C0362C", "#0F8B4C", "#2F6FED", "#D39412"]} empty={t("No AI recommendations yet", "தரவு இல்லை")}
                activeKey={fRec} onSlice={toggle(fRec, setFRec)} />
            </ChartCard>
            <ChartCard icon={Landmark} title={t("Routing ministry", "அமைச்சகம்")} sub={t("Click a bar to filter", "வடிகட்ட தட்டவும்")}>
              <BarBreakdown data={dMin} color="#6D28D9" max={6} empty={t("No routing yet", "தரவு இல்லை")} activeKey={fMin} onPick={toggle(fMin, setFMin)} />
            </ChartCard>
          </div>
          <ChartCard icon={MapPin} title={t("Where voices come from", "எங்கிருந்து")} sub={t("Click a district to focus", "மாவட்டத்தை தட்டவும்")}>
            <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-[minmax(0,1fr)_240px]">
              <TamilNaduMap data={dDist} activeKey={district}
                onSelect={(key) => setDistrict((d) => (d === key ? undefined : key))} />
              <div className="flex flex-col">
                <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{t("Ranked by volume", "அளவு வாரியாக")}</div>
                {dDist.length > 0 ? (
                  <div className="max-h-[380px] space-y-0.5 overflow-y-auto pr-1">
                    {dDist.map((d, i) => (
                      <button key={d.key} onClick={() => setDistrict((cur) => (cur === d.key ? undefined : d.key))}
                        className={"flex w-full items-center justify-between rounded-md px-2 py-1.5 text-[12.5px] transition-colors hover:bg-muted/50 " +
                          (district === d.key ? "bg-brand/10 ring-1 ring-brand/20" : "")}>
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
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
            <ChartCard icon={ListOrdered} title={t("Biggest bodies", "மிகப்பெரிய அமைப்புகள்")} sub={t("By stated membership", "உறுப்பினர் எண்ணிக்கை")}>
              <RankedList items={view.top_associations}
                valueOf={(x) => human(x.members)} subOf={(x) => x.category || undefined}
                empty={t("No membership figures stated yet", "தரவு இல்லை")} />
            </ChartCard>
            <ChartCard icon={TrendingUp} title={t("Received", "பெறப்பட்டது")} sub={t("Recent trend", "சமீபத்திய போக்கு")} className="lg:col-span-2">
              <TrendArea data={view.trend} label={t("Submissions", "சமர்ப்பிப்புகள்")} />
            </ChartCard>
          </div>
        </div>
      ),
    },
    {
      key: "records", label: t("Records", "பதிவுகள்"), icon: Table2, count: tableRows.length,
      content: (
        <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-card">
          <div className="flex flex-wrap items-center gap-2 border-b border-border px-5 py-3.5">
            <h2 className="type-card-heading">{t("Every association", "எல்லா சங்கங்கள்")}</h2>
            <span className="font-mono text-[12px] font-semibold tabular-nums text-muted-foreground">{human(tableRows.length)}</span>
            <div className="relative ml-auto">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Search union / representative…", "தேடு…")}
                className="h-9 w-60 rounded-xl border border-input bg-card pl-8 pr-3 text-[13px] shadow-card focus:border-brand focus:outline-none" />
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-left text-[13.5px]">
              <thead className="bg-[#EDF1F8] text-[11px] uppercase tracking-[0.08em] text-muted-foreground/80">
                <tr>
                  <th className="px-4 py-3 font-semibold">{t("Association / Union", "சங்கம் / தொழிற்சங்கம்")}</th>
                  <th className="px-4 py-3 font-semibold">{t("Representative", "பிரதிநிதி")}</th>
                  <th className="w-[44%] px-4 py-3 font-semibold">{t("Citizen asked", "கோரிக்கை")}</th>
                  <th className="px-4 py-3 font-semibold">{t("Urgency", "அவசரம்")}</th>
                </tr>
              </thead>
              <tbody>
                {tableRows.length === 0 ? (
                  <tr><td colSpan={4} className="px-4 py-10 text-center text-muted-foreground">
                    {t("No associations match.", "பொருந்தும் சங்கங்கள் இல்லை.")} {anyFilter && <button onClick={clearAll} className="font-medium text-brand hover:underline">{t("Clear filters", "வடிகட்டிகளை அழி")}</button>}
                  </td></tr>
                ) : tableRows.map((r) => (
                  <tr key={r.id} onClick={() => drawer.setSelectedId(r.id)}
                    className="cursor-pointer border-t border-border/70 transition-colors hover:bg-[#EFF3FB]" title={t("Open detail", "விவரம் திற")}>
                    <td className="px-4 py-3 font-medium text-foreground">{r.association_name || t("Unnamed body", "பெயரிடப்படாதது")}</td>
                    <td className="px-4 py-3 text-foreground/85">
                      {r.representative_name || "—"}
                      {r.representative_designation && <span className="block text-[11px] text-muted-foreground">{r.representative_designation}</span>}
                    </td>
                    <td className="px-4 py-3 text-foreground/85">
                      <span className="line-clamp-2">{r.association_ask || r.association_ask_ta || <span className="text-muted-foreground">—</span>}</span>
                    </td>
                    <td className="px-4 py-3">{r.urgency ? <Pill tone={urgencyPill(r.urgency)} label={titleCase(r.urgency)} /> : <span className="text-muted-foreground">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="border-t border-border px-5 py-2.5 text-[12px] text-muted-foreground">{human(tableRows.length)} {t("shown", "காட்டப்படுகிறது")}</div>
        </div>
      ),
    },
  ];

  return (
    <ScreenState loading={loading} err={err}>
      {rows && (
        <>
          <SectionPager filterBar={filterBar} sections={sections} />
          <DrawerSheet
            open={drawer.selectedId != null}
            onClose={drawer.close}
            loading={drawer.loading}
            detail={drawer.detail}
            render={(d) => <AssociationDrawer d={d} readOnly onClose={drawer.close} />}
          />
        </>
      )}
    </ScreenState>
  );
}
