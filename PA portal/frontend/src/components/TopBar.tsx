"use client";

import { useSyncExternalStore } from "react";
import { ShieldCheck } from "lucide-react";
import { useLang } from "@/lib/lang-context";
import { cn } from "@/lib/utils";
import { subscribeLoading, getLoadingSnapshot } from "@/lib/loading-bar";

/** Indeterminate loading bar pinned to the header's bottom border. Shows while
 *  any API request is in flight (see lib/loading-bar). */
function HeaderLoadingBar() {
  const loading = useSyncExternalStore(subscribeLoading, getLoadingSnapshot, () => false);
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-x-0 bottom-0 h-[3px] overflow-hidden transition-opacity duration-200"
      style={{ opacity: loading ? 1 : 0 }}
    >
      <div className="loading-bar-indeterminate" />
    </div>
  );
}

interface TopBarProps {
  rightSlot?: React.ReactNode;
  /** Page search field, rendered in the header per the Aurora reference. */
  searchSlot?: React.ReactNode;
  /** Page-specific title shown in the header. Falls back to "topbar.title". */
  title?: string;
  /** Page-specific subtitle shown above the title. Falls back to "topbar.subtitle". */
  subtitle?: string;
  /** Page-specific icon. Defaults to the brand shield. */
  icon?: React.ReactNode;
  /** Signed-in user — retained for callers; not shown in the header. */
  user?: string;
}

export default function TopBar({ rightSlot, searchSlot, title, subtitle, icon }: TopBarProps) {
  const { lang, setLang, t } = useLang();
  const headerTitle = title ?? t("topbar.title");
  const headerSubtitle = subtitle ?? t("topbar.subtitle");
  const headerIcon = icon ?? <ShieldCheck className="h-4 w-4" />;

  return (
    <header className="sticky top-0 z-30 h-20 flex-shrink-0 border-b border-border bg-card relative">
      <HeaderLoadingBar />
      <div className="flex h-full items-center gap-4 px-6">
        {/* Left — page identity */}
        <div className="flex min-w-0 items-center gap-3">
          <div className="grid h-10 w-10 flex-shrink-0 place-items-center rounded-xl border border-border bg-card text-brand shadow-card">
            {headerIcon}
          </div>
          <div className="min-w-0 leading-tight">
            <div className="type-page-title truncate text-foreground">
              {headerTitle}
            </div>
            <div className="mt-0.5 truncate text-[12px] font-medium text-muted-foreground">
              {headerSubtitle}
            </div>
          </div>
        </div>

        {/* Center-right — page search (Aurora Recall) */}
        {searchSlot != null && (
          <div className="ml-auto hidden w-full max-w-md md:block">{searchSlot}</div>
        )}

        {/* Right — language toggle */}
        <div className={cn("flex flex-shrink-0 items-center gap-2.5", searchSlot == null && "ml-auto")}>
          <div className="flex items-center rounded-full border border-border bg-card p-0.5 text-xs font-bold shadow-card">
            <button
              onClick={() => setLang("ta")}
              className={cn(
                "rounded-full px-3.5 py-1.5 transition-all",
                lang === "ta" ? "bg-foreground text-card shadow-card" : "text-muted-foreground hover:text-foreground"
              )}
            >
              தமிழ்
            </button>
            <button
              onClick={() => setLang("en")}
              className={cn(
                "rounded-full px-3.5 py-1.5 transition-all",
                lang === "en" ? "bg-foreground text-card shadow-card" : "text-muted-foreground hover:text-foreground"
              )}
            >
              English
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
