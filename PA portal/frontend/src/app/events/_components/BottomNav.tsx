"use client";

import { cn } from "@/lib/utils";
import { useT } from "../_lib/i18n";
import { CalendarDays, Camera, Inbox } from "../_lib/icons";
import type { View } from "./EventsApp";

function Item({ active, icon, label, badge, onClick }: {
  active: boolean; icon: React.ReactNode; label: string; badge?: number; onClick: () => void;
}) {
  return (
    <button onClick={onClick}
      className={cn("relative flex flex-1 flex-col items-center justify-center gap-1 text-[0.62rem] font-bold transition-colors",
        active ? "text-[#2F6FED]" : "text-slate-400")}>
      <span className="relative [&_svg]:h-[21px] [&_svg]:w-[21px]">
        {icon}
        {!!badge && (
          <span className="absolute -right-2.5 -top-1.5 grid min-w-[16px] place-items-center rounded-full bg-[#B2372D] px-1 text-[9px] font-black leading-4 text-white">
            {badge > 99 ? "99+" : badge}
          </span>
        )}
      </span>
      <span>{label}</span>
    </button>
  );
}

export default function BottomNav({ view, reviewCount, onChange }: {
  view: View;
  reviewCount: number;
  onChange: (v: View) => void;
}) {
  const { t } = useT();

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 mx-auto flex h-[calc(var(--nav-h)+env(safe-area-inset-bottom))] max-w-[560px] border-t border-slate-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
      <Item active={view === "calendar"} icon={<CalendarDays strokeWidth={1.75} />}
        label={t("Calendar", "நாட்காட்டி")} onClick={() => onChange("calendar")} />
      <Item active={view === "capture"} icon={<Camera strokeWidth={1.75} />}
        label={t("Capture", "படம்")} onClick={() => onChange("capture")} />
      <Item active={view === "review"} icon={<Inbox strokeWidth={1.75} />} badge={reviewCount}
        label={t("Needs Review", "சரிபார்க்க")} onClick={() => onChange("review")} />
    </nav>
  );
}
