"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Users2, Check, Send, Building2, UserRound,
  Users, MapPin, CalendarClock, Loader2, Inbox, ShieldAlert, Search,
  ChevronLeft, ChevronRight, ArrowLeft, Layers, RefreshCw,
} from "lucide-react";

import TopBar from "@/components/TopBar";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { InlineAttachmentPreview } from "@/components/ui/inline-attachment-preview";
import type { GalleryAttachment } from "@/components/ui/attachment-gallery";
import { useLang } from "@/lib/lang-context";
import { cn } from "@/lib/utils";
import { fetchMe, type SessionUser } from "@/app/(dashboard)/settings/_lib/adminApi";
import {
  listAssociationGroups, listAssociationsByName, getAssociation, decideAssociation,
  type AssociationGroup, type AssociationGroupedResponse,
  type AssociationListItem, type AssociationDetail, type AssociationBrief, type AssociationDecision,
} from "./_lib/associationApi";

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
/** 48000 → "48K", 120000 → "1.2L". */
function human(n: number): string {
  if (!n) return "—";
  if (n >= 1e7) return `${(n / 1e7).toFixed(1)}Cr`;
  if (n >= 1e5) return `${(n / 1e5).toFixed(1)}L`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return n.toLocaleString("en-IN");
}

type Gate = { kind: "loading" } | { kind: "denied"; me: SessionUser | null } | { kind: "ok"; me: SessionUser };

