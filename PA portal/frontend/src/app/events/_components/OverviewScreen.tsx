"use client";

// Office overview: KPI cards + department-wise ticket-load chart, styled to
// match the PA portal's Overview page (KpiCard pattern: tone icon chip, muted
// label, mono value, caption — 2-up grid on phones so nothing overflows).

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "../_lib/api";
import type { OverviewData } from "../_lib/types";
import { useT } from "../_lib/i18n";
import {
  Building2, CalendarCheck, FileText, Handshake, Ticket, Clock, CheckCircle2,
} from "../_lib/icons";

// Same tone palette as the PA overview KpiCard.
const TONE: Record<string, { bg: string; fg: string }> = {
  brand:  { bg: "bg-[#2F6FED]/10", fg: "text-[#2F6FED]" },
  violet: { bg: "bg-[#EDE9FE]",    fg: "text-[#6D28D9]" },
  mint:   { bg: "bg-[#DCFAE6]",    fg: "text-[#0F8B4C]" },
  amber:  { bg: "bg-[#FEF0D9]",    fg: "text-[#B45309]" },
  rose:   { bg: "bg-[#FEE4E2]",    fg: "text-[#C0362C]" },
};

function KpiCard({ icon: Icon, tone, label, value, caption }: {
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  tone: keyof typeof TONE; label: string; value: number; caption: string;
}) {
  const t = TONE[tone];
  return (
    <Card className="flex flex-col gap-3 rounded-2xl border-slate-100 p-4 shadow-sm">
      <span className={cn("grid h-9 w-9 place-items-center rounded-xl", t.bg, t.fg)}>
        <Icon className="h-[18px] w-[18px]" strokeWidth={1.75} />
      </span>
      <div className="min-w-0">
        <div className="text-[0.75rem] font-semibold leading-snug text-slate-500">{label}</div>
        <div className="font-mono text-[24px] font-bold leading-tight tracking-tight tabular-nums text-slate-900">
          {value.toLocaleString("en-IN")}
        </div>
        <div className="text-[0.7rem] leading-snug text-slate-400">{caption}</div>
      </div>
    </Card>
  );
}

/** "elementary_education" → "Elementary Education" */
function deptLabel(raw: string): string {
  return raw.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

const BAR_COLORS = ["#2F6FED", "#21395B", "#0F8B4C", "#B45309", "#6D28D9", "#0E7490", "#C0362C", "#5A6472"];

export default function OverviewScreen() {
  const { t } = useT();
  const [data, setData] = useState<OverviewData | null>(null);

  useEffect(() => {
    let live = true;
    const load = () => api.overview().then((d) => { if (live) setData(d); }).catch(() => {});
    load();
    const id = setInterval(load, 60_000);
    return () => { live = false; clearInterval(id); };
  }, []);

  if (!data) {
    return (
      <div className="space-y-3 px-4 pt-4">
        <div className="grid grid-cols-2 gap-3">
          {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-[124px] rounded-2xl" />)}
        </div>
        <Skeleton className="h-[260px] rounded-2xl" />
      </div>
    );
  }

  const maxDept = Math.max(1, ...data.departments.map((d) => d.count));

  return (
    <div className="space-y-6 px-4 pb-8 pt-4">
      {/* ── Today ── */}
      <section>
        <h2 className="mb-3 text-[0.7rem] font-extrabold uppercase tracking-widest text-slate-400">
          {t("Today", "இன்று")}
        </h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <KpiCard icon={Ticket} tone="brand"
            label={t("Tickets", "டிக்கெட்")} value={data.today.tickets}
            caption={t("raised today", "இன்று எழுப்பப்பட்டவை")} />
          <KpiCard icon={CalendarCheck} tone="mint"
            label={t("Appointments", "சந்திப்புகள்")} value={data.today.appointments}
            caption={t("scheduled today", "இன்று திட்டமிடப்பட்டவை")} />
          <KpiCard icon={FileText} tone="amber"
            label={t("Petitions Received", "பெறப்பட்ட மனுக்கள்")} value={data.today.petitions_received}
            caption={t("received today", "இன்று பெறப்பட்டவை")} />
          <KpiCard icon={Clock} tone="rose"
            label={t("Awaiting Review", "மதிப்பாய்வு நிலுவை")} value={data.today.petitions_awaiting}
            caption={t("pending PA review", "PA மதிப்பாய்வு நிலுவை")} />
          <KpiCard icon={CheckCircle2} tone="mint"
            label={t("Reviewed", "மதிப்பாய்வு செய்யப்பட்டவை")} value={data.today.petitions_reviewed}
            caption={t("reviewed today", "இன்று மதிப்பாய்வு")} />
        </div>
      </section>

      {/* ── Overall ── */}
      <section>
        <h2 className="mb-3 text-[0.7rem] font-extrabold uppercase tracking-widest text-slate-400">
          {t("Overall", "மொத்தம்")}
        </h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <KpiCard icon={Ticket} tone="brand"
            label={t("Tickets", "டிக்கெட்")} value={data.totals.tickets}
            caption={t("all time", "மொத்தமாக")} />
          <KpiCard icon={CalendarCheck} tone="mint"
            label={t("Appointments", "சந்திப்புகள்")} value={data.totals.appointments}
            caption={t("all time", "மொத்தமாக")} />
          <KpiCard icon={Handshake} tone="violet"
            label={t("Meetings", "கூட்டங்கள்")} value={data.totals.meetings}
            caption={t("slot-booked", "நேரம் ஒதுக்கப்பட்டவை")} />
          <KpiCard icon={FileText} tone="amber"
            label={t("Petitions Received", "பெறப்பட்ட மனுக்கள்")} value={data.totals.petitions_received}
            caption={t("all time", "மொத்தமாக")} />
          <KpiCard icon={Clock} tone="rose"
            label={t("Awaiting Review", "மதிப்பாய்வு நிலுவை")} value={data.totals.petitions_awaiting}
            caption={t("pending PA review", "PA மதிப்பாய்வு நிலுவை")} />
          <KpiCard icon={CheckCircle2} tone="mint"
            label={t("Reviewed", "மதிப்பாய்வு செய்யப்பட்டவை")} value={data.totals.petitions_reviewed}
            caption={t("all time", "மொத்தமாக")} />
        </div>
      </section>

      {/* ── Department chart ── */}
      <section>
        <h2 className="mb-3 flex items-center gap-1.5 text-[0.7rem] font-extrabold uppercase tracking-widest text-slate-400">
          <Building2 className="h-3.5 w-3.5" strokeWidth={1.75} />
          {t("Tickets by department", "துறை வாரியாக டிக்கெட்")}
        </h2>
        <Card className="rounded-2xl border-slate-100 p-4 shadow-sm">
          {data.departments.length === 0 ? (
            <div className="py-6 text-center text-base text-slate-400">
              {t("No tickets routed to departments yet.", "இன்னும் துறைகளுக்கு டிக்கெட் இல்லை.")}
            </div>
          ) : (
            <div className="space-y-3.5">
              {data.departments.map((d, i) => (
                <div key={d.name}>
                  <div className="mb-1 flex items-baseline justify-between gap-2">
                    <span className="min-w-0 truncate text-[0.9rem] font-semibold text-slate-700">
                      {deptLabel(d.name)}
                    </span>
                    <span className="shrink-0 font-mono text-[0.9rem] font-bold tabular-nums text-slate-900">
                      {d.count}
                    </span>
                  </div>
                  <div className="h-3 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${Math.max(6, (d.count / maxDept) * 100)}%`,
                        backgroundColor: BAR_COLORS[i % BAR_COLORS.length],
                      }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </section>
    </div>
  );
}
