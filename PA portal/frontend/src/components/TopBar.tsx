"use client";

import { ShieldCheck } from "lucide-react";
import { useLang } from "@/lib/lang-context";
import { cn } from "@/lib/utils";

interface TopBarProps {
  rightSlot?: React.ReactNode;
  /** Page-specific title shown in the header. Falls back to "topbar.title". */
  title?: string;
  /** Page-specific subtitle shown above the title. Falls back to "topbar.subtitle". */
  subtitle?: string;
  /** Page-specific icon. Defaults to the brand shield. */
  icon?: React.ReactNode;
}

export default function TopBar({ rightSlot, title, subtitle, icon }: TopBarProps) {
  const { lang, setLang, t } = useLang();
  const headerTitle = title ?? t("topbar.title");
  const headerSubtitle = subtitle ?? t("topbar.subtitle");
  const headerIcon = icon ?? <ShieldCheck className="h-4 w-4" />;

  return (
    <header className="sticky top-0 z-30 h-16 flex-shrink-0 border-b border-border bg-card/80 backdrop-blur-md">
      <div className="flex h-full items-center justify-between px-6">
        {/* Left — page identity */}
        <div className="flex items-center gap-3">
          <div className="grid h-9 w-9 place-items-center rounded-md bg-primary/5 text-primary ring-1 ring-primary/10">
            {headerIcon}
          </div>
          <div className="leading-tight">
            <div className="text-lg font-bold tracking-tight text-sidebar">
              {headerTitle}
            </div>
            <div className="mt-0.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {headerSubtitle}
            </div>
          </div>
        </div>

        {/* Right — lang toggle + page slot */}
        <div className="flex items-center gap-3">
          {/* EN / த pill toggle */}
          <div className="flex items-center rounded-full border border-border bg-muted/50 p-0.5 text-xs font-bold">
            <button
              onClick={() => setLang("en")}
              className={cn(
                "rounded-full px-3 py-1 transition-all",
                lang === "en"
                  ? "bg-[#0f62fe] text-white shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              EN
            </button>
            <button
              onClick={() => setLang("ta")}
              className={cn(
                "rounded-full px-3 py-1 transition-all",
                lang === "ta"
                  ? "bg-[#0f62fe] text-white shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              த
            </button>
          </div>

          {rightSlot != null && (
            <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
              {rightSlot}
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
