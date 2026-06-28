"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  CalendarDays, LayoutDashboard, LogOut, Clock, Ticket, Landmark, UserPlus, Sparkles, ClipboardCheck, QrCode,
} from "lucide-react";
import { fetchTicketsOpenCount } from "@/lib/api";
import { useLang } from "@/lib/lang-context";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { href: "/overview",      tKey: "nav.performance",  icon: LayoutDashboard },
  { href: "/tickets",       tKey: "nav.tickets",      icon: Ticket, badge: "openTickets" as const },
  { href: "/appointments",  tKey: "nav.appointments", icon: CalendarDays },
  { href: "/scheduling",    tKey: "nav.scheduling",   icon: Clock },
  { href: "/referrals",     tKey: "nav.referrals",    icon: UserPlus },
  { href: "/ai-uploads",    tKey: "nav.aiUploads",    icon: Sparkles },
  { href: "/ai-review",     tKey: "nav.aiReview",     icon: ClipboardCheck },
  { href: "/crowd-qr",      tKey: "nav.crowdQr",      icon: QrCode },
];

export default function Sidebar({ user = "admin" }: { user?: string }) {
  const pathname = usePathname();
  const { t } = useLang();
  const [openTickets, setOpenTickets] = useState<number | null>(null);

  useEffect(() => {
    fetchTicketsOpenCount().then(setOpenTickets).catch(() => setOpenTickets(null));
    const id = setInterval(() => {
      fetchTicketsOpenCount().then(setOpenTickets).catch(() => {});
    }, 30_000);
    return () => clearInterval(id);
  }, [pathname]);

  const badges: Record<string, number | null> = { openTickets };

  return (
    <aside className="w-64 flex-shrink-0 flex flex-col bg-sidebar text-sidebar-foreground relative">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-white/[0.06] to-transparent" />

      {/* Brand */}
      <div className="h-16 flex items-center gap-3 px-5 border-b border-sidebar-border relative">
        <div className="grid h-9 w-9 place-items-center rounded-lg bg-brand text-white shadow-card-md ring-1 ring-white/10">
          <Landmark className="h-5 w-5" />
        </div>
        <div className="leading-tight">
          <div className="text-sm font-bold tracking-tight">{t("brand.title")}</div>
          <div className="text-[11px] font-medium text-sidebar-foreground/55">{t("brand.subtitle")}</div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto sidebar-scroll px-3 py-4">
        <div className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-sidebar-foreground/40">
          {t("nav.menu")}
        </div>
        <div className="space-y-1">
          {NAV_ITEMS.map(({ href, tKey, icon: Icon, badge }) => {
            const active = pathname?.startsWith(href);
            const badgeVal = badge ? badges[badge] : null;
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  "group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all",
                  active
                    ? "bg-sidebar-active/90 text-white shadow-card"
                    : "text-sidebar-foreground/70 hover:bg-sidebar-hover hover:text-white"
                )}
              >
                <span
                  className={cn(
                    "absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-brand transition-all",
                    active ? "opacity-100" : "opacity-0 group-hover:opacity-40"
                  )}
                />
                <Icon className={cn("h-[18px] w-[18px] transition-colors", active ? "text-white" : "text-sidebar-foreground/60 group-hover:text-white")} />
                <span className="flex-1">{t(tKey)}</span>
                {badgeVal != null && badgeVal > 0 && (
                  <span className="grid h-5 min-w-[20px] place-items-center rounded-full bg-red-500 px-1.5 text-[10px] font-bold text-white shadow-card">
                    {badgeVal > 99 ? "99+" : badgeVal}
                  </span>
                )}
              </Link>
            );
          })}
        </div>
      </nav>

      {/* Footer */}
      <div className="border-t border-sidebar-border p-3">
        <div className="flex items-center gap-3 rounded-lg px-2 py-2">
          <div className="grid h-9 w-9 place-items-center rounded-full bg-white/10 text-xs font-bold uppercase text-white ring-1 ring-white/10">
            {user.slice(0, 2)}
          </div>
          <div className="min-w-0 flex-1 leading-tight">
            <div className="truncate text-sm font-semibold text-white">{user}</div>
            <div className="text-[11px] text-sidebar-foreground/50">{t("nav.paOffice")}</div>
          </div>
          <a
            href="/auth/logout"
            title="Sign out"
            onClick={(e) => {
              e.preventDefault();
              fetch("/auth/logout", { credentials: "include" }).finally(() => {
                window.location.href = "/login";
              });
            }}
            className="grid h-8 w-8 place-items-center rounded-md text-sidebar-foreground/60 transition-colors hover:bg-sidebar-hover hover:text-white"
          >
            <LogOut className="h-4 w-4" />
          </a>
        </div>
      </div>
    </aside>
  );
}
