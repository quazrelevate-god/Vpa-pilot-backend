"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Inbox, CheckCircle2, Clock, Lightbulb, IndianRupee, Gauge,
  Layers, Sparkles, TrendingUp, Landmark, ListOrdered, Search, X,
  BarChart3, Table2,
} from "lucide-react";
import {
  ChartCard, BarBreakdown, DonutBreakdown, TrendArea, RankedList, C,
} from "@/components/insights/DashboardKit";
import {
  analyze, fmtINR, type ProposalRow as DeskProposalRow,
} from "@/app/(dashboard)/proposal-dashboard/_lib/api";
import { ProposalDrawer } from "@/app/(dashboard)/proposal-review/_lib/ProposalDrawer";
import { cn } from "@/lib/utils";
import { toUserMessage } from "@/lib/errors";
import { useT } from "../_lib/i18n";
import { api, Unauthorized } from "../_lib/api";
import { useDetail } from "../_lib/useDetail";
import { DrawerSheet } from "./DrawerSheet";
import { SectionPager, type PagerSection } from "./SectionPager";
import { ScreenState, KpiGrid, MKpi, human, titleCase, Pill } from "./kit";

const CAT_LABEL: Record<string, string> = {
  school: "School Education", tamil: "Tamil & Heritage",
  information: "Information & Publicity", film: "Film",
};

function recPill(r?: string | null) {
  const v = (r || "").toLowerCase();
  if (v === "review_closely") return "brand" as const;
  if (v === "standard") return "mint" as const;
  if (v === "needs_more_info") return "amber" as const;
  return "slate" as const;
}

