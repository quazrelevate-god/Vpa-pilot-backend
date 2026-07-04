"use client";

import { cn } from "@/lib/utils";
import { useT } from "../_lib/i18n";
import { Calendar, CalendarCheck } from "../_lib/icons";
import type { Availability } from "../_lib/types";

// Live "today's slot availability" hero. Green when seats are open, amber when
// none / offline — the floor team's at-a-glance "can I still seat someone?".
export default function AvailabilityCard({ avail }: { avail: Availability }) {
  const { t } = useT();
  const open = avail.open && !avail.offline;

  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200/70 bg-white p-4 shadow-sm">
      <div>
        <div className="text-sm font-bold text-slate-900">{t("Today's Slot Availability", "இன்றைய இட நிலை")}</div>
        <div className={cn("mt-1 inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide",
          avail.offline ? "text-amber-600" : "text-emerald-600")}>
          <span className={cn("h-1.5 w-1.5 rounded-full bg-current", !avail.offline && "animate-pulse")} />
          {avail.offline ? t("Offline", "இணைப்பு இல்லை") : t("Live", "நேரலை")}
          {avail.updated && <span className="font-semibold normal-case text-slate-400">· {t("Updated", "புதுப்பிப்பு")} {avail.updated}</span>}
        </div>

        <div className="mt-2 flex items-baseline gap-1.5">
          <span className={cn("text-[2rem] font-black leading-none tracking-tight", open ? "text-emerald-600" : "text-amber-600")}>
            {avail.offline ? "—" : avail.seats}
          </span>
          <span className={cn("text-base font-bold", open ? "text-emerald-600" : "text-amber-600")}>
            {t("Seats Open", "இடங்கள்")}
          </span>
        </div>
        <div className="mt-0.5 text-sm font-semibold text-slate-500">
          {avail.offline
            ? t("Reconnecting…", "மீண்டும் இணைக்கிறது…")
            : open
              ? t(`${avail.slots} Slots Available`, `${avail.slots} இடங்கள் உள்ளன`)
              : t("No slots today", "இன்று இடம் இல்லை")}
        </div>
      </div>

      <div className={cn("grid h-16 w-16 shrink-0 place-items-center rounded-2xl",
        open ? "bg-emerald-50 text-emerald-600" : "bg-amber-50 text-amber-600")}>
        {open ? <CalendarCheck className="h-7 w-7" /> : <Calendar className="h-7 w-7" />}
      </div>
    </div>
  );
}
