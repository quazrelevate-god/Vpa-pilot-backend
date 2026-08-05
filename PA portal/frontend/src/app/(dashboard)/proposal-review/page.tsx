"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Lightbulb, FileText, Check, X, HelpCircle, Building2,
  IndianRupee, CalendarClock, Users, Sparkles, AlertTriangle, Loader2, Inbox, ShieldAlert,
  ArrowLeft, ListChecks, LayoutGrid, User, Mail, Phone,
} from "lucide-react";

import TopBar from "@/components/TopBar";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { InlineAttachmentPreview } from "@/components/ui/inline-attachment-preview";
import type { GalleryAttachment } from "@/components/ui/attachment-gallery";
import { useLang } from "@/lib/lang-context";
import { cn } from "@/lib/utils";
import { fetchMe, type SessionUser } from "@/app/(dashboard)/settings/_lib/adminApi";
import {
  listProposals, getProposal, decideProposal,
  type ProposalListItem, type ProposalListResponse, type ProposalDetail,
  type ProposalBrief, type Decision,
} from "./_lib/proposalApi";

// ── display maps ────────────────────────────────────────────────────────────
const CATEGORY_LABEL: Record<string, string> = {
  school: "School Education", tamil: "Tamil & Heritage",
  information: "Information & Publicity", film: "Film",
};

const STATUS_META: Record<string, { label: string; cls: string }> = {
  QUEUED:              { label: "Queued",          cls: "bg-slate-100 text-slate-600" },
  PROCESSING:          { label: "Reading…",        cls: "bg-sky-100 text-sky-700" },
  AWAITING_REVIEW:     { label: "Awaiting review", cls: "bg-amber-100 text-amber-800" },
  FAILED:              { label: "Failed",          cls: "bg-red-100 text-red-700" },
  APPROVED:            { label: "Approved",        cls: "bg-emerald-100 text-emerald-700" },
  REJECTED:            { label: "Rejected",        cls: "bg-red-100 text-red-700" },
  NEEDS_CLARIFICATION: { label: "Needs info",      cls: "bg-orange-100 text-orange-800" },
};

const REC_META: Record<string, { label: string; cls: string; dot: string }> = {
  review_closely:  { label: "Review closely",  cls: "border-violet-300 bg-violet-50 text-violet-700", dot: "bg-violet-500" },
  standard:        { label: "Standard",        cls: "border-slate-300 bg-slate-50 text-slate-600",   dot: "bg-slate-400" },
  needs_more_info: { label: "Needs more info", cls: "border-amber-300 bg-amber-50 text-amber-700",   dot: "bg-amber-500" },
};

const TABS: { key: string; label: string }[] = [
  { key: "AWAITING_REVIEW", label: "Awaiting" },
  { key: "APPROVED", label: "Approved" },
  { key: "REJECTED", label: "Rejected" },
  { key: "NEEDS_CLARIFICATION", label: "Needs info" },
  { key: "", label: "All" },
];

const DETAIL_TABS = [
  { key: "overview",   label: "Overview",   icon: LayoutGrid },
  { key: "highlights", label: "Highlights", icon: ListChecks },
  { key: "document",   label: "Document",   icon: FileText },
] as const;
type DetailTabKey = (typeof DETAIL_TABS)[number]["key"];

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }); }
  catch { return "—"; }
}

/** A field the AI leaves as "Not specified" (or empty) is not a real value. */
function specified(v?: string | null): boolean {
  const s = (v || "").trim();
  return !!s && s.toLowerCase() !== "not specified";
}

/** Map review documents ({filename,url,mime}) → the inline previewer's shape. */
function toAttachments(docs: { filename: string | null; url: string | null; mime: string | null }[]): GalleryAttachment[] {
  return (docs || [])
    .filter((d) => !!d.url)
    .map((d) => ({
      name: d.filename || "document",
      url: d.url as string,
      type: (d.mime || "").startsWith("image/") ? "IMAGE" : "DOCUMENT",
      mime: d.mime || undefined,
    }));
}

