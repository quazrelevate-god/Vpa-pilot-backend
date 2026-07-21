"use client";

// Office overview: total + today counts over the existing petition system
// (tickets / appointments / meetings / petitions) and a department-wise
// ticket-load bar chart. Read-only; data from /events/api/overview.

import { useEffect, useState } from "react";
import { api } from "../_lib/api";
import type { OverviewData } from "../_lib/types";
import { useT } from "../_lib/i18n";
import {
  Building2, CalendarCheck, FileText, Handshake, Loader2, Ticket,
} from "../_lib/icons";

function Tile({ icon, label, value, accent }: {
  icon: React.ReactNode; label: string; value: number; accent: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center gap-2 text-slate-500">
        <span style={{ color: accent }} className="[&_svg]:h-6 [&_svg]:w-6">{icon}</span>
        <span className="text-sm font-bold leading-tight">{label}</span>
      </div>
      <div className="mt-2 font-mono text-4xl font-bold tabular-nums text-slate-900">
        {value}
      </div>
    </div>
  );
}

/** "elementary_education" → "Elementary Education" */
function deptLabel(raw: string): string {
  return raw.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

const BAR_COLORS = ["#2F6FED", "#21395B", "#4F8A5B", "#CC6A1F", "#7C3AED", "#0E7490", "#B2372D", "#5A6472"];

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
      <div className="grid min-h-[40vh] place-items-center">
        <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
      </div>
    );
  }

  const maxDept = Math.max(1, ...data.departments.map((d) => d.count));

  return (
    <div className="space-y-6 px-4 pb-6 pt-4">
      {/* ── Today ── */}
      <section>
        <h2 className="mb-2.5 text-base font-extrabold uppercase tracking-wide text-slate-500">
          {t("Today", "இன்று")}
        </h2>
        <div className="grid grid-cols-3 gap-2.5">
          <Tile icon={<Ticket strokeWidth={1.75} />} accent="#2F6FED"
            label={t("Tickets", "டிக்கெட்")} value={data.today.tickets} />
          <Tile icon={<CalendarCheck strokeWidth={1.75} />} accent="#4F8A5B"
            label={t("Appointments", "சந்திப்பு")} value={data.today.appointments} />
          <Tile icon={<FileText strokeWidth={1.75} />} accent="#CC6A1F"
            label={t("Petitions", "மனுக்கள்")} value={data.today.petitions} />
        </div>
      </section>

      {/* ── Totals ── */}
      <section>
        <h2 className="mb-2.5 text-base font-extrabold uppercase tracking-wide text-slate-500">
          {t("Overall", "மொத்தம்")}
        </h2>
        <div className="grid grid-cols-3 gap-2.5">
          <Tile icon={<Ticket strokeWidth={1.75} />} accent="#2F6FED"
            label={t("Tickets", "டிக்கெட்")} value={data.totals.tickets} />
          <Tile icon={<CalendarCheck strokeWidth={1.75} />} accent="#4F8A5B"
            label={t("Appointments", "சந்திப்பு")} value={data.totals.appointments} />
          <Tile icon={<Handshake strokeWidth={1.75} />} accent="#7C3AED"
            label={t("Meetings", "கூட்டங்கள்")} value={data.totals.meetings} />
        </div>
      </section>

      {/* ── Department chart ── */}
      <section>
        <h2 className="mb-2.5 flex items-center gap-2 text-base font-extrabold uppercase tracking-wide text-slate-500">
          <Building2 className="h-5 w-5" strokeWidth={1.75} />
          {t("Tickets by department", "துறை வாரியாக டிக்கெட்")}
        </h2>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          {data.departments.length === 0 ? (
            <div className="py-6 text-center text-base text-slate-400">
              {t("No tickets routed to departments yet.", "இன்னும் துறைகளுக்கு டிக்கெட் இல்லை.")}
            </div>
          ) : (
            <div className="space-y-3.5">
              {data.departments.map((d, i) => (
                <div key={d.name}>
                  <div className="mb-1 flex items-baseline justify-between gap-2">
                    <span className="truncate text-base font-semibold text-slate-700">
                      {deptLabel(d.name)}
                    </span>
                    <span className="font-mono text-base font-bold tabular-nums text-slate-900">
                      {d.count}
                    </span>
                  </div>
                  <div className="h-3.5 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${Math.max(6, (d.count / maxDept) * 100)}%`,
                        backgroundColor: BAR_COLORS[i % BAR_COLORS.length],
                      }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
