"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Ticket, FolderOpen, CheckCircle2, AlertTriangle, Clock, ShieldCheck,
  Percent, Layers, ListChecks, TrendingUp, Timer, Gauge, Building2, Search, X,
  BarChart3, Table2,
} from "lucide-react";
import {
  ChartCard, BarBreakdown, DonutBreakdown, TrendArea,
} from "@/components/insights/DashboardKit";
import { cn } from "@/lib/utils";
import { useT } from "../_lib/i18n";
import { api, Unauthorized, type TicketRow } from "../_lib/api";
import { analyzeTickets } from "../_lib/analyzeTickets";
import { useDetail } from "../_lib/useDetail";
import { DrawerSheet } from "./DrawerSheet";
import { TicketDrawer } from "./TicketDrawer";
import { SectionPager, type PagerSection } from "./SectionPager";
import { ScreenState, KpiGrid, MKpi, human, titleCase, Pill, type Col } from "./kit";

function priorityPill(p?: string | null) {
  const v = (p || "").toLowerCase();
  if (v === "critical") return "rose" as const;
  if (v === "high") return "orange" as const;
  if (v === "medium") return "amber" as const;
  return "slate" as const;
}
function Pct({ v }: { v?: number | null }) {
  if (v == null) return <span className="font-mono text-[13px] text-muted-foreground">—</span>;
  const cls = v >= 80 ? "text-emerald-600" : v >= 50 ? "text-amber-600" : "text-red-600";
  return <span className={cn("font-mono text-[13px] font-bold", cls)}>{v}%</span>;
}

type Dim = "status" | "priority" | "dept" | "q";

