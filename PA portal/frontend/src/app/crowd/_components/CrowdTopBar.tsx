"use client";

import { cn } from "@/lib/utils";
import { useT } from "../_lib/i18n";
import { RefreshCw, Download, LogOut, Calendar, CalendarCheck } from "../_lib/icons";
import type { Availability } from "../_lib/types";

/**
 * Shared top chrome for the crowd PWA. Left side is the live slot availability
 * (free seats / slots). Right side holds every app-level action, styled to
 * DESIGN.md: a segmented toggle for language, secondary (bordered Slate Indigo)
 * buttons for refresh + install, and a red button for sign out.
 */
export default function CrowdTopBar({
  avail, onInstall, onRefresh, onSignOut,
}: {
  avail: Availability;
  onInstall: () => void;
  onRefresh: () => void;
  onSignOut: () => void;
}) {
  const { t, lang, setLang } = useT();
  const open = avail.open && !avail.offline;

  const secondaryBtn =
    "grid h-9 w-9 place-items-center rounded-lg border border-[#E1E5EB] bg-white text-[#21395B] transition-colors active:scale-95 hover:bg-[#EAEEF3]";

  return (
    <header className="sticky top-0 z-40 flex items-center justify-between gap-2 border-b border-[#E1E5EB] bg-white/95 px-4 pb-2.5 pt-[calc(0.625rem+env(safe-area-inset-top))] backdrop-blur">
      {/* live slot availability */}
      <div className="flex min-w-0 items-center gap-2.5">
        <span className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-lg",
          open ? "bg-[#E7F3EC] text-[#2E7D5B]" : "bg-[#FBEEDF] text-[#CC6A1F]")}>
          {open ? <CalendarCheck className="h-[19px] w-[19px]" /> : <Calendar className="h-[19px] w-[19px]" />}
        </span>
        <div className="flex items-center gap-2.5">
          <div className="flex flex-col leading-none">
            <span className={cn("text-[1.15rem] font-black tracking-tight tabular-nums", open ? "text-[#2E7D5B]" : "text-[#CC6A1F]")}>
              {avail.offline ? "—" : avail.seats}
            </span>
            <span className="mt-0.5 text-[0.58rem] font-bold uppercase tracking-wide text-[#5A6472]">{t("Seats free", "இடம் காலி")}</span>
          </div>
          <span className="h-7 w-px bg-[#E1E5EB]" />
          <div className="flex flex-col leading-none">
            <span className="text-[1.15rem] font-black tracking-tight tabular-nums text-[#131720]">{avail.offline ? "—" : avail.slots}</span>
            <span className="mt-0.5 text-[0.58rem] font-bold uppercase tracking-wide text-[#5A6472]">{t("Slots free", "ஸ்லாட் காலி")}</span>
          </div>
        </div>
      </div>

      {/* actions */}
      <div className="flex shrink-0 items-center gap-1.5">
        {/* language toggle */}
        <div className="inline-flex items-center rounded-lg border border-[#E1E5EB] bg-[#EAEEF3] p-0.5">
          {(["en", "ta"] as const).map((l) => (
            <button key={l} onClick={() => setLang(l)} aria-pressed={lang === l}
              className={cn("rounded-md px-2 py-1 text-[0.72rem] font-bold transition-colors",
                lang === l ? "bg-white text-[#21395B] shadow-sm" : "text-[#5A6472]")}>
              {l === "en" ? "EN" : "த"}
            </button>
          ))}
        </div>
        <button onClick={onRefresh} className={secondaryBtn} aria-label={t("Refresh data", "தரவை புதுப்பி")}>
          <RefreshCw className="h-[18px] w-[18px]" />
        </button>
        <button onClick={onInstall} className={secondaryBtn} aria-label={t("Install app", "செயலியை நிறுவு")}>
          <Download className="h-[18px] w-[18px]" />
        </button>
        <button onClick={onSignOut}
          className="grid h-9 w-9 place-items-center rounded-lg bg-[#B2372D] text-white transition-colors active:scale-95 hover:bg-[#9D3027]"
          aria-label={t("Sign out", "வெளியேறு")}>
          <LogOut className="h-[18px] w-[18px]" />
        </button>
      </div>
    </header>
  );
}
