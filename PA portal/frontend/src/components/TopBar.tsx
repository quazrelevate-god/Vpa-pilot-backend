"use client";

import { useSyncExternalStore } from "react";
import { Menu } from "lucide-react";
import { useLang } from "@/lib/lang-context";
import { cn } from "@/lib/utils";
import { subscribeLoading, getLoadingSnapshot } from "@/lib/loading-bar";
import { toggleSidebar } from "@/lib/sidebar-drawer";

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

  return (
    <header className="sticky top-0 z-30 h-20 flex-shrink-0 border-b border-border bg-card relative">
      <HeaderLoadingBar />
      <div className="flex h-full items-center gap-3 px-4 sm:gap-4 sm:px-6">
        {/* Hamburger — opens the sidebar drawer on mobile/tablet (< lg).
            Hidden at lg+ where the sidebar is a permanent static column. */}
        <button
          type="button"
          aria-label="Open menu"
          onClick={toggleSidebar}
          className="lg:hidden grid h-10 w-10 flex-shrink-0 place-items-center rounded-xl border border-border bg-card text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Menu className="h-5 w-5" />
        </button>
        {/* Left — page identity. Default is the Nam Kural mark in the ivory
            + gold container that matches the Minister sidebar and Events
            top bar; callers that pass their own `icon` prop keep the
            neutral brand-shield container so page-specific icons
            (Association Dashboard's Users, etc.) still read right. */}
        <div className="flex min-w-0 items-center gap-3">
          {icon ? (
            <div className="grid h-10 w-10 flex-shrink-0 place-items-center rounded-xl border border-border bg-card text-brand shadow-card">
              {icon}
            </div>
          ) : (
            <span
              className="grid h-10 w-10 flex-shrink-0 place-items-center rounded-xl"
              style={{
                background: "rgba(233,184,76,0.12)",
                boxShadow: "inset 0 0 0 1px rgba(233,184,76,0.28)",
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/brand/namkural-icon.svg" alt="" className="h-6 w-6" />
            </span>
          )}
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
