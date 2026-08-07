"use client";

import { Home, Lightbulb, Ticket, Users2, CalendarDays, LogOut, type LucideIcon } from "lucide-react";
import { useT } from "../_lib/i18n";
import { api } from "../_lib/api";

export type Tab = "home" | "proposals" | "tickets" | "associations" | "events";

const ITEMS: { key: Tab; icon: LucideIcon; en: string; ta: string }[] = [
  { key: "home",         icon: Home,         en: "Home",          ta: "முகப்பு" },
  { key: "proposals",    icon: Lightbulb,    en: "Proposals",     ta: "முன்மொழிவுகள்" },
  { key: "tickets",      icon: Ticket,       en: "Tickets",       ta: "புகார்கள்" },
  { key: "associations", icon: Users2,       en: "Associations",  ta: "சங்கங்கள்" },
  { key: "events",       icon: CalendarDays, en: "Events",        ta: "நிகழ்வுகள்" },
];

/** Deep-navy navigation rail with a gold active spine — the same register as
 *  the sign-in screen, so the app reads as one ministerial instrument. */
export default function Sidebar({ tab, onTab }: { tab: Tab; onTab: (t: Tab) => void }) {
  const { lang } = useT();

  async function logout() {
    try { await api.logout(); } catch {}
    window.location.href = "/minister/login";
  }

  return (
    <aside className="mn-nav flex h-full w-[248px] flex-col">
      {/* Brand */}
      <div className="mn-nav-brand flex items-center gap-3 px-5 py-5">
        <span
          className="grid h-11 w-11 shrink-0 place-items-center rounded-xl"
          style={{
            background: "rgba(233,184,76,0.12)",
            boxShadow: "inset 0 0 0 1px rgba(233,184,76,0.28)",
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/minister/namkural-icon.svg" alt="" className="h-7 w-7" />
        </span>
        <div className="min-w-0 leading-tight">
          <div className="mn-nav-title truncate font-serif text-[16.5px] font-semibold">
            {lang === "ta" ? "அமைச்சர் மேசை" : "Minister's Desk"}
          </div>
          <div className="mn-nav-sub truncate text-[10px] font-bold uppercase">
            {lang === "ta" ? "நம் குரல்" : "Nam Kural"}
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex flex-1 flex-col gap-1.5 overflow-y-auto p-3">
        {ITEMS.map(({ key, icon: Icon, en, ta }) => {
          const active = tab === key;
          return (
            <button
              key={key}
              onClick={() => onTab(key)}
              aria-current={active ? "page" : undefined}
              className="mn-nav-item flex w-full items-center gap-3 px-4 py-3.5 text-left text-[14.5px] font-semibold"
            >
              <Icon className="mn-nav-icon h-[20px] w-[20px] shrink-0" strokeWidth={active ? 2.2 : 1.75} />
              <span className="truncate">{lang === "ta" ? ta : en}</span>
            </button>
          );
        })}
      </nav>

      {/* Sign out — read-only app, so this is the only secondary action. */}
      <div className="mn-nav-foot p-3">
        <button
          onClick={logout}
          className="mn-nav-item flex w-full items-center gap-3 px-4 py-3 text-left text-[13.5px] font-semibold"
        >
          <LogOut className="h-[18px] w-[18px] shrink-0" />
          <span className="truncate">{lang === "ta" ? "வெளியேறு" : "Sign out"}</span>
        </button>
      </div>
    </aside>
  );
}
