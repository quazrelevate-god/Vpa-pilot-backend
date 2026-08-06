"use client";

import {
  useCallback, useEffect, useMemo, useRef, useState, type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Lightbulb, Check, X, HelpCircle, Building2, IndianRupee, CalendarClock, Users,
  Sparkles, AlertTriangle, Loader2, Inbox, ShieldAlert, User, Search,
  Download, MapPin, Briefcase, Landmark,
  Wallet, Wrench, ShieldAlert as RiskIcon, Award, FolderOpen,
} from "lucide-react";

import TopBar from "@/components/TopBar";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Sheet, SheetContent, SheetClose, SheetTitle } from "@/components/ui/sheet";
import { InlineAttachmentPreview } from "@/components/ui/inline-attachment-preview";
import type { GalleryAttachment } from "@/components/ui/attachment-gallery";
import { useLang } from "@/lib/lang-context";
import { cn } from "@/lib/utils";
import { fetchMe, type SessionUser } from "@/app/(dashboard)/settings/_lib/adminApi";
import {
  listProposals, getProposal, decideProposal,
  type ProposalListItem, type ProposalListResponse, type ProposalDetail,
  type ProposalBrief, type ProposalDoc, type Decision,
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
  review_closely:  { label: "Review closely",      cls: "border-violet-300 bg-violet-50 text-violet-700",   dot: "bg-violet-500"  },
  standard:        { label: "Ready to review",     cls: "border-emerald-300 bg-emerald-50 text-emerald-700", dot: "bg-emerald-500" },
  needs_more_info: { label: "Needs clarification", cls: "border-amber-300 bg-amber-50 text-amber-700",     dot: "bg-amber-500"   },
};

const TABS: { key: string; label: string }[] = [
  { key: "AWAITING_REVIEW", label: "Awaiting" },
  { key: "APPROVED", label: "Approved" },
  { key: "REJECTED", label: "Rejected" },
  { key: "NEEDS_CLARIFICATION", label: "Needs info" },
  { key: "", label: "All" },
];

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }); }
  catch { return "—"; }
}
function daysSince(iso: string | null): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((Date.now() - t) / 86_400_000));
}
/** A field the AI leaves as "Not specified" (or empty) is not a real value. */
function specified(v?: string | null): boolean {
  const s = (v || "").trim();
  return !!s && s.toLowerCase() !== "not specified";
}

/** Map ProposalDoc → the shared preview component's shape. Images render with
 *  the zoom/pan viewer; PDFs render inline (iframe with #toolbar=0). */
