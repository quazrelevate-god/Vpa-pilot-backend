"use client";

import { useT } from "../_lib/i18n";
import { UserRound, Tag, FileText, Camera, Calendar, Clock } from "../_lib/icons";
import type { Slot } from "../_lib/types";
import { CATS } from "./WizardDetails";

function Row({ icon, k, v }: { icon: React.ReactNode; k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 border-b border-slate-100 py-3 last:border-b-0">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] bg-[#1E40AF]/10 text-[#1E40AF] [&_svg]:h-[17px] [&_svg]:w-[17px]">{icon}</span>
      <div className="min-w-0">
        <div className="text-[0.72rem] font-bold uppercase tracking-wide text-slate-500">{k}</div>
        <div className="mt-0.5 text-[0.92rem] font-semibold text-slate-800">{v}</div>
      </div>
    </div>
  );
}

export default function WizardReview({
  name, mobile, category, desc, photoCount, date, slot, slots, persons,
}: {
  name: string;
  mobile: string;
  category: string;
  desc: string;
  photoCount: number;
  date: string | null;
  slot: number | null;
  slots: Slot[] | null;
  persons: number;
}) {
  const { t, lang } = useT();
  const cat = CATS.find((c) => c[0] === category);
  const catLabel = cat ? (lang === "ta" ? cat[2] : cat[1]) : "—";
  const chosen = slot && slots ? slots.find((s) => s.id === slot) : null;

  return (
    <div className="rounded-2xl border border-slate-200/70 bg-white p-4 shadow-sm">
      <Row icon={<UserRound />} k={t("Name", "பெயர்")}
        v={<>{name}{mobile && <span className="text-slate-400"> · {mobile}</span>}</>} />
      <Row icon={<Tag />} k={t("Category", "வகை")} v={catLabel} />
      {desc && <Row icon={<FileText />} k={t("Grievance", "குறை")} v={desc} />}
      {photoCount > 0 && <Row icon={<Camera />} k={t("Photos", "படங்கள்")} v={`${photoCount} ${t("attached", "இணைக்கப்பட்டது")}`} />}

      {chosen && date && (
        <div className="mt-3.5 rounded-2xl border border-emerald-200 bg-emerald-50 p-3.5">
          <div className="text-[0.72rem] font-bold uppercase tracking-wide text-emerald-700">{t("Appointment", "சந்திப்பு")}</div>
          <div className="mt-2 flex items-center gap-2.5 font-bold text-slate-800">
            <Calendar className="h-[18px] w-[18px] text-emerald-700" />
            {new Date(date + "T00:00:00").toLocaleDateString(lang === "ta" ? "ta-IN" : "en-GB", { day: "2-digit", month: "short", year: "numeric" })}
          </div>
          <div className="mt-1.5 flex items-center gap-2.5 font-bold text-slate-800">
            <Clock className="h-[18px] w-[18px] text-emerald-700" />
            {chosen.label} <span className="font-semibold text-slate-500">· {persons} {t("persons", "நபர்கள்")}</span>
          </div>
        </div>
      )}
    </div>
  );
}
