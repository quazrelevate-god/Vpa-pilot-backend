"use client";
/**
 * Shared proposal-detail drawer (+ helpers). Same shape as AssociationDrawer:
 * extracted so the Proposal Dashboard can render the exact same detail view
 * WITHOUT a route redirect — just imports <ProposalDrawer readOnly /> and
 * skips the sticky Approve / Reject / Needs-clarification decision bar.
 */
import { useCallback, useMemo, type ReactNode } from "react";
import {
  Check, X, HelpCircle, Building2, IndianRupee, CalendarClock,
  Sparkles, AlertTriangle, Loader2, User, Download,
  Briefcase, Landmark, Wallet, ShieldAlert as RiskIcon, FolderOpen,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { SheetClose, SheetTitle } from "@/components/ui/sheet";
import { InlineAttachmentPreview } from "@/components/ui/inline-attachment-preview";
import type { GalleryAttachment } from "@/components/ui/attachment-gallery";
import { useLang } from "@/lib/lang-context";
import { cn } from "@/lib/utils";
import type {
  ProposalDetail, ProposalBrief, ProposalDoc, Decision,
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
  standard:        { label: "Ready to review",     cls: "border-emerald-300 bg-emerald-50 text-emerald-700", dot: "bg-emerald-500" },
  needs_more_info: { label: "Needs clarification", cls: "border-amber-300 bg-amber-50 text-amber-700",     dot: "bg-amber-500"   },
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
export function Tile({ icon, label, value, mono = false }: {
  icon?: ReactNode; label: string; value?: string | null; mono?: boolean;
}) {
  if (!specified(value)) return null;
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-lg border border-border bg-background/60 px-4 py-3">
      <div className="flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
        {icon}{label}
      </div>
      <div className={cn("text-[14px] font-semibold leading-snug text-foreground", mono && "num")}>
        {value}
      </div>
    </div>
  );
}

export function Reading({ label, text }: { label: string; text: string }) {
  if (!specified(text)) return null;
  return (
    <div className="rounded-lg border border-border bg-background/60 p-4">
      <div className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{label}</div>
      <p className="font-serif text-[15px] leading-[1.75] text-foreground/90">{text}</p>
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
  /** Read-only mode = hide the sticky decision bar. Used on the dashboard. */
  readOnly?: boolean;
  note?: string;
  setNote?: (v: string) => void;
  deciding?: boolean;
  onDecide?: (dec: Decision) => void;
}

export function ProposalDrawer({
  d, onClose, readOnly = false,
  note = "", setNote,
  deciding = false, onDecide,
}: ProposalDrawerProps) {
  const { lang } = useLang();
  const ta = lang === "ta";
  const L = useCallback((en?: string, taStr?: string) => {
    if (ta && taStr && taStr.trim()) return taStr;
    return (en || taStr || "").trim();
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
              <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-semibold", rec.cls)}>
                <span className={cn("h-1.5 w-1.5 rounded-full", rec.dot)} />{rec.label}
              </span>
            )}
          </div>
          <SheetClose
            onClick={onClose}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </SheetClose>
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
                <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-semibold", rec.cls)}>
                  <span className={cn("h-1.5 w-1.5 rounded-full", rec.dot)} />{rec.label}
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

            {/* 2 — Feasibility */}
            <SectionShell n={2} id="feasibility" title="Feasibility" hidden={!specified(readiness) && !specified(ex.timeline)}>
              <div className="space-y-3">
                <Reading label="Implementation readiness" text={readiness} />
                {specified(ex.timeline) && (
                  <div className="grid gap-2.5 sm:grid-cols-2">
                    <Tile icon={<CalendarClock className="h-3 w-3" />} label="Implementation timeline" value={ex.timeline} mono />
                  </div>
                )}
              </div>
            </SectionShell>

            {/* 3 — Impact */}
            <SectionShell n={3} id="impact" title="Impact" hidden={!specified(beneficiary)}>
              <Reading label="Direct beneficiaries" text={beneficiary} />
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

            {/* 5 — Financial */}
            <SectionShell n={5} id="financial" title="Financial" hidden={!specified(ex.estimated_cost) && !specified(ex.applicant_contribution)}>
              <div className="grid gap-2.5 sm:grid-cols-2">
                <Tile icon={<IndianRupee className="h-3 w-3" />} label="Funding ask" value={ex.estimated_cost} mono />
                <Tile icon={<Wallet className="h-3 w-3" />} label="Applicant contribution" value={ex.applicant_contribution} mono />
              </div>
            </SectionShell>

            {/* 6 — The Ask */}
            <SectionShell n={6} id="ask" title="The ask" hidden={!specified(partnership) && !d.category}>
              <div className="space-y-3">
                <div className="grid gap-2.5 sm:grid-cols-2">
                  <Tile icon={<Landmark className="h-3 w-3" />} label="Portfolio" value={CATEGORY_LABEL[d.category ?? ""] ?? d.category ?? null} />
                </div>
                <Reading label="Partnership model" text={partnership} />
              </div>
            </SectionShell>

            {/* 7 — Track Record */}
            <SectionShell n={7} id="track" title="Applicant track record" hidden={!specified(track)}>
              <Reading label="Prior deployments (as stated in the proposal)" text={track} />
            </SectionShell>

            {/* 8 — Documents */}
            <SectionShell n={8} id="documents" title="Attached documents">
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

            {decided && d.decision_note && (
              <div className="rounded-lg border border-border bg-secondary/60 px-3.5 py-3 text-[13.5px]">
                <span className="font-semibold">Decision note:</span> {d.decision_note}
                {d.reviewed_by && <div className="mt-0.5 text-[11.5px] text-muted-foreground">— {d.reviewed_by}, {fmtDate(d.reviewed_at)}</div>}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Sticky decision bar — hidden in read-only mode. */}
      {!readOnly && setNote && onDecide && (
        <div className="shrink-0 space-y-2.5 border-t border-border bg-card px-5 py-4 sm:px-7">
          {decided && (
            <div className="flex items-center gap-1.5 text-[12.5px] font-medium text-muted-foreground">
              <Check className="h-3.5 w-3.5 text-emerald-600" />
              Already {st.label.toLowerCase()} — you can change the decision below.
            </div>
          )}
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Decision note (required to reject or request clarification)…"
            className="min-h-[60px] resize-none text-sm"
          />
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <Button disabled={deciding} onClick={() => onDecide("approved")}
              className="bg-emerald-600 text-white hover:bg-emerald-700 !bg-none">
              {deciding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Approve proposal
            </Button>
            <Button disabled={deciding} variant="outline" onClick={() => onDecide("needs_clarification")}
              className="border-orange-300 text-orange-700 hover:bg-orange-50">
              <HelpCircle className="h-4 w-4" /> Request clarification
            </Button>
            <Button disabled={deciding} variant="outline" onClick={() => onDecide("rejected")}
              className="border-red-300 text-red-700 hover:bg-red-50">
              <X className="h-4 w-4" /> Reject
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