export default function AssociationReviewPage() {
  const router = useRouter();
  const { t, lang } = useLang();
  const [gate, setGate] = useState<Gate>({ kind: "loading" });

  const [tab, setTab] = useState<string>("AWAITING_REVIEW");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<AssociationGroupedResponse | null>(null);
  const [loading, setLoading] = useState(true);

  // drill: a body is selected → its submissions; then one submission → detail
  const [group, setGroup] = useState<AssociationGroup | null>(null);
  const [subs, setSubs] = useState<AssociationListItem[] | null>(null);
  const [detail, setDetail] = useState<AssociationDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [note, setNote] = useState("");
  const [deciding, setDeciding] = useState(false);

  const L = useCallback((en?: string, ta?: string) => (lang === "ta" && ta ? ta : en) || "", [lang]);

  // ── gate ──
  useEffect(() => {
    const ac = new AbortController();
    (async () => {
      try {
        const me = await fetchMe(ac.signal);
        if (!me) { router.replace("/login"); return; }
        if (me.role !== "super_admin") { setGate({ kind: "denied", me }); return; }
        setGate({ kind: "ok", me });
      } catch { if (!ac.signal.aborted) setGate({ kind: "denied", me: null }); }
    })();
    return () => ac.abort();
  }, [router]);

  // ── grouped list (debounced on q; refetch on tab/page) ──
  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const res = await listAssociationGroups({ status: tab || undefined, q: q || undefined, page }, signal);
      if (!signal?.aborted) { setData(res); setLoading(false); }
    } catch (e) {
      if (!signal?.aborted) { setLoading(false); toast.error((e as Error).message); }
    }
  }, [tab, q, page]);

  useEffect(() => {
    if (gate.kind !== "ok") return;
    setLoading(true);
    const ac = new AbortController();
    const id = setTimeout(() => load(ac.signal), 200);
    return () => { ac.abort(); clearTimeout(id); };
  }, [gate.kind, load]);

  // reset to page 1 whenever the filter changes
  useEffect(() => { setPage(1); }, [tab, q]);

  const counts = data?.counts || {};
  const countFor = (key: string) =>
    key === "" ? Object.values(counts).reduce((a, b) => a + b, 0) : (counts[key] || 0);

  // ── open a body → fetch its submissions ──
  const openGroup = async (g: AssociationGroup) => {
    setGroup(g); setSubs(null); setDetail(null); setNote("");
    try {
      const res = await listAssociationsByName(g.association_name);
      setSubs(res.items);
    } catch (e) { toast.error((e as Error).message); }
  };

  // ── open one submission → detail ──
  const openDetail = async (id: number) => {
    setDetailLoading(true); setDetail({ id } as AssociationDetail); setNote("");
    try { setDetail(await getAssociation(id)); }
    catch (e) { toast.error((e as Error).message); setDetail(null); }
    finally { setDetailLoading(false); }
  };

  const closeSheet = () => { setGroup(null); setSubs(null); setDetail(null); };

  const decide = async (decision: AssociationDecision) => {
    if (!detail) return;
    setDeciding(true);
    try {
      const updated = await decideAssociation(detail.id, decision, note.trim() || undefined);
      setDetail(updated);
      toast.success(decision === "forwarded" ? "Forwarded to department." : "Marked reviewed.");
      // refresh the drilled submissions + the grouped list underneath
      if (group) listAssociationsByName(group.association_name).then((r) => setSubs(r.items)).catch(() => {});
      load();
    } catch (e) { toast.error((e as Error).message); }
    finally { setDeciding(false); }
  };

  // ── render ──
  return (
    <div className="flex h-full flex-1 flex-col overflow-hidden">
      <TopBar
        title={t("nav.associationReview")}
        subtitle="Unions & collective bodies — pick a body, then work its stack"
        icon={<Users2 className="h-4 w-4" />}
      />

      <main className="flex-1 overflow-y-auto px-4 py-5 sm:px-8 sm:py-7">
        <div className="mx-auto max-w-6xl space-y-5">
          {gate.kind === "loading" && <GridSkeleton />}
          {gate.kind === "denied" && <NotAuthorized me={gate.me} />}
          {gate.kind === "ok" && (
            <>
              {/* controls: tabs + search */}
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-wrap gap-1.5 rounded-xl bg-card p-1 shadow-card">
                  {TABS.map((tb) => {
                    const active = tab === tb.key;
                    return (
                      <button key={tb.key || "all"} onClick={() => setTab(tb.key)}
                        className={cn("relative inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
                          active ? "bg-brand text-white shadow-sm" : "text-muted-foreground hover:bg-accent")}>
                        {tb.label}
                        <span className={cn("num rounded-full px-1.5 py-0.5 text-[11px]",
                          active ? "bg-white/20 text-white" : "bg-muted text-muted-foreground")}>{countFor(tb.key)}</span>
                      </button>
                    );
                  })}
                </div>
                <div className="flex items-center gap-2">
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                    <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search union / representative…"
                      className="h-9 w-60 rounded-xl border border-input bg-card pl-8 pr-3 text-[13px] shadow-card focus:border-brand focus:outline-none" />
                  </div>
                  <Button variant="outline" size="sm" className="h-9 rounded-xl" onClick={() => load()}>
                    <RefreshCw className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>

              {/* grouped bodies */}
              {loading && !data ? (
                <GridSkeleton />
              ) : !data || data.groups.length === 0 ? (
                <EmptyState hasQuery={!!q} />
              ) : (
                <>
                  <div className="text-[12.5px] text-muted-foreground">
                    <span className="font-semibold text-foreground">{data.total_groups.toLocaleString("en-IN")}</span> bodies
                    {q && <> matching “{q}”</>}
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {data.groups.map((g) => <GroupCard key={g.key} g={g} onOpen={() => openGroup(g)} />)}
                  </div>
                  {(data.page > 1 || data.has_more) && (
                    <div className="flex items-center justify-center gap-3 pt-1">
                      <Button variant="outline" size="sm" disabled={data.page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                        <ChevronLeft className="h-4 w-4" /> Prev
                      </Button>
                      <span className="text-[12.5px] tabular-nums text-muted-foreground">Page {data.page}</span>
                      <Button variant="outline" size="sm" disabled={!data.has_more} onClick={() => setPage((p) => p + 1)}>
                        Next <ChevronRight className="h-4 w-4" />
                      </Button>
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </main>

      {/* drill sheet: body's submissions → one submission's detail */}
      <Sheet open={!!group} onOpenChange={(o) => !o && closeSheet()}>
        <SheetContent side="right" className="w-full overflow-y-auto p-0 sm:max-w-2xl">
          <SheetTitle className="sr-only">Association</SheetTitle>
          {group && !detail && (
            <SubmissionsView group={group} subs={subs} onOpen={openDetail} L={L} />
          )}
          {group && detail && (
            detailLoading && !detail.extraction ? <DetailSkeleton /> : (
              <AssociationDetailView
                d={detail} group={group} L={L} note={note} setNote={setNote}
                deciding={deciding} onDecide={decide} onBack={() => { setDetail(null); setNote(""); }}
              />
            )
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

// ── Level 1: one association BODY ─────────────────────────────────────────────
function GroupCard({ g, onOpen }: { g: AssociationGroup; onOpen: () => void }) {
  const urg = g.latest_urgency ? URGENCY_META[g.latest_urgency] : null;
  return (
    <Card onClick={onOpen}
      className="group cursor-pointer p-4 shadow-card transition-all hover:-translate-y-0.5 hover:shadow-card-md">
      <div className="mb-2 flex items-start justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-brand/10 px-2 py-0.5 text-[11px] font-semibold text-brand">
          <Layers className="h-3 w-3" /> {g.count} submission{g.count === 1 ? "" : "s"}
        </span>
        {g.awaiting > 0 && (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">{g.awaiting} awaiting</span>
        )}
      </div>
      <h3 className="flex items-start gap-1.5 text-[15px] font-semibold leading-snug text-foreground">
        <Building2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="line-clamp-2">{g.association_name}</span>
      </h3>
      {g.representative_name && (
        <div className="mt-0.5 truncate text-[12px] text-muted-foreground">{g.representative_name}</div>
      )}

      <div className="mt-3 flex flex-wrap gap-1">
        {g.categories.slice(0, 3).map((c) => (
          <Badge key={c} variant="outline" className="border-border bg-secondary text-[10.5px] font-medium text-secondary-foreground">
            {titleCase(c)}
          </Badge>
        ))}
        {g.categories.length > 3 && <span className="text-[11px] text-muted-foreground">+{g.categories.length - 3}</span>}
      </div>

      <div className="mt-3 flex items-center justify-between border-t border-border/60 pt-2.5 text-[11.5px] text-muted-foreground">
        <span className="inline-flex items-center gap-1"><Users className="h-3 w-3" />{human(g.members)} members</span>
        <span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3" />{g.districts.length || "—"}</span>
        {urg && <span className={cn("rounded-full border px-1.5 py-0.5 text-[10.5px] font-medium", urg.cls)}>{urg.label}</span>}
      </div>
    </Card>
  );
}

// ── Level 2: a body's stack of submissions ────────────────────────────────────
function SubmissionsView({
  group, subs, onOpen, L,
}: { group: AssociationGroup; subs: AssociationListItem[] | null; onOpen: (id: number) => void; L: (e?: string, t?: string) => string }) {
  return (
    <div className="flex min-h-full flex-col">
      <div className="border-b border-border bg-gradient-to-b from-card to-background px-5 py-5 sm:px-6">
        <div className="mb-1 inline-flex items-center gap-1.5 rounded-full bg-brand/10 px-2 py-0.5 text-[11px] font-semibold text-brand">
          <Layers className="h-3 w-3" /> {group.count} submission{group.count === 1 ? "" : "s"}
        </div>
        <h2 className="flex items-start gap-1.5 text-lg font-semibold leading-snug text-foreground">
          <Building2 className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          {group.association_name}
        </h2>
        <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] text-muted-foreground">
          {group.representative_name && <span className="inline-flex items-center gap-1"><UserRound className="h-3 w-3" />{group.representative_name}</span>}
          <span className="inline-flex items-center gap-1"><Users className="h-3 w-3" />{human(group.members)} members</span>
          {group.districts.length > 0 && <span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3" />{group.districts.map(titleCase).join(", ")}</span>}
        </div>
      </div>

      <div className="flex-1 space-y-2.5 px-5 py-5 sm:px-6">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Their submissions</div>
        {subs == null ? (
          <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-16 rounded-xl" />)}</div>
        ) : subs.length === 0 ? (
          <div className="grid h-24 place-items-center text-[13px] italic text-muted-foreground">No submissions.</div>
        ) : subs.map((s) => {
          const st = STATUS_META[s.status] || { label: s.status, cls: "bg-slate-100 text-slate-600" };
          const urg = s.urgency ? URGENCY_META[s.urgency] : null;
          return (
            <button key={s.id} onClick={() => onOpen(s.id)}
              className="group block w-full rounded-xl border border-border bg-card p-3.5 text-left transition-all hover:-translate-y-0.5 hover:border-brand/30 hover:shadow-card">
              <div className="mb-1 flex items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  {s.category && <Badge variant="outline" className="border-border bg-secondary text-[10.5px] text-secondary-foreground">{titleCase(s.category)}</Badge>}
                  {urg && <span className={cn("rounded-full border px-1.5 py-0.5 text-[10.5px] font-medium", urg.cls)}>{urg.label}</span>}
                </div>
                <span className={cn("rounded-full px-2 py-0.5 text-[10.5px] font-semibold", st.cls)}>{st.label}</span>
              </div>
              <div className="text-[13px] font-medium text-foreground line-clamp-2">
                {L(s.association_ask ?? undefined, s.association_ask_ta ?? undefined) || titleCase(s.category) || "Submission"}
              </div>
              <div className="mt-1 text-[11.5px] text-muted-foreground">{fmtDate(s.created_at)}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Level 3: full detail + decision ───────────────────────────────────────────
function Field({ icon, label, value }: { icon: ReactNode; label: string; value?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card px-3.5 py-3">
      <div className="mb-0.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{icon}{label}</div>
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
  d, group, L, note, setNote, deciding, onDecide, onBack,
}: {
  d: AssociationDetail; group: AssociationGroup; L: (en?: string, ta?: string) => string;
  note: string; setNote: (v: string) => void; deciding: boolean;
  onDecide: (dec: AssociationDecision) => void; onBack: () => void;
}) {
  const ex: AssociationBrief = d.extraction || {};
  const st = STATUS_META[d.status] || { label: d.status, cls: "bg-slate-100 text-slate-600" };
  const urg = d.urgency ? URGENCY_META[d.urgency] : null;
  const decided = d.status === "REVIEWED" || d.status === "FORWARDED";

  return (
    <div className="flex min-h-full flex-col">
      <div className="border-b border-border bg-gradient-to-b from-card to-background px-5 py-5 sm:px-6">
        {group.count > 1 && (
          <button onClick={onBack} className="mb-2 inline-flex items-center gap-1 text-[12px] font-medium text-brand hover:underline">
            <ArrowLeft className="h-3.5 w-3.5" /> {group.count} submissions from this body
          </button>
        )}
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          {d.category && <Badge variant="outline" className="border-border bg-secondary text-[11px] text-secondary-foreground">{titleCase(d.category)}</Badge>}
          {urg && <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium", urg.cls)}>{urg.label}</span>}
          <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", st.cls)}>{st.label}</span>
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
        {L(ex.association_ask, ex.association_ask_ta) && <Section label="Collective ask">{L(ex.association_ask, ex.association_ask_ta)}</Section>}
        {L(ex.summary, ex.summary_ta) && <Section label="Summary">{L(ex.summary, ex.summary_ta)}</Section>}

        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          <Field icon={<UserRound className="h-3 w-3" />} label="Representative"
            value={[d.representative_name, d.representative_designation].filter(Boolean).join(" · ") || undefined} />
          <Field icon={<Users className="h-3 w-3" />} label="Members" value={d.member_count || undefined} />
          <Field icon={<MapPin className="h-3 w-3" />} label="District" value={titleCase(d.district) || undefined} />
          <Field icon={<CalendarClock className="h-3 w-3" />} label="Document date" value={d.document_date || undefined} />
        </div>
        {d.ministry && <Field icon={<Building2 className="h-3 w-3" />} label="Concerned ministry" value={titleCase(d.ministry)} />}

        <div>
          <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Document</div>
          {(() => {
            const docAtts = toAttachments(d.documents || []);
            return docAtts.length > 0 ? (
              <div className="h-[440px]">
                <InlineAttachmentPreview attachments={docAtts} defaultOpenFirst />
              </div>
            ) : (
              <span className="text-[13px] text-muted-foreground">None</span>
            );
          })()}
        </div>

        {decided && d.decision_note && (
          <div className="rounded-xl border border-border bg-secondary px-3.5 py-3 text-[13px]">
            <span className="font-semibold">Decision note:</span> {d.decision_note}
            {d.reviewed_by && <div className="mt-0.5 text-[11.5px] text-muted-foreground">— {d.reviewed_by}, {fmtDate(d.reviewed_at)}</div>}
          </div>
        )}
      </div>

      <div className="sticky bottom-0 space-y-2.5 border-t border-border bg-card/95 px-5 py-4 backdrop-blur sm:px-6">
        <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Decision note (optional)…"
          className="min-h-[60px] resize-none text-sm" />
        <div className="grid grid-cols-2 gap-2">
          <Button disabled={deciding} variant="outline" onClick={() => onDecide("reviewed")}
            className="border-emerald-300 text-emerald-700 hover:bg-emerald-50">
            {deciding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Mark reviewed
          </Button>
          <Button disabled={deciding} onClick={() => onDecide("forwarded")} className="bg-brand text-white hover:bg-brand/90">
            <Send className="h-4 w-4" /> Forward to dept
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── states ────────────────────────────────────────────────────────────────────
function GridSkeleton() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-40 rounded-xl" />)}
    </div>
  );
}
function DetailSkeleton() {
  return (
    <div className="space-y-4 p-6">
      <Skeleton className="h-6 w-2/3" /><Skeleton className="h-20 w-full" /><Skeleton className="h-24 w-full" /><Skeleton className="h-16 w-full" />
    </div>
  );
}
function EmptyState({ hasQuery }: { hasQuery: boolean }) {
  return (
    <Card className="flex flex-col items-center justify-center gap-2 py-16 text-center shadow-card">
      <Inbox className="h-8 w-8 text-muted-foreground" />
      <p className="text-sm font-medium text-foreground">{hasQuery ? "No bodies match your search" : "No association submissions yet"}</p>
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
