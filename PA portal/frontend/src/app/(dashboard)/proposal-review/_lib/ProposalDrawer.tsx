"use client";
/**
 * Shared proposal-detail drawer (+ helpers). Same shape as AssociationDrawer:
 * extracted so the Proposal Dashboard can render the exact same detail view
 * WITHOUT a route redirect — just imports <ProposalDrawer readOnly /> and
 * skips the sticky Approve / Reject / Needs-clarification decision bar.
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Check, X, HelpCircle, Building2, IndianRupee, CalendarClock,
  Sparkles, AlertTriangle, Loader2, User, Download,
  Briefcase, Landmark, Wallet, ShieldAlert as RiskIcon, FolderOpen, Pencil,
  Search as SearchIcon, RefreshCcw,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { SheetClose, SheetTitle } from "@/components/ui/sheet";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { InlineAttachmentPreview } from "@/components/ui/inline-attachment-preview";
import { DrawerNav } from "@/components/ui/drawer-nav";
import type { GalleryAttachment } from "@/components/ui/attachment-gallery";
import { useLang } from "@/lib/lang-context";
import { cn } from "@/lib/utils";
import {
  PROPOSAL_CATEGORIES, updateProposalCategory, findSimilarProposals,
  type ProposalDetail, type ProposalBrief, type ProposalDoc, type Decision,
  type SimilarProposalCandidate,
} from "./proposalApi";

// ── display maps ────────────────────────────────────────────────────────────
export const CATEGORY_LABEL: Record<string, string> = {
  school: "School Education", tamil: "Tamil & Heritage",
  information: "Information & Publicity", film: "Film",
};

export const STATUS_META: Record<string, { label: string; cls: string }> = {
  QUEUED:              { label: "Queued",          cls: "bg-slate-100 text-slate-600" },
  PROCESSING:          { label: "Reading…",        cls: "bg-sky-100 text-sky-700" },
  AWAITING_REVIEW:     { label: "Awaiting review", cls: "bg-amber-100 text-amber-800" },
  FAILED:              { label: "Failed",          cls: "bg-red-100 text-red-700" },
  APPROVED:            { label: "Approved",        cls: "bg-emerald-100 text-emerald-700" },
  REJECTED:            { label: "Rejected",        cls: "bg-red-100 text-red-700" },
  NEEDS_CLARIFICATION: { label: "Needs info",      cls: "bg-orange-100 text-orange-800" },
};

export const REC_META: Record<string, { label: string; cls: string; dot: string }> = {
  review_closely:  { label: "Review closely",      cls: "border-violet-300 bg-violet-50 text-violet-700",   dot: "bg-violet-500"  },
  standard:        { label: "Looks routine",       cls: "border-emerald-300 bg-emerald-50 text-emerald-700", dot: "bg-emerald-500" },
  needs_more_info: { label: "Vague brief",         cls: "border-amber-300 bg-amber-50 text-amber-700",     dot: "bg-amber-500"   },
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
export function specified(v?: string | null): boolean {
  const s = (v || "").trim();
  return !!s && s.toLowerCase() !== "not specified";
}
export function toAttachments(docs: ProposalDoc[] | undefined): GalleryAttachment[] {
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
  icon?: ReactNode; label: string; value?: string | null; mono?: boolean;
  /** When true, renders the value in muted italic (fallback copy like
   *  "No cost mentioned") instead of collapsing the tile entirely. */
  muted?: boolean;
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
 *  for load-bearing fields like beneficiary or implementation readiness that
 *  should always show the fact of "not stated" rather than disappearing).
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
export interface ProposalDrawerProps {
  d: ProposalDetail;
  onClose: () => void;
  /** Read-only mode = hide the sticky decision bar AND the desk-reassignment
   *  section. Used on the dashboards and by the Minister app. */
  readOnly?: boolean;
  note?: string;
  setNote?: (v: string) => void;
  deciding?: boolean;
  onDecide?: (dec: Decision) => void;
  /** Save-only update to `decision_note` on an already-decided row. Distinct
   *  from onDecide because it doesn't touch status / reviewed_by, so the
   *  reviewer can add follow-up clarifications without the "did you change
   *  your mind?" side-effects. */
  onNoteSave?: (note: string) => Promise<void> | void;
  /** Called with the refreshed row after the desk is reassigned, so the list
   *  behind the drawer can pick up the new category. */
  onCategorySaved?: (updated: ProposalDetail) => void;
  /** Prev/next drawer navigation (wired by the list page via useDrawerNav). */
  onPrev?: () => void;
  onNext?: () => void;
  hasPrev?: boolean;
  hasNext?: boolean;
  navLoading?: boolean;
}