export default function TicketsOverview() {
  const { t } = useT();

  const [rows, setRows] = useState<TicketRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    const ac = new AbortController();
    api.listTickets(1, 200, undefined, ac.signal)
      .then((r) => setRows(r.items))
      .catch((e) => {
        if (ac.signal.aborted) return;
        if (e instanceof Unauthorized) { window.location.href = "/minister/login"; return; }
        setErr((e as Error).message);
      });
    return () => ac.abort();
  }, []);

  const [fStatus, setFStatus] = useState("");
  const [fPriority, setFPriority] = useState("");
  const [fDept, setFDept] = useState("");
  const [q, setQ] = useState("");
  const drawer = useDetail(api.ticketDetail);

  const searchMatch = (r: TicketRow) => {
    const s = q.trim().toLowerCase();
    if (!s) return true;
    return (r.citizen_name || "").toLowerCase().includes(s)
      || (r.citizen_ask || "").toLowerCase().includes(s)
      || (r.ticket_number || "").toLowerCase().includes(s);
  };
  const matches = (r: TicketRow, exclude: Dim | null) => {
    if (exclude !== "status" && fStatus && (r.status || "").toLowerCase() !== fStatus) return false;
    if (exclude !== "priority" && fPriority && (r.priority || "").toLowerCase() !== fPriority) return false;
    if (exclude !== "dept" && fDept && (r.assigned_department || r.department || "") !== fDept) return false;
    if (exclude !== "q" && !searchMatch(r)) return false;
    return true;
  };
  const subset = (exclude: Dim | null) => (rows ?? []).filter((r) => matches(r, exclude));

  const filtered = useMemo(() => subset(null), // eslint-disable-line react-hooks/exhaustive-deps
    [rows, fStatus, fPriority, fDept, q]);
  const view = useMemo(() => analyzeTickets(filtered), [filtered]);
  const k = view.kpis;
  const slaTotal = k.breached + k.due_soon + k.on_track;

  const dStatus = useMemo(() => analyzeTickets(subset("status")).by_status, [rows, fPriority, fDept, q]); // eslint-disable-line react-hooks/exhaustive-deps
  const dPriority = useMemo(() => analyzeTickets(subset("priority")).by_priority, [rows, fStatus, fDept, q]); // eslint-disable-line react-hooks/exhaustive-deps
  const dDepts = useMemo(() => analyzeTickets(subset("dept")).departments, [rows, fStatus, fPriority, q]); // eslint-disable-line react-hooks/exhaustive-deps
  const trend = useMemo(() => view.trend.map((p) => ({ date: p.date, received: p.raised })), [view]);

  const toggle = (cur: string, set: (v: string) => void) => (key: string) => set(cur === key ? "" : key);
  const chips: { label: string; clear: () => void }[] = [];
  if (fStatus) chips.push({ label: `${t("Status", "நிலை")} · ${titleCase(fStatus)}`, clear: () => setFStatus("") });
  if (fPriority) chips.push({ label: `${t("Priority", "முன்னுரிமை")} · ${titleCase(fPriority)}`, clear: () => setFPriority("") });
  if (fDept) chips.push({ label: `${t("Department", "துறை")} · ${titleCase(fDept)}`, clear: () => setFDept("") });
  const anyFilter = chips.length > 0;
  const clearAll = () => { setFStatus(""); setFPriority(""); setFDept(""); setQ(""); };

  const cols: Col<TicketRow>[] = [
    { key: "num", label: t("Ticket", "புகார்"),
      render: (r) => (
        <div>
          <div className="font-mono text-[12px] text-muted-foreground">{r.ticket_number || `#${r.id}`}</div>
          <div className="font-medium text-foreground">{r.citizen_name || "—"}</div>
        </div>
      ) },
    { key: "ask", label: t("Citizen ask", "கோரிக்கை"), className: "w-[46%]",
      render: (r) => r.citizen_ask ? <span className="line-clamp-2 text-foreground/85">{r.citizen_ask}</span> : <span className="italic text-muted-foreground">{t("No summary yet", "சுருக்கம் இல்லை")}</span> },
    { key: "prio", label: t("Priority", "முன்னுரிமை"), render: (r) => r.priority ? <Pill tone={priorityPill(r.priority)} label={titleCase(r.priority)} /> : <span className="text-muted-foreground">—</span> },
    { key: "cat", label: t("Category", "வகை"), render: (r) => <span className="text-muted-foreground">{r.category_label || titleCase(r.category)}</span> },
  ];

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

  const slaHealth = (
    <ChartCard icon={AlertTriangle} title={t("SLA health", "SLA நிலை")} sub={t("Against target", "இலக்குக்கு எதிராக")}>
      {slaTotal === 0 ? (
        <div className="grid h-24 place-items-center text-[12.5px] italic text-muted-foreground">{t("No open tickets", "திறந்த புகார்கள் இல்லை")}</div>
      ) : (
        <div className="space-y-3">
          <div className="flex h-3 overflow-hidden rounded-full bg-muted">
            {k.on_track > 0 && <div className="bg-emerald-500" style={{ width: `${(k.on_track / slaTotal) * 100}%` }} />}
            {k.due_soon > 0 && <div className="bg-amber-500" style={{ width: `${(k.due_soon / slaTotal) * 100}%` }} />}
            {k.breached > 0 && <div className="bg-red-500" style={{ width: `${(k.breached / slaTotal) * 100}%` }} />}
          </div>
          {[
            { cls: "bg-emerald-500", label: t("On track", "சரியான வழியில்"), n: k.on_track },
            { cls: "bg-amber-500", label: t("Due soon", "விரைவில்"), n: k.due_soon },
            { cls: "bg-red-500", label: t("Breached", "மீறல்"), n: k.breached },
          ].map((r) => (
            <div key={r.label} className="flex items-center gap-2 text-[13px]">
              <span className={cn("h-2.5 w-2.5 rounded-full", r.cls)} />
              <span className="flex-1 text-foreground/85">{r.label}</span>
              <span className="font-mono font-bold text-foreground">{r.n}</span>
              <span className="font-mono text-[11px] text-muted-foreground">({slaTotal ? Math.round((r.n / slaTotal) * 100) : 0}%)</span>
            </div>
          ))}
        </div>
      )}
    </ChartCard>
  );

  const sections: PagerSection[] = [
    {
      key: "dashboard", label: t("Dashboard", "டாஷ்போர்டு"), icon: Gauge,
      content: (
        <div className="space-y-3">
          <KpiGrid>
            <MKpi icon={Ticket} tone="brand" label={t("Total tickets", "மொத்த புகார்கள்")} value={human(k.total)} />
            <MKpi icon={FolderOpen} tone="amber" label={t("Open", "திறந்தவை")} value={human(k.open)} caption={t("in progress", "நடைபெறுகிறது")} highlight={k.open > 0} />
            <MKpi icon={CheckCircle2} tone="mint" label={t("Resolved", "தீர்க்கப்பட்டது")} value={human(k.resolved)} />
            <MKpi icon={AlertTriangle} tone="rose" label={t("SLA breached", "SLA மீறல்")} value={human(k.breached)} highlight={k.breached > 0} />
            <MKpi icon={Clock} tone="violet" label={t("Due soon", "விரைவில் முடிவடையும்")} value={human(k.due_soon)} />
            <MKpi icon={ShieldCheck} tone="mint" label={t("On track", "சரியான வழியில்")} value={human(k.on_track)} />
          </KpiGrid>
          <KpiGrid>
            <MKpi icon={Percent} tone="mint" label={t("Resolution rate", "தீர்வு விகிதம்")} value={`${k.resolution_rate}%`} caption={t("of all tickets", "எல்லாவற்றிலும்")} />
            <MKpi icon={Gauge} tone="brand" label={t("On-time %", "நேரத்தில் %")} value={k.on_time_pct != null ? `${k.on_time_pct}%` : "—"} caption={t("within SLA", "SLA-க்குள்")} />
            <MKpi icon={Timer} tone="violet" label={t("Avg response", "சராசரி பதில்")} value={k.avg_response_hours != null ? `${k.avg_response_hours}h` : "—"} caption={t("first response", "முதல் பதில்")} />
          </KpiGrid>
          {slaHealth}
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <ChartCard icon={ListChecks} title={t("Status", "நிலை")} sub={t("Click to filter", "வடிகட்ட தட்டவும்")}>
              <BarBreakdown data={dStatus} empty={t("No tickets yet", "புகார்கள் இல்லை")} activeKey={fStatus} onPick={toggle(fStatus, setFStatus)} />
            </ChartCard>
            <ChartCard icon={ShieldCheck} title={t("Priority", "முன்னுரிமை")} sub={t("Click to filter", "வடிகட்ட தட்டவும்")}>
              <DonutBreakdown data={dPriority} centerLabel={t("tickets", "புகார்கள்")}
                colors={["#C0362C", "#EE7327", "#D39412", "#4F8A5B"]} empty={t("No priority data yet", "தரவு இல்லை")}
                activeKey={fPriority} onSlice={toggle(fPriority, setFPriority)} />
            </ChartCard>
          </div>

          {/* Department performance — click a row to scope the ticket list. */}
          <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-card">
            <div className="flex items-center gap-2 border-b border-border px-5 py-3.5">
              <Building2 className="h-4 w-4 text-brand" />
              <h2 className="type-card-heading">{t("Department performance", "துறை செயல்திறன்")}</h2>
              <span className="text-[12px] text-muted-foreground">{t("Click a row to filter", "வடிகட்ட வரிசையை தட்டவும்")}</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-left text-[13.5px]">
                <thead className="bg-[#EDF1F8] text-[11px] uppercase tracking-[0.08em] text-muted-foreground/80">
                  <tr>
                    <th className="px-4 py-3 font-semibold">{t("Department", "துறை")}</th>
                    <th className="px-4 py-3 text-right font-semibold">{t("Open", "திறந்த")}</th>
                    <th className="px-4 py-3 text-right font-semibold">{t("Resolved", "தீர்வு")}</th>
                    <th className="px-4 py-3 text-right font-semibold">{t("Total", "மொத்தம்")}</th>
                    <th className="px-4 py-3 text-right font-semibold">{t("Rate", "விகிதம்")}</th>
                    <th className="px-4 py-3 text-right font-semibold">{t("On-time", "நேரத்தில்")}</th>
                    <th className="px-4 py-3 text-right font-semibold">{t("Avg days", "சராசரி நாட்கள்")}</th>
                  </tr>
                </thead>
                <tbody>
                  {dDepts.length === 0 ? (
                    <tr><td colSpan={7} className="px-4 py-10 text-center text-muted-foreground">{t("No routing yet", "தரவு இல்லை")}</td></tr>
                  ) : dDepts.map((d) => {
                    const active = fDept === d.key;
                    return (
                      <tr key={d.key} onClick={() => toggle(fDept, setFDept)(d.key)}
                        className={cn("cursor-pointer border-t border-border/70 transition-colors hover:bg-[#EFF3FB]", active && "bg-brand/[0.06]")}>
                        <td className="px-4 py-3 font-semibold text-foreground">{d.label}</td>
                        <td className="px-4 py-3 text-right font-mono text-foreground">{d.open}</td>
                        <td className="px-4 py-3 text-right font-mono text-foreground">{d.resolved}</td>
                        <td className="px-4 py-3 text-right font-mono text-muted-foreground">{d.total}</td>
                        <td className="px-4 py-3 text-right"><Pct v={d.resolution_rate} /></td>
                        <td className="px-4 py-3 text-right"><Pct v={d.on_time_pct} /></td>
                        <td className="px-4 py-3 text-right font-mono text-muted-foreground">{d.avg_resolution_days != null ? `${d.avg_resolution_days}d` : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <ChartCard icon={TrendingUp} title={t("Raised", "பதிவு")} sub={t("Last 30 days", "கடந்த 30 நாட்கள்")}>
            <TrendArea data={trend} color="#B45309" label={t("Tickets", "புகார்கள்")} />
          </ChartCard>
        </div>
      ),
    },
    {
      key: "records", label: t("Records", "பதிவுகள்"), icon: Table2, count: filtered.length,
      content: (
        <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-card">
          <div className="flex flex-wrap items-center gap-2 border-b border-border px-5 py-3.5">
            <Layers className="h-4 w-4 text-brand" />
            <h2 className="type-card-heading">{t("Every ticket", "எல்லா புகார்கள்")}</h2>
            <span className="font-mono text-[12px] font-semibold tabular-nums text-muted-foreground">{human(filtered.length)}</span>
            <div className="relative ml-auto">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Search ticket / citizen…", "தேடு…")}
                className="h-9 w-56 rounded-xl border border-input bg-card pl-8 pr-3 text-[13px] shadow-card focus:border-brand focus:outline-none" />
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-[13.5px]">
              <thead className="bg-[#EDF1F8] text-[11px] uppercase tracking-[0.08em] text-muted-foreground/80">
                <tr>{cols.map((c) => (
                  <th key={c.key} className={cn("px-4 py-3 font-semibold", c.className)}>{c.label}</th>
                ))}</tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr><td colSpan={cols.length} className="px-4 py-10 text-center text-muted-foreground">
                    {t("No tickets match.", "பொருந்தும் புகார்கள் இல்லை.")} {anyFilter && <button onClick={clearAll} className="font-medium text-brand hover:underline">{t("Clear filters", "வடிகட்டிகளை அழி")}</button>}
                  </td></tr>
                ) : filtered.map((r) => (
                  <tr key={r.id} onClick={() => drawer.setSelectedId(r.id)}
                    className="cursor-pointer border-t border-border/70 transition-colors hover:bg-[#EFF3FB]" title={t("Open detail", "விவரம் திற")}>
                    {cols.map((c) => <td key={c.key} className={cn("px-4 py-3", c.className)}>{c.render(r)}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
            render={(d) => <TicketDrawer d={d} onClose={drawer.close} />}
          />
        </>
      )}
    </ScreenState>
  );
}
