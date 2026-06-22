"use client";

import { ShieldCheck } from "lucide-react";
import { useLang } from "@/lib/lang-context";
import { cn } from "@/lib/utils";

export default function TopBar({ rightSlot }: { rightSlot?: React.ReactNode }) {
  const { lang, setLang, t } = useLang();

  return (
    <header className="sticky top-0 z-30 h-16 flex-shrink-0 border-b border-border bg-card/80 backdrop-blur-md">
      <div className="flex h-full items-center justify-between px-6">
        {/* Left — brand */}
        <div className="flex items-center gap-3">
          <div className="grid h-8 w-8 place-items-center rounded-md bg-primary/5 text-primary ring-1 ring-primary/10">
            <ShieldCheck className="h-4 w-4" />
          </div>
          <div className="leading-tight">
            <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {t("topbar.subtitle")}
            </div>
            <div className="text-sm font-bold tracking-tight text-foreground">
              {t("topbar.title")}
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
