"use client";

import { cn } from "@/lib/utils";
import { useT } from "../_lib/i18n";
import { CalendarDays, LogOut } from "../_lib/icons";

export default function TopBar({ onLogout }: { onLogout: () => void }) {
  const { t, lang, setLang } = useT();

  return (
    <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 pt-[env(safe-area-inset-top)] backdrop-blur">
      <div className="flex h-14 items-center gap-2.5 px-4">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[#21395B] text-white">
          <CalendarDays className="h-4.5 w-4.5" strokeWidth={1.75} />
        </span>
        <div className="min-w-0 leading-tight">
          <div className="truncate text-[0.95rem] font-extrabold tracking-tight text-slate-900">
            {t("Events Desk", "நிகழ்வு மேசை")}
          </div>
          <div className="text-[0.65rem] font-semibold text-slate-400">
            {t("Shared greetings calendar", "பொது வாழ்த்து நாட்காட்டி")}
          </div>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <div className="inline-flex items-center rounded-lg border border-[#E1E5EB] bg-[#EAEEF3] p-0.5">
            {(["en", "ta"] as const).map((l) => (
              <button key={l} type="button" onClick={() => setLang(l)} aria-pressed={lang === l}
                className={cn("rounded-md px-2 py-0.5 text-[0.65rem] font-bold transition-colors",
                  lang === l ? "bg-white text-[#21395B] shadow-sm" : "text-[#5A6472]")}>
                {l === "en" ? "EN" : "தமிழ்"}
              </button>
            ))}
          </div>
          <button onClick={onLogout} aria-label={t("Sign out", "வெளியேறு")}
            className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600">
            <LogOut className="h-4 w-4" strokeWidth={1.75} />
          </button>
        </div>
      </div>
    </header>
  );
}