export default function ProposalsOverview() {
  const { t } = useT();

  const [rows, setRows] = useState<DeskProposalRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    const ac = new AbortController();
    api.listProposals(200, 0, ac.signal)
      .then((r) => setRows(r.items as unknown as DeskProposalRow[]))
      .catch((e) => {
        if (ac.signal.aborted) return;
        if (e instanceof Unauthorized) { window.location.href = "/minister/login"; return; }
        setErr(toUserMessage(e, "Couldn't load this view."));
      });
    return () => ac.abort();
  }, []);

  const [fStatus, setFStatus] = useState("");
  const [fRec, setFRec] = useState("");
  const [fCat, setFCat] = useState("");
  const [q, setQ] = useState("");

  const drawer = useDetail(api.proposalDetail);

  const matchQ = (r: DeskProposalRow) => {
    const s = q.trim().toLowerCase();
    if (!s) return true;
    return (r.title || "").toLowerCase().includes(s)
      || (r.org_name || "").toLowerCase().includes(s)
      || (r.tracking_ref || "").toLowerCase().includes(s);
  };

  const base = useMemo(
    () => (rows ?? []).filter((r) =>
      (!fRec || (r.ai_recommendation || "standard") === fRec) &&
      (!fCat || (r.category || "other") === fCat) &&
      matchQ(r)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, fRec, fCat, q],
  );
  const filtered = useMemo(() => base.filter((r) => !fStatus || r.status === fStatus), [base, fStatus]);
  const view = useMemo(() => analyze(filtered), [filtered]);
  const k = view.kpis;
  const trendSeries = useMemo(() => view.trend.map((p) => p.received), [view]);

  const statusCounts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const r of base) c[r.status] = (c[r.status] || 0) + 1;
    return c;
  }, [base]);

  const tabs = [
    { key: "", label: t("All", "அனைத்தும்") },
    { key: "AWAITING_REVIEW", label: t("Awaiting", "காத்திருக்கிறது") },
    { key: "APPROVED", label: t("Approved", "அங்கீகரிக்கப்பட்டது") },
    { key: "REJECTED", label: t("Rejected", "நிராகரிக்கப்பட்டது") },
    { key: "NEEDS_CLARIFICATION", label: t("Needs info", "தகவல் தேவை") },
  ];
  const countFor = (key: string) => (key === "" ? base.length : statusCounts[key] || 0);

  const tableRows = useMemo(
    () => [...filtered].sort((a, b) => (b.created_at || "").localeCompare(a.created_at || "")),
    [filtered],
  );

  const toggle = (cur: string, set: (v: string) => void) => (key: string) => set(cur === key ? "" : key);
  const clearAll = () => { setFStatus(""); setFRec(""); setFCat(""); setQ(""); };

  const chips: { label: string; clear: () => void }[] = [];
  if (fStatus) chips.push({ label: `${t("Status", "நிலை")} · ${titleCase(fStatus)}`, clear: () => setFStatus("") });
  if (fRec) chips.push({ label: `${t("AI", "AI")} · ${titleCase(fRec)}`, clear: () => setFRec("") });
  if (fCat) chips.push({ label: `${t("Portfolio", "துறை")} · ${CAT_LABEL[fCat] ?? titleCase(fCat)}`, clear: () => setFCat("") });
  if (q.trim()) chips.push({ label: `“${q.trim()}”`, clear: () => setQ("") });
  const anyFilter = chips.length > 0;

  const loading = rows == null;

  // Shared filter bar — pinned above all three panes, so a filter set from the
  // Insights charts stays visible when you swipe to Records.
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
          <MKpi icon={Inbox} tone="amber" label={t("Awaiting decision", "முடிவுக்காக")}
            value={human(k.awaiting)} caption={t(`of ${human(k.total)} · on the desk`, `${human(k.total)}-இல் · மேசையில்`)} highlight={k.awaiting > 0} />
          <MKpi icon={CheckCircle2} tone="mint" label={t("Approval rate", "அங்கீகார விகிதம்")}
            value={(k.approved + k.rejected) > 0 ? `${k.approval_rate}%` : "—"}
            caption={(k.approved + k.rejected) > 0 ? t(`${human(k.approved)} of ${human(k.approved + k.rejected)} decided`, `${human(k.approved + k.rejected)}-இல் ${human(k.approved)}`) : t("none decided yet", "இதுவரை இல்லை")} />
          <MKpi icon={Clock} tone="violet" label={t("Avg decision", "சராசரி முடிவு")}
            value={k.avg_decision_days != null ? `${k.avg_decision_days}d` : "—"} caption={t("received → decided", "பெறப்பட்டது → முடிவு")} />
          <MKpi icon={Lightbulb} tone="brand" label={anyFilter ? t("Proposals (filtered)", "முன்மொழிவுகள் (வடிகட்டப்பட்டது)") : t("Total proposals", "மொத்த முன்மொழிவுகள்")}
            value={human(k.total)} caption={anyFilter ? t("in this view", "இந்த பார்வையில்") : t("all time", "எல்லா நேரமும்")}
            delta={anyFilter ? null : k.growth_pct} series={trendSeries} />
          <MKpi icon={IndianRupee} tone="violet" label={t("Pipeline value", "மதிப்பீட்டு தொகை")}
            value={fmtINR(k.pipeline_cost_value)}
            caption={k.pipeline_cost_count > 0 ? t(`across ${human(k.pipeline_cost_count)}`, `${human(k.pipeline_cost_count)} இல்`) : t("no costs stated", "தொகை இல்லை")} />
          <MKpi icon={Gauge} tone="mint" label={t("Decided", "முடிவெடுக்கப்பட்டது")}
            value={human(k.decided)} caption={t(`${k.decided_pct}% of this view`, `இந்த பார்வையில் ${k.decided_pct}%`)} />
        </KpiGrid>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <ChartCard icon={Layers} title={t("Where each proposal stands", "ஒவ்வொன்றின் நிலை")} sub={t("Click a slice to filter", "வடிகட்ட ஒரு பகுதியை தட்டவும்")}>
              <DonutBreakdown data={view.by_status} centerLabel={t("proposals", "முன்மொழிவுகள்")}
                colors={["#B45309", "#0F8B4C", "#C0362C", "#EA8C0C"]} empty={t("No proposals in this view", "இந்த பார்வையில் இல்லை")}
                activeKey={fStatus} onSlice={toggle(fStatus, setFStatus)} />
            </ChartCard>
            <ChartCard icon={Sparkles} title={t("What the AI flagged", "AI குறிப்பிட்டது")} sub={t("Triage — click to filter · never a decision", "வகைப்பாடு — வடிகட்ட தட்டவும்")}>
              <DonutBreakdown data={view.by_recommendation} centerLabel={t("briefs", "சுருக்கங்கள்")}
                colors={["#6D28D9", "#64748B", "#B45309"]} empty={t("No AI briefs in this view", "தரவு இல்லை")}
                activeKey={fRec} onSlice={toggle(fRec, setFRec)} />
            </ChartCard>
          </div>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <ChartCard icon={Landmark} title={t("By portfolio", "துறை வாரியாக")} sub={t("Click a bar to filter", "வடிகட்ட ஒரு பட்டையை தட்டவும்")}>
              <BarBreakdown data={view.by_category} color={C.brand} empty={t("No proposals in this view", "தரவு இல்லை")}
                activeKey={fCat} onPick={toggle(fCat, setFCat)} />
            </ChartCard>
            <ChartCard icon={TrendingUp} title={t("Proposals received", "பெறப்பட்டது")} sub={t("Last 90 days", "கடந்த 90 நாட்கள்")}>
              <TrendArea data={view.trend} color={C.brand} label={t("Proposals", "முன்மொழிவுகள்")} />
            </ChartCard>
          </div>
          <ChartCard icon={ListOrdered} title={t("Who's proposing", "யார் முன்மொழிகிறார்கள்")} sub={t("Most active organisations", "மிகவும் செயலில்")}>
            <RankedList items={view.top_orgs} valueOf={(o) => human(o.count)} empty={t("No organisations in this view", "அமைப்புகள் இல்லை")} />
          </ChartCard>
        </div>
      ),
    },
    {
      key: "records", label: t("Records", "பதிவுகள்"), icon: Table2, count: tableRows.length,
      content: (
        <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-card">
          <div className="flex flex-wrap items-center gap-2 border-b border-border px-5 py-3.5">
            <h2 className="type-card-heading">{t("Every proposal", "எல்லா முன்மொழிவுகள்")}</h2>
            <span className="font-mono text-[12px] font-semibold tabular-nums text-muted-foreground">{human(tableRows.length)}</span>
            <div className="relative ml-auto">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Search ref, org, title…", "தேடு…")}
                className="h-9 w-56 rounded-xl border border-input bg-card pl-8 pr-3 text-[13px] shadow-card focus:border-brand focus:outline-none" />
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5 border-b border-border px-5 py-2.5">
            {tabs.map((tb) => (
              <button key={tb.key || "all"} onClick={() => setFStatus(tb.key)}
                className={cn("inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12.5px] font-medium transition-colors",
                  fStatus === tb.key ? "bg-brand text-white" : "text-muted-foreground hover:bg-accent")}>
                {tb.label}
                <span className={cn("num rounded-full px-1.5 text-[11px]", fStatus === tb.key ? "bg-white/20 text-white" : "bg-muted text-muted-foreground")}>{countFor(tb.key)}</span>
              </button>
            ))}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-[13.5px]">
              <thead className="bg-[#EDF1F8] text-[11px] uppercase tracking-[0.08em] text-muted-foreground/80">
                <tr>
                  <th className="w-[52%] px-4 py-3 font-semibold">{t("Proposal", "முன்மொழிவு")}</th>
                  <th className="px-4 py-3 font-semibold">{t("Organisation", "அமைப்பு")}</th>
                  <th className="px-4 py-3 font-semibold">{t("AI recommendation", "AI பரிந்துரை")}</th>
                </tr>
              </thead>
              <tbody>
                {tableRows.length === 0 ? (
                  <tr><td colSpan={3} className="px-4 py-10 text-center text-muted-foreground">
                    {t("No proposals match.", "பொருந்தும் முன்மொழிவுகள் இல்லை.")} {anyFilter && <button onClick={clearAll} className="font-medium text-brand hover:underline">{t("Clear filters", "வடிகட்டிகளை அழி")}</button>}
                  </td></tr>
                ) : tableRows.map((p) => (
                  <tr key={p.id} onClick={() => drawer.setSelectedId(p.id)}
                    className="cursor-pointer border-t border-border/70 transition-colors hover:bg-[#EFF3FB]" title={t("Open detail", "விவரம் திற")}>
                    <td className="px-4 py-3">
                      <div className="font-medium text-foreground">{p.title || t("Untitled proposal", "தலைப்பில்லாத முன்மொழிவு")}</div>
                      {p.tracking_ref && <div className="font-mono text-[11px] font-semibold text-brand">{p.tracking_ref}</div>}
                    </td>
                    <td className="px-4 py-3 text-foreground/85">{p.org_name || "—"}</td>
                    <td className="px-4 py-3">
                      {p.ai_recommendation
                        ? <Pill tone={recPill(p.ai_recommendation)} label={titleCase(p.ai_recommendation)} />
                        : <span className="text-muted-foreground">—</span>}
                    </td>
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
            render={(d) => <ProposalDrawer d={d} readOnly onClose={drawer.close} />}
          />
        </>
      )}
    </ScreenState>
  );
}
