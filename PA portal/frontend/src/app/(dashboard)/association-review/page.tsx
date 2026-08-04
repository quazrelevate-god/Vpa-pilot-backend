"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Users2, FileText, ExternalLink, Check, Send, Building2, UserRound,
  Users, MapPin, CalendarClock, Loader2, Inbox, ShieldAlert,
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
  listAssociations, getAssociation, decideAssociation,
  type AssociationListItem, type AssociationListResponse, type AssociationDetail,
  type AssociationBrief, type AssociationDecision,
} from "./_lib/associationApi";

// ── display maps ────────────────────────────────────────────────────────────
const STATUS_META: Record<string, { label: string; cls: string }> = {
  AWAITING_REVIEW: { label: "Awaiting review", cls: "bg-amber-100 text-amber-800" },
  REVIEWED:        { label: "Reviewed",        cls: "bg-emerald-100 text-emerald-700" },
  FORWARDED:       { label: "Forwarded",       cls: "bg-sky-100 text-sky-700" },
};

const URGENCY_META: Record<string, { label: string; cls: string }> = {
  critical: { label: "Critical", cls: "border-red-300 bg-red-50 text-red-700" },
  high:     { label: "High",     cls: "border-orange-300 bg-orange-50 text-orange-700" },
  medium:   { label: "Medium",   cls: "border-amber-300 bg-amber-50 text-amber-700" },
  low:      { label: "Low",      cls: "border-slate-300 bg-slate-50 text-slate-600" },
};

const TABS: { key: string; label: string }[] = [
  { key: "AWAITING_REVIEW", label: "Awaiting" },
  { key: "REVIEWED", label: "Reviewed" },
  { key: "FORWARDED", label: "Forwarded" },
  { key: "", label: "All" },
];

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }); }
  catch { return "—"; }
}

