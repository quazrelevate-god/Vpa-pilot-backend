"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { CalendarDays, LayoutDashboard, LogOut, Clock, Users, Ticket } from "lucide-react";
import { fetchTicketsOpenCount } from "@/lib/api";

const NAV = [
  { href: "/overview",       label: "Dashboard",      icon: LayoutDashboard },
  { href: "/tickets",        label: "Tickets",        icon: Ticket, badge: "openTickets" as const },
  { href: "/appointments",   label: "Appointments",   icon: CalendarDays },
  { href: "/scheduling",     label: "Scheduling",     icon: Clock },
  { href: "/waiting-queue",  label: "Waiting Queue",  icon: Users },
];

export default function Sidebar({ user = "admin" }: { user?: string }) {
  const pathname = usePathname();
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
    <aside className="w-60 bg-sidebar text-white flex flex-col flex-shrink-0">
      <div className="h-16 flex items-center px-5 border-b border-white/10">
        <span className="text-sm font-bold leading-tight">
          Petition Management
          <br />
          <span className="text-white/50 font-normal text-xs">Staff Portal</span>
        </span>
      </div>
      <nav className="flex-1 overflow-y-auto sidebar-scroll py-3">
        {NAV.map(({ href, label, icon: Icon, badge }) => {
          const active = pathname?.startsWith(href);
          const badgeVal = badge ? badges[badge] : null;
          return (
            <Link
              key={href}
              href={href}
              className={[
                "flex items-center px-5 py-3 text-sm font-medium gap-3 transition-colors",
                active
                  ? "bg-sidebarActive text-white"
                  : "text-white/70 hover:bg-sidebarHover hover:text-white",
              ].join(" ")}
            >
              <Icon className="w-4 h-4" />
              <span className="flex-1">{label}</span>
              {badgeVal != null && badgeVal > 0 && (
                <span className="bg-red-500/90 text-white text-[10px] font-bold rounded-full min-w-[20px] h-5 px-1.5 flex items-center justify-center">
                  {badgeVal > 99 ? "99+" : badgeVal}
                </span>
              )}
            </Link>
          );
        })}
      </nav>
      <div className="p-4 border-t border-white/10">
        <a
          href="/auth/logout"
          className="flex items-center gap-2 text-white/60 hover:text-white text-xs transition-colors"
        >
          <LogOut className="w-4 h-4" /> Sign out ({user})
        </a>
      </div>
    </aside>
  );
}
