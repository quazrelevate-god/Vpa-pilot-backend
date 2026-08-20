"use client";
/**
 * Shared association-detail drawer (+ helpers).
 *
 * Same 2-pane drawer the Association Review page uses. Extracted here so
 * the Association Dashboard can render the exact same detail view WITHOUT
 * a route redirect — it just imports <AssociationDrawer readOnly /> and
 * skips the sticky decision bar at the bottom.
 *
 * Display maps + formatters + section helpers are also exported so both
 * the review page (list card colours) and the dashboard (table pills) can
 * stay visually consistent without redefining the same tables of hex.
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Check, Send, Building2, UserRound, Users, MapPin, CalendarClock,
  Loader2, Sparkles, AlertTriangle, Landmark, Target, Flag,
  ShieldAlert as RiskIcon, ScrollText, FolderOpen, X, Download,
  Search as SearchIcon, Pencil, RefreshCcw,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { SheetClose, SheetTitle } from "@/components/ui/sheet";
import { InlineAttachmentPreview } from "@/components/ui/inline-attachment-preview";
import { DrawerNav } from "@/components/ui/drawer-nav";
import type { GalleryAttachment } from "@/components/ui/attachment-gallery";
import { useLang } from "@/lib/lang-context";
import { cn } from "@/lib/utils";
import {
  findSimilarAssociations,
  type AssociationDetail, type AssociationBrief, type AssociationDoc,
  type AssociationDecision, type SimilarAssociationCandidate,
} from "./associationApi";

// ── display maps (kept here so review-page list cards + dashboard-page
//    table pills can import + stay visually consistent) ────────────────────
export const STATUS_META: Record<string, { label: string; cls: string }> = {
  AWAITING_REVIEW: { label: "Awaiting review", cls: "bg-amber-100 text-amber-800" },
  REVIEWED:        { label: "Reviewed",        cls: "bg-emerald-100 text-emerald-700" },
  FORWARDED:       { label: "Forwarded",       cls: "bg-sky-100 text-sky-700" },
};

export const REC_META: Record<string, { label: string; cls: string; dot: string }> = {
  engage_now:      { label: "Engage now",      cls: "border-red-300 bg-red-50 text-red-700",           dot: "bg-red-500"     },
  routine:         { label: "Routine",         cls: "border-emerald-300 bg-emerald-50 text-emerald-700", dot: "bg-emerald-500" },
  refer:           { label: "Refer",           cls: "border-sky-300 bg-sky-50 text-sky-700",           dot: "bg-sky-500"     },
  needs_more_info: { label: "Needs more info", cls: "border-amber-300 bg-amber-50 text-amber-700",     dot: "bg-amber-500"   },
};

export const URGENCY_META: Record<string, { label: string; cls: string }> = {
  critical: { label: "Critical", cls: "border-red-300 bg-red-50 text-red-700" },
  high:     { label: "High",     cls: "border-orange-300 bg-orange-50 text-orange-700" },
  medium:   { label: "Medium",   cls: "border-amber-300 bg-amber-50 text-amber-700" },
  low:      { label: "Low",      cls: "border-slate-300 bg-slate-50 text-slate-600" },
};

// ── formatters ────────────────────────────────────────────────────────────
export function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }); }
  catch { return "—"; }
}
export function daysSince(iso: string | null): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((Date.now() - t) / 86_400_000));
}
export function titleCase(s?: string | number | null): string {
  if (s == null || s === "") return "";
  // Coerce first: some fields (e.g. member_count) arrive as numbers at runtime
  // despite the string type, and .replace() on a number would crash the drawer.
  return String(s).replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
/** A field the AI leaves as "Not specified" / "Unknown" is not a real value. */
export function specified(v?: string | number | null): boolean {
  const s = (v == null ? "" : String(v)).trim();
  return !!s && s.toLowerCase() !== "not specified" && s.toLowerCase() !== "unknown";
}
export function toAttachments(docs: AssociationDoc[] | undefined): GalleryAttachment[] {
  return (docs || [])
    .filter((d) => !!d.url)
    .map((d) => ({
      name: d.filename || "document",
      url: d.url as string,
      type: (d.mime || "").startsWith("image/") ? "IMAGE" : "DOCUMENT",
      mime: d.mime || undefined,
    }));
}

