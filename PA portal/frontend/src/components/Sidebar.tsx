"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";
import { motion } from "framer-motion";
import {
  CalendarDays, ChevronDown, ChevronsLeft, ChevronsRight, LayoutDashboard, LogOut, Clock, Ticket, Landmark, UserPlus, Sparkles, ClipboardCheck, QrCode,
  BarChart3, Lightbulb, Users2, PieChart, Activity, X,
  Settings as SettingsIcon,
} from "lucide-react";
import { subscribeSidebar, getSidebarSnapshot, closeSidebar } from "@/lib/sidebar-drawer";
import { useMediaQuery } from "@/lib/use-media-query";

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

type BadgeKey = "openTickets" | "awaitingReview";

// Final-reference order: Overview → Appointments → Petition Review → Tickets
// → Scheduling → AI Uploads → Referrals → Crowd QR.
// Alt+1…9 jumps by position in this list.
const NAV_ITEMS: { href: string; tKey: string; icon: typeof CalendarDays; badge?: BadgeKey; badgeTone?: "violet" | "orange" | "red" }[] = [
  { href: "/overview",      tKey: "nav.performance",  icon: LayoutDashboard },
  { href: "/appointments",  tKey: "nav.appointments", icon: CalendarDays },
  { href: "/ai-review",     tKey: "nav.aiReview",     icon: ClipboardCheck, badge: "awaitingReview", badgeTone: "red" },
  { href: "/proposal-review", tKey: "nav.proposalReview", icon: Lightbulb },
  { href: "/proposal-dashboard", tKey: "nav.proposalDashboard", icon: PieChart },
  { href: "/association-review", tKey: "nav.associationReview", icon: Users2 },
  { href: "/association-dashboard", tKey: "nav.associationDashboard", icon: Activity },
  { href: "/tickets",       tKey: "nav.tickets",      icon: Ticket, badge: "openTickets", badgeTone: "orange" },
  { href: "/ticket-insights", tKey: "nav.ticketInsights", icon: BarChart3 },
  { href: "/scheduling",    tKey: "nav.scheduling",   icon: Clock },
  { href: "/ai-uploads",    tKey: "nav.aiUploads",    icon: Sparkles },
  { href: "/referrals",     tKey: "nav.referrals",    icon: UserPlus },
  { href: "/crowd-qr",      tKey: "nav.crowdQr",      icon: QrCode },
];

// Rooms reserved for super_admin. Everyone else — including pa/auditor, who
// otherwise see every room — never gets these in the nav.
const SUPER_ADMIN_ONLY: string[] = ["/overview", "/referrals", "/proposal-review", "/proposal-dashboard", "/association-review", "/association-dashboard"];

// Settings is a real page; only visible to super_admin with the feature
// flag on. When neither condition holds it disappears from the nav entirely
// rather than showing a "Coming soon" placeholder.
const SETTINGS_ITEM = {
  href: "/settings" as const,
  tKey: "nav.settings",
  icon: SettingsIcon,
};

// Layout breakpoint — at 1280px the sidebar stays open permanently. Below that
// it starts collapsed to an icon-only rail; a toggle expands it inline.
const EXPAND_BREAKPOINT = "(min-width: 1280px)";