export function ProposalDrawer({
  d, onClose, readOnly = false,
  note = "", setNote,
  deciding = false, onDecide,
  onNoteSave,
  onCategorySaved,
  onPrev, onNext, hasPrev, hasNext, navLoading,
}: ProposalDrawerProps) {
  const { lang } = useLang();

  // Category reassignment (section 10). Draft lives here until Save, so an
  // accidental change to the picker never writes anything.
  const [catDraft, setCatDraft] = useState<string>(d.category ?? "");
  const [savingCat, setSavingCat] = useState(false);
  // Re-seed when the drawer is pointed at a different proposal.
  useEffect(() => { setCatDraft(d.category ?? ""); }, [d.id, d.category]);
  const catDirty = !!catDraft && catDraft !== (d.category ?? "");

  // Sticky decision bar: once decided, hide the action buttons behind a
  // "Change decision" toggle so a stray click can't accidentally re-stamp
  // reviewed_by / reviewed_at on an already-decided proposal. A separate
  // `editingNote` mode reveals only a textarea + Save, keyed to the
  // note-only endpoint — lets the reviewer add follow-up clarifications
  // without flipping status. Both auto-collapse when the drawer switches
  // proposals or the row's status changes.
  const [changingDecision, setChangingDecision] = useState(false);
  const [editingNote, setEditingNote] = useState(false);
  useEffect(() => {
    setChangingDecision(false);
    setEditingNote(false);
  }, [d.id, d.status]);

  async function saveCategory() {
    if (!catDirty || savingCat) return;
    setSavingCat(true);
    try {
      const updated = await updateProposalCategory(d.id, catDraft);
      toast.success("Category updated", {
        description: `Moved to ${CATEGORY_LABEL[catDraft] ?? catDraft}.`,
      });
      onCategorySaved?.(updated);
    } catch (e) {
      toast.error("Couldn't update the desk", { description: (e as Error).message });
      setCatDraft(d.category ?? "");   // roll the picker back to the stored value
    } finally {
      setSavingCat(false);
    }
  }
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

  const ex: ProposalBrief = d.extraction || {};
  const rec = ex.ai_recommendation ? REC_META[ex.ai_recommendation] : null;
  const st = STATUS_META[d.status] || { label: d.status, cls: "bg-slate-100 text-slate-600" };
  const decided = ["APPROVED", "REJECTED", "NEEDS_CLARIFICATION"].includes(d.status);
  const days = daysSince(d.created_at);

  const problem     = L(ex.problem_statement,   ex.problem_statement_ta);
  const solution    = L(ex.proposed_solution,   ex.proposed_solution_ta);
  const benefit     = L(ex.expected_benefit,    ex.expected_benefit_ta);
  const beneficiary = L(ex.beneficiary_scope,   ex.beneficiary_scope_ta);
  const readiness   = L(ex.implementation_readiness, ex.implementation_readiness_ta);
  const partnership = L(ex.partnership_model,   ex.partnership_model_ta);
  const track       = L(ex.track_record,        ex.track_record_ta);
  const risks       = (ta && ex.key_risks_ta?.length ? ex.key_risks_ta : ex.key_risks) || [];
  const highlights  = (ta && ex.key_highlights_ta?.length ? ex.key_highlights_ta : ex.key_highlights) || [];

  const gaps: string[] = [];
  if (!specified(problem))                gaps.push("Problem statement not described");
  if (!specified(solution))               gaps.push("Proposed solution not detailed");
  if (!specified(ex.estimated_cost))      gaps.push("Funding ask (₹) not specified");
  if (!specified(ex.timeline))            gaps.push("Implementation timeline missing");
  if (!specified(beneficiary))            gaps.push("Beneficiary scope not quantified");

  const docAtts = useMemo(() => toAttachments(d.documents), [d.documents]);

  // ── Layer-2 "Find similar" state, lifted so the header pill + count and
  // the Duplicate Check section body always agree. Auto-fires when Layer 1B
  // pre-flagged the row so the reviewer sees the count without hunting.
  const [simPanelOpen, setSimPanelOpen] = useState(false);
  const [simLoading,   setSimLoading]   = useState(false);
  const [simCands,     setSimCands]     = useState<SimilarProposalCandidate[] | null>(null);
  const [simReason,    setSimReason]    = useState<string | null>(null);
  const [simErr,       setSimErr]       = useState<string | null>(null);

  const runSimilarScan = useCallback(async () => {
    setSimLoading(true); setSimErr(null);
    try {
      const res = await findSimilarProposals(d.id);
      setSimCands(res.candidates || []);
      setSimReason(res.reason || null);
    } catch (e) {
      setSimErr((e as Error).message);
    } finally {
      setSimLoading(false);
    }
  }, [d.id]);

  useEffect(() => {
    if (d.is_duplicate && simCands === null && !simLoading) {
      runSimilarScan();
    }
  }, [d.is_duplicate, simCands, simLoading, runSimilarScan]);

  const simCount = simCands?.length ?? 0;
  const openSimilarPanel = () => {
    setSimPanelOpen(true);
    if (simCands === null && !simLoading) runSimilarScan();
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
                {CATEGORY_LABEL[d.category] || d.category}
              </Badge>
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
                  d.duplicate_of_tracking_ref
                    ? `Fingerprint matches ${d.duplicate_of_tracking_ref} within the last 90 days. Click to see all matches.`
                    : "Fingerprint matches an earlier proposal within the last 90 days. Click to see all matches."
                }
              >
                <AlertTriangle className="h-3 w-3" />
                Suspected duplicate{d.duplicate_of_tracking_ref ? ` of ${d.duplicate_of_tracking_ref}` : ""}
                {simLoading && <Loader2 className="h-3 w-3 animate-spin" />}
                {!simLoading && simCands !== null && simCount > 0 && (
                  <span className="num rounded-full bg-amber-200 px-1.5 py-0.5 text-[10px] font-bold text-amber-900">
                    {simCount}
                  </span>
                )}
              </button>
            )}
            {!d.is_duplicate && (
              <button
                type="button"
                onClick={openSimilarPanel}
                className="group inline-flex items-center gap-1.5 rounded-md border border-brand/60 bg-brand/10 px-3 py-1.5 text-[12px] font-semibold text-brand shadow-[0_0_0_3px_rgba(91,91,214,0.12)] ring-1 ring-brand/30 transition-all hover:-translate-y-0.5 hover:bg-brand/15 hover:shadow-[0_4px_12px_rgba(91,91,214,0.25)] motion-safe:animate-pulse-soft"
                title="Fuzzy-scan same category for similar proposals."
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
            {L(ex.title, ex.title_ta) || d.title || "Untitled proposal"}
          </h2>
        </SheetTitle>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <Building2 className="h-3.5 w-3.5" />{d.org_name || "Unattributed"}
          </span>
          {(d.person_name || d.designation) && (
            <span className="inline-flex items-center gap-1.5">
              <User className="h-3.5 w-3.5" />{[d.person_name, d.designation].filter(Boolean).join(" · ")}
            </span>
          )}
          <span className="inline-flex items-center gap-1.5">
            <CalendarClock className="h-3.5 w-3.5" /><span className="num">{fmtDate(d.created_at)}</span>
          </span>
          {days != null && <span className="num">· {days}d in queue</span>}
          <span className="num ml-auto shrink-0 text-[11.5px]">{d.tracking_ref}</span>
        </div>
      </div>

      {/* Body — 2 panes on lg+ */}
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
            {d.status === "FAILED" && (
              <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-700">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>AI extraction failed for this proposal. {d.error_message}</span>
              </div>
            )}

            {/* 1 — AI Assessment + Executive Brief */}
            <SectionShell
              n={1} id="ai-brief" title="AI Assessment & Executive Brief"
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
                {ex.ai_rationale ? (
                  <p className="rounded-md bg-muted/40 px-3 py-2 text-[13.5px] leading-relaxed text-foreground/85">
                    {ex.ai_rationale}
                  </p>
                ) : (
                  <p className="text-[13px] italic text-muted-foreground">No AI note recorded.</p>
                )}
                {gaps.length > 0 && (
                  <div className="mt-4">
                    <div className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                      What&apos;s missing in this brief
                    </div>
                    <ul className="space-y-1.5">
                      {gaps.map((g, i) => (
                        <li key={i} className="flex gap-2 text-[13.5px] text-foreground/85">
                          <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
                          <span>{g}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              {(specified(problem) || specified(solution) || specified(benefit)) && (
                <div className="mt-4">
                  <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                    <Briefcase className="h-3.5 w-3.5" /> Executive brief
                  </div>
                  <div className="space-y-3">
                    <Reading label="Problem" text={problem} />
                    <Reading label="Proposed solution" text={solution} />
                    <Reading label="Expected outcome" text={benefit} />
                  </div>
                </div>
              )}

              {highlights.length > 0 && (
                <div className="mt-4">
                  <div className="mb-2 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Key highlights</div>
                  <div className="flex flex-wrap gap-1.5">
                    {highlights.map((h, i) => (
                      <span key={i} className="rounded-full border border-border bg-secondary/70 px-2.5 py-1 text-[12.5px] text-secondary-foreground">{h}</span>
                    ))}
                  </div>
                </div>
              )}
            </SectionShell>

            {/* 2 — Feasibility (always shown; readiness + timeline are core
                 decision context, an absence is itself signal the reviewer
                 needs to see, not a silently-hidden section). */}
            <SectionShell n={2} id="feasibility" title="Feasibility">
              <div className="space-y-3">
                <Reading
                  label="Implementation readiness"
                  text={specified(readiness) ? readiness : "No implementation readiness described in the document"}
                  muted={!specified(readiness)}
                />
                <div className="grid gap-2.5 sm:grid-cols-2">
                  <Tile
                    icon={<CalendarClock className="h-3 w-3" />}
                    label="Implementation timeline"
                    value={specified(ex.timeline) ? ex.timeline : "No timeline stated"}
                    muted={!specified(ex.timeline)}
                    mono={specified(ex.timeline)}
                  />
                </div>
              </div>
            </SectionShell>

            {/* 3 — Impact (always shown; beneficiary_scope is a core
                 Minister-decision field — "who and how many does this
                 touch?". Silent removal used to leave the reviewer
                 wondering whether the AI missed it or the doc was silent). */}
            <SectionShell n={3} id="impact" title="Impact">
              <Reading
                label="Direct beneficiaries"
                text={specified(beneficiary) ? beneficiary : "No beneficiary scope stated in the document"}
                muted={!specified(beneficiary)}
              />
            </SectionShell>

            {/* 4 — Risks */}
            <SectionShell n={4} id="risk" title="Risks" hidden={risks.length === 0}>
              <ul className="space-y-2">
                {risks.map((r, i) => (
                  <li key={i} className="flex gap-2.5 rounded-md border border-amber-200/60 bg-amber-50/50 px-3 py-2 text-[13.5px] leading-relaxed text-foreground/90">
                    <RiskIcon className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
                    <span>{r}</span>
                  </li>
                ))}
              </ul>
            </SectionShell>

            {/* 5 — Financial. Funding ask ALWAYS renders — an unstated cost is
                   itself a signal the Minister should see ("No cost mentioned"
                   rather than a hidden section). Contribution stays optional. */}
            <SectionShell n={5} id="financial" title="Financial">
              <div className="grid gap-2.5 sm:grid-cols-2">
                <Tile
                  icon={<IndianRupee className="h-3 w-3" />}
                  label="Funding ask"
                  value={specified(ex.estimated_cost) ? ex.estimated_cost : "No cost mentioned"}
                  muted={!specified(ex.estimated_cost)}
                  mono={specified(ex.estimated_cost)}
                />
                <Tile icon={<Wallet className="h-3 w-3" />} label="Applicant contribution" value={ex.applicant_contribution} mono />
              </div>
            </SectionShell>

            {/* 6 — The Ask */}
            <SectionShell n={6} id="ask" title="The ask" hidden={!specified(partnership) && !d.category}>
              <div className="space-y-3">
                <div className="grid gap-2.5 sm:grid-cols-2">
                  <Tile icon={<Landmark className="h-3 w-3" />} label="Category" value={CATEGORY_LABEL[d.category ?? ""] ?? d.category ?? null} />
                </div>
                <Reading label="Partnership model" text={partnership} />
              </div>
            </SectionShell>

            {/* 7 — Track Record */}
            <SectionShell n={7} id="track" title="Applicant track record" hidden={!specified(track)}>
              <Reading label="Prior deployments (as stated in the proposal)" text={track} />
            </SectionShell>

            {/* 8 — Duplicate Check (state lifted to parent so header pill +
                 count badge stay in sync with the section body). */}
            <SimilarProposalsPanel
              open={simPanelOpen} onToggle={() => setSimPanelOpen((v) => !v)}
              loading={simLoading} cands={simCands} reason={simReason} err={simErr}
              onScan={runSimilarScan}
            />

            {/* 9 — Documents */}
            <SectionShell n={9} id="documents" title="Attached documents">
              {docAtts.length === 0 ? (
                <p className="text-[13px] text-muted-foreground">No source document attached.</p>
              ) : (
                <ul className="space-y-1.5">
                  {(d.documents || []).filter((doc) => !!doc.url).map((doc, i) => (
                    <li key={i} className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-[13.5px]">
                      <FolderOpen className="h-4 w-4 shrink-0 text-muted-foreground" />
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

            {/* 10 — Category reassignment. The only editable thing in this
                    drawer, so it is hidden entirely in read-only mode. */}
            {!readOnly && (
              <SectionShell
                n={10}
                id="category"
                title="Category assignment"
                right={
                  <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                    <Pencil className="h-3 w-3" /> Editable
                  </span>
                }
              >
                <div className="rounded-lg border border-border bg-background/60 p-4">
                  <p className="mb-3 text-[13px] text-muted-foreground">
                    The desk is set from the submission form. Change it here if the
                    proposal belongs with a different portfolio.
                  </p>

                  <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center">
                    <Select value={catDraft} onValueChange={setCatDraft} disabled={savingCat}>
                      <SelectTrigger className="h-10 w-full sm:max-w-[280px]">
                        <SelectValue placeholder="Choose a desk" />
                      </SelectTrigger>
                      <SelectContent>
                        {PROPOSAL_CATEGORIES.map((c) => (
                          <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>

                    <Button
                      onClick={saveCategory}
                      disabled={!catDirty || savingCat}
                      className="h-10 sm:w-auto"
                    >
                      {savingCat ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                      {savingCat ? "Saving…" : "Save"}
                    </Button>

                    {catDirty && !savingCat && (
                      <button
                        type="button"
                        onClick={() => setCatDraft(d.category ?? "")}
                        className="text-[12.5px] font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                      >
                        Cancel
                      </button>
                    )}
                  </div>

                  <p className="mt-3 text-[12px] text-muted-foreground">
                    The tracking reference{" "}
                    <span className="num font-semibold text-foreground">{d.tracking_ref}</span>{" "}
                    stays the same — the applicant already has it.
                  </p>
                </div>
              </SectionShell>
            )}

            {decided && d.decision_note && (
              <div className="rounded-lg border border-border bg-secondary/60 px-3.5 py-3 text-[13.5px]">
                <span className="font-semibold">Decision note:</span> {d.decision_note}
                {d.reviewed_by && <div className="mt-0.5 text-[11.5px] text-muted-foreground">— {d.reviewed_by}, {fmtDate(d.reviewed_at)}</div>}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Sticky decision bar — hidden in read-only mode. Post-decision, the
          three action buttons hide behind a "Change decision" toggle so a
          stray click can't silently re-stamp reviewed_by / reviewed_at on an
          already-decided proposal (backend also 409s the same-status no-op,
          but the UI shouldn't offer it in the first place). */}
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
              {/* Compact action row — right-aligned auto-width buttons so the
                  card stays tight and the two actions don't dominate the
                  drawer visually. */}
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
                placeholder="Follow-up note or clarification ask…"
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
                placeholder="Decision note (required to reject or request more info)…"
                className="min-h-[60px] resize-none text-sm"
              />
              {/* All three actions in one compact right-aligned row. Approve
                  stays visually primary (filled emerald) but sized to
                  content — no more full-width dominance. Request info uses
                  sky-blue so it stops reading as a second Reject. */}
              <div className="flex flex-wrap items-center justify-end gap-2">
                {d.status !== "APPROVED" && (
                  <Button size="sm" disabled={deciding} onClick={() => onDecide("approved")}
                    className="bg-emerald-600 text-white hover:bg-emerald-700 !bg-none">
                    {deciding ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Approve
                  </Button>
                )}
                {d.status !== "NEEDS_CLARIFICATION" && (
                  <Button size="sm" disabled={deciding} variant="outline" onClick={() => onDecide("needs_clarification")}
                    className="border-sky-300 text-sky-700 hover:bg-sky-50 hover:text-sky-800">
                    <HelpCircle className="h-3.5 w-3.5" /> Request info
                  </Button>
                )}
                {d.status !== "REJECTED" && (
                  <Button size="sm" disabled={deciding} variant="outline" onClick={() => onDecide("rejected")}
                    className="border-red-300 text-red-700 hover:bg-red-50 hover:text-red-800">
                    <X className="h-3.5 w-3.5" /> Reject
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
// Body of the "Duplicate check" section. State is owned by the parent drawer
// so the header pill / count badge and this section body always agree.
function SimilarProposalsPanel({
  open, onToggle, loading, cands, reason, err, onScan,
}: {
  open: boolean;
  onToggle: () => void;
  loading: boolean;
  cands: SimilarProposalCandidate[] | null;
  reason: string | null;
  err: string | null;
  onScan: () => void;
}) {
  return (
    <SectionShell n={8} id="similar" title="Duplicate check"
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
          Trigram-similarity scan across the same desk. Read-only — nothing gets merged automatically.
        </p>
      ) : loading ? (
        <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Scanning proposals in this desk…
        </div>
      ) : err ? (
        <p className="text-[13px] text-red-700">Scan failed: {err}</p>
      ) : (cands?.length ?? 0) === 0 ? (
        <p className="text-[13px] italic text-muted-foreground">{reason || "No similar proposals found."}</p>
      ) : (
        <ul className="space-y-1.5">
          {(cands || []).map((c) => (
            <li key={c.id} className="flex items-center gap-3 rounded-md border border-border bg-card px-3 py-2 text-[13px]">
              <span className="num rounded-full bg-amber-100 px-2 py-0.5 text-[10.5px] font-bold text-amber-800" title={`Similarity ${(c.score * 100).toFixed(0)}%`}>
                {(c.score * 100).toFixed(0)}%
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate font-semibold text-foreground">{c.title || c.tracking_ref}</div>
                <div className="truncate text-[11.5px] text-muted-foreground">
                  {c.org_name || "—"} · {c.tracking_ref} · {c.status}
                </div>
              </div>
              <a
                href={`/proposal-review?id=${c.id}`}
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
