"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  CalendarDays, ChevronDown, LayoutDashboard, LogOut, Clock, Ticket, Landmark, UserPlus, Sparkles, ClipboardCheck, QrCode, Hourglass,
  Building2, BarChart3, Settings as SettingsIcon,
} from "lucide-react";

/** Operations Center mark — four rounded nodes (Departments · MLAs · Ministers
 *  · Citizens) linked into a connected ring. Inherits currentColor. */
function OpsLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      {/* connectors */}
      <g fill="currentColor" opacity="0.5">
        <rect x="9" y="4.8" width="6" height="2.4" rx="1.2" />
        <rect x="9" y="16.8" width="6" height="2.4" rx="1.2" />
        <rect x="4.8" y="9" width="2.4" height="6" rx="1.2" />
        <rect x="16.8" y="9" width="2.4" height="6" rx="1.2" />
      </g>
      {/* four nodes */}
      <g fill="currentColor">
        <rect x="3" y="3" width="6" height="6" rx="2" />
        <rect x="15" y="3" width="6" height="6" rx="2" />
        <rect x="3" y="15" width="6" height="6" rx="2" />
        <rect x="15" y="15" width="6" height="6" rx="2" />
      </g>
    </svg>
  );
}
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { fetchTicketsOpenCount, fetchAppointmentCounts } from "@/lib/api";
import { useLang } from "@/lib/lang-context";
import { cn } from "@/lib/utils";

type BadgeKey = "openTickets" | "awaitingReview" | "waiting";

// Final-reference order: Overview → Appointments → Petition Review → Tickets
// → Scheduling → Waiting Queue → AI Uploads → Referrals → Crowd QR.
// Alt+1…9 jumps by position in this list.
const NAV_ITEMS: { href: string; tKey: string; icon: typeof CalendarDays; badge?: BadgeKey; badgeTone?: "violet" | "orange" | "red" }[] = [
  { href: "/overview",      tKey: "nav.performance",  icon: LayoutDashboard },
  { href: "/appointments",  tKey: "nav.appointments", icon: CalendarDays },
  { href: "/ai-review",     tKey: "nav.aiReview",     icon: ClipboardCheck, badge: "awaitingReview", badgeTone: "red" },
  { href: "/tickets",       tKey: "nav.tickets",      icon: Ticket, badge: "openTickets", badgeTone: "orange" },
  { href: "/scheduling",    tKey: "nav.scheduling",   icon: Clock },
  { href: "/waiting-queue", tKey: "nav.waitingQueue", icon: Hourglass, badge: "waiting", badgeTone: "orange" },
  { href: "/ai-uploads",    tKey: "nav.aiUploads",    icon: Sparkles },
  { href: "/referrals",     tKey: "nav.referrals",    icon: UserPlus },
  { href: "/crowd-qr",      tKey: "nav.crowdQr",      icon: QrCode },
];

// Present in the approved reference but not built yet — rendered identically,
// inert until their pages exist (no dead links).
const SOON_ITEMS: { tKey: string; icon: typeof CalendarDays }[] = [
  { tKey: "nav.departments", icon: Building2 },
  { tKey: "nav.analytics",   icon: BarChart3 },
  { tKey: "nav.settings",    icon: SettingsIcon },
];

function daysSince(iso: string): number {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 0;
  return Math.floor((Date.now() - then) / 86_400_000);
}