// ── section building blocks ───────────────────────────────────────────────
export function Tile({ icon, label, value, mono = false, muted = false }: {
  icon?: ReactNode; label: string; value?: string | number | null; mono?: boolean; muted?: boolean;
}) {
  if (!specified(value) && !muted) return null;
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-lg border border-border bg-background/60 px-4 py-3">
      <div className="flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
        {icon}{label}
      </div>
      <div className={cn(
        "text-[14px] font-semibold leading-snug",
        mono && "num",
        muted ? "italic text-muted-foreground" : "text-foreground",
      )}>
        {value}
      </div>
    </div>
  );
}

/** Serif reading block for narrative fields — hides on empty unless `muted`
 *  is set, in which case it renders the fallback text in muted italic (used
 *  for load-bearing fields like the collective ask, which should always show
 *  the fact of "not stated" rather than disappearing from the drawer).
 */
export function Reading({ label, text, muted = false }: { label: string; text: string; muted?: boolean }) {
  if (!specified(text) && !muted) return null;
  return (
    <div className="rounded-lg border border-border bg-background/60 p-4">
      <div className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{label}</div>
      <p className={cn(
        "font-serif text-[15px] leading-[1.75]",
        muted ? "italic text-muted-foreground" : "text-foreground/90",
      )}>
        {text}
      </p>
    </div>
  );
}

