"use client";

import {
  useCallback, useEffect, useMemo, useRef, useState, type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Lightbulb, Check, X, HelpCircle, Building2, IndianRupee, CalendarClock, Users,
  Sparkles, AlertTriangle, Loader2, Inbox, ShieldAlert, User, Search,
  Download, Forward, MapPin, Layers, Briefcase, Landmark,
  TrendingUp, Wallet, Wrench, ShieldAlert as RiskIcon, Award, FileCheck,
  ChevronRight, ChevronLeft, FileText, Image as ImageIcon, FolderOpen,
} from "lucide-react";

import TopBar from "@/components/TopBar";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Sheet, SheetContent, SheetClose, SheetTitle } from "@/components/ui/sheet";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { useLang } from "@/lib/lang-context";
import { cn } from "@/lib/utils";
import { fetchMe, type SessionUser } from "@/app/(dashboard)/settings/_lib/adminApi";
import {
  listProposals, getProposal, decideProposal, fetchProposalDocuments,
  type ProposalListItem, type ProposalListResponse, type ProposalDetail,
  type ProposalBrief, type Decision,
  type ProposalDocumentEntry,
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

const REC_META: Record<string, { label: string; cls: string; dot: string; confidence: string }> = {
  review_closely:  { label: "Review closely",     cls: "border-violet-300 bg-violet-50 text-violet-700",   dot: "bg-violet-500",  confidence: "Medium" },
  standard:        { label: "Ready to Review",    cls: "border-emerald-300 bg-emerald-50 text-emerald-700", dot: "bg-emerald-500", confidence: "High" },
  needs_more_info: { label: "Needs Clarification", cls: "border-amber-300 bg-amber-50 text-amber-700",     dot: "bg-amber-500",   confidence: "Low" },
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
function specified(v?: string | null): boolean {
  const s = (v || "").trim();
  return !!s && s.toLowerCase() !== "not specified";
}
function fmtBytes(n: number | null | undefined): string {
  if (n == null) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

type Gate =
  | { kind: "loading" }
  | { kind: "denied"; me: SessionUser | null }
  | { kind: "ok"; me: SessionUser };

// Eight numbered sections — no "Proposal Identity" (fields moved to header).
const SECTIONS: { n: number; id: string; tKey: string; icon: typeof Building2 }[] = [
  { n: 1, id: "ai-brief",    tKey: "prop.sec1", icon: Sparkles },
  { n: 2, id: "feasibility", tKey: "prop.sec2", icon: Wrench },
  { n: 3, id: "impact",      tKey: "prop.sec3", icon: TrendingUp },
  { n: 4, id: "risk",        tKey: "prop.sec4", icon: RiskIcon },
  { n: 5, id: "financial",   tKey: "prop.sec5", icon: Wallet },
  { n: 6, id: "ask",         tKey: "prop.sec6", icon: Briefcase },
  { n: 7, id: "track",       tKey: "prop.sec7", icon: Award },
  { n: 8, id: "documents",   tKey: "prop.sec8", icon: FolderOpen },
];

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

  const forwardForReview = () => {
    toast.info("Forward-for-review will be wired to the backend workflow.");
  };

  const approveReady = async () => {
    const ready = (data?.items || []).filter(
      (p) => p.status === "AWAITING_REVIEW" && p.ai_recommendation === "standard",
    );
    if (!ready.length) { toast.info("No 'Ready to Review' proposals in queue."); return; }
    if (!window.confirm(`Approve ${ready.length} ready proposal(s)?`)) return;
    setDeciding(true);
    try {
      for (const p of ready) await decideProposal(p.id, "approved");
      toast.success(`${ready.length} approved.`);
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
        subtitle={t("prop.subtitle")}
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
            {/* action bar: tabs + search + bulk + export */}
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
                  placeholder={t("prop.searchPlaceholder")}
                  className="h-9 pl-9"
                />
              </div>

              <div className="ml-auto flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={approveReady} disabled={deciding}>
                  <Check className="h-4 w-4" /> {t("prop.approveSelected")}
                </Button>
                <Button variant="outline" size="sm" onClick={doExport}>
                  <Download className="h-4 w-4" /> {t("prop.export")}
                </Button>
              </div>
            </div>

            {/* Full-width list */}
            <div className="min-h-0 flex-1 overflow-y-auto">
              {loading && !data ? (
                <ListSkeleton />
              ) : filtered.length === 0 ? (
                <EmptyState t={t} />
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

      {/* Detail drawer */}
      <Sheet open={selectedId != null} onOpenChange={(o) => { if (!o) setSelectedId(null); }}>
        <SheetContent
          side="right"
          hideClose
          className="flex w-full flex-col gap-0 p-0 sm:max-w-[75vw] lg:max-w-[70vw] xl:max-w-[1200px]"
        >
          {selectedId == null ? null : detailLoading && !detail ? (
            <DetailSkeleton />
          ) : detail ? (
            <DetailPane
              d={detail} L={L} t={t}
              note={note} setNote={setNote}
              deciding={deciding}
              onDecide={decide}
              onForward={forwardForReview}
              onClose={() => setSelectedId(null)}
            />
          ) : (
            <DetailEmpty t={t} />
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

// ── detail helpers ───────────────────────────────────────────────────────────
function Tile({ icon, label, value, mono = false, muted = false }: {
  icon?: ReactNode; label: string; value?: string | number | null; mono?: boolean; muted?: boolean;
}) {
  const has = value != null && String(value).trim() !== "" && String(value).toLowerCase() !== "not specified";
  return (
    <div className={cn(
      "flex min-w-0 flex-col gap-1 rounded-lg border border-border px-4 py-3",
      muted ? "bg-muted/40" : "bg-background/60",
    )}>
      <div className="flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
        {icon}{label}
      </div>
      <div className={cn(
        "text-[14px] font-semibold leading-snug",
        mono && has && "num",
        has ? "text-foreground" : "text-muted-foreground/45 font-normal italic",
      )}>
        {has ? String(value) : "Not provided"}
      </div>
    </div>
  );
}

function BriefTile({ label, text }: { label: string; text: string }) {
  const ok = specified(text);
  return (
    <div className="rounded-lg border border-border bg-background/60 p-4">
      <div className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{label}</div>
      <p className={cn(
        "font-serif text-[14px] leading-[1.65]",
        ok ? "text-foreground/90" : "italic text-muted-foreground/45",
      )}>
        {ok ? text : "Not provided"}
      </p>
    </div>
  );
}

function SectionShell({
  n, id, title, right, children,
}: { n: number; id: string; title: string; right?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24 rounded-xl border border-border bg-background/40 p-4 sm:p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="num grid h-7 w-7 place-items-center rounded-full bg-brand/10 text-[13px] font-bold text-brand">{n}</span>
          <h3 className="font-serif text-[16px] font-semibold text-foreground">{title}</h3>
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}

function ViewMore({ label }: { label: string }) {
  return (
    <button
      type="button"
      onClick={() => toast.info("Deep-dive view is coming soon.")}
      className="inline-flex items-center gap-1 text-[12.5px] font-semibold text-brand hover:underline"
    >
      {label} <ChevronRight className="h-3.5 w-3.5" />
    </button>
  );
}

// ── detail pane (inside drawer) ──────────────────────────────────────────────
function DetailPane({
  d, L, t, note, setNote, deciding, onDecide, onForward, onClose,
}: {
  d: ProposalDetail;
  L: (en?: string, ta?: string) => string;
  t: (k: string) => string;
  note: string; setNote: (v: string) => void;
  deciding: boolean;
  onDecide: (dec: Decision) => void;
  onForward: () => void;
  onClose: () => void;
}) {
  const ex: ProposalBrief = d.extraction || {};
  const rec = ex.ai_recommendation ? REC_META[ex.ai_recommendation] : null;
  const st = STATUS_META[d.status] || { label: d.status, cls: "bg-slate-100 text-slate-600" };
  const decided = ["APPROVED", "REJECTED", "NEEDS_CLARIFICATION"].includes(d.status);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState<string>(SECTIONS[0].id);

  const days = daysSince(d.created_at);
  const NP = t("prop.notProvided");

  // Scroll-spy — track section nearest the top so first/last stay reachable.
  useEffect(() => {
    const root = scrollRef.current;
    if (!root) return;
    const compute = () => {
      const sections = SECTIONS
        .map((s) => root.querySelector<HTMLElement>(`#${s.id}`))
        .filter((el): el is HTMLElement => !!el);
      if (!sections.length) return;
      const rootTop = root.getBoundingClientRect().top;
      // active = the last section whose top is above (or at) the viewport top
      // + a small gutter. Falls back to first if none has scrolled past.
      let currentId = sections[0].id;
      const gutter = 80;
      for (const el of sections) {
        const top = el.getBoundingClientRect().top - rootTop;
        if (top - gutter <= 0) currentId = el.id;
        else break;
      }
      // If we're at the very bottom, highlight the last section.
      if (root.scrollTop + root.clientHeight >= root.scrollHeight - 4) {
        currentId = sections[sections.length - 1].id;
      }
      setActive(currentId);
    };
    compute();
    root.addEventListener("scroll", compute, { passive: true });
    window.addEventListener("resize", compute);
    return () => {
      root.removeEventListener("scroll", compute);
      window.removeEventListener("resize", compute);
    };
  }, [d.id]);

  const jump = (id: string) => {
    const root = scrollRef.current;
    const el = root?.querySelector<HTMLElement>(`#${id}`);
    if (!root || !el) return;
    // Compute offset relative to scroll container, subtract sticky header gutter.
    const top = el.offsetTop - 16;
    root.scrollTo({ top, behavior: "smooth" });
    // Optimistically set the active pill so the click always highlights it,
    // even if the section is only partially in view / at the ends.
    setActive(id);
  };

  const gaps: string[] = [];
  if (!specified(L(ex.problem_statement, ex.problem_statement_ta))) gaps.push("Problem statement not described");
  if (!specified(L(ex.proposed_solution, ex.proposed_solution_ta))) gaps.push("Proposed solution not detailed");
  if (!specified(ex.estimated_cost)) gaps.push("Funding ask (₹) not specified");
  if (!specified(ex.timeline)) gaps.push("Implementation timeline missing");
  if (!specified(L(ex.beneficiary_scope, ex.beneficiary_scope_ta))) gaps.push("Beneficiary scope not quantified");

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Header — proposal identity lives here (no separate section below). */}
      <div className="shrink-0 border-b border-border bg-card px-6 py-5">
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
          {d.category && (
            <span className="inline-flex items-center gap-1.5">
              <Landmark className="h-3.5 w-3.5" />{CATEGORY_LABEL[d.category] || d.category}
            </span>
          )}
          <span className="inline-flex items-center gap-1.5">
            <CalendarClock className="h-3.5 w-3.5" /><span className="num">{fmtDate(d.created_at)}</span>
          </span>
          {days != null && <span className="num">· {days}d in queue</span>}
          <span className="num ml-auto shrink-0 text-[11.5px]">{d.tracking_ref}</span>
        </div>
      </div>

      {/* body */}
      <div className="min-h-0 flex-1 overflow-hidden">
        <div className="grid h-full min-h-0 grid-cols-1 xl:grid-cols-[1fr_180px]">
          <div ref={scrollRef} className="min-h-0 space-y-5 overflow-y-auto px-6 py-5">
            {d.status === "FAILED" && (
              <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-700">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>AI extraction failed for this proposal. {d.error_message}</span>
              </div>
            )}

            {/* 1 — AI Assessment + Executive Brief (merged) */}
            <SectionShell
              n={1} id="ai-brief" title={t("prop.sec1")}
              right={rec ? (
                <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-semibold", rec.cls)}>
                  <span className={cn("h-1.5 w-1.5 rounded-full", rec.dot)} />{rec.label}
                </span>
              ) : undefined}
            >
              {/* AI Assessment block */}
              <div className="rounded-lg border border-border bg-background/60 p-4">
                <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                  <Sparkles className="h-3.5 w-3.5" /> AI Assessment
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full border border-border bg-background px-2.5 py-0.5 text-[11.5px] font-semibold">
                    Confidence: <span className={cn("num", rec?.confidence === "High" ? "text-emerald-700" : rec?.confidence === "Low" ? "text-amber-700" : "text-violet-700")}>{rec?.confidence ?? "—"}</span>
                  </span>
                  {gaps.length > 0 && <ViewMore label={t("prop.viewQuestions")} />}
                </div>
                {ex.ai_rationale && (
                  <p className="mt-3 rounded-md bg-muted/40 px-3 py-2 text-[13px] leading-relaxed text-foreground/85">
                    {ex.ai_rationale}
                  </p>
                )}
                <div className="mt-4">
                  <div className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                    Why this needs more information
                  </div>
                  {gaps.length > 0 ? (
                    <ul className="space-y-1.5">
                      {gaps.map((g, i) => (
                        <li key={i} className="flex gap-2 text-[13px] text-foreground/85">
                          <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
                          <span>{g}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-[13px] italic text-muted-foreground">No gaps flagged — the brief looks complete.</p>
                  )}
                </div>
              </div>

              {/* Executive Brief block */}
              <div className="mt-4">
                <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                  <Briefcase className="h-3.5 w-3.5" /> Executive Brief
                </div>
                <div className="grid gap-3 lg:grid-cols-2">
                  <BriefTile label="Problem" text={L(ex.problem_statement, ex.problem_statement_ta)} />
                  <BriefTile label="Proposed solution" text={L(ex.proposed_solution, ex.proposed_solution_ta)} />
                  <BriefTile label="Expected outcome" text={L(ex.expected_benefit, ex.expected_benefit_ta)} />
                  <BriefTile label="Why government?" text="" />
                </div>
              </div>
            </SectionShell>

            {/* 2 — Feasibility */}
            <SectionShell n={2} id="feasibility" title={t("prop.sec2")} right={<ViewMore label={t("prop.viewFeasibility")} />}>
              <div className="grid gap-2.5 sm:grid-cols-3">
                <Tile icon={<Layers className="h-3 w-3" />} label="Implementation readiness" value={NP} />
                <Tile icon={<CalendarClock className="h-3 w-3" />} label="Implementation timeline" value={ex.timeline} mono />
                <Tile icon={<Wrench className="h-3 w-3" />} label="Technical feasibility" value={NP} />
              </div>
            </SectionShell>

            {/* 3 — Impact */}
            <SectionShell n={3} id="impact" title={t("prop.sec3")}>
              <div className="grid gap-2.5 sm:grid-cols-3">
                <Tile icon={<Users className="h-3 w-3" />} label="Direct beneficiaries" value={L(ex.beneficiary_scope, ex.beneficiary_scope_ta)} />
                <Tile icon={<MapPin className="h-3 w-3" />} label="Geographical reach" value={null} />
                <Tile icon={<Briefcase className="h-3 w-3" />} label="Jobs created" value={null} mono />
              </div>
              <div className="mt-2.5 grid gap-2.5 sm:grid-cols-2">
                <Tile icon={<IndianRupee className="h-3 w-3" />} label="Economic impact (est.)" value={null} mono muted />
                <Tile icon={<Landmark className="h-3 w-3" />} label="Govt. offices impacted" value={null} mono muted />
              </div>
            </SectionShell>

            {/* 4 — Risk */}
            <SectionShell n={4} id="risk" title={t("prop.sec4")} right={<ViewMore label={t("prop.viewRisks")} />}>
              <p className="text-[13px] italic text-muted-foreground">Risks not yet extracted for this proposal.</p>
            </SectionShell>

            {/* 5 — Financial */}
            <SectionShell n={5} id="financial" title={t("prop.sec5")} right={<ViewMore label={t("prop.viewFinancial")} />}>
              <div className="grid gap-2.5 sm:grid-cols-3">
                <Tile icon={<IndianRupee className="h-3 w-3" />} label="Total project cost" value={ex.estimated_cost} mono />
                <Tile icon={<IndianRupee className="h-3 w-3" />} label="Govt. funding ask" value={ex.estimated_cost} mono />
                <Tile icon={<IndianRupee className="h-3 w-3" />} label="Applicant contribution" value={null} mono />
              </div>
              <div className="mt-2.5 grid gap-2.5 sm:grid-cols-2">
                <Tile icon={<IndianRupee className="h-3 w-3" />} label="Recurring cost" value={null} mono muted />
                <Tile icon={<IndianRupee className="h-3 w-3" />} label="Cost per beneficiary" value={null} mono muted />
              </div>
            </SectionShell>

            {/* 6 — The Ask */}
            <SectionShell n={6} id="ask" title={t("prop.sec6")}>
              <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
                <Tile icon={<IndianRupee className="h-3 w-3" />} label="Funding ask (₹)" value={ex.estimated_cost} mono />
                <Tile icon={<CalendarClock className="h-3 w-3" />} label="Implementation period" value={ex.timeline} mono />
                <Tile icon={<Landmark className="h-3 w-3" />} label="Departments involved" value={CATEGORY_LABEL[d.category ?? ""] ?? d.category ?? null} />
                <Tile icon={<Users className="h-3 w-3" />} label="Partnership model" value={null} />
                <Tile icon={<ShieldAlert className="h-3 w-3" />} label="Regulatory support" value={null} />
                <Tile icon={<Wrench className="h-3 w-3" />} label="Other resources" value={null} />
              </div>
            </SectionShell>

            {/* 7 — Applicant Track Record */}
            <SectionShell n={7} id="track" title={t("prop.sec7")}>
              <p className="text-[13px] italic text-muted-foreground">{t("prop.trackNoData")}</p>
            </SectionShell>

            {/* 8 — Supporting Documents */}
            <SectionShell n={8} id="documents" title={t("prop.sec8")}>
              <DocumentsGallery proposalId={d.id} t={t} />
            </SectionShell>

            {decided && d.decision_note && (
              <div className="rounded-lg border border-border bg-secondary/60 px-3.5 py-3 text-[13px]">
                <span className="font-semibold">Decision note:</span> {d.decision_note}
                {d.reviewed_by && <div className="mt-0.5 text-[11.5px] text-muted-foreground">— {d.reviewed_by}, {fmtDate(d.reviewed_at)}</div>}
              </div>
            )}
          </div>

          {/* Right-hand jump nav — numbered pills, no header label. */}
          <aside className="hidden border-l border-border xl:block">
            <div className="sticky top-0 px-3 py-5">
              <nav className="space-y-1">
                {SECTIONS.map((s) => {
                  const isActive = active === s.id;
                  const Icon = s.icon;
                  return (
                    <button
                      key={s.id}
                      onClick={() => jump(s.id)}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12.5px] transition-colors",
                        isActive
                          ? "bg-brand/10 font-semibold text-brand"
                          : "text-muted-foreground hover:bg-muted hover:text-foreground",
                      )}
                    >
                      <span className={cn(
                        "num inline-grid h-5 w-5 shrink-0 place-items-center rounded-full text-[10.5px] font-bold",
                        isActive ? "bg-brand text-white" : "bg-muted text-muted-foreground",
                      )}>{s.n}</span>
                      <Icon className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">{t(s.tKey)}</span>
                    </button>
                  );
                })}
              </nav>
            </div>
          </aside>
        </div>
      </div>

      {/* Sticky footer — decision bar */}
      <div className="shrink-0 space-y-2.5 border-t border-border bg-card px-6 py-4">
        {decided && (
          <div className="flex items-center gap-1.5 text-[12.5px] font-medium text-muted-foreground">
            <Check className="h-3.5 w-3.5 text-emerald-600" />
            Already {st.label.toLowerCase()} — you can change the decision below.
          </div>
        )}
        <Textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={t("prop.decisionNote")}
          className="min-h-[60px] resize-none text-sm"
        />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Button disabled={deciding} onClick={() => onDecide("approved")}
            className="bg-emerald-600 text-white hover:bg-emerald-700 !bg-none">
            {deciding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} {t("prop.approve")}
          </Button>
          <Button disabled={deciding} variant="outline" onClick={() => onDecide("needs_clarification")}
            className="border-orange-300 text-orange-700 hover:bg-orange-50">
            <HelpCircle className="h-4 w-4" /> {t("prop.clarify")}
          </Button>
          <Button disabled={deciding} variant="outline" onClick={() => onDecide("rejected")}
            className="border-red-300 text-red-700 hover:bg-red-50">
            <X className="h-4 w-4" /> {t("prop.reject")}
          </Button>
          <Button disabled={deciding} variant="outline" onClick={onForward}
            className="border-border text-foreground/80 hover:bg-muted">
            <Forward className="h-4 w-4" /> {t("prop.forward")}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── documents gallery ────────────────────────────────────────────────────────
type LightboxTarget = {
  docIndex: number;
  pageIndex: number; // 0-based
};

function DocumentsGallery({ proposalId, t }: { proposalId: number; t: (k: string) => string }) {
  const [docs, setDocs] = useState<ProposalDocumentEntry[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [lightbox, setLightbox] = useState<LightboxTarget | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setDocs(null);
    fetchProposalDocuments(proposalId)
      .then((res) => { if (alive) { setDocs(res.documents); setLoading(false); } })
      .catch(() => { if (alive) { setDocs([]); setLoading(false); } });
    return () => { alive = false; };
  }, [proposalId]);

  if (loading) {
    return (
      <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))" }}>
        {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="aspect-[3/4] rounded-md" />)}
      </div>
    );
  }
  if (!docs || docs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
        <FolderOpen className="h-8 w-8 text-muted-foreground/40" />
        <p className="text-[13px] text-muted-foreground">{t("prop.docsEmpty")}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {docs.map((doc, di) => (
        <div key={doc.id}>
          <div className="mb-2 flex items-center justify-between gap-2 border-b border-border pb-1.5">
            <div className="flex min-w-0 items-center gap-2">
              {doc.kind === "image"
                ? <ImageIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                : <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
              <span className="truncate text-[13px] font-semibold text-foreground">{doc.filename}</span>
            </div>
            <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
              <span className="num">{doc.page_count} {doc.page_count === 1 ? "page" : "pages"}</span>
              {doc.size_bytes != null && <span className="num">{fmtBytes(doc.size_bytes)}</span>}
              <a
                href={doc.original_url} target="_blank" rel="noreferrer"
                className="inline-flex items-center gap-1 text-brand hover:underline"
              >
                <Download className="h-3 w-3" />
              </a>
            </div>
          </div>

          <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))" }}>
            {doc.pages.map((pg, pi) => (
              <PageTile
                key={pg.page_no}
                thumbUrl={pg.thumb_url}
                pageNo={pg.page_no}
                totalPages={doc.page_count}
                kind={doc.kind}
                filename={doc.filename}
                onOpen={() => setLightbox({ docIndex: di, pageIndex: pi })}
              />
            ))}
          </div>
        </div>
      ))}

      {lightbox && (
        <Lightbox
          docs={docs}
          target={lightbox}
          onChange={setLightbox}
          onClose={() => setLightbox(null)}
          t={t}
        />
      )}
    </div>
  );
}

function PageTile({
  thumbUrl, pageNo, totalPages, kind, filename, onOpen,
}: {
  thumbUrl: string; pageNo: number; totalPages: number;
  kind: "pdf" | "image"; filename: string; onOpen: () => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const [visible, setVisible] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || visible) return;
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) { setVisible(true); obs.disconnect(); break; }
        }
      },
      { rootMargin: "100% 0px 100% 0px" }, // one viewport of pre-fetch
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [visible]);

  const caption = kind === "pdf"
    ? `PDF · Page ${pageNo} of ${totalPages}`
    : `Image · ${filename}`;

  return (
    <button
      ref={ref}
      onClick={onOpen}
      className="group flex flex-col overflow-hidden rounded-md border border-border bg-card text-left shadow-card transition-all hover:-translate-y-0.5 hover:shadow-card-md focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
    >
      <div className="relative aspect-[3/4] w-full overflow-hidden bg-muted/50">
        {visible && (
          <img
            src={thumbUrl}
            alt={`${filename} — page ${pageNo}`}
            className={cn("h-full w-full object-cover object-top transition-opacity", loaded ? "opacity-100" : "opacity-0")}
            onLoad={() => setLoaded(true)}
            onError={() => setLoaded(true)}
            loading="lazy"
          />
        )}
        {(!visible || !loaded) && (
          <div className="absolute inset-0 animate-pulse bg-gradient-to-br from-muted/60 to-muted/30" />
        )}
      </div>
      <div className="flex flex-col gap-0.5 border-t border-border px-2.5 py-1.5">
        <span className="truncate text-[12px] font-medium text-foreground">{filename}</span>
        <span className="num truncate text-[10.5px] text-muted-foreground">{caption}</span>
      </div>
    </button>
  );
}

function Lightbox({
  docs, target, onChange, onClose, t,
}: {
  docs: ProposalDocumentEntry[];
  target: LightboxTarget;
  onChange: (t: LightboxTarget) => void;
  onClose: () => void;
  t: (k: string) => string;
}) {
  const doc = docs[target.docIndex];
  const page = doc?.pages[target.pageIndex];

  const go = useCallback((delta: number) => {
    let di = target.docIndex;
    let pi = target.pageIndex + delta;
    if (pi < 0) {
      di = di - 1;
      if (di < 0) return;
      pi = docs[di].pages.length - 1;
    } else if (pi >= docs[di].pages.length) {
      di = di + 1;
      if (di >= docs.length) return;
      pi = 0;
    }
    onChange({ docIndex: di, pageIndex: pi });
  }, [docs, target, onChange]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") go(-1);
      else if (e.key === "ArrowRight") go(1);
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [go]);

  if (!doc || !page) return null;

  // Higher-res version for the lightbox: request width=1600.
  const fullUrl = page.thumb_url.replace(/w=\d+/, "w=1600");

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-[95vw] gap-0 p-0 sm:max-w-[92vw]">
        <div className="flex items-center justify-between gap-3 border-b border-border bg-card px-4 py-2.5">
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-semibold text-foreground">{doc.filename}</div>
            <div className="num text-[11px] text-muted-foreground">
              {t("prop.docPage")} {page.page_no} {t("prop.docOf")} {doc.page_count}
            </div>
          </div>
          <a
            href={doc.original_url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[12px] font-semibold text-foreground/80 hover:bg-muted"
          >
            <Download className="h-3.5 w-3.5" /> {t("prop.docDownload")}
          </a>
        </div>
        <div className="relative flex max-h-[80vh] min-h-[400px] items-center justify-center bg-neutral-900">
          <img
            src={fullUrl}
            alt={`${doc.filename} page ${page.page_no}`}
            className="max-h-[80vh] max-w-full object-contain"
          />
          <button
            onClick={() => go(-1)}
            className="absolute left-3 top-1/2 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-full bg-black/50 text-white hover:bg-black/70"
            aria-label="Previous page"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <button
            onClick={() => go(1)}
            className="absolute right-3 top-1/2 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-full bg-black/50 text-white hover:bg-black/70"
            aria-label="Next page"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        </div>
      </DialogContent>
    </Dialog>
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
function DetailEmpty({ t }: { t: (k: string) => string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-6 py-16 text-center">
      <Lightbulb className="h-8 w-8 text-muted-foreground/40" />
      <p className="text-sm font-medium text-foreground">{t("prop.selectProposal")}</p>
      <p className="max-w-xs text-[13px] text-muted-foreground">{t("prop.selectHelp")}</p>
    </div>
  );
}
function EmptyState({ t }: { t: (k: string) => string }) {
  return (
    <Card className="flex flex-col items-center justify-center gap-2 py-16 text-center shadow-card">
      <Inbox className="h-8 w-8 text-muted-foreground" />
      <p className="text-sm font-medium text-foreground">{t("prop.emptyTitle")}</p>
      <p className="text-[13px] text-muted-foreground">{t("prop.emptyHelp")}</p>
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
