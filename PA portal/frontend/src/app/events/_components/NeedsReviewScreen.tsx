"use client";

// Safety net: everything that isn't a clean calendar entry — failed
// extractions, uploads still processing, and readable cards with no
// detected date. Nothing captured is ever silently lost.

import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { api } from "../_lib/api";
import type { EventItem } from "../_lib/types";
import { displayTitle, pickVenue, typeMeta } from "../_lib/types";
import { fmtLongDate } from "../_lib/dates";
import { useT } from "../_lib/i18n";
import { AlertTriangle, ChevronDown, Inbox, Loader2 } from "../_lib/icons";

// An event is approvable when:
//   1. Extraction (or manual save) finished cleanly (status=READY).
//   2. Date AND both times are set — nothing a Minister could have "said yes
//      to" is missing.
//   3. Not already approved (idempotent — hide the button once done).
//   4. Event date is today or later. Attendance is forward-looking; past
//      events cannot be approved and the button is hidden to match the
//      server rule (POST /approve 409s on a past row).
function isApprovable(e: EventItem): boolean {
  if (e.status !== "READY") return false;
  // end_time is optional — many invitations only announce a start ("6 PM
  // at SRM Mahal"). Mirrors the backend approve_event guard.
  if (!e.date || !e.start_time) return false;
  if (e.is_approved) return false;
  // Compare as YYYY-MM-DD strings — no TZ math needed since e.date is IST
  // wall-clock and toISODate uses local (IST) date too.
  const today = new Date();
  const todayISO = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  return e.date >= todayISO;
}

function statusChip(e: EventItem, t: (en: string, ta: string) => string) {
  if (e.status === "FAILED") {
    return { cls: "bg-red-50 text-red-700 border-red-200", label: t("Failed — fix manually", "தோல்வி — கைமுறையாக சரிசெய்க") };
  }
  if (e.status === "QUEUED" || e.status === "PROCESSING") {
    return { cls: "bg-amber-50 text-amber-700 border-amber-200", label: t("Extracting…", "எடுக்கப்படுகிறது…") };
  }
  // Data-hole chips come BEFORE the approval chips so a missing-time
  // legacy row doesn't get labelled "Awaiting approval" when the real
  // issue is a data fix. Order matters: date → times → past → default.
  if (!e.date) {
    return { cls: "bg-orange-50 text-orange-700 border-orange-200", label: t("No date — set one", "தேதி இல்லை — அமைக்கவும்") };
  }
  if (!e.start_time) {
    return { cls: "bg-orange-50 text-orange-700 border-orange-200", label: t("No start time — set one", "தொடக்க நேரம் இல்லை — அமைக்கவும்") };
  }
  // READY + fully-formed. If it's already approved (only possible on a
  // legacy backfilled row still in the queue for another reason, or a
  // rare race), show that truthfully — "Attended" — so the popup badge
  // and the list chip match.
  if (e.is_approved) {
    return { cls: "bg-emerald-50 text-emerald-700 border-emerald-200", label: t("Attended", "வருகை பதிந்தது") };
  }
  // Past + unapproved. The server now surfaces these (they used to be hidden,
  // which silently swallowed a retry that re-extracted to a past date). A
  // past event can't be approved as-is, so tell the reviewer to fix the date.
  const today = new Date();
  const todayISO = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  if (e.date && e.date < todayISO) {
    return { cls: "bg-slate-100 text-slate-600 border-slate-200", label: t("Past — edit the date to approve", "கடந்தது — தேதியை மாற்றி அனுமதிக்கவும்") };
  }
  // Remaining case: unapproved AND today or later.
  return { cls: "bg-blue-50 text-blue-700 border-blue-200", label: t("Awaiting confirmation", "உறுதிசெய்ய காத்திருக்கிறது") };
}

