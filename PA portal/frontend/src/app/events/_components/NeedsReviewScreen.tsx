"use client";

// Safety net: everything that isn't a clean calendar entry — failed
// extractions, uploads still processing, and readable cards with no
// detected date. Nothing captured is ever silently lost.

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { api } from "../_lib/api";
import type { EventItem } from "../_lib/types";
import { displayTitle, pickVenue, typeMeta } from "../_lib/types";
import { useT } from "../_lib/i18n";
import { AlertTriangle, Inbox, Loader2 } from "../_lib/icons";

// An event is approvable when extraction (or manual save) finished cleanly
// AND a date was set — those are the two things a Minister could actually
// have said "yes" to. The Approve button is hidden otherwise so a reviewer
// isn't tempted to bless a broken/undated row and then find it on the calendar.
function isApprovable(e: EventItem): boolean {
  return e.status === "READY" && !!e.date && !e.is_approved;
}

function statusChip(e: EventItem, t: (en: string, ta: string) => string) {
  if (e.status === "FAILED") {
    return { cls: "bg-red-50 text-red-700 border-red-200", label: t("Failed — fix manually", "தோல்வி — கைமுறையாக சரிசெய்க") };
  }
  if (e.status === "QUEUED" || e.status === "PROCESSING") {
    return { cls: "bg-amber-50 text-amber-700 border-amber-200", label: t("Extracting…", "எடுக்கப்படுகிறது…") };
  }
  if (!e.date) {
    return { cls: "bg-orange-50 text-orange-700 border-orange-200", label: t("No date — set one", "தேதி இல்லை — அமைக்கவும்") };
  }
  // READY + dated but not yet approved — waiting for Minister confirmation.
  return { cls: "bg-blue-50 text-blue-700 border-blue-200", label: t("Awaiting approval", "அனுமதிக்கு காத்திருக்கிறது") };
}

export default function NeedsReviewScreen({ refreshKey, onOpen }: {
  refreshKey: number;
  onOpen: (e: EventItem) => void;
}) {
  const { t, lang } = useT();
  const [items, setItems] = useState<EventItem[] | null>(null);
  // Per-row in-flight guard so a double-tap on Approve doesn't fire two
  // POSTs (idempotent server-side, but the second would race and confuse
  // the optimistic list update).
  const [approving, setApproving] = useState<Set<number>>(new Set());

  useEffect(() => {
    let live = true;
    const load = () => api.needsReview()
      .then((d) => { if (live) setItems(d.items); })
      .catch(() => {});
    load();
    const id = setInterval(load, 15_000);
    return () => { live = false; clearInterval(id); };
  }, [refreshKey]);

  async function onApprove(e: EventItem) {
    if (approving.has(e.id)) return;
    setApproving((s) => new Set(s).add(e.id));
    try {
      await api.approve(e.id);
      // Optimistic: the row leaves the needs-review list the moment it's
      // approved (server-filter now excludes is_approved=True rows unless
      // they're still status!=READY or undated, neither of which applies).
      setItems((prev) => (prev ? prev.filter((x) => x.id !== e.id) : prev));
      toast.success(t("Approved — now on the calendar", "அனுமதிக்கப்பட்டது — நாட்காட்டியில் காட்டப்படுகிறது"));
    } catch (err) {
      toast.error(t("Approve failed", "அனுமதி தோல்வி"), { description: (err as Error).message });
    } finally {
      setApproving((s) => { const n = new Set(s); n.delete(e.id); return n; });
    }
  }

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
        <div className="text-base font-bold text-slate-700">{t("All clear", "அனைத்தும் சரி")}</div>
        <div className="max-w-[260px] text-sm leading-relaxed text-slate-400">
          {t("Every captured invitation has a date on the calendar.", "பதிவான ஒவ்வொரு அழைப்பிதழும் நாட்காட்டியில் உள்ளது.")}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2 px-4 pt-4 pb-4">
      <div className="mb-3 text-[0.72rem] font-bold uppercase tracking-wider text-slate-400">
        {t("Needs your attention", "உங்கள் கவனம் தேவை")}
        <span className="ml-1.5 inline-block rounded-full bg-slate-200 px-2 py-0.5 font-mono text-slate-600 tabular-nums">
          {items.length}
        </span>
      </div>
      {items.map((e) => {
        const chip = statusChip(e, t);
        const meta = typeMeta(e.event_type);
        const canApprove = isApprovable(e);
        const busy = approving.has(e.id);
        return (
          // Row-as-div (not button) because we now have a nested Approve
          // button — nested <button> is invalid HTML and browsers complain.
          <div
            key={e.id}
            role="button" tabIndex={0}
            onClick={() => onOpen(e)}
            onKeyDown={(k) => { if (k.key === "Enter" || k.key === " ") onOpen(e); }}
            className="flex w-full cursor-pointer items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3 text-left shadow-sm transition-shadow hover:shadow-md active:bg-slate-50"
          >
            {/* Thumbnail — hidden for manual events with no photo */}
            {e.image_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={e.image_url} alt=""
                className="h-14 w-14 shrink-0 rounded-xl border border-slate-100 object-cover" />
            ) : (
              <span className="grid h-14 w-14 shrink-0 place-items-center rounded-xl border border-slate-100 bg-slate-50 text-slate-300">
                <svg className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3h10.5M4.5 6.75h15M3 10.5h18M4.5 14.25h15M6.75 18h10.5M9 21.75h6" />
                </svg>
              </span>
            )}
            <div className="min-w-0 flex-1">
              <div className="truncate text-[0.9rem] font-bold text-slate-900">{displayTitle(e, lang)}</div>
              {pickVenue(e, lang) && <div className="truncate text-xs text-slate-500 mt-0.5">{pickVenue(e, lang)}</div>}
              <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
                <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[0.72rem] font-bold", chip.cls)}>
                  {e.status === "FAILED" && <AlertTriangle className="h-3 w-3" strokeWidth={2} />}
                  {(e.status === "QUEUED" || e.status === "PROCESSING") && <Loader2 className="h-3 w-3 animate-spin" />}
                  {chip.label}
                </span>
                {e.event_type && (
                  <span className="text-[0.72rem] font-semibold" style={{ color: meta.color }}>
                    {t(meta.en, meta.ta)}
                  </span>
                )}
              </div>
            </div>
            {canApprove ? (
              // Approve is the primary reviewer action — surface it inline so
              // the common case is one tap. Open-detail is still available by
              // tapping anywhere else on the row.
              <button
                type="button"
                disabled={busy}
                onClick={(k) => { k.stopPropagation(); onApprove(e); }}
                className={cn(
                  "shrink-0 rounded-full px-3 py-1.5 text-[0.78rem] font-bold text-white shadow-sm transition-colors",
                  busy ? "bg-slate-300" : "bg-[#2F6FED] hover:bg-[#2456bd]",
                )}
              >
                {busy
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  : t("Approve", "அனுமதி")}
              </button>
            ) : (
              <svg className="h-4 w-4 shrink-0 text-slate-300" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
              </svg>
            )}
          </div>
        );
      })}
    </div>
  );
}
