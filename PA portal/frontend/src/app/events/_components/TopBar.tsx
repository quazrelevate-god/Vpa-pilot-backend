"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { useT } from "../_lib/i18n";
import { CalendarDays, Download, LogOut } from "../_lib/icons";
import InstallDialog from "./InstallDialog";

export default function TopBar({ onLogout }: { onLogout: () => void }) {
  const { t, lang, setLang } = useT();
  const [installOpen, setInstallOpen] = useState(false);

  return (
    <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 pt-[env(safe-area-inset-top)] backdrop-blur">
      <div className="flex h-14 items-center gap-3 px-4">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[#21395B] text-white shadow-sm">
          <CalendarDays className="h-5 w-5" strokeWidth={1.75} />
        </span>
        <div className="min-w-0 leading-tight">
          <div className="truncate text-[1rem] font-extrabold tracking-tight text-slate-900">
            {t("Events Desk", "நிகழ்வு மேசை")}
          </div>
          <div className="text-[0.72rem] font-medium text-slate-400">
            {t("Shared greetings calendar", "பொது வாழ்த்து நாட்காட்டி")}
          </div>
        </div>

        <div className="ml-auto flex items-center gap-1">
          <div className="inline-flex items-center rounded-lg border border-[#E1E5EB] bg-[#EAEEF3] p-0.5">
            {(["en", "ta"] as const).map((l) => (
              <button key={l} type="button" onClick={() => setLang(l)} aria-pressed={lang === l}
                className={cn("rounded-md px-2.5 py-1 text-xs font-bold transition-colors",
                  lang === l ? "bg-white text-[#21395B] shadow-sm" : "text-[#5A6472]")}>
                {l === "en" ? "EN" : "தமிழ்"}
              </button>
            ))}
          </div>
          <button onClick={() => setInstallOpen(true)} aria-label={t("Install app", "செயலியை நிறுவு")}
            className="grid h-9 w-9 place-items-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-[#2F6FED]">
            <Download className="h-[18px] w-[18px]" strokeWidth={1.75} />
          </button>
          <button onClick={onLogout} aria-label={t("Sign out", "வெளியேறு")}
            className="grid h-9 w-9 place-items-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600">
            <LogOut className="h-[18px] w-[18px]" strokeWidth={1.75} />
          </button>
        </div>
      </div>

      <InstallDialog open={installOpen} onClose={() => setInstallOpen(false)} />
    </header>
  );
}
