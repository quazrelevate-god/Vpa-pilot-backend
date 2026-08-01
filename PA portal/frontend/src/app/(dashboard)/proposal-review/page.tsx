"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Lightbulb, FileText, ExternalLink, Check, X, HelpCircle, Building2,
  IndianRupee, CalendarClock, Users, Sparkles, AlertTriangle, Loader2, Inbox, ShieldAlert,
} from "lucide-react";

import TopBar from "@/components/TopBar";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
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
  QUEUED:              { label: "Queued",        cls: "bg-slate-100 text-slate-600" },
  PROCESSING:          { label: "Reading…",      cls: "bg-sky-100 text-sky-700" },
  AWAITING_REVIEW:     { label: "Awaiting review", cls: "bg-amber-100 text-amber-800" },
  FAILED:              { label: "Failed",        cls: "bg-red-100 text-red-700" },
  APPROVED:            { label: "Approved",      cls: "bg-emerald-100 text-emerald-700" },
  REJECTED:            { label: "Rejected",      cls: "bg-red-100 text-red-700" },
  NEEDS_CLARIFICATION: { label: "Needs info",    cls: "bg-orange-100 text-orange-800" },
};

const REC_META: Record<string, { label: string; cls: string; dot: string }> = {
  review_closely:  { label: "Review closely", cls: "border-violet-300 bg-violet-50 text-violet-700", dot: "bg-violet-500" },
  standard:        { label: "Standard",       cls: "border-slate-300 bg-slate-50 text-slate-600",   dot: "bg-slate-400" },
  needs_more_info: { label: "Needs more info", cls: "border-amber-300 bg-amber-50 text-amber-700",  dot: "bg-amber-500" },
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

  const [selected, setSelected] = useState<ProposalDetail | null>(null);
  const [sheetLoading, setSheetLoading] = useState(false);
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
      } catch (e) {
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

  const counts = data?.counts || {};
  const countFor = (key: string) =>
    key === "" ? Object.values(counts).reduce((a, b) => a + b, 0) : (counts[key] || 0);

  // ── open detail ─────────────────────────────────────────────────────────────
  const openDetail = async (id: number) => {
    setSheetLoading(true);
    setSelected({ id } as ProposalDetail); // opens the sheet immediately
    setNote("");
    try {
      const det = await getProposal(id);
      setSelected(det);
    } catch (e) {
      toast.error((e as Error).message);
      setSelected(null);
    } finally {
      setSheetLoading(false);
    }
  };

  const decide = async (decision: Decision) => {
    if (!selected) return;
    if ((decision === "rejected" || decision === "needs_clarification") && !note.trim()) {
      toast.error("Please add a short note for this decision.");
      return;
    }
    setDeciding(true);
    try {
      const updated = await decideProposal(selected.id, decision, note.trim() || undefined);
      setSelected(updated);
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
        subtitle="Ideas submitted to the Hon'ble Minister — decide at a glance"
        icon={<Lightbulb className="h-4 w-4" />}
      />

      <main className="flex-1 overflow-y-auto px-6 py-6 sm:px-10 sm:py-8">
        <div className="mx-auto max-w-6xl space-y-6">
          {gate.kind === "loading" && <ListSkeleton />}
          {gate.kind === "denied" && <NotAuthorized me={gate.me} />}
          {gate.kind === "ok" && (
            <>
              {/* tabs */}
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

              {/* list */}
              {loading && !data ? (
                <ListSkeleton />
              ) : !data || data.items.length === 0 ? (
                <EmptyState />
              ) : (
                <div className="grid gap-4 sm:grid-cols-2">
                  {data.items.map((p) => (
                    <ProposalCard key={p.id} p={p} L={L} onOpen={() => openDetail(p.id)} />
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </main>

      {/* detail sheet */}
      <Sheet open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <SheetContent side="right" className="w-full overflow-y-auto p-0 sm:max-w-2xl">
          <SheetTitle className="sr-only">Proposal detail</SheetTitle>
          {sheetLoading && !selected?.extraction ? (
            <DetailSkeleton />
          ) : selected ? (
            <ProposalDetailView
              d={selected} L={L} ta={lang === "ta"} note={note} setNote={setNote}
              deciding={deciding} onDecide={decide}
            />
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}

// ── card ────────────────────────────────────────────────────────────────────
function ProposalCard({ p, L, onOpen }: { p: ProposalListItem; L: (en?: string, ta?: string) => string; onOpen: () => void }) {
  const rec = p.ai_recommendation ? REC_META[p.ai_recommendation] : null;
  const st = STATUS_META[p.status] || { label: p.status, cls: "bg-slate-100 text-slate-600" };
  return (
    <Card
      onClick={onOpen}
      className="group cursor-pointer p-4 shadow-card transition-all hover:-translate-y-0.5 hover:shadow-card-md"
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {p.category && (
            <Badge variant="outline" className="border-border bg-secondary text-[11px] font-medium text-secondary-foreground">
              {CATEGORY_LABEL[p.category] || p.category}
            </Badge>
          )}
          {rec && (
            <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium", rec.cls)}>
              <span className={cn("h-1.5 w-1.5 rounded-full", rec.dot)} />{rec.label}
            </span>
          )}
        </div>
        <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", st.cls)}>{st.label}</span>
      </div>

      <div className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
        <Building2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate">{p.org_name || "—"}</span>
      </div>
      <h3 className="mt-1 line-clamp-2 text-[15px] font-semibold leading-snug text-foreground">
        {p.title || "Untitled proposal"}
      </h3>

      <div className="mt-3 flex items-center justify-between text-[11.5px] text-muted-foreground">
        <span className="num">{p.tracking_ref}</span>
        <span>{fmtDate(p.created_at)}</span>
      </div>
    </Card>
  );
}

// ── detail view ───────────────────────────────────────────────────────────────
function Field({ icon, label, value }: { icon: ReactNode; label: string; value?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card px-3.5 py-3">
      <div className="mb-0.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {icon}{label}
      </div>
      <div className="text-sm font-medium text-foreground">{value || "Not specified"}</div>
    </div>
  );
}

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
      <p className="text-[14px] leading-relaxed text-foreground">{children}</p>
    </div>
  );
}

function ProposalDetailView({
  d, L, ta, note, setNote, deciding, onDecide,
}: {
  d: ProposalDetail; L: (en?: string, ta?: string) => string; ta: boolean;
  note: string; setNote: (v: string) => void;
  deciding: boolean; onDecide: (dec: Decision) => void;
}) {
  const ex: ProposalBrief = d.extraction || {};
  const rec = ex.ai_recommendation ? REC_META[ex.ai_recommendation] : null;
  const st = STATUS_META[d.status] || { label: d.status, cls: "bg-slate-100 text-slate-600" };
  const decided = ["APPROVED", "REJECTED", "NEEDS_CLARIFICATION"].includes(d.status);
  const hl = (ta && ex.key_highlights_ta?.length ? ex.key_highlights_ta : ex.key_highlights) || [];

  return (
    <div className="flex min-h-full flex-col">
      {/* header */}
      <div className="border-b border-border bg-gradient-to-b from-card to-background px-5 py-5 sm:px-6">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            {d.category && (
              <Badge variant="outline" className="border-border bg-secondary text-[11px] text-secondary-foreground">
                {CATEGORY_LABEL[d.category] || d.category}
              </Badge>
            )}
            <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", st.cls)}>{st.label}</span>
          </div>
          <span className="num text-[11.5px] text-muted-foreground">{d.tracking_ref}</span>
        </div>
        <div className="flex items-center gap-1.5 text-[15px] font-semibold text-foreground">
          <Building2 className="h-4 w-4 text-muted-foreground" />{d.org_name || "—"}
        </div>
        <div className="text-[12.5px] text-muted-foreground">
          {[d.person_name, d.designation].filter(Boolean).join(" · ") || "—"} · {fmtDate(d.created_at)}
        </div>
        <h2 className="mt-3 text-lg font-semibold leading-snug text-foreground">
          {L(ex.title, ex.title_ta) || d.title || "Untitled proposal"}
        </h2>
      </div>

      <div className="flex-1 space-y-5 px-5 py-5 sm:px-6">
        {d.status === "FAILED" && (
          <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-700">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>AI extraction failed for this proposal. {d.error_message}</span>
          </div>
        )}

        {/* AI read */}
        {rec && (
          <div className={cn("rounded-xl border px-4 py-3", rec.cls)}>
            <div className="flex items-center gap-1.5 text-[13px] font-semibold">
              <Sparkles className="h-3.5 w-3.5" /> AI read — {rec.label}
            </div>
            {ex.ai_rationale && <p className="mt-1 text-[13px] leading-relaxed opacity-90">{ex.ai_rationale}</p>}
          </div>
        )}

        {/* problem / solution */}
        {L(ex.problem_statement, ex.problem_statement_ta) && (
          <Section label="Problem">{L(ex.problem_statement, ex.problem_statement_ta)}</Section>
        )}
        {L(ex.proposed_solution, ex.proposed_solution_ta) && (
          <Section label="What they propose">{L(ex.proposed_solution, ex.proposed_solution_ta)}</Section>
        )}

        {/* quick facts */}
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
          <Field icon={<IndianRupee className="h-3 w-3" />} label="Cost / ask" value={ex.estimated_cost} />
          <Field icon={<CalendarClock className="h-3 w-3" />} label="Timeline" value={ex.timeline} />
          <Field icon={<Users className="h-3 w-3" />} label="Beneficiaries" value={L(ex.beneficiary_scope, ex.beneficiary_scope_ta)} />
        </div>

        {L(ex.expected_benefit, ex.expected_benefit_ta) && (
          <Section label="Expected benefit">{L(ex.expected_benefit, ex.expected_benefit_ta)}</Section>
        )}

        {/* highlights */}
        {hl.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {hl.map((h, i) => (
              <span key={i} className="rounded-full border border-border bg-secondary px-2.5 py-1 text-[12px] text-secondary-foreground">{h}</span>
            ))}
          </div>
        )}

        {/* documents + contact */}
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Documents</div>
            <div className="space-y-1.5">
              {(d.documents || []).length === 0 && <span className="text-[13px] text-muted-foreground">None</span>}
              {(d.documents || []).map((doc, i) => (
                <a key={i} href={doc.url || "#"} target="_blank" rel="noreferrer"
                   className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-[13px] text-foreground transition-colors hover:bg-accent">
                  <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="flex-1 truncate">{doc.filename || "document.pdf"}</span>
                  <ExternalLink className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                </a>
              ))}
            </div>
          </div>
          <div>
            <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Contact</div>
            <div className="space-y-1 text-[13px] text-foreground">
              <div className="truncate">{d.email || "—"}</div>
              <div className="num">{d.phone || "—"}</div>
            </div>
          </div>
        </div>

        {decided && d.decision_note && (
          <div className="rounded-xl border border-border bg-secondary px-3.5 py-3 text-[13px]">
            <span className="font-semibold">Decision note:</span> {d.decision_note}
            {d.reviewed_by && <div className="mt-0.5 text-[11.5px] text-muted-foreground">— {d.reviewed_by}, {fmtDate(d.reviewed_at)}</div>}
          </div>
        )}
      </div>

      {/* decision bar */}
      <div className="sticky bottom-0 space-y-2.5 border-t border-border bg-card/95 px-5 py-4 backdrop-blur sm:px-6">
        <Textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Decision note (required to reject or request clarification)…"
          className="min-h-[64px] resize-none text-sm"
        />
        <div className="grid grid-cols-3 gap-2">
          <Button disabled={deciding} onClick={() => onDecide("approved")}
            className="bg-emerald-600 text-white hover:bg-emerald-700">
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
    <div className="grid gap-4 sm:grid-cols-2">
      {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-36 rounded-xl" />)}
    </div>
  );
}
function DetailSkeleton() {
  return (
    <div className="space-y-4 p-6">
      <Skeleton className="h-6 w-2/3" />
      <Skeleton className="h-20 w-full" />
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-16 w-full" />
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