export default function Sidebar({ user = "admin" }: { user?: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const { t } = useLang();
  const [openTickets, setOpenTickets] = useState<number | null>(null);
  const [apptCounts, setApptCounts] = useState<Record<string, number>>({});
  const [oldestWaitDays, setOldestWaitDays] = useState<number>(0);

  useEffect(() => {
    const loadBadges = () => {
      fetchTicketsOpenCount().then(setOpenTickets).catch(() => {});
      fetchAppointmentCounts({}).then(setApptCounts).catch(() => {});
      // Oldest wait drives the Waiting Queue badge escalation (3+ days = fairness alarm).
      fetch("/api/v1/scheduling/admin/waiting-queue?limit=1", { credentials: "include" })
        .then((r) => (r.ok ? r.json() : []))
        .then((items) => {
          const first = Array.isArray(items) ? items[0] : null;
          setOldestWaitDays(first?.waiting_since ? daysSince(first.waiting_since) : 0);
        })
        .catch(() => {});
    };
    loadBadges();
    const id = setInterval(loadBadges, 30_000);
    return () => clearInterval(id);
  }, [pathname]);

  // Alt+1…9 — jump to the Nth room from anywhere in the portal.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      const n = Number(e.key);
      if (!Number.isInteger(n) || n < 1 || n > NAV_ITEMS.length) return;
      e.preventDefault();
      router.push(NAV_ITEMS[n - 1].href);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router]);

  const badges: Record<BadgeKey, number | null> = {
    openTickets,
    awaitingReview: apptCounts["Awaiting Review"] ?? null,
    waiting: apptCounts["Waiting"] ?? null,
  };
  const waitingEscalated = oldestWaitDays >= 3;

  return (
    <aside className="aurora-sidebar relative flex w-64 flex-shrink-0 flex-col text-sidebar-foreground">
      {/* Brand — Operations Center (links home) */}
      <Link
        href="/overview"
        className="relative flex items-center gap-3 rounded-xl px-5 pb-4 pt-5 transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="grid h-11 w-11 flex-shrink-0 place-items-center rounded-2xl border border-[#E7DFFC] bg-gradient-to-br from-white to-[#F3EFFC] text-[#7C5CF6] shadow-[0_2px_8px_rgba(124,92,246,0.12)]">
          <OpsLogo className="h-[22px] w-[22px]" />
        </span>
        <span className="leading-tight">
          <span className="block text-[15px] font-bold leading-snug tracking-tight text-foreground">
            Operations Center
          </span>
          <span className="mt-0.5 block text-[11px] font-medium text-muted-foreground">Petition Desk</span>
        </span>
      </Link>

      {/* Nav */}
      <nav aria-label="Main navigation" className="nav-scroll-fade sidebar-scroll flex-1 overflow-y-auto px-3 pb-3 pt-1">
        <div className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/70">
          {t("nav.menu")}
        </div>
        <div className="space-y-2">
          {NAV_ITEMS.map(({ href, tKey, icon: Icon, badge, badgeTone }, i) => {
            const active = pathname?.startsWith(href);
            const badgeVal = badge ? badges[badge] : null;
            const escalate = badge === "waiting" && waitingEscalated;
            return (
              <Link
                key={href}
                href={href}
                title={`${t(tKey)} — Alt+${i + 1}`}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "group relative flex h-12 items-center gap-3 rounded-[12px] px-3.5 text-sm font-medium",
                  "transition-colors duration-150",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
                  active
                    ? "text-[#FFF0F5]"
                    : "aurora-nav-item text-[#303446] hover:text-[#D97B3F]"
                )}
              >
                {active && (
                  <motion.span
                    layoutId="sidebar-active-pill"
                    className="aurora-nav-active absolute inset-0 rounded-[12px]"
                    transition={{ type: "spring", stiffness: 420, damping: 38 }}
                  />
                )}
                <Icon
                  className={cn(
                    "relative z-[1] h-[22px] w-[22px] transition-[color,transform] duration-150",
                    active
                      ? "text-white drop-shadow-[0_1px_1px_rgba(91,68,196,0.35)]"
                      : "text-[#4A4E5E] group-hover:translate-x-0.5 group-hover:text-[#D97B3F]"
                  )}
                />
                <span className="relative z-[1] flex-1">{t(tKey)}</span>
                {badgeVal != null && badgeVal > 0 && (
                  <span
                    key={`${badgeVal}-${escalate}`}
                    aria-label={`${badgeVal} ${t(tKey)}`}
                    title={escalate ? `Oldest waiting ${oldestWaitDays} days` : undefined}
                    className={cn(
                      "aurora-badge-in relative z-[1] grid h-[22px] min-w-[26px] place-items-center rounded-full px-2 text-[12px] font-semibold tabular-nums",
                      active
                        ? "bg-white/80 text-brand"
                        : badgeTone === "red"
                          ? "bg-[#E5484D] text-white shadow-[0_2px_6px_rgba(229,72,77,0.4)]"
                          : badgeTone === "orange"
                            ? escalate
                              ? "bg-[#E5484D] text-white shadow-[0_2px_6px_rgba(229,72,77,0.45)]"
                              : "bg-[#F59C40] text-white shadow-[0_2px_6px_rgba(245,156,64,0.4)]"
                            : "border border-[#E7DFFC] bg-white/90 text-[#7C5CF6] shadow-[0_2px_6px_rgba(124,92,246,0.15)]"
                    )}
                  >
                    {badgeVal > 999 ? "999+" : badgeVal}
                  </span>
                )}
              </Link>
            );
          })}
          {SOON_ITEMS.map(({ tKey, icon: Icon }) => (
            <span
              key={tKey}
              title="Coming soon"
              aria-disabled="true"
              className="group relative flex h-12 cursor-default select-none items-center gap-3 rounded-[12px] px-3.5 text-sm font-medium text-[#303446]"
            >
              <Icon className="h-[22px] w-[22px] text-[#4A4E5E]" />
              <span className="flex-1">{t(tKey)}</span>
            </span>
          ))}
        </div>
      </nav>

      {/* Foot — office card (language toggle now lives in the header) */}
      <div className="border-t border-sidebar-border p-3">
        {/* Office / account card — chevron opens the account menu */}
        <div className="flex items-center gap-3 rounded-xl border border-border bg-card p-2.5 shadow-card">
          <div className="grid h-9 w-9 flex-shrink-0 place-items-center rounded-lg bg-accent text-accent-foreground">
            <Landmark className="h-[18px] w-[18px]" />
          </div>
          <div className="min-w-0 flex-1 leading-tight">
            <div className="truncate text-sm font-semibold text-foreground">{t("nav.paOffice")}</div>
            <div className="truncate text-[11px] text-muted-foreground">Secretariat, Chennai</div>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                aria-label="Account menu"
                className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-sidebar-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <ChevronDown className="h-4 w-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" side="top" className="w-52">
              <DropdownMenuLabel className="text-[12px] text-muted-foreground">
                Signed in as <span className="font-semibold text-foreground">{user}</span>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={() => {
                  fetch("/auth/logout", { credentials: "include" }).finally(() => {
                    window.location.href = "/login";
                  });
                }}
              >
                <LogOut className="h-3.5 w-3.5" /> Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </aside>
  );
}
