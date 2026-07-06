"use client";

import { Building2, LogOut, RefreshCw } from "lucide-react";
import { useDeptLang } from "../_lib/i18n";
import { cn } from "@/lib/utils";

interface Props {
  label: string;
  onRefresh?: () => void;
  refreshing?: boolean;
  onSignOut: () => void;
}

export default function DeptTopBar({ label, onRefresh, refreshing, onSignOut }: Props) {
  const { lang, setLang, t } = useDeptLang();
  return (
    <header className="sticky top-0 z-30 h-20 flex-shrink-0 border-b border-border bg-card">
      <div className="flex h-full items-center gap-4 px-6">
        {/* Left — dept identity */}
        <div className="flex min-w-0 items-center gap-3">
          <div className="grid h-10 w-10 flex-shrink-0 place-items-center rounded-xl border border-[#CFE0FB] bg-gradient-to-br from-white to-[#EAF1FE] text-[#1E40AF] shadow-[0_2px_8px_rgba(47,111,237,0.12)]">
            <Building2 className="h-[18px] w-[18px]" />
          </div>
          <div className="min-w-0 leading-tight">
            <div className="type-page-title truncate text-foreground">{label || "…"}</div>
            <div className="mt-0.5 truncate text-[12px] font-medium text-muted-foreground">
              {t("workspace")}
            </div>
          </div>
        </div>

        {/* Right — language + refresh + sign out */}
        <div className="ml-auto flex items-center gap-2">
          <div className="flex overflow-hidden rounded-full border border-border bg-card shadow-card">
            <button
              onClick={() => setLang("ta")}
              className={cn(
                "px-3 py-1.5 text-[12px] font-semibold transition-colors",
                lang === "ta" ? "bg-brand text-white" : "text-muted-foreground hover:bg-muted",
              )}
            >
              தமிழ்
            </button>
            <button
              onClick={() => setLang("en")}
              className={cn(
                "px-3 py-1.5 text-[12px] font-semibold transition-colors",
                lang === "en" ? "bg-brand text-white" : "text-muted-foreground hover:bg-muted",
              )}
            >
              English
            </button>
          </div>

          {onRefresh && (
            <button
              onClick={onRefresh}
              disabled={refreshing}
              title={t("refresh")}
              className="grid h-9 w-9 place-items-center rounded-xl border border-border bg-card text-muted-foreground shadow-card transition-colors hover:bg-muted disabled:opacity-50"
            >
              <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} />
            </button>
          )}

          <button
            onClick={onSignOut}
            className="flex items-center gap-1.5 rounded-xl border border-border bg-card px-3 py-1.5 text-sm font-semibold text-foreground shadow-card transition-colors hover:bg-muted"
          >
            <LogOut className="h-4 w-4" /> {t("signOut")}
          </button>
        </div>
      </div>
    </header>
  );
}