export default function NeedsReviewScreen({ refreshKey, onOpen, canApprove }: {
  refreshKey: number;
  onOpen: (e: EventItem) => void;
  // Uploader-only accounts see the queue and can edit/delete/retry, but the
  // Approve pill is hidden — approving requires event_reviewer (also enforced
  // server-side in POST /approve).
  canApprove: boolean;
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

  // Bucket by date so the list reads as a chronology, not a jumbled queue.
  // Undated rows (no event_date yet — either OCR gap or manual save with a
  // dropped date) get a "No date" section pinned at the top; those are the
  // most urgent to fix because the reviewer can't approve them.
  // Dated rows are ordered DESCENDING — latest date first.
  //
  // MUST live above the loading / empty early returns — hooks-rules-of-order.
  // React counts hook calls positionally per render; if items goes from null
  // to a loaded array the pre-fix version added a 3rd hook mid-lifecycle and
  // threw error #310 "Rendered more hooks than during the previous render".
  const sections = useMemo(() => {
    if (!items) return [];
    const map = new Map<string, EventItem[]>();  // key = date string OR "" for undated
    for (const e of items) {
      const key = e.date || "";
      const arr = map.get(key) ?? [];
      arr.push(e);
      map.set(key, arr);
    }
    const dated = [...map.entries()].filter(([k]) => k).sort(([a], [b]) => b.localeCompare(a));
    const undated = map.get("") ?? [];
    const out: { key: string; date: string | null; rows: EventItem[] }[] = [];
    if (undated.length) out.push({ key: "__no_date__", date: null, rows: undated });
    for (const [k, rows] of dated) out.push({ key: k, date: k, rows });
    return out;
  }, [items]);

  // Per-date collapse. Past-date sections with no approvable rows collapse
  // by default — the reviewer can't act on them here, so they're pure noise
  // above the actionable dates. Everything else stays expanded on first
  // sight, and every section respects a manual toggle afterwards.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggleSection = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  // Seed defaults once per section key. Tracked in a ref so a user
  // expand-then-collapse cycle isn't re-collapsed the next time sections
  // recompute (poll refetch, mutation, etc.).
  const seededRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const today = new Date();
    const todayISO = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    const toCollapse: string[] = [];
    for (const s of sections) {
      if (seededRef.current.has(s.key)) continue;
      seededRef.current.add(s.key);
      // Past-dated section AND nothing on it is approvable → default collapsed.
      // Undated ("No date") sections stay expanded — those need the reviewer's
      // eye first (data hole to fix).
      if (s.date && s.date < todayISO && !s.rows.some(isApprovable)) {
        toCollapse.push(s.key);
      }
    }
    if (toCollapse.length) {
      setCollapsed((prev) => {
        const next = new Set(prev);
        for (const k of toCollapse) next.add(k);
        return next;
      });
    }
  }, [sections]);
  // Prune collapse-keys AND seeded-keys for date sections that no longer
  // exist. Without the seeded prune, a date that reappears (deleted then
  // re-created for the same day) would silently skip its collapse-default
  // pass. Without the collapsed prune, a stale collapsed key would sit
  // around and re-collapse a section that returns for other reasons.
  useEffect(() => {
    const valid = new Set(sections.map((s) => s.key));
    // Prune seeded ref in place — refs don't trigger re-render, safe here.
    for (const k of Array.from(seededRef.current)) {
      if (!valid.has(k)) seededRef.current.delete(k);
    }
    setCollapsed((prev) => {
      if (prev.size === 0) return prev;
      let changed = false;
      const next = new Set<string>();
      for (const k of prev) { if (valid.has(k)) next.add(k); else changed = true; }
      return changed ? next : prev;
    });
  }, [sections]);

  if (items === null) {
    return (
      <div className="grid h-full place-items-center">
        <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
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
    // `h-full overflow-y-auto` — the review list scrolls INSIDE the shell.
    // Header + nav stay pinned; only the list of date-grouped rows moves.
    <div
      className="h-full overflow-y-auto overscroll-none pb-4"
      style={{
        paddingLeft:  "clamp(0.75rem, 3.5vw, 1rem)",
        paddingRight: "clamp(0.75rem, 3.5vw, 1rem)",
        paddingTop:   "clamp(0.75rem, 3.5vw, 1rem)",
        display: "flex",
        flexDirection: "column",
        gap: "clamp(0.9rem, 3.5vw, 1.25rem)",
      }}
    >
      <div className="text-[0.72rem] font-bold uppercase tracking-wider text-slate-400">
        {t("Needs your attention", "உங்கள் கவனம் தேவை")}
        <span className="ml-1.5 inline-block rounded-full bg-slate-200 px-2 py-0.5 font-mono text-slate-600 tabular-nums">
          {items.length}
        </span>
      </div>

      {sections.map((section) => {
        const isCollapsed = collapsed.has(section.key);
        return (
        <section key={section.key} className="flex flex-col gap-2">
          {/* Date header — tap to collapse/expand this date's rows. Undated
              rows get a highlighted "No date" chip so the reviewer's eye
              lands there first (most actionable data hole). */}
          <button
            type="button"
            onClick={() => toggleSection(section.key)}
            aria-expanded={!isCollapsed}
            className="flex w-full items-center gap-3 rounded-lg py-1 text-left transition-colors hover:bg-slate-50 active:bg-slate-100"
          >
            <ChevronDown
              className={cn(
                "h-4 w-4 shrink-0 text-slate-400 transition-transform duration-200",
                isCollapsed && "-rotate-90",
              )}
              strokeWidth={2}
            />
            <div
              className={cn(
                "text-[0.72rem] font-bold uppercase tracking-wider",
                section.date ? "text-slate-500" : "text-[#CC6A1F]",
              )}
            >
              {section.date
                ? fmtLongDate(section.date, lang)
                : t("No date — set one", "தேதி இல்லை — அமைக்கவும்")}
            </div>
            <div className="h-px flex-1 bg-slate-200" />
            <span className="rounded-full bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] font-bold tabular-nums text-slate-500">
              {section.rows.length}
            </span>
          </button>

          {!isCollapsed && (
          <div className="flex flex-col gap-2">
            {section.rows.map((e) => (
              <NeedsReviewRow
                key={e.id}
                e={e}
                lang={lang}
                t={t}
                busy={approving.has(e.id)}
                canApprove={canApprove}
                onOpen={onOpen}
                onApprove={onApprove}
              />
            ))}
          </div>
          )}
        </section>
        );
      })}
    </div>
  );
}

// Row extracted so the section-grouped render above stays readable. Behavior
// unchanged from the previous flat list — same chip, same Approve button
// gating, same open-on-tap semantics.
function NeedsReviewRow({
  e, lang, t, busy, canApprove, onOpen, onApprove,
}: {
  e: EventItem;
  lang: "en" | "ta";
  t: (en: string, ta: string) => string;
  busy: boolean;
  // Role gate — uploaders don't get the Approve pill, only reviewers do.
  canApprove: boolean;
  onOpen: (e: EventItem) => void;
  onApprove: (e: EventItem) => void;
}) {
  const chip = statusChip(e, t);
  const meta = typeMeta(e.event_type);
  // Row-level pill also requires the row itself to be in an approvable state
  // (READY + has date/time + not past + not already approved).
  const showApproveButton = canApprove && isApprovable(e);
  return (
    // Row-as-div (not button) because we have a nested Approve button and
    // nested <button> is invalid HTML.
    <div
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
      {showApproveButton ? (
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
}
