"use client";

import {
  useCallback, useEffect, useMemo, useRef, useState, type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Users2, Check, Send, Building2, UserRound, Users, MapPin, CalendarClock,
  Loader2, Inbox, ShieldAlert, Search, Download, Sparkles, AlertTriangle,
  Landmark, Target, Flag, ShieldAlert as RiskIcon, ScrollText, FolderOpen, X,
} from "lucide-react";

import TopBar from "@/components/TopBar";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Sheet, SheetContent, SheetClose, SheetTitle } from "@/components/ui/sheet";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { InlineAttachmentPreview } from "@/components/ui/inline-attachment-preview";
import type { GalleryAttachment } from "@/components/ui/attachment-gallery";
import { useLang } from "@/lib/lang-context";
import { cn } from "@/lib/utils";
import { fetchMe, type SessionUser } from "@/app/(dashboard)/settings/_lib/adminApi";
import {
  listAssociations, getAssociation, decideAssociation,
  type AssociationListItem, type AssociationListResponse, type AssociationDetail,
  type AssociationBrief, type AssociationDoc, type AssociationDecision,
} from "./_lib/associationApi";

// ── display maps ────────────────────────────────────────────────────────────
const STATUS_META: Record<string, { label: string; cls: string }> = {
  AWAITING_REVIEW: { label: "Awaiting review", cls: "bg-amber-100 text-amber-800" },
  REVIEWED:        { label: "Reviewed",        cls: "bg-emerald-100 text-emerald-700" },
  FORWARDED:       { label: "Forwarded",       cls: "bg-sky-100 text-sky-700" },
};

const REC_META: Record<string, { label: string; cls: string; dot: string }> = {
  engage_now:      { label: "Engage now",      cls: "border-red-300 bg-red-50 text-red-700",           dot: "bg-red-500"     },
  routine:         { label: "Routine",         cls: "border-emerald-300 bg-emerald-50 text-emerald-700", dot: "bg-emerald-500" },
  refer:           { label: "Refer",           cls: "border-sky-300 bg-sky-50 text-sky-700",           dot: "bg-sky-500"     },
  needs_more_info: { label: "Needs more info", cls: "border-amber-300 bg-amber-50 text-amber-700",     dot: "bg-amber-500"   },
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

// The 9 grievance categories AssociationExtraction is constrained to (matches
// backend/src/prompts/association_extraction.py). Dropdown values stay
// snake_case so they match what the AI writes into `category`.
const CATEGORY_OPTIONS: { value: string; label: string }[] = [
  { value: "action_required",     label: "Action required" },
  { value: "job_requests",        label: "Job requests" },
  { value: "school_admission",    label: "School admission" },
  { value: "school_upgradation",  label: "School upgradation" },
  { value: "pension_requests",    label: "Pension" },
  { value: "transfer_requests",   label: "Transfer" },
  { value: "rti",                 label: "RTI" },
  { value: "general",             label: "General" },
  { value: "other",               label: "Other" },
];

const URGENCY_OPTIONS: { value: string; label: string }[] = [
  { value: "critical", label: "Critical" },
  { value: "high",     label: "High" },
  { value: "medium",   label: "Medium" },
  { value: "low",      label: "Low" },
];

const REC_OPTIONS: { value: string; label: string }[] = [
  { value: "engage_now",      label: "Engage now" },
  { value: "routine",         label: "Routine" },
  { value: "refer",           label: "Refer" },
  { value: "needs_more_info", label: "Needs more info" },
];

const DATE_RANGE_OPTIONS: { value: string; label: string }[] = [
  { value: "today",  label: "Today" },
  { value: "week",   label: "This week" },
  { value: "month",  label: "This month" },
  { value: "custom", label: "Custom range" },
];

const ANY = "__any__";  // placeholder value used to represent "no filter" in <Select>
// (Select doesn't allow SelectItem value="", so we use a sentinel and treat it as null.)

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }); }
  catch { return "—"; }
}

/** Return the earliest timestamp (ms) that qualifies for a date-range PRESET
 *  bucket. "custom" is handled separately via dateFrom/dateTo state — returns
 *  null here on purpose so the caller falls through to the custom-range check. */