/** Numbered section shell. `hidden` suppresses the whole section when empty. */
export function SectionShell({
  n, id, title, right, hidden, children,
}: { n: number; id: string; title: string; right?: ReactNode; hidden?: boolean; children: ReactNode }) {
  if (hidden) return null;
  return (
    <section id={id} className="scroll-mt-24 rounded-xl border border-border bg-background/40 p-4 sm:p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="num grid h-7 w-7 place-items-center rounded-full bg-brand/10 text-[13px] font-bold text-brand">{n}</span>
          <h3 className="font-serif text-[17px] font-semibold text-foreground">{title}</h3>
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}

// ── the drawer itself ─────────────────────────────────────────────────────
export interface AssociationDrawerProps {
  d: AssociationDetail;
  onClose: () => void;
  /** Read-only mode = hide the sticky decision bar. Used on the dashboard
   *  where a Minister just wants to LOOK at the extraction, not decide.
   *  When false, `note`/`setNote`/`deciding`/`onDecide` are required. */
  readOnly?: boolean;
  note?: string;
  setNote?: (v: string) => void;
  deciding?: boolean;
  onDecide?: (dec: AssociationDecision) => void;
  /** Save-only update to `decision_note` on an already-decided row. Distinct
   *  from onDecide because it doesn't re-run the ticket mint or re-stamp
   *  reviewed_by — pure note edit. */
  onNoteSave?: (note: string) => Promise<void> | void;
  /** Prev/next drawer navigation (wired by the list page via useDrawerNav). */
  onPrev?: () => void;
  onNext?: () => void;
  hasPrev?: boolean;
  hasNext?: boolean;
  navLoading?: boolean;
}

export function AssociationDrawer({
  d, onClose, readOnly = false,
  note = "", setNote,
  deciding = false, onDecide,
  onNoteSave,
  onPrev, onNext, hasPrev, hasNext, navLoading,
}: AssociationDrawerProps) {
  const { lang } = useLang();
  const ta = lang === "ta";
  // Defensive: the extraction JSON is typed as strings but at runtime AI
  // sometimes returns an array or object (partial extraction, prompt drift).
  // Coerce non-strings to "" so a bad field can't crash the whole drawer
  // with "trim is not a function".
  const L = useCallback((en?: unknown, taStr?: unknown) => {
    const enS   = typeof en === "string" ? en : "";
    const taStrS = typeof taStr === "string" ? taStr : "";
    if (ta && taStrS.trim()) return taStrS;
    return (enS || taStrS || "").trim();
  }, [ta]);

  const ex: AssociationBrief = d.extraction || {};
  const rec = ex.ai_recommendation ? REC_META[ex.ai_recommendation] : null;
  const st = STATUS_META[d.status] || { label: d.status, cls: "bg-slate-100 text-slate-600" };
  const urg = typeof d.urgency === "string" && d.urgency ? URGENCY_META[d.urgency.toLowerCase()] : null;
  const decided = ["REVIEWED", "FORWARDED"].includes(d.status);
  const days = daysSince(d.created_at);

  // Sticky decision bar: once decided, hide the action buttons behind a
  // "Change decision" toggle so a stray click can't re-run the ticket mint
  // + re-stamp reviewed_by / reviewed_at (the endpoint also 409s the
  // same-status no-op now, but the UI shouldn't offer it in the first
  // place). Separate `editingNote` mode reveals only a textarea + Save so
  // the reviewer can amend the note without touching status. Both
  // auto-reset when the drawer switches rows or the row's status changes.
  const [changingDecision, setChangingDecision] = useState(false);
  const [editingNote, setEditingNote] = useState(false);
  useEffect(() => {
    setChangingDecision(false);
    setEditingNote(false);
  }, [d.id, d.status]);

  const ask       = L(ex.association_ask,   ex.association_ask_ta);
  const summary   = L(ex.summary,           ex.summary_ta);
  const demand    = L(ex.demand_context,    ex.demand_context_ta);
  const outcome   = L(ex.expected_outcome,  ex.expected_outcome_ta);
  const precedent = L(ex.precedent_context, ex.precedent_context_ta);
  const rationale = L(ex.ai_rationale,      ex.ai_rationale_ta);

  // Defensive: extraction arrays occasionally arrive as strings/objects when
  // the AI's response drifts from the schema. Fall back to [] so .map() on
  // them can't crash the drawer.
  const asArr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x) => typeof x === "string") : []);
  const keyDetails   = ta && asArr(ex.key_details_ta).length     ? asArr(ex.key_details_ta)     : asArr(ex.key_details);
  const stakeholders = ta && asArr(ex.key_stakeholders_ta).length ? asArr(ex.key_stakeholders_ta) : asArr(ex.key_stakeholders);
  const risks        = ta && asArr(ex.risks_if_ignored_ta).length ? asArr(ex.risks_if_ignored_ta) : asArr(ex.risks_if_ignored);

  const docAtts = useMemo(() => toAttachments(d.documents), [d.documents]);

  // ── Layer-2 "Find similar" state, lifted up so the header pill and the
  // Duplicate Check section stay in sync (count badge on top, expanded panel
  // below). Auto-fires the scan when the drawer opens on a row that Layer 1B
  // already flagged as a suspected duplicate — the reviewer sees the count
  // immediately without scrolling or hunting for the button.
  const [simPanelOpen, setSimPanelOpen]   = useState(false);
  const [simLoading,   setSimLoading]     = useState(false);
  const [simCands,     setSimCands]       = useState<SimilarAssociationCandidate[] | null>(null);
  const [simReason,    setSimReason]      = useState<string | null>(null);
  const [simErr,       setSimErr]         = useState<string | null>(null);

  const runSimilarScan = useCallback(async () => {
    setSimLoading(true); setSimErr(null);
    try {
      const res = await findSimilarAssociations(d.id);
      setSimCands(res.candidates || []);
      setSimReason(res.reason || null);
    } catch (e) {
      setSimErr((e as Error).message);
    } finally {
      setSimLoading(false);
    }
  }, [d.id]);

  // Auto-scan on drawer open ONLY when Layer 1B pre-flagged this row.
  // Deterministic dedup already thinks it's a match — surfacing the actual
  // candidates without a click removes friction for the reviewer. Rows the
  // fingerprint didn't flag stay on-demand (avoids running the scan on every
  // drawer open for every proposal).
  useEffect(() => {
    if (d.is_duplicate && simCands === null && !simLoading) {
      runSimilarScan();
    }
  }, [d.is_duplicate, simCands, simLoading, runSimilarScan]);

  const simCount = simCands?.length ?? 0;
  const openSimilarPanel = () => {
    setSimPanelOpen(true);
    if (simCands === null && !simLoading) runSimilarScan();
    // Scroll the section into view so the reviewer sees the expanded panel.
    requestAnimationFrame(() => {
      const el = document.getElementById("similar");
      el?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Header */}
      <div className="shrink-0 border-b border-border bg-card px-5 py-4 sm:px-7 sm:py-5">
        <div className="mb-2 flex items-start justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            {d.category && (
              <Badge variant="outline" className="border-border bg-secondary text-[11px] text-secondary-foreground">
                {titleCase(d.category)}
              </Badge>
            )}
            {urg && (
              <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-semibold", urg.cls)}>
                <Flag className="h-3 w-3" />{urg.label}
              </span>
            )}
            <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", st.cls)}>{st.label}</span>
            {rec && (
              <span className={cn("inline-flex items-center gap-1 rounded-full border border-dashed px-2 py-0.5 text-[11px] font-semibold", rec.cls)} title="AI's triage hint — not the reviewer's decision">
                <Sparkles className="h-3 w-3" /> {rec.label}
              </span>
            )}
            {d.is_duplicate && (
              <button
                type="button"
                onClick={openSimilarPanel}
                className="inline-flex items-center gap-1.5 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800 transition-colors hover:bg-amber-100"
                title={
                  d.duplicate_of_name
                    ? `Fingerprint matches an earlier submission from ${d.duplicate_of_name} within the last 90 days. Click to see all matches.`
                    : "Fingerprint matches an earlier association submission within the last 90 days. Click to see all matches."
                }
              >
                <AlertTriangle className="h-3 w-3" />
                Suspected duplicate{d.duplicate_of_name ? ` of ${d.duplicate_of_name.slice(0, 30)}${d.duplicate_of_name.length > 30 ? "…" : ""}` : ""}
                {simLoading && <Loader2 className="h-3 w-3 animate-spin" />}
                {!simLoading && simCands !== null && simCount > 0 && (
                  <span className="num rounded-full bg-amber-200 px-1.5 py-0.5 text-[10px] font-bold text-amber-900">
                    {simCount}
                  </span>
                )}
              </button>
            )}
            {/* Layer-2 button — always visible so a reviewer can scan even
                when Layer 1B didn't flag the row. Compact & neutral so it
                doesn't compete with the amber duplicate pill when both show. */}
            {!d.is_duplicate && (
              <button
                type="button"
                onClick={openSimilarPanel}
                className="group inline-flex items-center gap-1.5 rounded-md border border-brand/60 bg-brand/10 px-3 py-1.5 text-[12px] font-semibold text-brand shadow-[0_0_0_3px_rgba(91,91,214,0.12)] ring-1 ring-brand/30 transition-all hover:-translate-y-0.5 hover:bg-brand/15 hover:shadow-[0_4px_12px_rgba(91,91,214,0.25)] motion-safe:animate-pulse-soft"
                title="Fuzzy-scan same category + district for similar submissions."
              >
                <SearchIcon className="h-3.5 w-3.5 transition-transform group-hover:scale-110" />
                Find similar
                {simLoading && <Loader2 className="h-3 w-3 animate-spin" />}
                {!simLoading && simCands !== null && simCount > 0 && (
                  <span className="num rounded-full bg-amber-200 px-1.5 py-0.5 text-[10px] font-bold text-amber-900">
                    {simCount}
                  </span>
                )}
              </button>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {onPrev && onNext && (
              <DrawerNav
                onPrev={onPrev} onNext={onNext}
                hasPrev={!!hasPrev} hasNext={!!hasNext}
                loading={!!navLoading}
              />
            )}
            <SheetClose
              onClick={onClose}
              className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </SheetClose>
          </div>
        </div>

        <SheetTitle asChild>
          <h2 className="font-serif text-[22px] font-semibold leading-tight text-foreground sm:text-[26px]">
            {d.association_name || "Unnamed association"}
          </h2>
        </SheetTitle>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-muted-foreground">
          {(d.representative_name || d.representative_designation) && (
            <span className="inline-flex items-center gap-1.5">
              <UserRound className="h-3.5 w-3.5" />
              {[d.representative_name, d.representative_designation].filter(Boolean).join(" · ")}
            </span>
          )}
          {d.member_count && (
            <span className="inline-flex items-center gap-1.5">
              <Users className="h-3.5 w-3.5" />{d.member_count}
            </span>
          )}
          {d.district && (
            <span className="inline-flex items-center gap-1.5">
              <MapPin className="h-3.5 w-3.5" />{d.district}
            </span>
          )}
          <span className="inline-flex items-center gap-1.5">
            <CalendarClock className="h-3.5 w-3.5" /><span className="num">{fmtDate(d.created_at)}</span>
          </span>
          {days != null && <span className="num">· {days}d in queue</span>}
          <span className="num ml-auto shrink-0 text-[11.5px]">#{d.id}</span>
        </div>
      </div>

      {/* Body — 2 panes on lg+: preview LEFT, reading RIGHT */}
      <div className="min-h-0 flex-1 overflow-hidden">
        <div className="grid h-full min-h-0 grid-cols-1 lg:grid-cols-[minmax(0,45%)_1fr]">
          <div className="min-h-0 overflow-hidden border-b border-border bg-muted/25 p-3 sm:p-4 lg:border-b-0 lg:border-r">
            {docAtts.length > 0 ? (
              <InlineAttachmentPreview attachments={docAtts} defaultOpenFirst className="h-full" />
            ) : (
              <div className="flex h-full min-h-[280px] items-center justify-center rounded-xl border border-dashed border-border bg-background/60 text-center">
                <div>
                  <FolderOpen className="mx-auto h-8 w-8 text-muted-foreground/40" />
                  <p className="mt-2 text-[13px] text-muted-foreground">No source document attached.</p>
                </div>
              </div>
            )}
          </div>

          <div className="min-h-0 space-y-5 overflow-y-auto px-5 py-5 sm:px-6">
            {/* 1 — Association details (identity + meta) */}
            <SectionShell n={1} id="association" title="Association details">
              <div className="grid gap-2.5 sm:grid-cols-2">
                <Tile icon={<Building2 className="h-3 w-3" />} label="Association name" value={d.association_name} />
                <Tile icon={<UserRound className="h-3 w-3" />} label="Representative" value={d.representative_name} />
                <Tile icon={<UserRound className="h-3 w-3" />} label="Designation" value={d.representative_designation} />
                <Tile icon={<Users className="h-3 w-3" />} label="Membership" value={d.member_count} />
                <Tile icon={<Landmark className="h-3 w-3" />} label="Category" value={titleCase(d.category)} />
                <Tile icon={<Building2 className="h-3 w-3" />} label="Ministry" value={titleCase(d.ministry)} />
                <Tile icon={<Flag className="h-3 w-3" />} label="Urgency" value={urg?.label ?? titleCase(d.urgency)} />
                <Tile icon={<MapPin className="h-3 w-3" />} label="District" value={d.district} />
                <Tile icon={<CalendarClock className="h-3 w-3" />} label="Document date" value={d.document_date} mono />
                <Tile icon={<Target className="h-3 w-3" />} label="Source" value={titleCase(d.source)} />
              </div>
            </SectionShell>

            {/* 2 — The collective ask (always shown; the ask IS the deliverable
                 of an association submission, so absence is itself a signal
                 the PA must see — never hide the section on empty). */}
            <SectionShell n={2} id="ask" title="The collective ask">
              <div className="space-y-3">
                <Reading
                  label="Ask"
                  text={specified(ask) ? ask : "No clear collective ask stated in the document"}
                  muted={!specified(ask)}
                />
                <Reading label="Why now" text={demand} />
              </div>
            </SectionShell>

            {/* 3 — Summary + key details (always shown; a blank summary is a
                 signal the extraction was thin — reviewer should see the
                 fallback, not a vanished section, so they don't approve
                 blindly assuming AI just skipped the block). */}
            <SectionShell n={3} id="summary" title="Summary">
              <div className="space-y-3">
                <Reading
                  label="Overview"
                  text={specified(summary) ? summary : "No summary extracted — the source document may be thin or unreadable"}
                  muted={!specified(summary)}
                />
                {keyDetails.length > 0 && (
                  <div>
                    <div className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Key details</div>
                    <ul className="space-y-1.5">
                      {keyDetails.map((k, i) => (
                        <li key={i} className="flex gap-2 text-[13.5px] leading-relaxed text-foreground/85">
                          <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground/50" />
                          <span>{k}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </SectionShell>

            {/* 4 — Stakeholders + risks */}
            <SectionShell n={4} id="stake-risk" title="Stakeholders & risks" hidden={stakeholders.length === 0 && risks.length === 0}>
              <div className="grid gap-4 lg:grid-cols-2">
                {stakeholders.length > 0 && (
                  <div>
                    <div className="mb-1.5 flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                      <Users className="h-3 w-3" /> Key stakeholders
                    </div>
                    <ul className="space-y-1.5">
                      {stakeholders.map((s, i) => (
                        <li key={i} className="flex gap-2 rounded-md border border-border bg-background/60 px-3 py-2 text-[13.5px] leading-snug text-foreground/90">
                          <UserRound className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                          <span>{s}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {risks.length > 0 && (
                  <div>
                    <div className="mb-1.5 flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                      <RiskIcon className="h-3 w-3" /> Risks if ignored
                    </div>
                    <ul className="space-y-1.5">
                      {risks.map((r, i) => (
                        <li key={i} className="flex gap-2 rounded-md border border-amber-200/60 bg-amber-50/50 px-3 py-2 text-[13.5px] leading-snug text-foreground/90">
                          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
                          <span>{r}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </SectionShell>

            {/* 5 — Expected outcome + precedent (always shown; expected
                 outcome is the concrete "what does the association want the
                 government to do?" — its absence should trigger a
                 needs_more_info decision, not vanish. Precedent stays
                 optional — many first-time submissions have no history). */}
            <SectionShell n={5} id="outcome" title="Outcome & precedent">
              <div className="space-y-3">
                <Reading
                  label="Expected outcome (as stated)"
                  text={specified(outcome) ? outcome : "No concrete expected outcome stated in the document"}
                  muted={!specified(outcome)}
                />
                <Reading label="Precedent / prior actions" text={precedent} />
              </div>
            </SectionShell>

            {/* 6 — AI Assessment */}
            <SectionShell
              n={6} id="ai-brief" title="AI Assessment"
              right={rec ? (
                <span className={cn("inline-flex items-center gap-1 rounded-full border border-dashed px-2 py-0.5 text-[11px] font-semibold", rec.cls)} title="AI's triage hint — not the reviewer's decision">
                  <Sparkles className="h-3 w-3" /> {rec.label}
                </span>
              ) : undefined}
            >
              <div className="rounded-lg border border-border bg-background/60 p-4">
                <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                  <Sparkles className="h-3.5 w-3.5" /> AI read
                </div>
                {specified(rationale) ? (
                  <p className="rounded-md bg-muted/40 px-3 py-2 text-[13.5px] leading-relaxed text-foreground/85">
                    {rationale}
                  </p>
                ) : (
                  <p className="text-[13px] italic text-muted-foreground">No AI note recorded.</p>
                )}
              </div>
            </SectionShell>

            {/* 7 — Duplicate check (Layer 2, reviewer-triggered fuzzy dedup).
                 State is lifted to AssociationDrawer so the header pill /
                 count badge and this section body always agree. */}
            <SimilarAssociationsPanel
              n={7}
              open={simPanelOpen} onToggle={() => setSimPanelOpen((v) => !v)}
              loading={simLoading} cands={simCands} reason={simReason} err={simErr}
              onScan={runSimilarScan}
            />

            {/* 8 — Documents */}
            <SectionShell n={8} id="documents" title="Attached documents">
              {docAtts.length === 0 ? (
                <p className="text-[13px] text-muted-foreground">No source document attached.</p>
              ) : (
                <ul className="space-y-1.5">
                  {(d.documents || []).filter((doc) => !!doc.url).map((doc, i) => (
                    <li key={i} className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-[13.5px]">
                      <ScrollText className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="flex-1 truncate text-foreground">{doc.filename || "document"}</span>
                      {doc.mime && (
                        <span className="rounded bg-secondary px-1.5 py-0.5 text-[10.5px] font-semibold uppercase tracking-wider text-secondary-foreground">
                          {doc.mime.split("/")[1] || doc.mime}
                        </span>
                      )}
                      {doc.url && (
                        <a href={doc.url} target="_blank" rel="noreferrer"
                           className="inline-flex items-center gap-1 text-brand hover:underline"
                           title="Open in a new tab">
                          <Download className="h-3.5 w-3.5" />
                        </a>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </SectionShell>

          </div>
        </div>
      </div>

      {/* Sticky decision bar — hidden entirely in read-only mode. Post-
          decision, action buttons hide behind a "Change decision" toggle
          so a stray click can't re-run the ticket mint or re-stamp
          reviewed_by / reviewed_at (backend also 409s the same-status
          no-op, but the UI shouldn't offer it in the first place). */}
      {!readOnly && setNote && onDecide && (
        <div className="shrink-0 space-y-3 border-t border-border bg-card px-5 py-4 sm:px-7">
          {/* ─ (a) Decided + idle: prominent status card + two clear actions ─ */}
          {decided && !changingDecision && !editingNote && (
            <div className="rounded-lg border-2 border-border bg-muted/30 p-3.5">
              <div className="flex items-start gap-2.5">
                <Check className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
                <div className="min-w-0 flex-1">
                  <div className="text-[14px] font-bold text-foreground">
                    {st.label}
                    {d.reviewed_by && (
                      <span className="ml-1.5 text-[12.5px] font-normal text-muted-foreground">
                        · by {d.reviewed_by}
                      </span>
                    )}
                  </div>
                  {d.decision_note ? (
                    <div className="mt-1 whitespace-pre-wrap rounded-md bg-background/70 px-2.5 py-1.5 text-[13px] leading-snug text-foreground/85">
                      {d.decision_note}
                    </div>
                  ) : (
                    <div className="mt-1 text-[12.5px] italic text-muted-foreground">No note yet.</div>
                  )}
                </div>
              </div>
              <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
                {onNoteSave && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => { setEditingNote(true); setNote(d.decision_note ?? ""); }}
                    className="border-2 border-brand/40 font-semibold text-brand hover:border-brand hover:bg-brand/5 hover:text-brand"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                    {d.decision_note ? "Edit note" : "Add note"}
                  </Button>
                )}
                <Button
                  size="sm"
                  onClick={() => { setChangingDecision(true); setNote(d.decision_note ?? ""); }}
                  className="bg-slate-800 font-semibold text-white hover:bg-slate-900 !bg-none"
                >
                  <RefreshCcw className="h-3.5 w-3.5" /> Change decision
                </Button>
              </div>
            </div>
          )}

          {/* ─ (b) Editing note only — no status flip ─ */}
          {decided && editingNote && (
            <>
              <div className="flex items-center justify-between gap-2 text-[12.5px] font-medium text-muted-foreground">
                <span>Editing note on <strong>{st.label.toLowerCase()}</strong>. Status won't change.</span>
                <button
                  type="button"
                  onClick={() => setEditingNote(false)}
                  className="text-brand hover:underline"
                >
                  Cancel
                </button>
              </div>
              <Textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Follow-up note…"
                className="min-h-[70px] resize-none text-sm"
                autoFocus
              />
              <div className="flex justify-end">
                <Button
                  disabled={deciding || !onNoteSave}
                  onClick={async () => {
                    if (!onNoteSave) return;
                    await onNoteSave(note.trim());
                    setEditingNote(false);
                  }}
                  className="bg-brand font-semibold text-white hover:bg-brand/90 !bg-none"
                >
                  {deciding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                  Save note
                </Button>
              </div>
            </>
          )}

          {/* ─ (c) Changing decision (or first-decide on AWAITING_REVIEW) ─ */}
          {(!decided || changingDecision) && (
            <>
              {decided && changingDecision && (
                <div className="flex items-center justify-between gap-2 text-[12.5px] font-medium text-muted-foreground">
                  <span>Changing from <strong>{st.label.toLowerCase()}</strong>. Pick a different decision below.</span>
                  <button
                    type="button"
                    onClick={() => setChangingDecision(false)}
                    className="text-brand hover:underline"
                  >
                    Cancel
                  </button>
                </div>
              )}
              <Textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Decision note (required when forwarding to a department)…"
                className="min-h-[60px] resize-none text-sm"
              />
              {/* Compact right-aligned auto-width row. Each button hidden
                  if it would be a no-op against the current status —
                  matches the backend guard so a stray click can't fire. */}
              <div className="flex flex-wrap items-center justify-end gap-2">
                {d.status !== "REVIEWED" && (
                  <Button size="sm" disabled={deciding} onClick={() => onDecide("reviewed")}
                    className="bg-emerald-600 text-white hover:bg-emerald-700 !bg-none">
                    {deciding ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Mark reviewed
                  </Button>
                )}
                {d.status !== "FORWARDED" && (
                  <Button size="sm" disabled={deciding} variant="outline" onClick={() => onDecide("forwarded")}
                    className="border-sky-300 text-sky-700 hover:bg-sky-50 hover:text-sky-800">
                    <Send className="h-3.5 w-3.5" /> Forward to department
                  </Button>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}


// ── Layer-2 fuzzy dedup panel ───────────────────────────────────────────────
// Body of the "Duplicate check" section. State (loading/candidates/reason/err)
// is owned by the parent drawer so the header pill + count badge stay in
// sync with what this panel shows. Auto-scan (on drawer open when Layer 1B
// pre-flagged the row) is also parent-controlled — see AssociationDrawer.
function SimilarAssociationsPanel({
  n, open, onToggle, loading, cands, reason, err, onScan,
}: {
  n: number;
  open: boolean;
  onToggle: () => void;
  loading: boolean;
  cands: SimilarAssociationCandidate[] | null;
  reason: string | null;
  err: string | null;
  onScan: () => void;
}) {
  return (
    <SectionShell n={n} id="similar" title="Duplicate check"
      right={
        <button
          onClick={() => { onToggle(); if (cands === null && !loading) onScan(); }}
          className={cn(
            "group inline-flex items-center gap-1.5 rounded-md border border-brand/60 bg-brand/10 px-3 py-1.5 text-[12.5px] font-semibold text-brand shadow-[0_0_0_3px_rgba(91,91,214,0.12)] ring-1 ring-brand/30 transition-all hover:-translate-y-0.5 hover:bg-brand/15 hover:shadow-[0_4px_12px_rgba(91,91,214,0.25)]",
            // Pulse only while un-scanned so the invitation is loud on
            // first landing; once results are known the button is quiet.
            !open && cands === null && !loading && "motion-safe:animate-pulse-soft"
          )}
        >
          <SearchIcon className="h-3.5 w-3.5 transition-transform group-hover:scale-110" />
          {open ? "Hide" : "Find similar"}
          {!loading && cands !== null && cands.length > 0 && (
            <span className="num rounded-full bg-amber-200 px-1.5 py-0.5 text-[10px] font-bold text-amber-900">
              {cands.length}
            </span>
          )}
        </button>
      }
    >
      {!open ? (
        <p className="text-[12.5px] text-muted-foreground">
          Trigram-similarity scan across the same category + district. Read-only — nothing gets merged automatically.
        </p>
      ) : loading ? (
        <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Scanning associations in this bucket…
        </div>
      ) : err ? (
        <p className="text-[13px] text-red-700">Scan failed: {err}</p>
      ) : (cands?.length ?? 0) === 0 ? (
        <p className="text-[13px] italic text-muted-foreground">{reason || "No similar associations found."}</p>
      ) : (
        <ul className="space-y-1.5">
          {(cands || []).map((c) => (
            <li key={c.id} className="flex items-center gap-3 rounded-md border border-border bg-card px-3 py-2 text-[13px]">
              <span className="num rounded-full bg-amber-100 px-2 py-0.5 text-[10.5px] font-bold text-amber-800" title={`Similarity ${(c.score * 100).toFixed(0)}%`}>
                {(c.score * 100).toFixed(0)}%
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate font-semibold text-foreground">{c.association_name || "Unnamed body"}</div>
                <div className="truncate text-[11.5px] text-muted-foreground">
                  {c.representative_name || "—"} · {c.district || "—"} · {c.status}
                </div>
              </div>
              <a
                href={`/association-review?id=${c.id}`}
                target="_blank"
                rel="noreferrer"
                className="shrink-0 text-[11.5px] font-semibold text-brand hover:underline"
              >
                Open →
              </a>
            </li>
          ))}
        </ul>
      )}
    </SectionShell>
  );
}
