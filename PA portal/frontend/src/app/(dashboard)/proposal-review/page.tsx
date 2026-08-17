"use client";

import {
  useCallback, useEffect, useRef, useState, type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Lightbulb, Building2, Sparkles, Inbox, ShieldAlert,
  Search, Download, CalendarClock, X, Layers,
} from "lucide-react";

import TopBar from "@/components/TopBar";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useLang } from "@/lib/lang-context";
import { fetchMe, type SessionUser } from "@/app/(dashboard)/settings/_lib/adminApi";
import {
  listProposals, getProposal, decideProposal,
  type ProposalListItem, type ProposalListResponse, type ProposalDetail,
  type Decision,
} from "./_lib/proposalApi";
import {
  ProposalDrawer,
  CATEGORY_LABEL, STATUS_META, REC_META,
  fmtDate,
} from "./_lib/ProposalDrawer";

const TABS: { key: string; label: string }[] = [
  { key: "AWAITING_REVIEW", label: "Awaiting" },
  { key: "APPROVED", label: "Approved" },
  { key: "REJECTED", label: "Rejected" },
  { key: "NEEDS_CLARIFICATION", label: "Needs info" },
  { key: "", label: "All" },
];

// The 4 desks a proposal can target — matches CATEGORY_LABEL keys above.
const CATEGORY_OPTIONS: { value: string; label: string }[] = [
  { value: "school",      label: "School Education" },
  { value: "tamil",       label: "Tamil & Heritage" },
  { value: "information", label: "Information & Publicity" },
  { value: "film",        label: "Film" },
];

const REC_OPTIONS: { value: string; label: string }[] = [
  { value: "review_closely",  label: "Review closely" },
  { value: "standard",        label: "Ready to review" },
  { value: "needs_more_info", label: "Needs clarification" },
];

const DATE_RANGE_OPTIONS: { value: string; label: string }[] = [
  { value: "today",  label: "Today" },
  { value: "week",   label: "This week" },
  { value: "month",  label: "This month" },
  { value: "custom", label: "Custom range" },
];

const ANY = "__any__";  // sentinel — <SelectItem value=""> isn't allowed by Radix.

// fmtDate + daysSince + specified + toAttachments now come from
// ./_lib/ProposalDrawer so the review page and the dashboard-side read-only
// drawer share the same formatters.

/** Earliest timestamp (ms) that qualifies for a date-range PRESET bucket.
 *  "custom" returns null; the caller handles it via dateFrom/dateTo state. */
function dateRangeStart(bucket: string | null): number | null {
  if (!bucket) return null;
  const now = new Date();
  if (bucket === "today") {
    const d = new Date(now); d.setHours(0, 0, 0, 0);
    return d.getTime();
  }
  if (bucket === "week") {
    const d = new Date(now); d.setHours(0, 0, 0, 0);
    const day = d.getDay();
    const monOffset = day === 0 ? -6 : 1 - day;
    d.setDate(d.getDate() + monOffset);
    return d.getTime();
  }
  if (bucket === "month") {
    return new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  }
  return null;
}

/** Parse "YYYY-MM-DD" as local-midnight ms. Returns null on empty / malformed. */
function parseDateYMD(v: string): number | null {
  if (!v) return null;
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]) - 1, d = Number(m[3]);
  const dt = new Date(y, mo, d, 0, 0, 0, 0);
  return Number.isNaN(dt.getTime()) ? null : dt.getTime();
}

/** ISO YYYY-MM-DD for a preset bucket's start date, for the server-side
 *  date_from query param. `custom` returns null (caller supplies dateFrom). */
function dateRangeStartYMD(bucket: string | null): string | null {
  const ms = dateRangeStart(bucket);
  if (ms == null) return null;
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Standard debounce hook. 300ms feels responsive without hammering the API
 *  as the user types in the search box. */
function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}
type Gate =
  | { kind: "loading" }
  | { kind: "denied"; me: SessionUser | null }
  | { kind: "ok"; me: SessionUser };

