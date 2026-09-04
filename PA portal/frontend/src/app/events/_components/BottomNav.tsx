"use client";

import { cn } from "@/lib/utils";
import { useT } from "../_lib/i18n";
import { CalendarDays, Inbox, LayoutDashboard } from "../_lib/icons";
import type { View } from "./EventsApp";

function Item({ active, icon, label, badge, onClick }: {
  active: boolean; icon: React.ReactNode; label: string; badge?: number; onClick: () => void;
}) {
  return (
    <button onClick={onClick}
      className={cn(
        "relative flex flex-1 flex-col items-center justify-center gap-0.5 text-[0.72rem] font-bold transition-colors",
        active ? "text-[#2F6FED]" : "text-slate-400",
      )}>
      {/* Active background pill */}
      <span className={cn(
        "relative flex h-8 w-14 items-center justify-center rounded-full transition-colors [&_svg]:h-[22px] [&_svg]:w-[22px]",
        active ? "bg-[#2F6FED]/10" : "",
      )}>
        {icon}
        {!!badge && (
          <span className="absolute -right-1 -top-1.5 grid min-w-[18px] place-items-center rounded-full bg-[#B2372D] px-1 text-[10px] font-black leading-[18px] text-white">
            {badge > 99 ? "99+" : badge}
          </span>
        )}
      </span>
      <span>{label}</span>
    </button>
  );
}

export default function BottomNav({ view, reviewCount, showReviewTab, onChange }: {
  view: View;
  reviewCount: number;
  // Both event_uploader and event_reviewer see the Needs Review tab now —
  // uploaders can fix/delete their own captured rows even though only
  // reviewers can Approve. The endpoint accepts either role, so the badge
  // poll is safe for both.
  showReviewTab: boolean;
  onChange: (v: View) => void;
}) {
  const { t } = useT();

  return (
    // Normal flex-column child (was `fixed`). Sits below <main> and reserves
    // its own space in the layout, so <main>'s height math = viewport −
    // header − nav automatically. `shrink-0` so it never gets squeezed
    // when the timeline pushes for more room.
    //
    // Safe-area buffer is CAPPED at 8px. iOS reports ~34px for the home-
    // indicator strip; letting that full value bloat the nav made the icons
    // look like they were floating above a big empty white apron. 8px
    // clears the gesture area without leaving that empty band.
    <nav
      className="flex shrink-0 border-t border-slate-200 bg-white/95 backdrop-blur"
      style={{
        height: "calc(var(--nav-h) + min(env(safe-area-inset-bottom), 8px))",
        paddingBottom: "min(env(safe-area-inset-bottom), 8px)",
      }}
    >
      <Item active={view === "overview"} icon={<LayoutDashboard strokeWidth={1.75} />}
        label={t("Overview", "மேலோட்டம்")} onClick={() => onChange("overview")} />
      <Item active={view === "calendar"} icon={<CalendarDays strokeWidth={1.75} />}
        label={t("Calendar", "நாட்காட்டி")} onClick={() => onChange("calendar")} />
      {showReviewTab && (
        <Item active={view === "review"} icon={<Inbox strokeWidth={1.75} />} badge={reviewCount}
          label={t("Needs Review", "சரிபார்க்க")} onClick={() => onChange("review")} />
      )}
    </nav>
  );
}
