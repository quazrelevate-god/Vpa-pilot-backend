"use client";

// Safety net: everything that isn't a clean calendar entry — failed
// extractions, uploads still processing, and readable cards with no
// detected date. Nothing captured is ever silently lost.

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { api } from "../_lib/api";
import type { EventItem } from "../_lib/types";
import { typeMeta } from "../_lib/types";
import { useT } from "../_lib/i18n";
import { AlertTriangle, Inbox, Loader2 } from "../_lib/icons";

function statusChip(e: EventItem, t: (en: string, ta: string) => string) {
  if (e.status === "FAILED") {
    return { cls: "bg-red-50 text-red-700 border-red-200", label: t("Failed — fix manually", "தோல்வி — கைமுறையாக சரிசெய்க") };
  }
  if (e.status === "QUEUED" || e.status === "PROCESSING") {
    return { cls: "bg-amber-50 text-amber-700 border-amber-200", label: t("Extracting…", "எடுக்கப்படுகிறது…") };
  }
  return { cls: "bg-orange-50 text-orange-700 border-orange-200", label: t("No date — set one", "தேதி இல்லை — அமைக்கவும்") };
}

export default function NeedsReviewScreen({ refreshKey, onOpen }: {
  refreshKey: number;
  onOpen: (e: EventItem) => void;
}) {
  const { t } = useT();
  const [items, setItems] = useState<EventItem[] | null>(null);

  useEffect(() => {
    let live = true;
    const load = () => api.needsReview()
      .then((d) => { if (live) setItems(d.items); })
      .catch(() => {});
    load();
    const id = setInterval(load, 15_000);
    return () => { live = false; clearInterval(id); };
  }, [refreshKey]);

  if (items === null) {
    return (
      <div className="grid min-h-[40vh] place-items-center">
        <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 px-6 text-center">
        <span className="grid h-14 w-14 place-items-center rounded-full bg-[#4F8A5B]/10 text-[#4F8A5B]">
          <Inbox className="h-6 w-6" strokeWidth={1.75} />
        </span>
        <div className="text-sm font-bold text-slate-700">{t("All clear", "அனைத்தும் சரி")}</div>
        <div className="max-w-[260px] text-xs leading-relaxed text-slate-400">
          {t("Every captured invitation has a date on the calendar.", "பதிவான ஒவ்வொரு அழைப்பிதழும் நாட்காட்டியில் உள்ளது.")}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2.5 px-4 pt-4">
      <div className="text-xs font-bold uppercase tracking-wide text-slate-400">
        {t("Needs your attention", "உங்கள் கவனம் தேவை")} · <span className="font-mono tabular-nums">{items.length}</span>
      </div>
      {items.map((e) => {
        const chip = statusChip(e, t);
        const meta = typeMeta(e.event_type);
        return (
          <button key={e.id} onClick={() => onOpen(e)}
            className="flex w-full items-center gap-3 rounded-xl border border-slate-200 bg-white p-2.5 text-left shadow-sm active:bg-slate-50">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={e.image_url} alt=""
              className="h-14 w-14 shrink-0 rounded-lg border border-slate-100 object-cover" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-bold text-slate-900">{e.display_title}</div>
              {e.venue && <div className="truncate text-xs text-slate-500">{e.venue}</div>}
              <div className="mt-1 flex items-center gap-1.5">
                <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[0.6rem] font-bold", chip.cls)}>
                  {e.status === "FAILED" && <AlertTriangle className="h-3 w-3" strokeWidth={1.75} />}
                  {(e.status === "QUEUED" || e.status === "PROCESSING") && <Loader2 className="h-3 w-3 animate-spin" />}
                  {chip.label}
                </span>
                {e.event_type && (
                  <span className="truncate text-[0.6rem] font-semibold" style={{ color: meta.color }}>
                    {t(meta.en, meta.ta)}
                  </span>
                )}
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}