export default function ProposalReviewPage() {
  const router = useRouter();
  const { t } = useLang();
  const [gate, setGate] = useState<Gate>({ kind: "loading" });

  const [tab, setTab] = useState<string>("AWAITING_REVIEW");
  const [q, setQ] = useState("");
  const [data, setData] = useState<ProposalListResponse | null>(null);
  const [loading, setLoading] = useState(true);

  // "?batch=<id>" deep-link from the AI Uploads batch card. Scopes the list
  // to proposals the classifier routed from that specific batch — same
  // pattern as the ai-review page uses. Read once from window.location so
  // we don't need the Next 15 useSearchParams Suspense boundary; a "clear"
  // button on the chip resets state AND strips the param from the URL so
  // reloading doesn't re-apply the scope.
  const [batchFilter, setBatchFilter] = useState<string>("");

  // Filter state — null when the chip is at "Any". Filters AND with tabs +
  // search + each other. Category, AI-recommendation, and submitted-date.
  const [recFilter,      setRecFilter]      = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [dateFilter,     setDateFilter]     = useState<string | null>(null);
  const [dateFrom,       setDateFrom]       = useState<string>("");
  const [dateTo,         setDateTo]         = useState<string>("");

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<ProposalDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [note, setNote] = useState("");
  const [deciding, setDeciding] = useState(false);

  // Lang-picker (L helper) is now internal to ProposalDrawer via its own useLang.

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

  // Server-side pagination. Was `list(tab, 100, 0)` then client-filter — that
  // silently truncated at 100. Now every filter + search + page turn maps to
  // a fresh query with the right offset, and `total` from the server drives
  // the pagination footer so the visible slice always matches reality.
  const PAGE_SIZE = 30;
  const [page, setPage] = useState(1);
  const debouncedQ = useDebounced(q, 300);
  const activeDateFrom = dateFilter === "custom" ? dateFrom : (dateRangeStartYMD(dateFilter) ?? "");
  const activeDateTo   = dateFilter === "custom" ? dateTo   : "";

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const res = await listProposals({
        status: tab || undefined,
        q: debouncedQ || undefined,
        category: categoryFilter || undefined,
        recommendation: recFilter || undefined,
        dateFrom: activeDateFrom || undefined,
        dateTo: activeDateTo || undefined,
        batchId: batchFilter || undefined,
        limit: PAGE_SIZE,
        offset: (page - 1) * PAGE_SIZE,
      });
      if (!signal?.aborted) { setData(res); setLoading(false); }
    } catch (e) {
      if (!signal?.aborted) { setLoading(false); toast.error((e as Error).message); }
    }
  }, [tab, debouncedQ, categoryFilter, recFilter, activeDateFrom, activeDateTo, batchFilter, page]);

  // Reset to page 1 whenever any filter / search / tab changes — otherwise
  // narrowing the results from page 5 could leave you looking at an empty
  // out-of-range page.
  useEffect(() => { setPage(1); }, [tab, debouncedQ, categoryFilter, recFilter, activeDateFrom, activeDateTo, batchFilter]);

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
    const batch = p.get("batch");
    if (batch) setBatchFilter(batch);
  }, [gate.kind]);

  // Server drives filtering + pagination now — `data.items` is already the
  // correct slice. No client-side .filter() so the visible set can't disagree
  // with the pagination footer.
  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const lo = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const hi = Math.min(page * PAGE_SIZE, total);

  const activeFilterCount =
    (recFilter ? 1 : 0) + (categoryFilter ? 1 : 0) + (dateFilter ? 1 : 0);
  const clearAllFilters = () => {
    setRecFilter(null); setCategoryFilter(null);
    setDateFilter(null); setDateFrom(""); setDateTo("");
  };

  // Reset stashed dates when the chip leaves "custom", so the next pick starts blank.
  useEffect(() => {
    if (dateFilter !== "custom") { setDateFrom(""); setDateTo(""); }
  }, [dateFilter]);

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

  const [exporting, setExporting] = useState(false);
  const doExport = async () => {
    // Empty-result guard — button is disabled when total === 0, this just
    // protects against a filter change slipping through.
    if (total === 0) {
      toast(t("appts.exportNothing"));
      return;
    }
    // Export the ENTIRE filtered set, not just the current page — the old
    // implementation exported `filtered` (a client-slice of the first 100)
    // so an office with 240 proposals silently exported 100. Loop the
    // paginated API with the same filters and stitch the pages.
    setExporting(true);
    try {
      const EXPORT_PAGE = 200;    // backend limit cap
      const all: ProposalListItem[] = [];
      const MAX_PAGES = 50;       // safety cap ~ 10k rows
      for (let p = 0; p < MAX_PAGES; p++) {
        const res = await listProposals({
          status: tab || undefined,
          q: debouncedQ || undefined,
          category: categoryFilter || undefined,
          recommendation: recFilter || undefined,
          dateFrom: activeDateFrom || undefined,
          dateTo: activeDateTo || undefined,
          limit: EXPORT_PAGE,
          offset: p * EXPORT_PAGE,
        });
        all.push(...res.items);
        if (res.items.length < EXPORT_PAGE) break;
      }
      const headers = ["Tracking Ref", "Title", "Submitter", "Category", "Status", "AI", "Submitted"];
      const lines = all.map((p) => [
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
      toast.success(`${all.length} proposal(s) exported.`);
    } catch (e) {
      toast.error(`Export failed: ${(e as Error).message}`);
    } finally {
      setExporting(false);
    }
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
            {/* Batch-scope chip — visible only when arrived via
                "?batch=<id>" from the AI Uploads batch card. Clear resets
                state AND strips the param from the URL so a reload doesn't
                re-apply the scope. */}
            {batchFilter && (
              <div className="flex flex-wrap items-center gap-2 rounded-xl border border-brand/30 bg-brand/5 px-3.5 py-2.5">
                <Layers className="h-4 w-4 shrink-0 text-brand" />
                <span className="text-[13px] text-foreground">
                  Showing routed proposals from batch{" "}
                  <span className="font-mono text-[12.5px] font-bold text-brand">{batchFilter.slice(0, 8)}</span>
                  {data && <span className="ml-2 text-muted-foreground">· {data.total} {data.total === 1 ? "row" : "rows"}</span>}
                </span>
                <button
                  onClick={() => {
                    setBatchFilter("");
                    if (typeof window !== "undefined") {
                      const url = new URL(window.location.href);
                      url.searchParams.delete("batch");
                      window.history.replaceState({}, "", url.toString());
                    }
                  }}
                  className="ml-auto inline-flex items-center gap-1 rounded-lg border border-border bg-card px-2.5 py-1 text-[12.5px] font-semibold text-foreground transition-colors hover:bg-muted"
                >
                  <X className="h-3.5 w-3.5" /> Clear
                </button>
              </div>
            )}
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
                <Button
                  variant="outline"
                  size="sm"
                  onClick={doExport}
                  disabled={exporting || total === 0}
                  title={total === 0 ? t("appts.exportNothing") : undefined}
                >
                  <Download className="h-4 w-4" /> {exporting ? "Exporting…" : "Export"}
                </Button>
              </div>
            </div>

            {/* Filter chips — AND with tabs + search. Chip flips to a coloured
                pill with an inline clear when a value is picked. */}
            <div className="flex flex-wrap items-center gap-2">
              <FilterChip
                icon={<Sparkles className="h-3.5 w-3.5" />}
                label="AI"
                value={recFilter} onValue={setRecFilter}
                options={REC_OPTIONS}
              />
              <FilterChip
                icon={<Building2 className="h-3.5 w-3.5" />}
                label="Portfolio"
                value={categoryFilter} onValue={setCategoryFilter}
                options={CATEGORY_OPTIONS}
              />
              <FilterChip
                icon={<CalendarClock className="h-3.5 w-3.5" />}
                label="Submitted"
                value={dateFilter} onValue={setDateFilter}
                options={DATE_RANGE_OPTIONS}
              />
              {dateFilter === "custom" && (
                <CustomDateRange
                  from={dateFrom} to={dateTo}
                  onFrom={setDateFrom} onTo={setDateTo}
                />
              )}
              {activeFilterCount > 0 && (
                <button
                  type="button" onClick={clearAllFilters}
                  className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-2.5 py-1 text-[11.5px] font-semibold text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  title="Clear all filters"
                >
                  <X className="h-3 w-3" /> Clear ({activeFilterCount})
                </button>
              )}
              <span className="num ml-auto text-[11.5px] text-muted-foreground">
                {total === 0 ? "0 results" : `${lo}–${hi} of ${total}`}
              </span>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto">
              {loading && !data ? (
                <ListSkeleton />
              ) : items.length === 0 ? (
                <EmptyState />
              ) : (
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {items.map((p) => (
                    <ProposalCard
                      key={p.id} p={p}
                      selected={selectedId === p.id}
                      onOpen={() => setSelectedId(p.id)}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* Pagination footer — hidden when everything fits on one page.
                Server drives both the visible slice AND `total`, so the
                controls always match reality. */}
            {lastPage > 1 && (
              <div className="flex shrink-0 items-center justify-between rounded-xl border border-border bg-card px-3 py-2 text-sm">
                <span className="text-muted-foreground">
                  Showing <span className="num font-semibold text-foreground">{lo}–{hi}</span> of{" "}
                  <span className="num font-semibold text-foreground">{total}</span>
                </span>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm"
                    disabled={page <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}>
                    Prev
                  </Button>
                  <span className="num text-[13px] text-muted-foreground">
                    Page {page} / {lastPage}
                  </span>
                  <Button variant="outline" size="sm"
                    disabled={page >= lastPage}
                    onClick={() => setPage((p) => Math.min(lastPage, p + 1))}>
                    Next
                  </Button>
                </div>
              </div>
            )}
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
            <ProposalDrawer
              d={detail}
              note={note} setNote={setNote}
              deciding={deciding}
              onDecide={decide}
              onClose={() => setSelectedId(null)}
              onCategorySaved={(updated) => { setDetail(updated); load(); }}
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


// ── compact custom date-range control — h-8 pill matching FilterChip height.
//    Same shape used on association-review. Native picker opens on click via
//    showPicker(); empty end = open range.
function CustomDateRange({
  from, to, onFrom, onTo,
}: {
  from: string; to: string;
  onFrom: (v: string) => void;
  onTo:   (v: string) => void;
}) {
  const fromRef = useRef<HTMLInputElement>(null);
  const toRef   = useRef<HTMLInputElement>(null);
  const openPicker = (el: HTMLInputElement | null) => {
    if (!el) return;
    el.focus();
    try { (el as HTMLInputElement & { showPicker?: () => void }).showPicker?.(); } catch { /* ignore */ }
  };
  const fmt = (v: string) => {
    if (!v) return "";
    const [y, m, d] = v.split("-");
    if (!y || !m || !d) return v;
    return `${d}/${m}/${y.slice(2)}`;
  };
  return (
    <div className="inline-flex h-8 items-stretch overflow-hidden rounded-full border border-border bg-background text-[12px] font-semibold text-muted-foreground">
      <button
        type="button"
        onClick={() => openPicker(fromRef.current)}
        className="flex items-center gap-1.5 px-3 hover:bg-accent hover:text-foreground focus:bg-accent focus:outline-none"
        aria-label="From date"
      >
        <span className="num">{fmt(from) || "From"}</span>
        <input
          ref={fromRef} type="date" value={from} onChange={(e) => onFrom(e.target.value)}
          max={to || undefined}
          className="pointer-events-none absolute h-0 w-0 opacity-0"
          tabIndex={-1} aria-hidden
        />
      </button>
      <span className="flex items-center px-1 text-muted-foreground/60" aria-hidden>→</span>
      <button
        type="button"
        onClick={() => openPicker(toRef.current)}
        className="flex items-center gap-1.5 px-3 hover:bg-accent hover:text-foreground focus:bg-accent focus:outline-none"
        aria-label="To date"
      >
        <span className="num">{fmt(to) || "To"}</span>
        <input
          ref={toRef} type="date" value={to} onChange={(e) => onTo(e.target.value)}
          min={from || undefined}
          className="pointer-events-none absolute h-0 w-0 opacity-0"
          tabIndex={-1} aria-hidden
        />
      </button>
      {(from || to) && (
        <button
          type="button"
          onClick={() => { onFrom(""); onTo(""); }}
          className="flex items-center px-2 text-muted-foreground hover:bg-accent hover:text-foreground focus:bg-accent focus:outline-none"
          aria-label="Clear custom date range"
          title="Clear dates"
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}

// ── filter chip: same compact dropdown as association-review. Uses a sentinel
//    for "Any" because Radix's SelectItem can't hold value="".
function FilterChip({
  icon, label, value, onValue, options,
}: {
  icon?: ReactNode;
  label: string;
  value: string | null;
  onValue: (v: string | null) => void;
  options: { value: string; label: string }[];
}) {
  const active = !!value;
  const currentLabel = active ? (options.find((o) => o.value === value)?.label ?? value) : "";
  return (
    <div className="inline-flex items-stretch">
      <Select
        value={value ?? ANY}
        onValueChange={(v) => onValue(v === ANY ? null : v)}
      >
        <SelectTrigger
          className={cn(
            "h-8 gap-1.5 rounded-full border px-3 text-[12px] font-semibold shadow-none",
            active
              ? "border-brand/40 bg-brand/10 text-brand hover:bg-brand/15"
              : "border-border bg-background text-muted-foreground hover:bg-accent",
          )}
        >
          {icon}
          {active ? currentLabel : label}
          {active && (
            <span
              role="button"
              tabIndex={-1}
              onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); onValue(null); }}
              className="ml-1 -mr-1 grid h-4 w-4 place-items-center rounded-full text-brand/80 hover:bg-brand/15 hover:text-brand"
              aria-label={`Clear ${label} filter`}
            >
              <X className="h-3 w-3" />
            </span>
          )}
        </SelectTrigger>
        <SelectContent align="start" className="max-h-72">
          <SelectItem value={ANY}>Any {label.toLowerCase()}</SelectItem>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
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
