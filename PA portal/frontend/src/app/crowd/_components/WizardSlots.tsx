"use client";

import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { useT } from "../_lib/i18n";
import { Minus, Plus, Check } from "../_lib/icons";
import type { OpenDate, Slot } from "../_lib/types";

export default function WizardSlots({
  dates, date, slots, slot, persons, onPickDate, onPickSlot, onPersons,
}: {
  dates: OpenDate[] | null;
  date: string | null;
  slots: Slot[] | null;
  slot: number | null;
  persons: number;
  onPickDate: (d: string) => void;
  onPickSlot: (id: number) => void;
  onPersons: (n: number) => void;
}) {
  const { t } = useT();
  const dateLabel = date ? new Date(date + "T00:00:00").toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short", year: "numeric" }) : "";

  return (
    <div>
      <div className="mb-1.5 text-[0.8rem] font-bold text-slate-700">
        {t("Select a date", "தேதி தேர்வு")} <span className="font-medium text-slate-400">({t("optional", "விருப்பம்")})</span>
      </div>

      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1.5">
        {!dates ? (
          <Skeleton className="h-[76px] w-[68px] shrink-0 rounded-xl" />
        ) : dates.length === 0 ? (
          <div className="text-sm text-slate-500">{t("No open dates for meetings.", "சந்திப்புக்கு தேதி இல்லை.")}</div>
        ) : (
          dates.map((d) => {
            const dt = new Date(d.date + "T00:00:00");
            const on = date === d.date;
            return (
              <button key={d.date} onClick={() => onPickDate(d.date)}
                className={cn("min-w-[68px] shrink-0 rounded-xl border p-2 text-center transition-colors",
                  on ? "border-blue-600 bg-blue-600 text-white" : "border-slate-200 bg-white")}>
                <div className={cn("text-[0.66rem] font-bold uppercase", on ? "text-white/85" : "text-slate-500")}>{dt.toLocaleDateString("en-US", { weekday: "short" })}</div>
                <div className="text-[1.1rem] font-black leading-tight">{dt.getDate()}</div>
                <div className={cn("text-[0.62rem] font-bold", on ? "text-white/85" : "text-slate-400")}>{dt.toLocaleDateString("en-US", { month: "short" })}</div>
                {d.open != null && <div className={cn("mt-0.5 text-[0.6rem] font-bold", on ? "text-white" : "text-emerald-600")}>{d.open} {t("slots", "இடம்")}</div>}
              </button>
            );
          })
        )}
      </div>

      {!date ? (
        <div className="px-0.5 py-1.5 text-sm text-slate-500">{t("Pick a date to see time slots.", "நேரங்களை பார்க்க தேதி தேர்வு செய்யவும்.")}</div>
      ) : !slots ? (
        <Skeleton className="mt-4 h-32 rounded-xl" />
      ) : (
        <SlotGrid slots={slots} dateLabel={dateLabel} slot={slot} persons={persons} onPickSlot={onPickSlot} onPersons={onPersons} />
      )}
    </div>
  );
}

function SlotGrid({
  slots, dateLabel, slot, persons, onPickSlot, onPersons,
}: {
  slots: Slot[];
  dateLabel: string;
  slot: number | null;
  persons: number;
  onPickSlot: (id: number) => void;
  onPersons: (n: number) => void;
}) {
  const { t } = useT();
  const openCount = slots.filter((s) => s.available && s.remaining > 0).length;

  return (
    <>
      <div className="mt-4 mb-2 flex items-baseline justify-between gap-2">
        <div className="text-[0.92rem] font-bold text-slate-900">{t("Slots for", "நேரங்கள்")} {dateLabel}</div>
        <span className="inline-flex items-center gap-1 whitespace-nowrap text-[0.66rem] font-bold uppercase tracking-wide text-emerald-600">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />{t("Live", "நேரலை")}
        </span>
      </div>

      <div className={cn("mb-2 text-[0.8rem] font-bold", openCount > 0 ? "text-emerald-600" : "text-amber-600")}>
        {openCount > 0 ? `${openCount} ${t("slots open", "நேரங்கள் உள்ளன")}` : `⚠ ${t("No slots available for this day", "இந்த நாளில் இடம் இல்லை")}`}
      </div>

      <div className="grid grid-cols-2 gap-2.5">
        {slots.map((s) => {
          const ok = s.available && s.remaining > 0;
          const sel = slot === s.id;
          const blocked = s.status === "BLOCKED";
          return (
            <button key={s.id} type="button" disabled={!ok && !sel} onClick={() => (ok || sel) && onPickSlot(s.id)}
              className={cn("relative rounded-xl border p-2.5 text-left transition-colors",
                sel ? "border-blue-600 bg-blue-50"
                  : ok ? "border-slate-200 bg-white active:scale-[0.98]"
                    : "cursor-not-allowed border-slate-200 bg-slate-50 opacity-70")}>
              {sel && <span className="absolute right-2 top-2 grid h-4 w-4 place-items-center rounded-full bg-blue-600 text-white"><Check className="h-2.5 w-2.5" /></span>}
              <div className={cn("text-[0.84rem] font-bold", ok || sel ? "text-slate-900" : "text-slate-400")}>{s.label}</div>
              <div className={cn("mt-0.5 text-[0.7rem] font-bold",
                ok ? "text-emerald-600" : "uppercase text-slate-400")}>
                {ok ? `${s.remaining}/${s.max_capacity} ${t("seats", "இடம்")}` : blocked ? t("Blocked", "மூடியது") : t("Full", "நிரம்பியது")}
              </div>
            </button>
          );
        })}
      </div>

      {slot && (
        <div className="mt-3.5 flex items-center justify-between rounded-xl border border-slate-200 p-3.5">
          <div>
            <div className="text-[0.88rem] font-bold text-slate-900">{t("Number of persons", "நபர்கள் எண்ணிக்கை")}</div>
            <div className="text-[0.68rem] font-semibold text-slate-500">{t("Max 4", "அதிகபட்சம் 4")}</div>
          </div>
          <div className="flex items-center gap-3.5">
            <button type="button" disabled={persons <= 1} onClick={() => onPersons(Math.max(1, persons - 1))}
              className="grid h-9 w-9 place-items-center rounded-lg border border-slate-200 text-blue-600 disabled:opacity-40"><Minus className="h-4 w-4" /></button>
            <span className="min-w-5 text-center text-lg font-black">{persons}</span>
            <button type="button" disabled={persons >= 4} onClick={() => onPersons(Math.min(4, persons + 1))}
              className="grid h-9 w-9 place-items-center rounded-lg border border-slate-200 text-blue-600 disabled:opacity-40"><Plus className="h-4 w-4" /></button>
          </div>
        </div>
      )}
    </>
  );
}
