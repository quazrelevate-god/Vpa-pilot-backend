"use client";

import { cn } from "@/lib/utils";
import { useT, type Lang } from "../_lib/i18n";
import { Download, CalendarCheck, LogOut, Check, Globe } from "../_lib/icons";

export default function MenuScreen({
  onInstall, onRefresh, onSignOut,
}: {
  onInstall: () => void;
  onRefresh: () => void;
  onSignOut: () => void;
}) {
  const { t, lang, setLang } = useT();

  const langs: [Lang, string][] = [["en", "English"], ["ta", "தமிழ்"]];

  return (
    <>
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white px-4 pb-3 pt-[calc(0.75rem+env(safe-area-inset-top))]">
        <h1 className="text-lg font-extrabold text-slate-900">{t("Menu", "மெனு")}</h1>
      </header>

      <div className="px-4 pt-4 pb-[calc(var(--nav-h)+env(safe-area-inset-bottom)+1.5rem)]">
        {/* Language */}
        <div className="mb-2 mt-1 flex items-center gap-1.5 text-[0.74rem] font-bold uppercase tracking-wide text-slate-500">
          <Globe className="h-3.5 w-3.5" />{t("Language", "மொழி")}
        </div>
        <div className="overflow-hidden rounded-2xl border border-slate-200/70 bg-white shadow-sm">
          <div className="px-4 pt-3 text-[0.72rem] font-semibold text-slate-400">{t("Switch anytime", "எப்போது வேண்டுமானாலும்")}</div>
          {langs.map(([code, label]) => (
            <button key={code} onClick={() => setLang(code)}
              className="flex w-full items-center justify-between px-4 py-3 text-left">
              <span className={cn("font-bold", lang === code ? "text-blue-600" : "text-slate-700")}>{label}</span>
              {lang === code && <Check className="h-5 w-5 text-blue-600" />}
            </button>
          ))}
        </div>

        {/* App */}
        <div className="mb-2 mt-5 text-[0.74rem] font-bold uppercase tracking-wide text-slate-500">{t("App", "செயலி")}</div>
        <div className="overflow-hidden rounded-2xl border border-slate-200/70 bg-white shadow-sm">
          <button onClick={onInstall} className="flex w-full items-center gap-3.5 border-b border-slate-100 px-3.5 py-3.5 text-left">
            <span className="grid h-9 w-9 place-items-center rounded-[11px] bg-blue-50 text-blue-600"><Download className="h-5 w-5" /></span>
            <span className="flex-1">
              <span className="block font-bold text-slate-800">{t("Install app", "செயலியை நிறுவு")}</span>
              <span className="block text-[0.74rem] font-medium text-slate-500">{t("Add to home screen for quick access", "விரைவு அணுகலுக்கு முகப்புத் திரையில் சேர்")}</span>
            </span>
          </button>
          <button onClick={onRefresh} className="flex w-full items-center gap-3.5 px-3.5 py-3.5 text-left">
            <span className="grid h-9 w-9 place-items-center rounded-[11px] bg-blue-50 text-blue-600"><CalendarCheck className="h-5 w-5" /></span>
            <span className="font-bold text-slate-800">{t("Refresh data", "தரவை புதுப்பி")}</span>
          </button>
        </div>

        <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200/70 bg-white shadow-sm">
          <button onClick={onSignOut} className="flex w-full items-center gap-3.5 px-3.5 py-3.5 text-left">
            <span className="grid h-9 w-9 place-items-center rounded-[11px] bg-red-50 text-red-600"><LogOut className="h-5 w-5" /></span>
            <span className="font-bold text-red-600">{t("Sign out", "வெளியேறு")}</span>
          </button>
        </div>

        <div className="mt-6 text-center text-[0.74rem] text-slate-400">
          {t("Floor Operator", "தள ஆபரேட்டர்")} · Crowd Management PWA
        </div>
      </div>
    </>
  );
}
