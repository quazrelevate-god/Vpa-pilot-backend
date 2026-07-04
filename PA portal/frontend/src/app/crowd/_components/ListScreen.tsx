"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { useT } from "../_lib/i18n";
import { todayLabel } from "../_lib/api";
import { Search, Globe, UserRound, UserPlus, ArrowLeft } from "../_lib/icons";
import type { ApptFeed, RefFeed } from "../_lib/types";
import { ApptCard, RefCard } from "./VisitorCard";
import type { Tab } from "./CrowdApp";

type Filter = "" | "CAME" | "NOT_CAME";

function match(name: string, mobile: string, token: string, q: string) {
  const s = q.toLowerCase().trim();
  if (!s) return true;
  return name.toLowerCase().includes(s) || (mobile || "").includes(s) || token.toLowerCase().includes(s);
}

export default function ListScreen({
  tab, appt, refs, offline, onTab, onMark, onRegister, onBack,
}: {
  tab: Tab;
  appt: ApptFeed | null;
  refs: RefFeed | null;
  offline: boolean;
  onTab: (t: Tab) => void;
  onMark: (isAppt: boolean, id: number, wantCame: boolean) => void;
  onRegister: () => void;
  onBack: () => void;
}) {
  const { t, toggle } = useT();
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("");
  const isAppt = tab === "appt";
  const feed = isAppt ? appt : refs;

  const pass = (statusDb: string) => {
    if (!filter) return true;
    const st = statusDb.toUpperCase();
    if (filter === "CAME") return st === "CAME" || st === "AWAITING_REVIEW" || st === "COURTESY_DONE";
    if (filter === "NOT_CAME") return st === "NOT_CAME";
    return true;
  };

  const apptItems = (appt?.items || []).filter((it) => pass(it.status_db) && match(it.name, it.mobile, it.token, q));
  const refItems = (refs?.items || []).filter((it) => pass(it.status || "") && match(it.name, it.mobile || "", it.token, q));
  const shown = isAppt ? apptItems : refItems;

  const setTab = (tb: Tab) => { setFilter(""); onTab(tb); };

  const chips: [Filter, string, number, string][] = [
    ["", t("Expected", "எதிர்பார்ப்பு"), feed?.expected || 0, "blue"],
    ["CAME", t("Came", "வந்தார்"), feed?.present || 0, "emerald"],
    ["NOT_CAME", t("Not Came", "வரவில்லை"), feed?.not_came || 0, "red"],
  ];

  return (
    <>
      <header className="sticky top-0 z-30 flex items-center gap-2 border-b border-slate-200 bg-white px-4 pb-3 pt-[calc(0.75rem+env(safe-area-inset-top))]">
        <button onClick={onBack} className="grid h-9 w-9 place-items-center rounded-lg text-slate-600 active:bg-slate-100" aria-label={t("Back", "பின்")}>
          <ArrowLeft className="h-5 w-5" />
        </button>
        <h1 className="flex-1 text-lg font-extrabold text-slate-900">{isAppt ? t("Appointments", "சந்திப்புகள்") : t("Referrals", "பரிந்துரைகள்")}</h1>
        <button onClick={toggle} className="grid h-9 w-9 place-items-center rounded-lg text-slate-500 active:bg-slate-100" aria-label="language">
          <Globe className="h-5 w-5" />
        </button>
      </header>

      <div className="px-4 pt-4 pb-[calc(var(--nav-h)+env(safe-area-inset-bottom)+5.5rem)]">
        {/* segmented */}
        <div className="flex gap-2">
          {(["appt", "ref"] as const).map((tb) => {
            const active = tab === tb;
            const total = (tb === "appt" ? appt?.total : refs?.total) || 0;
            return (
              <button key={tb} onClick={() => setTab(tb)}
                className={cn("flex-1 rounded-xl border py-2.5 text-sm font-bold transition-colors",
                  active ? "border-blue-600 bg-blue-600 text-white" : "border-slate-200 bg-white text-slate-500")}>
                {tb === "appt" ? t("Appointments", "சந்திப்புகள்") : t("Referrals", "பரிந்துரைகள்")}{" "}
                <span className="text-xs opacity-80">{total}</span>
              </button>
            );
          })}
        </div>

        {/* search */}
        <div className="relative mt-3">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-slate-400" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} className="h-11 rounded-xl pl-10"
            placeholder={t("Search name, mobile, token…", "பெயர் / எண் / டோக்கன்")} />
        </div>

        {/* filter chips */}
        <div className="mt-3 grid grid-cols-3 gap-2.5">
          {chips.map(([key, label, n, tone]) => {
            const active = filter === key;
            const text = { blue: "text-blue-600", emerald: "text-emerald-600", red: "text-red-600" }[tone]!;
            const ring = { blue: "ring-blue-500", emerald: "ring-emerald-500", red: "ring-red-500" }[tone]!;
            return (
              <button key={key || "all"} onClick={() => setFilter(active ? "" : key)}
                className={cn("rounded-xl border border-slate-200/70 bg-white p-2.5 text-center", active && `ring-2 ${ring}`)}>
                <div className={cn("text-xl font-black", text)}>{n}</div>
                <div className="text-[0.62rem] font-bold uppercase tracking-wide text-slate-500">{label}</div>
              </button>
            );
          })}
        </div>

        <div className="my-3 text-[0.7rem] font-bold uppercase tracking-wide text-slate-500">
          {t("Today", "இன்று")} · {feed?.date || todayLabel()}
        </div>

        {offline && (
          <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-[0.82rem] font-bold text-amber-700">
            {t("Offline — showing last loaded data.", "இணைப்பு இல்லை — பழைய தரவு.")}
          </div>
        )}

        {shown.length === 0 ? (
          <div className="py-12 text-center text-slate-500">
            <UserRound className="mx-auto mb-2.5 h-12 w-12 opacity-30" />
            <div className="font-bold text-slate-700">{t("No visitors yet", "இன்னும் யாரும் இல்லை")}</div>
            <div className="text-sm text-slate-500">{t("Registered walk-ins will appear here.", "பதிவு செய்தவர்கள் இங்கே தெரிவார்கள்.")}</div>
          </div>
        ) : isAppt ? (
          apptItems.map((it) => <ApptCard key={it.id} it={it} onMark={(id, w) => onMark(true, id, w)} />)
        ) : (
          refItems.map((it) => <RefCard key={it.id} it={it} onMark={(id, w) => onMark(false, id, w)} />)
        )}
      </div>

      {/* floating register pill */}
      <button onClick={onRegister}
        className="fixed inset-x-4 bottom-[calc(var(--nav-h)+env(safe-area-inset-bottom)+0.75rem)] z-40 mx-auto inline-flex max-w-[calc(560px-2rem)] items-center justify-center gap-2 rounded-full bg-blue-600 py-3 text-[0.95rem] font-bold text-white shadow-lg shadow-blue-600/30 active:scale-[0.98]">
        <UserPlus className="h-[18px] w-[18px]" />{t("Register Walk-in", "நேரடி பதிவு")}
      </button>
    </>
  );
}