function titleCase(s?: string | null): string {
  if (!s) return "";
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

type Gate =
  | { kind: "loading" }
  | { kind: "denied"; me: SessionUser | null }
  | { kind: "ok"; me: SessionUser };

export default function AssociationReviewPage() {
  const router = useRouter();
  const { t, lang } = useLang();
  const [gate, setGate] = useState<Gate>({ kind: "loading" });

  const [tab, setTab] = useState<string>("AWAITING_REVIEW");
  const [data, setData] = useState<AssociationListResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const [selected, setSelected] = useState<AssociationDetail | null>(null);
  const [sheetLoading, setSheetLoading] = useState(false);
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

  // ── list fetch (+ light polling) ────────────────────────────────────────────
  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const res = await listAssociations(tab || undefined, 100, 0);
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

  const openDetail = async (id: number) => {
    setSheetLoading(true);
    setSelected({ id } as AssociationDetail);
    setNote("");
    try {
      setSelected(await getAssociation(id));
    } catch (e) {
      toast.error((e as Error).message);
      setSelected(null);
    } finally {
      setSheetLoading(false);
    }
  };

  const decide = async (decision: AssociationDecision) => {
    if (!selected) return;
    setDeciding(true);
    try {
      const updated = await decideAssociation(selected.id, decision, note.trim() || undefined);
      setSelected(updated);
      toast.success(decision === "forwarded" ? "Forwarded to department." : "Marked reviewed.");
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
        title={t("nav.associationReview")}
        subtitle="Collective matters from unions & associations — review and forward"
        icon={<Users2 className="h-4 w-4" />}
      />

      <main className="flex-1 overflow-y-auto px-6 py-6 sm:px-10 sm:py-8">
        <div className="mx-auto max-w-6xl space-y-6">
          {gate.kind === "loading" && <ListSkeleton />}
          {gate.kind === "denied" && <NotAuthorized me={gate.me} />}
          {gate.kind === "ok" && (
            <>
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

              {loading && !data ? (
                <ListSkeleton />
              ) : !data || data.items.length === 0 ? (
                <EmptyState />
              ) : (
                <div className="grid gap-4 sm:grid-cols-2">
                  {data.items.map((a) => (
                    <AssociationCard key={a.id} a={a} onOpen={() => openDetail(a.id)} />
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </main>

      <Sheet open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <SheetContent side="right" className="w-full overflow-y-auto p-0 sm:max-w-2xl">
          <SheetTitle className="sr-only">Association detail</SheetTitle>
          {sheetLoading && !selected?.extraction ? (
            <DetailSkeleton />
          ) : selected ? (
            <AssociationDetailView
              d={selected} L={L} note={note} setNote={setNote}
              deciding={deciding} onDecide={decide}
            />
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}

// ── card ────────────────────────────────────────────────────────────────────
function AssociationCard({ a, onOpen }: { a: AssociationListItem; onOpen: () => void }) {
  const st = STATUS_META[a.status] || { label: a.status, cls: "bg-slate-100 text-slate-600" };
  const urg = a.urgency ? URGENCY_META[a.urgency] : null;
  return (
    <Card
      onClick={onOpen}
      className="group cursor-pointer p-4 shadow-card transition-all hover:-translate-y-0.5 hover:shadow-card-md"
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {a.category && (
            <Badge variant="outline" className="border-border bg-secondary text-[11px] font-medium text-secondary-foreground">
              {titleCase(a.category)}
            </Badge>
          )}
          {urg && (
            <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium", urg.cls)}>
              {urg.label}
            </span>
          )}
        </div>
        <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", st.cls)}>{st.label}</span>
      </div>

      <h3 className="flex items-center gap-1.5 text-[15px] font-semibold leading-snug text-foreground">
        <Building2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="line-clamp-2">{a.association_name || "Unnamed association"}</span>
      </h3>
      <div className="mt-1 truncate text-[12.5px] text-muted-foreground">
        {[a.representative_name, a.representative_designation].filter(Boolean).join(" · ") || "—"}
      </div>

      <div className="mt-3 flex items-center justify-between text-[11.5px] text-muted-foreground">
        <span className="inline-flex items-center gap-1"><Users className="h-3 w-3" />{a.member_count || "—"}</span>
        <span>{fmtDate(a.created_at)}</span>
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
      <p className="whitespace-pre-line text-[14px] leading-relaxed text-foreground">{children}</p>
    </div>
  );
}

function AssociationDetailView({
  d, L, note, setNote, deciding, onDecide,
}: {
  d: AssociationDetail; L: (en?: string, ta?: string) => string;
  note: string; setNote: (v: string) => void;
  deciding: boolean; onDecide: (dec: AssociationDecision) => void;
}) {
  const ex: AssociationBrief = d.extraction || {};
  const st = STATUS_META[d.status] || { label: d.status, cls: "bg-slate-100 text-slate-600" };
  const urg = d.urgency ? URGENCY_META[d.urgency] : null;
  const decided = d.status === "REVIEWED" || d.status === "FORWARDED";

  return (
    <div className="flex min-h-full flex-col">
      {/* header */}
      <div className="border-b border-border bg-gradient-to-b from-card to-background px-5 py-5 sm:px-6">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            {d.category && (
              <Badge variant="outline" className="border-border bg-secondary text-[11px] text-secondary-foreground">
                {titleCase(d.category)}
              </Badge>
            )}
            {urg && (
              <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium", urg.cls)}>
                {urg.label}
              </span>
            )}
            <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", st.cls)}>{st.label}</span>
          </div>
        </div>
        <h2 className="flex items-center gap-1.5 text-lg font-semibold leading-snug text-foreground">
          <Building2 className="h-4 w-4 shrink-0 text-muted-foreground" />
          {d.association_name || "Unnamed association"}
        </h2>
        <div className="mt-0.5 text-[12.5px] text-muted-foreground">
          {[d.representative_name, d.representative_designation].filter(Boolean).join(" · ") || "—"} · {fmtDate(d.created_at)}
        </div>
      </div>

      <div className="flex-1 space-y-5 px-5 py-5 sm:px-6">
        {/* the collective ask */}
        {L(ex.association_ask, ex.association_ask_ta) && (
          <Section label="Collective ask">{L(ex.association_ask, ex.association_ask_ta)}</Section>
        )}
        {L(ex.summary, ex.summary_ta) && (
          <Section label="Summary">{L(ex.summary, ex.summary_ta)}</Section>
        )}

        {/* quick facts */}
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          <Field icon={<UserRound className="h-3 w-3" />} label="Representative"
            value={[d.representative_name, d.representative_designation].filter(Boolean).join(" · ") || undefined} />
          <Field icon={<Users className="h-3 w-3" />} label="Members" value={d.member_count || undefined} />
          <Field icon={<MapPin className="h-3 w-3" />} label="District" value={titleCase(d.district) || undefined} />
          <Field icon={<CalendarClock className="h-3 w-3" />} label="Document date" value={d.document_date || undefined} />
        </div>

        {/* ministry */}
        {d.ministry && <Field icon={<Building2 className="h-3 w-3" />} label="Concerned ministry" value={titleCase(d.ministry)} />}

        {/* documents */}
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
          placeholder="Decision note (optional)…"
          className="min-h-[64px] resize-none text-sm"
        />
        <div className="grid grid-cols-2 gap-2">
          <Button disabled={deciding} variant="outline" onClick={() => onDecide("reviewed")}
            className="border-emerald-300 text-emerald-700 hover:bg-emerald-50">
            {deciding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Mark reviewed
          </Button>
          <Button disabled={deciding} onClick={() => onDecide("forwarded")}
            className="bg-brand text-white hover:bg-brand/90">
            <Send className="h-4 w-4" /> Forward to dept
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
      <p className="text-sm font-medium text-foreground">No association submissions here yet</p>
      <p className="text-[13px] text-muted-foreground">Union/association matters detected by the scanner appear here once their brief is ready.</p>
    </Card>
  );
}
function NotAuthorized({ me }: { me: SessionUser | null }) {
  return (
    <Card className="flex flex-col items-center justify-center gap-2 py-16 text-center shadow-card">
      <ShieldAlert className="h-8 w-8 text-muted-foreground" />
      <p className="text-sm font-medium text-foreground">Association Review is for super administrators</p>
      <p className="text-[13px] text-muted-foreground">
        {me ? `You're signed in as ${me.full_name || me.login_name} (${me.role}).` : "Please sign in with an admin account."}
      </p>
    </Card>
  );
}