export default function Sidebar({ user = "admin" }: { user?: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const { t } = useLang();
  const [openTickets, setOpenTickets] = useState<number | null>(null);
  const [apptCounts, setApptCounts] = useState<Record<string, number>>({});

  // Fixed open on ≥ xl (1280px); starts collapsed below that but the user can
  // toggle it back open with the chevron button. When the viewport crosses
  // the breakpoint we sync so it doesn't get stuck.
  const [expanded, setExpanded] = useState(true);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mql = window.matchMedia(EXPAND_BREAKPOINT);
    setExpanded(mql.matches);
    const apply = (e: MediaQueryListEvent) => setExpanded(e.matches);
    mql.addEventListener("change", apply);
    return () => mql.removeEventListener("change", apply);
  }, []);

  // ── Mobile / tablet off-canvas drawer ──────────────────────────────────────
  // Below lg (1024px) the sidebar is a fixed overlay opened by the hamburger
  // in TopBar (shared state via the sidebar-drawer store). At lg+ it's a
  // static in-flow column and the drawer state is irrelevant (CSS lg: classes
  // pin it open). Content is always shown expanded inside the drawer, so labels
  // render even when the desktop rail is collapsed.
  const drawerOpen = useSyncExternalStore(subscribeSidebar, getSidebarSnapshot, () => false);
  const isLargeUp = useMediaQuery("(min-width: 1024px)", true);
  const showExpanded = isLargeUp ? expanded : true;

  // Auto-close the drawer whenever the route changes (nav click on mobile).
  useEffect(() => { closeSidebar(); }, [pathname]);

  useEffect(() => {
    const loadBadges = () => {
      // Skip polling in a hidden tab — parked tabs used to hit the unfiltered
      // count endpoints every 30s all day. Re-run once when the tab becomes
      // visible again so the badges are current the moment the user looks.
      if (document.hidden) return;
      fetchTicketsOpenCount().then(setOpenTickets).catch(() => {});
      fetchAppointmentCounts({}).then(setApptCounts).catch(() => {});
    };
    loadBadges();
    const id = setInterval(loadBadges, 30_000);
    const onVisibility = () => { if (!document.hidden) loadBadges(); };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [pathname]);

  // Settings nav — visible only to super_admin when the feature flag is on.
  const [showSettings, setShowSettings] = useState(false);
  // roleLoaded distinguishes "still loading" from "loaded and null" so the
  // nav can render an empty skeleton instead of the FULL nav during the
  // window before /me resolves (PORT-09: dept_officer / petition_reviewer
  // would briefly see Scheduling / AI Uploads / Referrals before the list
  // narrowed).
  const [role, setRole] = useState<string | null>(null);
  const [roleLoaded, setRoleLoaded] = useState(false);
  const [me, setMe] = useState<{ full_name?: string; login_name?: string; role?: string } | null>(null);
  useEffect(() => {
    // AbortController so a slow /me on route A doesn't clobber the fast /me
    // on route B (rapid nav race — older response used to setRole with a
    // stale value). Also protects against unmount.
    const ac = new AbortController();
    (async () => {
      try {
        const [flags, meRes] = await Promise.all([
          fetch("/api/v1/features", { credentials: "include", signal: ac.signal }).then((r) => r.ok ? r.json() : null),
          fetch("/api/v1/me", { credentials: "include", signal: ac.signal }).then((r) => r.ok ? r.json() : null),
        ]);
        if (ac.signal.aborted) return;
        setShowSettings(Boolean(flags?.superadmin_ui) && meRes?.role === "super_admin");
        setRole(meRes?.role ?? null);
        setMe(meRes ?? null);
        setRoleLoaded(true);
      } catch { /* soft-fail — Settings just stays hidden */ }
    })();
    return () => ac.abort();
  }, [pathname]);

  // Signed-in display name for the footer card (falls back gracefully).
  const displayName = me?.full_name || me?.login_name || user;
  const displaySub = me?.login_name && me?.full_name ? `@${me.login_name}` : t("nav.paOffice");

  // Roles that only get a slice of the portal. Everyone else (super_admin / pa
  // / auditor) sees every room.
  const ROLE_NAV: Record<string, string[]> = {
    dept_officer: ["/tickets"],
    petition_reviewer: ["/appointments", "/ai-review", "/tickets"],
  };
  // Render an empty nav while /me is still resolving — the old default
  // ("no role → show every item") briefly flashed forbidden items for
  // dept_officer / petition_reviewer before the list narrowed. Waiting
  // until roleLoaded=true means the nav is either empty (rare — first
  // paint) or correct, never wrong-then-correct.
  const allowedHrefs = roleLoaded && role ? ROLE_NAV[role] : undefined;
  const navItems = !roleLoaded
    ? []
    : (allowedHrefs
        ? NAV_ITEMS.filter((i) => allowedHrefs.includes(i.href))
        : NAV_ITEMS
      // Overview + Executive Queue are super_admin-only.
      ).filter((i) => !SUPER_ADMIN_ONLY.includes(i.href) || role === "super_admin");

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
  };

  return (
    <>
      {/* Mobile backdrop — click closes the drawer. lg:hidden so the desktop
          static sidebar never dims the page behind it. */}
      {drawerOpen && (
        <div
          className="fixed inset-0 z-40 bg-slate-900/40 backdrop-blur-[1px] lg:hidden"
          onClick={closeSidebar}
          aria-hidden="true"
        />
      )}
      <aside
        className={cn(
          "aurora-sidebar flex flex-col text-sidebar-foreground",
          // < lg: off-canvas fixed drawer that slides in/out via translate.
          "fixed inset-y-0 left-0 z-50 w-64 max-w-[85vw] shadow-2xl transition-transform duration-200 ease-out",
          drawerOpen ? "translate-x-0" : "-translate-x-full",
          // ≥ lg: static in-flow column — width transitions, no transform/shadow.
          "lg:static lg:z-auto lg:max-w-none lg:flex-shrink-0 lg:translate-x-0 lg:shadow-none lg:transition-[width]",
          expanded ? "lg:w-64" : "lg:w-[72px]",
        )}
      >
      {/* Brand — NamKural (links home) */}
      <div className="flex items-start gap-2 px-3 pb-4 pt-5">
        <Link
          href="/overview"
          onClick={() => closeSidebar()}
          className={cn(
            "flex min-w-0 flex-1 items-center gap-3 rounded-xl transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            showExpanded ? "px-2" : "justify-center px-0",
          )}
          title={`${t("brand.name")} — ${t("brand.tagline")}`}
        >
          {/* Nam Kural mark rendered as a bare circle — no ivory-gold window
              wrapper. Larger footprint (h-12 w-12) than the previous 22px
              icon-in-container so the mark reads clearly on the sidebar.
              rounded-full clips the SVG into a proper circle. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/brand/namkural-icon.svg"
            alt=""
            className="h-12 w-12 flex-shrink-0 rounded-full object-cover"
          />
          {showExpanded && (
            <span className="min-w-0 leading-tight">
              <span className="block truncate text-[15px] font-bold leading-snug tracking-tight text-foreground">
                {t("brand.name")}
              </span>
              <span className="mt-0.5 block truncate text-[11px] font-medium text-muted-foreground">{t("brand.tagline")}</span>
            </span>
          )}
        </Link>
        {/* Close button — mobile drawer only (< lg). */}
        <button
          type="button"
          aria-label="Close menu"
          onClick={closeSidebar}
          className="lg:hidden grid h-8 w-8 flex-shrink-0 place-items-center rounded-lg border border-sidebar-border bg-white/70 text-muted-foreground transition-colors hover:bg-sidebar-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="h-4 w-4" />
        </button>
        {/* Collapse / expand rail toggle — desktop only (lg→xl). Hidden < lg
            (drawer is always full) and ≥ xl (pinned open). */}
        <button
          type="button"
          aria-label={expanded ? "Collapse sidebar" : "Expand sidebar"}
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
          className={cn(
            "hidden lg:grid xl:hidden h-8 w-8 flex-shrink-0 place-items-center rounded-lg border border-sidebar-border bg-white/70 text-muted-foreground transition-colors hover:bg-sidebar-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            !expanded && "mx-auto mt-1",
          )}
        >
          {expanded ? <ChevronsLeft className="h-4 w-4" /> : <ChevronsRight className="h-4 w-4" />}
        </button>
      </div>

      {/* Nav */}
      <nav aria-label="Main navigation" className="nav-scroll-fade sidebar-scroll flex-1 overflow-y-auto px-3 pb-3 pt-1">
        {showExpanded && (
          <div className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/70">
            {t("nav.menu")}
          </div>
        )}
        <div className="space-y-2">
          {navItems.map(({ href, tKey, icon: Icon, badge, badgeTone }, i) => {
            const active = pathname?.startsWith(href);
            const badgeVal = badge ? badges[badge] : null;
            return (
              <Link
                key={href}
                href={href}
                onClick={() => closeSidebar()}
                title={showExpanded ? `${t(tKey)} — Alt+${i + 1}` : t(tKey)}
                aria-current={active ? "page" : undefined}
                aria-label={t(tKey)}
                className={cn(
                  "group relative flex h-12 items-center rounded-[12px] text-sm font-medium",
                  "transition-colors duration-150",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
                  showExpanded ? "gap-3 px-3.5" : "justify-center px-0",
                  active
                    ? "text-[#FFFFFF]"
                    : "aurora-nav-item text-[#303446] hover:text-[#1E40AF]",
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
                    "relative z-[1] h-[22px] w-[22px] flex-shrink-0 transition-[color,transform] duration-150",
                    active
                      ? "text-white drop-shadow-[0_1px_1px_rgba(37,99,235,0.35)]"
                      : "text-[#4A4E5E] group-hover:translate-x-0.5 group-hover:text-[#1E40AF]",
                  )}
                />
                {showExpanded && <span className="relative z-[1] flex-1 truncate">{t(tKey)}</span>}
                {badgeVal != null && badgeVal > 0 && (
                  showExpanded ? (
                    <span
                      key={badgeVal}
                      aria-label={`${badgeVal} ${t(tKey)}`}
                      className={cn(
                        "aurora-badge-in relative z-[1] grid h-[22px] min-w-[26px] place-items-center rounded-full px-2 text-[12px] font-semibold tabular-nums",
                        active
                          ? "bg-white/80 text-brand"
                          : badgeTone === "red"
                            ? "bg-[#E5484D] text-white shadow-[0_2px_6px_rgba(229,72,77,0.4)]"
                            : badgeTone === "orange"
                              ? "bg-[#F59C40] text-white shadow-[0_2px_6px_rgba(245,156,64,0.4)]"
                              : "border border-[#CFE0FB] bg-white/90 text-[#1E40AF] shadow-[0_2px_6px_rgba(47,111,237,0.15)]",
                      )}
                    >
                      {badgeVal > 999 ? "999+" : badgeVal}
                    </span>
                  ) : (
                    // Collapsed rail: badge shrinks to a tiny corner dot so
                    // "there's something waiting" survives the collapse.
                    <span
                      aria-hidden="true"
                      className={cn(
                        "absolute right-2 top-2 z-[1] h-2 w-2 rounded-full ring-2 ring-white",
                        badgeTone === "red" ? "bg-[#E5484D]" : badgeTone === "orange" ? "bg-[#F59C40]" : "bg-brand",
                      )}
                    />
                  )
                )}
              </Link>
            );
          })}
          {showSettings && (() => {
            const { href, tKey, icon: Icon } = SETTINGS_ITEM;
            const active = pathname?.startsWith(href);
            return (
              <Link
                href={href}
                onClick={() => closeSidebar()}
                title={t(tKey)}
                aria-current={active ? "page" : undefined}
                aria-label={t(tKey)}
                className={cn(
                  "group relative flex h-12 items-center rounded-[12px] text-sm font-medium",
                  "transition-colors duration-150",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
                  showExpanded ? "gap-3 px-3.5" : "justify-center px-0",
                  active
                    ? "text-[#FFFFFF]"
                    : "aurora-nav-item text-[#303446] hover:text-[#1E40AF]",
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
                    "relative z-[1] h-[22px] w-[22px] flex-shrink-0 transition-[color,transform] duration-150",
                    active
                      ? "text-white drop-shadow-[0_1px_1px_rgba(37,99,235,0.35)]"
                      : "text-[#4A4E5E] group-hover:translate-x-0.5 group-hover:text-[#1E40AF]",
                  )}
                />
                {showExpanded && <span className="relative z-[1] flex-1 truncate">{t(tKey)}</span>}
              </Link>
            );
          })()}
        </div>
      </nav>

      {/* Foot — office card (language toggle now lives in the header) */}
      <div className="border-t border-sidebar-border p-3">
        {showExpanded ? (
          <div className="flex items-center gap-3 rounded-xl border border-border bg-card p-2.5 shadow-card">
            <div className="grid h-9 w-9 flex-shrink-0 place-items-center rounded-lg bg-accent text-accent-foreground">
              <Landmark className="h-[18px] w-[18px]" />
            </div>
            <div className="min-w-0 flex-1 leading-tight">
              <div className="truncate text-sm font-semibold text-foreground">{displayName}</div>
              <div className="truncate text-[11px] text-muted-foreground">{displaySub}</div>
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
                  Signed in as <span className="font-semibold text-foreground">{displayName}</span>
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
        ) : (
          // Collapsed footer: just the account menu trigger as an icon.
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                aria-label={`Account: ${displayName}`}
                title={displayName}
                className="mx-auto grid h-10 w-10 place-items-center rounded-xl border border-border bg-card text-accent-foreground shadow-card transition-colors hover:bg-sidebar-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Landmark className="h-[18px] w-[18px]" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" side="right" className="w-52">
              <DropdownMenuLabel className="text-[12px] text-muted-foreground">
                Signed in as <span className="font-semibold text-foreground">{displayName}</span>
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
        )}
      </div>
      </aside>
    </>
  );
}