function dateRangeStart(bucket: string | null): number | null {
  if (!bucket) return null;
  const now = new Date();
  if (bucket === "today") {
    const d = new Date(now); d.setHours(0, 0, 0, 0);
    return d.getTime();
  }
  if (bucket === "week") {
    const d = new Date(now); d.setHours(0, 0, 0, 0);
    // Monday-start week
    const day = d.getDay(); // 0=Sun
    const monOffset = day === 0 ? -6 : 1 - day;
    d.setDate(d.getDate() + monOffset);
    return d.getTime();
  }
  if (bucket === "month") {
    return new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  }
  return null;
}

/** Parse a "YYYY-MM-DD" from a native <input type="date"> as a local-midnight
 *  timestamp in ms. Returns null on empty / malformed input. */
function parseDateYMD(v: string): number | null {
  if (!v) return null;
  // Explicit Y/M/D parse — new Date("2026-08-06") is UTC-midnight, which drifts
  // by IST offset. We want local midnight so a citizen submission at 10 AM IST
  // on the picked date is captured.
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]) - 1, d = Number(m[3]);
  const dt = new Date(y, mo, d, 0, 0, 0, 0);
  return Number.isNaN(dt.getTime()) ? null : dt.getTime();
}
function daysSince(iso: string | null): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((Date.now() - t) / 86_400_000));
}
function titleCase(s?: string | null): string {
  if (!s) return "";
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
/** A field the AI leaves as "Not specified" (or empty) is not a real value. */
function specified(v?: string | null): boolean {
  const s = (v || "").trim();
  return !!s && s.toLowerCase() !== "not specified" && s.toLowerCase() !== "unknown";
}

function toAttachments(docs: AssociationDoc[] | undefined): GalleryAttachment[] {
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

export default function AssociationReviewPage() {
  const router = useRouter();
  const { t, lang } = useLang();
  const [gate, setGate] = useState<Gate>({ kind: "loading" });

  const [tab, setTab] = useState<string>("AWAITING_REVIEW");
  const [q, setQ] = useState("");
  const [data, setData] = useState<AssociationListResponse | null>(null);
  const [loading, setLoading] = useState(true);

  // Filter state — null when the chip is at "Any". Filters combine (AND) with
  // each other, with the active tab (status), and with the search text.
  const [recFilter,      setRecFilter]      = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [urgencyFilter,  setUrgencyFilter]  = useState<string | null>(null);
  const [districtFilter, setDistrictFilter] = useState<string | null>(null);
  const [ministryFilter, setMinistryFilter] = useState<string | null>(null);
  const [dateFilter,     setDateFilter]     = useState<string | null>(null);
  // Custom range — only meaningful when dateFilter === "custom". Kept as raw
  // "YYYY-MM-DD" strings so <input type="date"> round-trips them directly.
  const [dateFrom,       setDateFrom]       = useState<string>("");
  const [dateTo,         setDateTo]         = useState<string>("");

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<AssociationDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [note, setNote] = useState("");
  const [deciding, setDeciding] = useState(false);

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

  // Deep-link: /association-review?id=42. Reads window.location once so we don't
  // need the Next 15 useSearchParams Suspense boundary.
  useEffect(() => {
    if (gate.kind !== "ok") return;
    if (typeof window === "undefined") return;
    const p = new URLSearchParams(window.location.search);
    const raw = p.get("id");
    const id = raw ? Number(raw) : NaN;
    if (Number.isFinite(id)) setSelectedId(id);
  }, [gate.kind]);

  // Dynamic dropdown options — pulled from the fetched rows so the reviewer
  // only sees values that actually appear in the current tab's data. Sorted
  // alphabetically so the list is scannable.
  const districtOptions = useMemo(() => {
    const set = new Set<string>();
    for (const a of data?.items ?? []) {
      const v = (a.district || "").trim();
      if (v && v.toLowerCase() !== "unknown") set.add(v);
    }
    return [...set].sort().map((v) => ({ value: v, label: v }));
  }, [data]);

  const ministryOptions = useMemo(() => {
    const set = new Set<string>();
    for (const a of data?.items ?? []) if (a.ministry) set.add(a.ministry);
    return [...set].sort().map((v) => ({ value: v, label: titleCase(v) }));
  }, [data]);

  const filtered = useMemo(() => {
    const items = data?.items ?? [];
    const needle = q.trim().toLowerCase();
    const presetStart = dateRangeStart(dateFilter);
    // Custom range: inclusive of the "to" day (add 24h) so an item created
    // late in the day still qualifies when to === same day.
    const customStart = dateFilter === "custom" ? parseDateYMD(dateFrom) : null;
    const customEndRaw = dateFilter === "custom" ? parseDateYMD(dateTo) : null;
    const customEnd = customEndRaw != null ? customEndRaw + 86_400_000 : null;
    return items.filter((a) => {
      if (recFilter      && a.ai_recommendation !== recFilter)      return false;
      if (categoryFilter && a.category          !== categoryFilter) return false;
      if (urgencyFilter  && (a.urgency || "").toLowerCase() !== urgencyFilter) return false;
      if (ministryFilter && a.ministry          !== ministryFilter) return false;
      if (districtFilter && (a.district ?? "")  !== districtFilter) return false;
      if (presetStart != null) {
        const t = a.created_at ? new Date(a.created_at).getTime() : NaN;
        if (!Number.isFinite(t) || t < presetStart) return false;
      }
      if (customStart != null || customEnd != null) {
        const t = a.created_at ? new Date(a.created_at).getTime() : NaN;
        if (!Number.isFinite(t)) return false;
        if (customStart != null && t < customStart) return false;
        if (customEnd   != null && t >= customEnd)  return false;
      }
      if (needle) {
        const hit =
          (a.association_name || "").toLowerCase().includes(needle) ||
          (a.representative_name || "").toLowerCase().includes(needle) ||
          (a.association_ask || "").toLowerCase().includes(needle) ||
          (a.category || "").toLowerCase().includes(needle);
        if (!hit) return false;
      }
      return true;
    });
  }, [data, q, recFilter, categoryFilter, urgencyFilter, districtFilter, ministryFilter, dateFilter, dateFrom, dateTo]);

  const activeFilterCount =
    (recFilter ? 1 : 0) + (categoryFilter ? 1 : 0) + (urgencyFilter ? 1 : 0) +
    (districtFilter ? 1 : 0) + (ministryFilter ? 1 : 0) + (dateFilter ? 1 : 0);

  const clearAllFilters = () => {
    setRecFilter(null); setCategoryFilter(null); setUrgencyFilter(null);
    setDistrictFilter(null); setMinistryFilter(null);
    setDateFilter(null); setDateFrom(""); setDateTo("");
  };

  // When the Submitted chip is cleared or flipped away from "custom", drop the
  // stashed dates so the next "Custom range" pick starts blank instead of
  // reviving yesterday's window silently.
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
        const det = await getAssociation(selectedId);
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

  const decide = async (decision: AssociationDecision) => {
    if (!detail) return;
    if (decision === "forwarded" && !note.trim()) {
      toast.error("Please add a short note when forwarding.");
      return;
    }
    setDeciding(true);
    try {
      const updated = await decideAssociation(detail.id, decision, note.trim() || undefined);
      setDetail(updated);
      toast.success(decision === "reviewed" ? "Marked reviewed." : "Forwarded to department.");
      load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setDeciding(false);
    }
  };

  const doExport = () => {
    const rows = filtered;
    const headers = ["ID", "Association", "Representative", "Category", "Urgency", "Members", "Status", "AI", "Submitted"];
    const lines = rows.map((a) => [
      a.id, a.association_name ?? "", a.representative_name ?? "",
      titleCase(a.category) ?? "", titleCase(a.urgency) ?? "",
      a.member_count ?? "",
      STATUS_META[a.status]?.label ?? a.status,
      a.ai_recommendation ?? "", a.created_at ?? "",
    ]);
    const csv = [headers, ...lines].map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = "data:text/csv;charset=utf-8," + encodeURIComponent(csv);
    a.download = `associations_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    toast.success(`${rows.length} association(s) exported.`);
  };

  return (
    <div className="flex h-full flex-1 flex-col overflow-hidden">
      <TopBar
        title={t("nav.associationReview")}
        subtitle="Collective petitions from unions and organised bodies — read the ask, look at the document, decide."
        icon={<Users2 className="h-4 w-4" />}
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
            {/* Row 1 — tabs + search + export */}
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
                  placeholder="Search association, representative, ask, or category…"
                  className="h-9 pl-9"
                />
              </div>

              <div className="ml-auto">
                <Button variant="outline" size="sm" onClick={doExport}>
                  <Download className="h-4 w-4" /> Export
                </Button>
              </div>
            </div>

            {/* Row 2 — filter chips. All AND with tabs + search. `activeFilterCount`
                shows an inline Clear-all pill only when at least one chip is set. */}
            <div className="flex flex-wrap items-center gap-2">
              <FilterChip
                icon={<Sparkles className="h-3.5 w-3.5" />}
                label="AI"
                value={recFilter} onValue={setRecFilter}
                options={REC_OPTIONS}
              />
              <FilterChip
                icon={<Landmark className="h-3.5 w-3.5" />}
                label="Category"
                value={categoryFilter} onValue={setCategoryFilter}
                options={CATEGORY_OPTIONS}
              />
              <FilterChip
                icon={<Flag className="h-3.5 w-3.5" />}
                label="Urgency"
                value={urgencyFilter} onValue={setUrgencyFilter}
                options={URGENCY_OPTIONS}
              />
              {districtOptions.length > 0 && (
                <FilterChip
                  icon={<MapPin className="h-3.5 w-3.5" />}
                  label="District"
                  value={districtFilter} onValue={setDistrictFilter}
                  options={districtOptions}
                />
              )}
              {ministryOptions.length > 0 && (
                <FilterChip
                  icon={<Building2 className="h-3.5 w-3.5" />}
                  label="Ministry"
                  value={ministryFilter} onValue={setMinistryFilter}
                  options={ministryOptions}
                />
              )}
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
                {filtered.length} of {data?.items?.length ?? 0}
              </span>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto">
              {loading && !data ? (
                <ListSkeleton />
              ) : filtered.length === 0 ? (
                <EmptyState />
              ) : (
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {filtered.map((a) => (
                    <AssociationCard
                      key={a.id} a={a} lang={lang}
                      selected={selectedId === a.id}
                      onOpen={() => setSelectedId(a.id)}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </main>

      {/* Wide right-slide drawer — 92vw on lg+, full-width on mobile.
          Two panes: document preview LEFT (always visible), reading RIGHT. */}
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
function AssociationCard({ a, lang, selected, onOpen }: {
  a: AssociationListItem; lang: string; selected: boolean; onOpen: () => void;
}) {
  const rec = a.ai_recommendation ? REC_META[a.ai_recommendation] : null;
  const st = STATUS_META[a.status] || { label: a.status, cls: "bg-slate-100 text-slate-600" };
  const urg = a.urgency ? URGENCY_META[a.urgency.toLowerCase()] : null;
  const ask = (lang === "ta" && a.association_ask_ta) || a.association_ask || "";
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
        {a.association_name || "Unnamed association"}
      </h3>

      {ask && (
        <p className="mt-1.5 line-clamp-2 text-[13px] leading-snug text-foreground/80">
          {ask}
        </p>
      )}

      <div className="mt-2 flex items-center gap-1.5 text-[12.5px] text-muted-foreground">
        <UserRound className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">
          {a.representative_name || "—"}
          {a.representative_designation && <span className="text-muted-foreground/70"> · {a.representative_designation}</span>}
        </span>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-border pt-2.5 text-[11px] text-muted-foreground">
        {a.category && (
          <span className="rounded bg-secondary px-1.5 py-0.5 font-medium text-secondary-foreground">
            {titleCase(a.category)}
          </span>
        )}
        {urg && (
          <span className={cn("rounded border px-1.5 py-0.5 font-semibold", urg.cls)}>
            {urg.label}
          </span>
        )}
        {a.member_count && (
          <span className="inline-flex items-center gap-1">
            <Users className="h-3 w-3" />{a.member_count}
          </span>
        )}
        <span className="num ml-auto">{fmtDate(a.created_at)}</span>
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
 *  empty/"Not specified". */
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
  d: AssociationDetail;
  L: (en?: string, ta?: string) => string;
  ta: boolean;
  note: string; setNote: (v: string) => void;
  deciding: boolean;
  onDecide: (dec: AssociationDecision) => void;
  onClose: () => void;
}) {
  const ex: AssociationBrief = d.extraction || {};
  const rec = ex.ai_recommendation ? REC_META[ex.ai_recommendation] : null;
  const st = STATUS_META[d.status] || { label: d.status, cls: "bg-slate-100 text-slate-600" };
  const urg = d.urgency ? URGENCY_META[d.urgency.toLowerCase()] : null;
  const decided = ["REVIEWED", "FORWARDED"].includes(d.status);
  const days = daysSince(d.created_at);

  // Lang-aware narrative strings.
  const ask       = L(ex.association_ask,   ex.association_ask_ta);
  const summary   = L(ex.summary,           ex.summary_ta);
  const demand    = L(ex.demand_context,    ex.demand_context_ta);
  const outcome   = L(ex.expected_outcome,  ex.expected_outcome_ta);
  const precedent = L(ex.precedent_context, ex.precedent_context_ta);
  const rationale = L(ex.ai_rationale,      ex.ai_rationale_ta);

  const keyDetails    = (ta && ex.key_details_ta?.length ? ex.key_details_ta : ex.key_details) || [];
  const stakeholders  = (ta && ex.key_stakeholders_ta?.length ? ex.key_stakeholders_ta : ex.key_stakeholders) || [];
  const risks         = (ta && ex.risks_if_ignored_ta?.length ? ex.risks_if_ignored_ta : ex.risks_if_ignored) || [];

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
            {/* 1 — Association details (identity + meta the AI extracted). Always
                 visible; individual tiles self-hide when the field is empty. */}
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

            {/* 2 — The collective ask */}
            <SectionShell
              n={2} id="ask" title="The collective ask"
              hidden={!specified(ask) && !specified(demand)}
            >
              <div className="space-y-3">
                <Reading label="Ask" text={ask} />
                <Reading label="Why now" text={demand} />
              </div>
            </SectionShell>

            {/* 3 — Summary + key details */}
            <SectionShell
              n={3} id="summary" title="Summary"
              hidden={!specified(summary) && keyDetails.length === 0}
            >
              <div className="space-y-3">
                <Reading label="Overview" text={summary} />
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

            {/* 4 — Stakeholders + risks (side by side) */}
            <SectionShell
              n={4} id="stake-risk" title="Stakeholders & risks"
              hidden={stakeholders.length === 0 && risks.length === 0}
            >
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

            {/* 5 — Expected outcome + precedent */}
            <SectionShell
              n={5} id="outcome" title="Outcome & precedent"
              hidden={!specified(outcome) && !specified(precedent)}
            >
              <div className="space-y-3">
                <Reading label="Expected outcome (as stated)" text={outcome} />
                <Reading label="Precedent / prior actions" text={precedent} />
              </div>
            </SectionShell>

            {/* 6 — AI Assessment (moved down: reviewer forms their own view of the
                 fields above, then reads the AI's take). Rationale block hides
                 gracefully when the AI didn't record one. */}
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

      {/* Sticky decision bar — Reviewed / Forward-to-dept (matches backend enum) */}
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
    </div>
  );
}

// ── compact custom date-range control — matches the h-8 pill height of a
//    FilterChip so it sits inline with the other chips instead of towering
//    over them like the existing DateRangePill (h-11) would. Native picker
//    fires on click via showPicker() when the browser supports it; the
//    <input> keeps validation + keyboard round-trip. Empty end === open range.
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

// ── filter chip: compact dropdown that shows just the label until a value is
//    picked, then flips to a coloured chip with an inline X to clear. The
//    Select primitive can't hold value="" for "no selection" so we use a
//    sentinel (`ANY`) and translate it back to null on the way in / out.
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
      {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-[132px] shrink-0 rounded-lg" />)}
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
      <Users2 className="h-8 w-8 text-muted-foreground/40" />
      <p className="text-sm font-medium text-foreground">Select an association to open</p>
      <p className="max-w-xs text-[13px] text-muted-foreground">Pick an association from the list — the document opens on the left, the summary sections on the right.</p>
    </div>
  );
}
function EmptyState() {
  return (
    <Card className="flex flex-col items-center justify-center gap-2 py-16 text-center shadow-card">
      <Inbox className="h-8 w-8 text-muted-foreground" />
      <p className="text-sm font-medium text-foreground">No associations here yet</p>
      <p className="text-[13px] text-muted-foreground">Union / association submissions from AI Uploads will appear here once their brief is ready.</p>
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
