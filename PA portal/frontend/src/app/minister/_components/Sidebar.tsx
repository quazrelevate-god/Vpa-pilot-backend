"use client";

import { Home, Lightbulb, Ticket, Users2, CalendarDays, LogOut, type LucideIcon } from "lucide-react";
import { useT } from "../_lib/i18n";
import { api } from "../_lib/api";
import { cn } from "@/lib/utils";

export type Tab = "home" | "proposals" | "tickets" | "associations" | "events";

const ITEMS: { key: Tab; icon: LucideIcon; en: string; ta: string }[] = [
  { key: "home",         icon: Home,         en: "Home",          ta: "முகப்பு" },
  { key: "proposals",    icon: Lightbulb,    en: "Proposals",     ta: "முன்மொழிவுகள்" },
  { key: "tickets",      icon: Ticket,       en: "Tickets",       ta: "புகார்கள்" },
  { key: "associations", icon: Users2,       en: "Associations",  ta: "சங்கங்கள்" },
  { key: "events",       icon: CalendarDays, en: "Events",        ta: "நிகழ்வுகள்" },
];

/** Left navigation for the tablet layout. Its visibility is driven by the shell
 *  (the TopBar menu button + a click on the dashboard both toggle it), so the
 *  Minister can give any dashboard the full width of the tablet. */
export default function Sidebar({ tab, onTab }: { tab: Tab; onTab: (t: Tab) => void }) {
  const { lang } = useT();

  async function logout() {
    try { await api.logout(); } catch {}
    window.location.href = "/minister/login";
  }

  return (
    <aside className="flex h-full w-[240px] flex-col border-r border-border bg-card">
      {/* Brand */}
      <div className="flex items-center gap-3 border-b border-border px-4 py-5">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/minister/namkural-icon.svg" alt="" className="h-10 w-10 shrink-0" />
        <div className="min-w-0 leading-tight">
          <div className="truncate font-serif text-[16px] font-semibold text-foreground">
            {lang === "ta" ? "அமைச்சர் மேசை" : "Minister's Desk"}
          </div>
          <div className="truncate text-[11.5px] text-muted-foreground">
            {lang === "ta" ? "நம் குரல்" : "Nam Kural"}
          </div>
        </div>
      </div>

      {/* Nav — roomy, touch-friendly items that use the tablet's vertical space
          instead of bunching at the top. */}
      <nav className="flex flex-1 flex-col gap-2 overflow-y-auto p-3">
        {ITEMS.map(({ key, icon: Icon, en, ta }) => {
          const active = tab === key;
          return (
            <button
              key={key}
              onClick={() => onTab(key)}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex w-full items-center gap-3 rounded-xl px-4 py-3.5 text-left text-[15px] font-semibold transition-colors",
                active
                  ? "bg-brand text-white shadow-card"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              <Icon className="h-[21px] w-[21px] shrink-0" strokeWidth={active ? 2.25 : 1.75} />
              <span className="truncate">{lang === "ta" ? ta : en}</span>
            </button>
          );
        })}
      </nav>

      {/* Sign out at the foot — no other secondary actions in a read-only app. */}
      <div className="border-t border-border p-3">
        <button
          onClick={logout}
          className="flex w-full items-center gap-3 rounded-xl px-4 py-3.5 text-left text-[14px] font-semibold text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <LogOut className="h-[20px] w-[20px] shrink-0" />
          {lang === "ta" ? "வெளியேறு" : "Sign out"}
        </button>
      </div>
    </aside>
  );
}