function toAttachments(docs: ProposalDoc[] | undefined): GalleryAttachment[] {
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
  const [q, setQ] = useState("");
  const [data, setData] = useState<ProposalListResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<ProposalDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [note, setNote] = useState("");
  const [deciding, setDeciding] = useState(false);

  // Pick English / Tamil per the active language, gracefully fall back to whichever
  // has content — Tamil extraction may be empty for older proposals.
  const L = useCallback((en?: string, ta?: string) => {
    if (lang === "ta" && ta && ta.trim()) return ta;
    return (en || ta || "").trim();
  }, [lang]);

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

  // Deep-link support: /proposal-review?id=42 auto-opens that proposal. Used
  // by the dashboard row-click and the ai-review "Open in workflow" button so
  // the reviewer lands on the specific proposal, not the list. Reads
  // window.location once (avoids the Next 15 useSearchParams Suspense dance)
  // and pushes to state so the drawer opens via the standard selectedId path.
  useEffect(() => {
    if (gate.kind !== "ok") return;
    if (typeof window === "undefined") return;
    const p = new URLSearchParams(window.location.search);
    const raw = p.get("id");
    const id = raw ? Number(raw) : NaN;
    if (Number.isFinite(id)) setSelectedId(id);
  }, [gate.kind]);

  const filtered = useMemo(() => {
    const items = data?.items ?? [];
    const needle = q.trim().toLowerCase();
    if (!needle) return items;
    return items.filter((p) =>
      (p.title || "").toLowerCase().includes(needle) ||
      (p.org_name || "").toLowerCase().includes(needle) ||
      (p.person_name || "").toLowerCase().includes(needle) ||
      (p.tracking_ref || "").toLowerCase().includes(needle),
    );
  }, [data, q]);

  useEffect(() => {
    if (selectedId == null) { setDetail(null); return; }
    let alive = true;
    setDetailLoading(true);
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

  const doExport = () => {
    const rows = filtered;
    const headers = ["Tracking Ref", "Title", "Submitter", "Category", "Status", "AI", "Submitted"];
    const lines = rows.map((p) => [
      p.tracking_ref, p.title ?? "", p.org_name ?? p.person_name ?? "",
      CATEGORY_LABEL[p.category ?? ""] ?? p.category ?? "",
      STATUS_META[p.status]?.label ?? p.status,
      p.ai_recommendation ?? "", p.created_at ?? "",
    ]);
    const csv = [headers, ...lines].map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = "data:text/csv;charset=utf-8," + encodeURIComponent(csv);
    a.download = `proposals_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    toast.success(`${rows.length} proposal(s) exported.`);
  };

  return (
    <div className="flex h-full flex-1 flex-col overflow-hidden">
      <TopBar
        title={t("nav.proposalReview")}
        subtitle="Proposals to the Hon'ble Minister — read the pitch, look at the document, decide."
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
            <div className="flex flex-wrap items-center gap-3">
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

              <div className="relative min-w-[220px] max-w-md flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Search title, submitter, or tracking ref…"
                  className="h-9 pl-9"
                />
              </div>

              <div className="ml-auto">
                <Button variant="outline" size="sm" onClick={doExport}>
                  <Download className="h-4 w-4" /> Export
                </Button>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto">
              {loading && !data ? (
                <ListSkeleton />
              ) : filtered.length === 0 ? (
                <EmptyState />
              ) : (
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {filtered.map((p) => (
                    <ProposalCard
                      key={p.id} p={p}
                      selected={selectedId === p.id}
                      onOpen={() => setSelectedId(p.id)}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </main>

      {/* Wide right-slide drawer — 92vw on lg+, full-width on mobile.
          Two panes: document preview LEFT (always visible), reading right. */}
      <Sheet open={selectedId != null} onOpenChange={(o) => { if (!o) setSelectedId(null); }}>
        <SheetContent
          side="right"
          hideClose
          className="flex w-full flex-col gap-0 p-0 sm:max-w-[95vw] lg:max-w-[92vw]"
        >
          {selectedId == null ? null : detailLoading && !detail ? (
            <DetailSkeleton />
          ) : detail ? (
            <DetailPane
              d={detail} L={L} ta={lang === "ta"}
              note={note} setNote={setNote}
              deciding={deciding}
              onDecide={decide}
              onClose={() => setSelectedId(null)}
            />
          ) : (
            <DetailEmpty />
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

// ── list card ────────────────────────────────────────────────────────────────
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

// ── shared tile: renders only if value is real (never a "Not provided" placeholder) ─
function Tile({ icon, label, value, mono = false }: {
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

/** Serif reading block for narrative fields. Renders nothing if the value is
 *  empty/"Not specified" — no placeholder theater. */
function Reading({ label, text }: { label: string; text: string }) {
  if (!specified(text)) return null;
  return (
    <div className="rounded-lg border border-border bg-background/60 p-4">
      <div className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{label}</div>
      <p className="font-serif text-[15px] leading-[1.75] text-foreground/90">{text}</p>
    </div>
  );
}

/** Numbered section shell. `hidden` suppresses the whole section when empty. */
function SectionShell({
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

// ── detail pane ──────────────────────────────────────────────────────────────
function DetailPane({
  d, L, ta, note, setNote, deciding, onDecide, onClose,
}: {
  d: ProposalDetail;
  L: (en?: string, ta?: string) => string;
  ta: boolean;
  note: string; setNote: (v: string) => void;
  deciding: boolean;
  onDecide: (dec: Decision) => void;
  onClose: () => void;
}) {
  const ex: ProposalBrief = d.extraction || {};
  const rec = ex.ai_recommendation ? REC_META[ex.ai_recommendation] : null;
  const st = STATUS_META[d.status] || { label: d.status, cls: "bg-slate-100 text-slate-600" };
  const decided = ["APPROVED", "REJECTED", "NEEDS_CLARIFICATION"].includes(d.status);
  const days = daysSince(d.created_at);

  // Executive-brief resolved strings (lang-aware).
  const problem     = L(ex.problem_statement,   ex.problem_statement_ta);
  const solution    = L(ex.proposed_solution,   ex.proposed_solution_ta);
  const benefit     = L(ex.expected_benefit,    ex.expected_benefit_ta);
  const beneficiary = L(ex.beneficiary_scope,   ex.beneficiary_scope_ta);
  const readiness   = L(ex.implementation_readiness, ex.implementation_readiness_ta);
  const partnership = L(ex.partnership_model,   ex.partnership_model_ta);
  const track       = L(ex.track_record,        ex.track_record_ta);
  const risks       = (ta && ex.key_risks_ta?.length ? ex.key_risks_ta : ex.key_risks) || [];
  const highlights  = (ta && ex.key_highlights_ta?.length ? ex.key_highlights_ta : ex.key_highlights) || [];

  // Gap list — shown only when the AI actually flagged something incomplete.
  const gaps: string[] = [];
  if (!specified(problem))                gaps.push("Problem statement not described");
  if (!specified(solution))               gaps.push("Proposed solution not detailed");
  if (!specified(ex.estimated_cost))      gaps.push("Funding ask (₹) not specified");
  if (!specified(ex.timeline))            gaps.push("Implementation timeline missing");
  if (!specified(beneficiary))            gaps.push("Beneficiary scope not quantified");

  // Documents → InlineAttachmentPreview shape.
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

      {/* Body — 2 panes on lg+: preview LEFT, reading RIGHT */}
      <div className="min-h-0 flex-1 overflow-hidden">
        <div className="grid h-full min-h-0 grid-cols-1 lg:grid-cols-[minmax(0,45%)_1fr]">
          {/* LEFT: always-visible document preview */}
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

          {/* RIGHT: numbered reading sections */}
          <div className="min-h-0 space-y-5 overflow-y-auto px-5 py-5 sm:px-6">
            {d.status === "FAILED" && (
              <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-700">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>AI extraction failed for this proposal. {d.error_message}</span>
              </div>
            )}

            {/* 1 — AI Assessment + Executive Brief (always visible) */}
            <SectionShell
              n={1} id="ai-brief" title="AI Assessment & Executive Brief"
              right={rec ? (
                <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-semibold", rec.cls)}>
                  <span className={cn("h-1.5 w-1.5 rounded-full", rec.dot)} />{rec.label}
                </span>
              ) : undefined}
            >
              {/* AI block */}
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
                      What's missing in this brief
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

              {/* Executive Brief block — renders only the narratives the AI actually filled */}
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

            {/* 2 — Feasibility (readiness) */}
            <SectionShell
              n={2} id="feasibility" title="Feasibility"
              hidden={!specified(readiness) && !specified(ex.timeline)}
            >
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
            <SectionShell
              n={3} id="impact" title="Impact"
              hidden={!specified(beneficiary)}
            >
              <Reading label="Direct beneficiaries" text={beneficiary} />
            </SectionShell>

            {/* 4 — Risk (real key_risks from the extraction) */}
            <SectionShell
              n={4} id="risk" title="Risks"
              hidden={risks.length === 0}
            >
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
            <SectionShell
              n={5} id="financial" title="Financial"
              hidden={!specified(ex.estimated_cost) && !specified(ex.applicant_contribution)}
            >
              <div className="grid gap-2.5 sm:grid-cols-2">
                <Tile icon={<IndianRupee className="h-3 w-3" />} label="Funding ask" value={ex.estimated_cost} mono />
                <Tile icon={<Wallet className="h-3 w-3" />} label="Applicant contribution" value={ex.applicant_contribution} mono />
              </div>
            </SectionShell>

            {/* 6 — The Ask (departments + partnership) */}
            <SectionShell
              n={6} id="ask" title="The ask"
              hidden={!specified(partnership) && !d.category}
            >
              <div className="space-y-3">
                <div className="grid gap-2.5 sm:grid-cols-2">
                  <Tile icon={<Landmark className="h-3 w-3" />} label="Portfolio" value={CATEGORY_LABEL[d.category ?? ""] ?? d.category ?? null} />
                </div>
                <Reading label="Partnership model" text={partnership} />
              </div>
            </SectionShell>

            {/* 7 — Applicant Track Record */}
            <SectionShell
              n={7} id="track" title="Applicant track record"
              hidden={!specified(track)}
            >
              <Reading label="Prior deployments (as stated in the proposal)" text={track} />
            </SectionShell>

            {/* 8 — Documents (always visible — inline preview is on the left; this
                     lists the file(s) so a reviewer can see what's attached and
                     download the original if needed) */}
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

      {/* Sticky decision bar — only three actions that actually work */}
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
    </div>
  );
}

// ── states ────────────────────────────────────────────────────────────────────
function ListSkeleton() {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-[104px] shrink-0 rounded-lg" />)}
    </div>
  );
}
function DetailSkeleton() {
  return (
    <div className="grid h-full grid-cols-1 lg:grid-cols-[minmax(0,45%)_1fr]">
      <div className="border-r border-border bg-muted/25 p-4">
        <Skeleton className="h-full min-h-[400px] w-full rounded-lg" />
      </div>
      <div className="space-y-4 p-6">
        <Skeleton className="h-7 w-3/4" />
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    </div>
  );
}
function DetailEmpty() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-6 py-16 text-center">
      <Lightbulb className="h-8 w-8 text-muted-foreground/40" />
      <p className="text-sm font-medium text-foreground">Select a proposal to open</p>
      <p className="max-w-xs text-[13px] text-muted-foreground">Pick a proposal from the list — the document opens on the left, the summary sections on the right.</p>
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
