"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarDays, LayoutDashboard, LogOut, Clock, Users } from "lucide-react";

const NAV = [
  { href: "/overview",       label: "Dashboard",      icon: LayoutDashboard },
  { href: "/appointments",   label: "Appointments",   icon: CalendarDays },
  { href: "/scheduling",     label: "Scheduling",     icon: Clock },
  { href: "/waiting-queue",  label: "Waiting Queue",  icon: Users },
];

export default function Sidebar({ user = "admin" }: { user?: string }) {
  const pathname = usePathname();
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
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = pathname?.startsWith(href);
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
              {label}
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
