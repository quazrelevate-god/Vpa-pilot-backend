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
import { useCallback, useMemo, type ReactNode } from "react";
import {
  Check, Send, Building2, UserRound, Users, MapPin, CalendarClock,
  Loader2, Sparkles, AlertTriangle, Landmark, Target, Flag,
  ShieldAlert as RiskIcon, ScrollText, FolderOpen, X, Download,
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
  AssociationDetail, AssociationBrief, AssociationDoc, AssociationDecision,
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
}

export function AssociationDrawer({
  d, onClose, readOnly = false,
  note = "", setNote,
  deciding = false, onDecide,
}: AssociationDrawerProps) {
  const { lang } = useLang();
  const ta = lang === "ta";
  const L = useCallback((en?: string, taStr?: string) => {
    if (ta && taStr && taStr.trim()) return taStr;
    return (en || taStr || "").trim();
  }, [ta]);

  const ex: AssociationBrief = d.extraction || {};
  const rec = ex.ai_recommendation ? REC_META[ex.ai_recommendation] : null;
  const st = STATUS_META[d.status] || { label: d.status, cls: "bg-slate-100 text-slate-600" };
  const urg = typeof d.urgency === "string" && d.urgency ? URGENCY_META[d.urgency.toLowerCase()] : null;
  const decided = ["REVIEWED", "FORWARDED"].includes(d.status);
  const days = daysSince(d.created_at);

  const ask       = L(ex.association_ask,   ex.association_ask_ta);
  const summary   = L(ex.summary,           ex.summary_ta);
  const demand    = L(ex.demand_context,    ex.demand_context_ta);
  const outcome   = L(ex.expected_outcome,  ex.expected_outcome_ta);
  const precedent = L(ex.precedent_context, ex.precedent_context_ta);
  const rationale = L(ex.ai_rationale,      ex.ai_rationale_ta);

  const keyDetails   = (ta && ex.key_details_ta?.length ? ex.key_details_ta : ex.key_details) || [];
  const stakeholders = (ta && ex.key_stakeholders_ta?.length ? ex.key_stakeholders_ta : ex.key_stakeholders) || [];
  const risks        = (ta && ex.risks_if_ignored_ta?.length ? ex.risks_if_ignored_ta : ex.risks_if_ignored) || [];

  const docAtts = useMemo(() => toAttachments(d.documents), [d.documents]);

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
                <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-semibold", rec.cls)}>
                  <span className={cn("h-1.5 w-1.5 rounded-full", rec.dot)} />{rec.label}
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

            {/* 7 — Documents */}
            <SectionShell n={7} id="documents" title="Attached documents">
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

            {decided && d.decision_note && (
              <div className="rounded-lg border border-border bg-secondary/60 px-3.5 py-3 text-[13.5px]">
                <span className="font-semibold">Decision note:</span> {d.decision_note}
                {d.reviewed_by && <div className="mt-0.5 text-[11.5px] text-muted-foreground">— {d.reviewed_by}, {fmtDate(d.reviewed_at)}</div>}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Sticky decision bar — hidden entirely in read-only mode. */}
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
            placeholder="Decision note (required when forwarding to a department)…"
            className="min-h-[60px] resize-none text-sm"
          />
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Button disabled={deciding} onClick={() => onDecide("reviewed")}
              className="bg-emerald-600 text-white hover:bg-emerald-700 !bg-none">
              {deciding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Mark reviewed
            </Button>
            <Button disabled={deciding} variant="outline" onClick={() => onDecide("forwarded")}
              className="border-sky-300 text-sky-700 hover:bg-sky-50">
              <Send className="h-4 w-4" /> Forward to department
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