type Gate =
  | { kind: "loading" }
  | { kind: "denied"; me: SessionUser | null }
  | { kind: "ok"; me: SessionUser };

export default function ProposalReviewPage() {
  const router = useRouter();
  const { t, lang } = useLang();
  const [gate, setGate] = useState<Gate>({ kind: "loading" });

  const [tab, setTab] = useState<string>("AWAITING_REVIEW");
  const [data, setData] = useState<ProposalListResponse | null>(null);
  const [loading, setLoading] = useState(true);

  // Master–detail: the selected id drives the right pane. No modal / no sheet —
  // the detail is an in-layout section (full-width with a back arrow on mobile).
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<ProposalDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailTab, setDetailTab] = useState<DetailTabKey>("overview");
  const [note, setNote] = useState("");
  const [deciding, setDeciding] = useState(false);

  // pick EN / TA per dashboard language
  const L = useCallback((en?: string, ta?: string) => (lang === "ta" && ta ? ta : en) || "", [lang]);

  // ── gate ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    const ac = new AbortController();
    (async () => {
      try {
        const me = await fetchMe(ac.signal);
        if (!me) { router.replace("/login"); return; }
        if (me.role !== "super_admin") { setGate({ kind: "denied", me }); return; }
        setGate({ kind: "ok", me });
      } catch {
        if (!ac.signal.aborted) setGate({ kind: "denied", me: null });
      }
    })();
    return () => ac.abort();
  }, [router]);

  // ── list fetch (+ light polling to catch extractions finishing) ────────────
  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const res = await listProposals(tab || undefined, 100, 0);
      if (!signal?.aborted) { setData(res); setLoading(false); }
    } catch (e) {
      if (!signal?.aborted) { setLoading(false); toast.error((e as Error).message); }
    }
  }, [tab]);

  useEffect(() => {
    if (gate.kind !== "ok") return;
    setLoading(true);
    const ac = new AbortController();
    load(ac.signal);
    const iv = setInterval(() => load(ac.signal), 10000);
    return () => { ac.abort(); clearInterval(iv); };
  }, [gate.kind, load]);

  // Changing the status tab clears any selection whose row is no longer listed.
  useEffect(() => { setSelectedId(null); }, [tab]);

  // On desktop, open the first proposal automatically so the Minister lands on
  // content, not an empty pane. On mobile we stay on the list (a selection there
  // takes over the screen), so the auto-open is gated to wide viewports.
  useEffect(() => {
    if (selectedId != null || !data?.items?.length) return;
    if (typeof window !== "undefined" && window.matchMedia("(min-width: 1024px)").matches) {
      setSelectedId(data.items[0].id);
    }
  }, [data, selectedId]);

  // ── detail fetch when the selection changes ────────────────────────────────
  useEffect(() => {
    if (selectedId == null) { setDetail(null); return; }
    let alive = true;
    setDetailLoading(true);
    setDetailTab("overview");
    setNote("");
    (async () => {
      try {
        const det = await getProposal(selectedId);
        if (alive) setDetail(det);
      } catch (e) {
        if (alive) { toast.error((e as Error).message); setDetail(null); }
      } finally {
        if (alive) setDetailLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [selectedId]);

  const counts = data?.counts || {};
  const countFor = (key: string) =>
    key === "" ? Object.values(counts).reduce((a, b) => a + b, 0) : (counts[key] || 0);

  const decide = async (decision: Decision) => {
    if (!detail) return;
    if ((decision === "rejected" || decision === "needs_clarification") && !note.trim()) {
      toast.error("Please add a short note for this decision.");
      return;
    }
    setDeciding(true);
    try {
      const updated = await decideProposal(detail.id, decision, note.trim() || undefined);
      setDetail(updated);
      toast.success(
        decision === "approved" ? "Proposal approved." :
        decision === "rejected" ? "Proposal rejected." : "Clarification requested."
      );
      load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setDeciding(false);
    }
  };

  // ── render ──────────────────────────────────────────────────────────────────
  return (
    <div className="flex h-full flex-1 flex-col overflow-hidden">
      <TopBar
        title={t("nav.proposalReview")}
        subtitle="Proposals to the Hon'ble Minister — the pitch, the numbers, decide"
        icon={<Lightbulb className="h-4 w-4" />}
      />

      <main className="flex-1 overflow-hidden px-4 py-4 sm:px-6 sm:py-5">
        {gate.kind === "loading" && (
          <div className="mx-auto max-w-[1440px]"><ListSkeleton /></div>
        )}
        {gate.kind === "denied" && (
          <div className="mx-auto max-w-3xl pt-10"><NotAuthorized me={gate.me} /></div>
        )}
        {gate.kind === "ok" && (
          <div className="mx-auto flex h-full max-w-[1440px] flex-col gap-4">
            {/* status tabs */}
            <div className="flex flex-wrap gap-1.5 rounded-xl bg-card p-1 shadow-card">
              {TABS.map((tb) => {
                const active = tab === tb.key;
                return (
                  <button
                    key={tb.key || "all"}
                    onClick={() => setTab(tb.key)}
                    className={cn(
                      "relative inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors",
                      active ? "bg-brand text-white shadow-sm" : "text-muted-foreground hover:bg-accent"
                    )}
                  >
                    {tb.label}
                    <span className={cn(
                      "num rounded-full px-1.5 py-0.5 text-[11px]",
                      active ? "bg-white/20 text-white" : "bg-muted text-muted-foreground"
                    )}>{countFor(tb.key)}</span>
                  </button>
                );
              })}
            </div>

            {/* master–detail */}
            <div className="grid min-h-0 flex-1 gap-5 lg:grid-cols-[minmax(340px,380px)_1fr]">
              {/* list (hidden on mobile once a proposal is open) */}
              <div className={cn(
                "min-h-0 flex-col gap-3 overflow-y-auto pr-0.5",
                selectedId != null ? "hidden lg:flex" : "flex",
              )}>
                {loading && !data ? (
                  <ListSkeleton />
                ) : !data || data.items.length === 0 ? (
                  <EmptyState />
                ) : (
                  data.items.map((p) => (
                    <ProposalCard
                      key={p.id} p={p}
                      selected={selectedId === p.id}
                      onOpen={() => setSelectedId(p.id)}
                    />
                  ))
                )}
              </div>

              {/* detail (hidden on mobile until a proposal is open) */}
              <div className={cn(
                "min-h-0 overflow-hidden rounded-lg border border-border bg-card shadow-card",
                selectedId == null ? "hidden lg:block" : "block",
              )}>
                {selectedId == null ? (
                  <DetailEmpty />
                ) : detailLoading && !detail?.extraction ? (
                  <DetailSkeleton />
                ) : detail ? (
                  <DetailSection
                    d={detail} L={L} ta={lang === "ta"}
                    tab={detailTab} setTab={setDetailTab}
                    note={note} setNote={setNote}
                    deciding={deciding} onDecide={decide}
                    onBack={() => setSelectedId(null)}
                  />
                ) : (
                  <DetailEmpty />
                )}
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

// ── elevator-pitch card ───────────────────────────────────────────────────────
function ProposalCard({ p, selected, onOpen }: {
  p: ProposalListItem; selected: boolean; onOpen: () => void;
}) {
  const rec = p.ai_recommendation ? REC_META[p.ai_recommendation] : null;
  const st = STATUS_META[p.status] || { label: p.status, cls: "bg-slate-100 text-slate-600" };
  return (
    <button
      onClick={onOpen}
      aria-pressed={selected}
      className={cn(
        "w-full shrink-0 rounded-lg border bg-card p-4 text-left shadow-card transition-all",
        "hover:-translate-y-0.5 hover:shadow-card-md focus:outline-none focus-visible:ring-2 focus-visible:ring-brand",
        selected
          ? "border-brand/50 shadow-[inset_3px_0_0_hsl(var(--accent-blue)),0_1px_3px_rgba(0,0,0,0.06)]"
          : "border-border",
      )}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        {rec ? (
          <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-semibold", rec.cls)}>
            <span className={cn("h-1.5 w-1.5 rounded-full", rec.dot)} />{rec.label}
          </span>
        ) : <span />}
        <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold", st.cls)}>{st.label}</span>
      </div>

      <h3 className="font-serif text-[17px] font-semibold leading-snug text-foreground line-clamp-2">
        {p.title || "Untitled proposal"}
      </h3>

      <div className="mt-1.5 flex items-center gap-1.5 text-[12.5px] text-muted-foreground">
        <Building2 className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">{p.org_name || p.person_name || "Unattributed"}</span>
      </div>

      <div className="mt-3 flex items-center justify-between border-t border-border pt-2.5 text-[11px] text-muted-foreground">
        {p.category && (
          <span className="rounded bg-secondary px-1.5 py-0.5 font-medium text-secondary-foreground">
            {CATEGORY_LABEL[p.category] || p.category}
          </span>
        )}
        <span className="num ml-auto">{fmtDate(p.created_at)}</span>
      </div>
    </button>
  );
}

// ── detail section (inline, not a pop-out) ────────────────────────────────────
function Stat({ icon, label, value, mono = false }: {
  icon: ReactNode; label: string; value?: string; mono?: boolean;
}) {
  const ok = specified(value);
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-lg border border-border bg-background/60 px-4 py-3">
      <div className="flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
        {icon}{label}
      </div>
      <div className={cn(
        "text-[14px] font-semibold leading-snug",
        mono && ok && "num",
        ok ? "text-foreground" : "text-muted-foreground/45 font-normal italic",
        !mono && "line-clamp-2",
      )}>
        {ok ? value : "Not specified"}
      </div>
    </div>
  );
}

function Reading({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section>
      <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.09em] text-muted-foreground">{label}</div>
      <p className="font-serif text-[15px] leading-[1.75] text-foreground/90">{children}</p>
    </section>
  );
}

function DetailSection({
  d, L, ta, tab, setTab, note, setNote, deciding, onDecide, onBack,
}: {
  d: ProposalDetail; L: (en?: string, ta?: string) => string; ta: boolean;
  tab: DetailTabKey; setTab: (k: DetailTabKey) => void;
  note: string; setNote: (v: string) => void;
  deciding: boolean; onDecide: (dec: Decision) => void; onBack: () => void;
}) {
  const ex: ProposalBrief = d.extraction || {};
  const rec = ex.ai_recommendation ? REC_META[ex.ai_recommendation] : null;
  const st = STATUS_META[d.status] || { label: d.status, cls: "bg-slate-100 text-slate-600" };
  const decided = ["APPROVED", "REJECTED", "NEEDS_CLARIFICATION"].includes(d.status);
  const hl = (ta && ex.key_highlights_ta?.length ? ex.key_highlights_ta : ex.key_highlights) || [];
  const docs = d.documents || [];
  const docAtts = toAttachments(docs);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* hero */}
      <div className="shrink-0 border-b border-border px-5 py-4 sm:px-7 sm:py-5">
        <div className="mb-2 flex items-center gap-2">
          <button onClick={onBack} aria-label="Back to list"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground lg:hidden">
            <ArrowLeft className="h-4 w-4" />
          </button>
          {d.category && (
            <Badge variant="outline" className="border-border bg-secondary text-[11px] text-secondary-foreground">
              {CATEGORY_LABEL[d.category] || d.category}
            </Badge>
          )}
          <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", st.cls)}>{st.label}</span>
          <span className="num ml-auto shrink-0 text-[11.5px] text-muted-foreground">{d.tracking_ref}</span>
        </div>

        <h2 className="font-serif text-[22px] font-semibold leading-tight text-foreground sm:text-[26px]">
          {L(ex.title, ex.title_ta) || d.title || "Untitled proposal"}
        </h2>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <Building2 className="h-3.5 w-3.5" />{d.org_name || "Unattributed"}
          </span>
          {(d.person_name || d.designation) && (
            <span className="inline-flex items-center gap-1.5">
              <User className="h-3.5 w-3.5" />{[d.person_name, d.designation].filter(Boolean).join(" · ")}
            </span>
          )}
          <span className="num">{fmtDate(d.created_at)}</span>
        </div>
      </div>

      {/* scroll body */}
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5 sm:px-7">
        {d.status === "FAILED" && (
          <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-700">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>AI extraction failed for this proposal. {d.error_message}</span>
          </div>
        )}

        {/* numbers band — always on, the at-a-glance figures */}
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
          <Stat icon={<IndianRupee className="h-3 w-3" />} label="Cost / ask" value={ex.estimated_cost} mono />
          <Stat icon={<CalendarClock className="h-3 w-3" />} label="Timeline" value={ex.timeline} mono />
          <Stat icon={<Users className="h-3 w-3" />} label="Beneficiaries" value={L(ex.beneficiary_scope, ex.beneficiary_scope_ta)} />
        </div>

        {/* AI read */}
        {rec && (
          <div className={cn("rounded-lg border px-4 py-3", rec.cls)}>
            <div className="flex items-center gap-1.5 text-[12.5px] font-semibold">
              <Sparkles className="h-3.5 w-3.5" /> AI read — {rec.label}
            </div>
            {ex.ai_rationale && <p className="mt-1 text-[13px] leading-relaxed opacity-90">{ex.ai_rationale}</p>}
          </div>
        )}

        {/* in-section tabs (not a pop-out) */}
        <div className="flex gap-1 border-b border-border">
          {DETAIL_TABS.map((dt) => {
            const active = tab === dt.key;
            const Icon = dt.icon;
            const count = dt.key === "highlights" ? hl.length : dt.key === "document" ? docs.length : undefined;
            return (
              <button
                key={dt.key}
                onClick={() => setTab(dt.key)}
                className={cn(
                  "-mb-px inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-[13px] font-semibold transition-colors",
                  active
                    ? "border-brand text-brand"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className="h-3.5 w-3.5" />{dt.label}
                {count != null && count > 0 && (
                  <span className={cn("num rounded-full px-1.5 text-[10.5px]", active ? "bg-brand/10 text-brand" : "bg-muted text-muted-foreground")}>{count}</span>
                )}
              </button>
            );
          })}
        </div>

        {/* tab bodies */}
        {tab === "overview" && (
          <div className="space-y-5">
            {specified(L(ex.problem_statement, ex.problem_statement_ta)) && (
              <Reading label="The problem">{L(ex.problem_statement, ex.problem_statement_ta)}</Reading>
            )}
            {specified(L(ex.proposed_solution, ex.proposed_solution_ta)) && (
              <Reading label="What they propose">{L(ex.proposed_solution, ex.proposed_solution_ta)}</Reading>
            )}
            {specified(L(ex.expected_benefit, ex.expected_benefit_ta)) && (
              <Reading label="Expected benefit">{L(ex.expected_benefit, ex.expected_benefit_ta)}</Reading>
            )}
            {!specified(L(ex.problem_statement, ex.problem_statement_ta))
              && !specified(L(ex.proposed_solution, ex.proposed_solution_ta))
              && !specified(L(ex.expected_benefit, ex.expected_benefit_ta)) && (
              <p className="text-[13px] text-muted-foreground">No narrative was extracted for this proposal.</p>
            )}
          </div>
        )}

        {tab === "highlights" && (
          hl.length > 0 ? (
            <ul className="space-y-2.5">
              {hl.map((h, i) => (
                <li key={i} className="flex gap-3">
                  <span className="num mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-brand/10 text-[11px] font-bold text-brand">{i + 1}</span>
                  <span className="text-[14px] leading-relaxed text-foreground/90">{h}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[13px] text-muted-foreground">No key highlights were extracted.</p>
          )
        )}

        {tab === "document" && (
          <div className="space-y-4">
            <div>
              <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.09em] text-muted-foreground">Source document</div>
              {docAtts.length > 0 ? (
                <div className="h-[460px]">
                  <InlineAttachmentPreview attachments={docAtts} defaultOpenFirst />
                </div>
              ) : (
                <span className="text-[13px] text-muted-foreground">None attached.</span>
              )}
            </div>
            <div>
              <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.09em] text-muted-foreground">Contact</div>
              <div className="space-y-1.5 text-[13px] text-foreground">
                <div className="flex items-center gap-2"><Mail className="h-3.5 w-3.5 text-muted-foreground" /><span className="truncate">{d.email || "—"}</span></div>
                <div className="flex items-center gap-2"><Phone className="h-3.5 w-3.5 text-muted-foreground" /><span className="num">{d.phone || "—"}</span></div>
              </div>
            </div>
          </div>
        )}

        {decided && d.decision_note && (
          <div className="rounded-lg border border-border bg-secondary/60 px-3.5 py-3 text-[13px]">
            <span className="font-semibold">Decision note:</span> {d.decision_note}
            {d.reviewed_by && <div className="mt-0.5 text-[11.5px] text-muted-foreground">— {d.reviewed_by}, {fmtDate(d.reviewed_at)}</div>}
          </div>
        )}
      </div>

      {/* decision bar — pinned */}
      <div className="shrink-0 space-y-2.5 border-t border-border bg-card px-5 py-4 sm:px-7">
        {decided && (
          <div className="flex items-center gap-1.5 text-[12.5px] font-medium text-muted-foreground">
            <Check className="h-3.5 w-3.5 text-emerald-600" />
            Already {STATUS_META[d.status]?.label.toLowerCase()} — you can change the decision below.
          </div>
        )}
        <Textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Decision note (required to reject or request clarification)…"
          className="min-h-[60px] resize-none text-sm"
        />
        <div className="grid grid-cols-3 gap-2">
          <Button disabled={deciding} onClick={() => onDecide("approved")}
            className="bg-emerald-600 text-white hover:bg-emerald-700 !bg-none">
            {deciding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Approve
          </Button>
          <Button disabled={deciding} variant="outline" onClick={() => onDecide("needs_clarification")}
            className="border-orange-300 text-orange-700 hover:bg-orange-50">
            <HelpCircle className="h-4 w-4" /> Ask info
          </Button>
          <Button disabled={deciding} variant="outline" onClick={() => onDecide("rejected")}
            className="border-red-300 text-red-700 hover:bg-red-50">
            <X className="h-4 w-4" /> Reject
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── states ────────────────────────────────────────────────────────────────────
function ListSkeleton() {
  return (
    <div className="flex flex-col gap-3">
      {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-[104px] shrink-0 rounded-lg" />)}
    </div>
  );
}
function DetailSkeleton() {
  return (
    <div className="space-y-4 p-6">
      <Skeleton className="h-7 w-3/4" />
      <Skeleton className="h-4 w-1/2" />
      <div className="grid grid-cols-3 gap-2.5 pt-2">
        <Skeleton className="h-16" /><Skeleton className="h-16" /><Skeleton className="h-16" />
      </div>
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-20 w-full" />
    </div>
  );
}
function DetailEmpty() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-6 py-16 text-center">
      <Lightbulb className="h-8 w-8 text-muted-foreground/40" />
      <p className="text-sm font-medium text-foreground">Select a proposal</p>
      <p className="max-w-xs text-[13px] text-muted-foreground">Pick a proposal on the left to read its pitch, see the numbers, and decide.</p>
    </div>
  );
}
function EmptyState() {
  return (
    <Card className="flex flex-col items-center justify-center gap-2 py-16 text-center shadow-card">
      <Inbox className="h-8 w-8 text-muted-foreground" />
      <p className="text-sm font-medium text-foreground">No proposals here yet</p>
      <p className="text-[13px] text-muted-foreground">Submissions from the public /proposal site will appear once their brief is ready.</p>
    </Card>
  );
}
function NotAuthorized({ me }: { me: SessionUser | null }) {
  return (
    <Card className="flex flex-col items-center justify-center gap-2 py-16 text-center shadow-card">
      <ShieldAlert className="h-8 w-8 text-muted-foreground" />
      <p className="text-sm font-medium text-foreground">Proposal Review is for super administrators</p>
      <p className="text-[13px] text-muted-foreground">
        {me ? `You're signed in as ${me.full_name || me.login_name} (${me.role}).` : "Please sign in with an admin account."}
      </p>
    </Card>
  );
}
