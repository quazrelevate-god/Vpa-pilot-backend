"use client";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useT } from "../_lib/i18n";
import { todayLabel } from "../_lib/api";
import { Calendar, Users, UserPlus } from "../_lib/icons";
import type { ApptFeed, RefFeed, Availability } from "../_lib/types";
import AvailabilityCard from "./AvailabilityCard";
import type { Tab } from "./CrowdApp";

function CountCard({ tone, icon, name, n, cap, onClick }: {
  tone: "blue" | "violet"; icon: React.ReactNode; name: string; n: number; cap: string; onClick: () => void;
}) {
  return (
    <button onClick={onClick}
      className="flex flex-col gap-1 rounded-2xl border border-slate-200/70 bg-white p-4 text-left shadow-sm transition-transform active:scale-[0.98]">
      <div className="flex items-center gap-2">
        <span className={cn("grid h-9 w-9 place-items-center rounded-xl",
          tone === "blue" ? "bg-blue-100 text-blue-600" : "bg-violet-100 text-violet-600")}>{icon}</span>
        <span className="text-[0.92rem] font-bold text-slate-900">{name}</span>
      </div>
      <div className="mt-1.5 text-[1.7rem] font-black leading-none tracking-tight text-slate-900">{n}</div>
      <div className="text-xs font-semibold text-slate-500">{cap}</div>
    </button>
  );
}

function StatTile({ tone, n, label }: { tone: "g" | "r" | "b"; n: number; label: string }) {
  const bg = { g: "bg-emerald-50", r: "bg-red-50", b: "bg-blue-50" }[tone];
  const text = { g: "text-emerald-600", r: "text-red-600", b: "text-blue-600" }[tone];
  return (
    <div className={cn("rounded-xl border border-slate-200/70 px-2.5 py-3 text-center", bg)}>
      <div className={cn("text-2xl font-black leading-none", text)}>{n}</div>
      <div className="mt-1 text-[0.62rem] font-bold uppercase tracking-wide text-slate-500">{label}</div>
    </div>
  );
}

export default function HomeScreen({
  appt, refs, avail, onOpenList, onRegister,
}: {
  appt: ApptFeed | null;
  refs: RefFeed | null;
  avail: Availability;
  onOpenList: (t: Tab) => void;
  onRegister: () => void;
}) {
  const { t } = useT();
  const a = appt, r = refs;
  const hour = new Date().getHours();
  const greet = hour < 12
    ? t("Good morning", "காலை வணக்கம்")
    : hour < 17 ? t("Good afternoon", "மதிய வணக்கம்") : t("Good evening", "மாலை வணக்கம்");
  const dateStr = a?.date || r?.date || todayLabel();

  return (
    <div className="px-4 pt-4 pb-[calc(var(--nav-h)+env(safe-area-inset-bottom)+1.5rem)]">
      {/* greeting */}
      <div className="mb-4">
        <div className="text-[0.82rem] font-semibold text-slate-500">{greet}</div>
        <div className="text-[1.3rem] font-black tracking-tight text-slate-900">{dateStr}</div>
      </div>

      <AvailabilityCard avail={avail} />

      <div className="mt-3 grid grid-cols-2 gap-3">
        <CountCard tone="blue" icon={<Calendar className="h-[18px] w-[18px]" />} name={t("Appointments", "சந்திப்புகள்")}
          n={a?.total || 0} cap={t("Today", "இன்று")} onClick={() => onOpenList("appt")} />
        <CountCard tone="violet" icon={<Users className="h-[18px] w-[18px]" />} name={t("Referrals", "பரிந்துரைகள்")}
          n={r?.total || 0} cap={t("Today", "இன்று")} onClick={() => onOpenList("ref")} />
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2.5">
        <StatTile tone="g" n={a?.present || 0} label={t("Came", "வந்தார்")} />
        <StatTile tone="r" n={a?.not_came || 0} label={t("Not Came", "வரவில்லை")} />
        <StatTile tone="b" n={a?.expected || 0} label={t("Expected", "எதிர்பார்ப்பு")} />
      </div>

      <Button onClick={onRegister}
        className="mt-5 h-12 w-full rounded-2xl bg-blue-600 text-base font-bold hover:bg-blue-700">
        <UserPlus className="h-5 w-5" />{t("Register Walk-in", "நேரடி பதிவு")}
      </Button>
    </div>
  );
}
