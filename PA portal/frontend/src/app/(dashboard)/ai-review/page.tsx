"use client";

import { memo, useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  ClipboardCheck, RefreshCw, Check, Pencil, X, FileText, Search,
  AlertTriangle, Clock, Loader2, Ticket as TicketIcon, Phone, Languages, ShieldAlert,
  QrCode, ScanLine, UserCog, SlidersHorizontal,
} from "lucide-react";
import { toast } from "sonner";

import TopBar from "@/components/TopBar";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import AppointmentDetailDrawer from "@/components/AppointmentDetailDrawer";
import { useLang } from "@/lib/lang-context";
import { cn } from "@/lib/utils";
import { fetchAppointments } from "@/lib/api";
import type { AppointmentRow } from "@/lib/types";

interface Upload {
  id: number; filename: string; mime_type: string; file_url: string | null;
  status: "QUEUED" | "PROCESSING" | "AWAITING_REVIEW" | "REVIEWED" | "FAILED";
  name: string | null; name_ta: string | null; mobile: string | null;
  category: string | null; urgency: string | null; department: string | null;
  headline: string | null; headline_ta: string | null;
  summary: string | null; summary_ta: string | null;
  citizen_ask: string | null; citizen_ask_ta: string | null;
  key_details: string[]; key_details_ta: string[];
  error: string | null; ticket_number: string | null; appointment_id: number | null; created_at: string | null;
}

type StatusKey = "QUEUED" | "PROCESSING" | "AWAITING_REVIEW" | "REVIEWED" | "FAILED";

interface InboxRow {
  kind: "upload" | "petition";
  id: number;
  name: string | null;
  mobile: string | null;
  category: string | null;
  urgency: string | null;
  statusKey: StatusKey;
  source: string;
  created_at: string | null;
  ticket_number: string | null;
  upload?: Upload;
  petition?: AppointmentRow;
}

const CATEGORIES = ["action_required","proposals","transfer_requests","pension_requests","school_admission","job_requests","rti","associations_unions","school_upgradation","invitation","greetings","general","other"];
const URGENCIES = ["low", "medium", "high", "critical"];

const SEGMENTS: { key: "" | StatusKey; tKey: string }[] = [
  { key: "",                tKey: "petition.segAll" },
  { key: "AWAITING_REVIEW", tKey: "petition.segAwaiting" },
  { key: "REVIEWED",        tKey: "petition.segReviewed" },
  { key: "FAILED",          tKey: "petition.segFailed" },
  { key: "PROCESSING",      tKey: "petition.segProcessing" },
];

const URGENCY_CLS: Record<string, string> = {
  critical: "bg-red-100 text-red-700", high: "bg-orange-100 text-orange-700",
  medium: "bg-amber-100 text-amber-700", low: "bg-slate-100 text-slate-600",
};

const SOURCE_META: Record<string, { tKey: string; cls: string; icon: typeof QrCode }> = {
  qr_citizen:  { tKey: "petition.sourceCitizen", cls: "bg-sky-100 text-sky-700",       icon: QrCode },
  ai_scan:     { tKey: "petition.sourceScanned", cls: "bg-violet-100 text-violet-700", icon: ScanLine },
  manual_staff:{ tKey: "petition.sourceStaff",   cls: "bg-slate-100 text-slate-600",   icon: UserCog },
};

const STATUS_TKEY: Record<StatusKey, string> = {
  QUEUED:          "petition.statusQueued",
  PROCESSING:      "petition.statusProcessing",
  AWAITING_REVIEW: "petition.statusAwaitingReview",
  REVIEWED:        "petition.statusReviewed",
  FAILED:          "petition.statusFailed",
};

const STATUS_CLS: Record<StatusKey, string> = {
  QUEUED:          "bg-slate-100 text-slate-600",
  PROCESSING:      "bg-blue-100 text-blue-700",
  AWAITING_REVIEW: "bg-amber-100 text-amber-700",
  REVIEWED:        "bg-emerald-100 text-emerald-700",
  FAILED:          "bg-red-100 text-red-700",
};

const STATUS_ICON: Record<StatusKey, typeof Clock> = {
  QUEUED:          Clock,
  PROCESSING:      Loader2,
  AWAITING_REVIEW: AlertTriangle,
  REVIEWED:        Check,
  FAILED:          X,
};

const pretty = (s: string) => s.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
const api = (p: string) => `/api/ai-uploads${p}`;

function petitionStatusKey(status: string): StatusKey {
  return status === "Reviewed" ? "REVIEWED" : "AWAITING_REVIEW";
}

const InboxTableRow = memo(function InboxTableRow({
  row, t, onOpen, onRetry,
}: {
  row: InboxRow;
  t: (k: string) => string;
  onOpen: (r: InboxRow) => void;
  onRetry: (ids: number[]) => void;
}) {
  const Icon = STATUS_ICON[row.statusKey];
  const sm = SOURCE_META[row.source] ?? { tKey: "petition.sourceStaff", cls: "bg-muted text-muted-foreground", icon: FileText };
  const SIcon = sm.icon;
  const clickable = row.statusKey === "AWAITING_REVIEW" || row.statusKey === "REVIEWED" || row.statusKey === "FAILED";
  return (
    <tr
      onClick={() => onOpen(row)}
      className={cn("border-t border-border/70", clickable ? "cursor-pointer hover:bg-muted/40" : "opacity-80")}
    >
      <td className="px-4 py-3 font-medium text-foreground">{row.name || <span className="text-muted-foreground">—</span>}</td>
      <td className="px-4 py-3 text-base text-muted-foreground">{row.mobile || "—"}</td>
      <td className="whitespace-nowrap px-4 py-3">
        <span className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[13px] font-semibold", sm.cls)}>
          <SIcon className="h-3.5 w-3.5" /> {t(sm.tKey)}
        </span>
      </td>
      <td className="px-4 py-3 text-base text-muted-foreground">{row.category ? pretty(row.category) : "—"}</td>
      <td className="px-4 py-3">
        {row.urgency
          ? <span className={cn("rounded px-2 py-0.5 text-[13px] font-semibold uppercase", URGENCY_CLS[row.urgency])}>{row.urgency}</span>
          : "—"}
      </td>
      <td className="whitespace-nowrap px-4 py-3">
        <span className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-1 text-[13px] font-semibold", STATUS_CLS[row.statusKey])}>
          <Icon className={cn("h-3.5 w-3.5", row.statusKey === "PROCESSING" && "animate-spin")} /> {t(STATUS_TKEY[row.statusKey])}
        </span>
        {row.ticket_number && <span className="ml-1.5 font-mono text-[13px] text-emerald-600">{row.ticket_number}</span>}
      </td>
      <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
        {row.statusKey === "AWAITING_REVIEW" && <Button size="sm" className="bg-violet-600 hover:bg-violet-700 text-white" onClick={() => onOpen(row)}>{t("petition.review")}</Button>}
        {row.statusKey === "REVIEWED" && <span className="inline-flex items-center gap-1 text-sm text-emerald-600"><TicketIcon className="h-3.5 w-3.5" /> {t("petition.done")}</span>}
        {row.statusKey === "FAILED" && <Button size="sm" variant="outline" onClick={() => onRetry([row.id])}><RefreshCw className="mr-1 h-3.5 w-3.5" /> {t("petition.retry")}</Button>}
        {(row.statusKey === "QUEUED" || row.statusKey === "PROCESSING") && <span className="text-sm text-muted-foreground">…</span>}
      </td>
    </tr>
  );
});

const InboxCard = memo(function InboxCard({
  row, t, onOpen, onRetry,
}: {
  row: InboxRow;
  t: (k: string) => string;
  onOpen: (r: InboxRow) => void;
  onRetry: (ids: number[]) => void;
}) {
  const Icon = STATUS_ICON[row.statusKey];
  const sm = SOURCE_META[row.source] ?? { tKey: "petition.sourceStaff", cls: "bg-muted text-muted-foreground", icon: FileText };
  const SIcon = sm.icon;
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen(row)}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(row); } }}
      className="w-full cursor-pointer rounded-xl border border-border bg-card p-3.5 text-left shadow-card transition-colors hover:bg-muted/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-base font-semibold text-foreground">{row.name || "—"}</div>
          <div className="text-sm text-muted-foreground">{row.mobile || "—"}</div>
        </div>
        <span className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[13px] font-semibold", STATUS_CLS[row.statusKey])}>
          <Icon className={cn("h-3.5 w-3.5", row.statusKey === "PROCESSING" && "animate-spin")} /> {t(STATUS_TKEY[row.statusKey])}
        </span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[13px] font-semibold", sm.cls)}>
          <SIcon className="h-3.5 w-3.5" /> {t(sm.tKey)}
        </span>
        {row.urgency && (
          <span className={cn("rounded px-2 py-0.5 text-[13px] font-semibold", URGENCY_CLS[row.urgency])}>{row.urgency}</span>
        )}
        {row.category && (
          <span className="text-sm text-muted-foreground">{pretty(row.category)}</span>
        )}
      </div>
      {row.ticket_number && (
        <div className="mt-2 font-mono text-sm text-emerald-600">{row.ticket_number}</div>
      )}
      {row.statusKey === "FAILED" && (
        <div className="mt-2" onClick={(e) => e.stopPropagation()}>
          <Button size="sm" variant="outline" onClick={() => onRetry([row.id])}><RefreshCw className="mr-1 h-3.5 w-3.5" /> {t("petition.retry")}</Button>
        </div>
      )}
    </div>
  );
});

export default function AiReviewPage() {
  const { t } = useLang();
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [petitions, setPetitions] = useState<AppointmentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [review, setReview] = useState<Upload | null>(null);
  const [reviewPetition, setReviewPetition] = useState<AppointmentRow | null>(null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Partial<Upload>>({});
  const [modalLang, setModalLang] = useState<"en" | "ta">("en");
  const [busy, setBusy] = useState(false);

  const [fStatus, setFStatus] = useState<"" | StatusKey>("");
  const [fUrgency, setFUrgency] = useState("");
  const [fSource, setFSource] = useState("");
  const [q, setQ] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const [uploadsRes, petitionsRes] = await Promise.allSettled([
        fetch(api(""), { credentials: "include", signal }).then(r => r.json()),
        fetchAppointments({ kind: "petition", status: "All", pageSize: 2000 }, signal),
      ]);
      if (signal?.aborted) return;
      if (uploadsRes.status === "fulfilled" && Array.isArray(uploadsRes.value)) setUploads(uploadsRes.value);
      if (petitionsRes.status === "fulfilled") {
        setPetitions((petitionsRes.value.items || []).filter((p: AppointmentRow) => p.source !== "ai_scan"));
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") { /* keep last good */ }
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    load(ctrl.signal);
    return () => ctrl.abort();
  }, [load]);

  // Live poll while queued/processing rows exist
  useEffect(() => {
    const active = uploads.some(u => u.status === "QUEUED" || u.status === "PROCESSING");
    if (!active) return;
    const id = setInterval(() => load(), 4000);
    return () => clearInterval(id);
  }, [uploads, load]);

  useEffect(() => {
    if (review && !editing) {
      const fresh = uploads.find(u => u.id === review.id);
      if (fresh) setReview(fresh);
    }
  }, [uploads]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!review) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !busy) setReview(null); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [review, busy]);

  useEffect(() => () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
  }, []);

  function onSearchChange(v: string) {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setQ(v), 300);
  }

  const rows = useMemo<InboxRow[]>(() => {
    const up: InboxRow[] = uploads.map(u => ({
      kind: "upload", id: u.id, name: u.name, mobile: u.mobile, category: u.category,
      urgency: u.urgency, statusKey: u.status, source: "ai_scan",
      created_at: u.created_at, ticket_number: u.ticket_number, upload: u,
    }));
    const pet: InboxRow[] = petitions.map(p => ({
      kind: "petition", id: p.id, name: p.name, mobile: p.mobile,
      category: p.category_label ?? p.category, urgency: p.urgency ?? null,
      statusKey: petitionStatusKey(p.status), source: p.source || "qr_citizen",
      created_at: p.created_at, ticket_number: null, petition: p,
    }));
    return [...up, ...pet].sort((a, b) =>
      (b.created_at || "").localeCompare(a.created_at || ""));
  }, [uploads, petitions]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { "": rows.length, AWAITING_REVIEW: 0, REVIEWED: 0, FAILED: 0, PROCESSING: 0, QUEUED: 0 };
    for (const r of rows) c[r.statusKey] = (c[r.statusKey] ?? 0) + 1;
    return c;
  }, [rows]);

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    return rows.filter(r =>
      (!fStatus || r.statusKey === fStatus) &&
      (!fUrgency || r.urgency === fUrgency) &&
      (!fSource || r.source === fSource) &&
      (!query || (r.name || "").toLowerCase().includes(query) || (r.mobile || "").includes(query))
    );
  }, [rows, fStatus, fUrgency, fSource, q]);

  const failedCount = uploads.filter(u => u.status === "FAILED").length;
  const advancedFilterCount = (fUrgency ? 1 : 0) + (fSource ? 1 : 0);
  const anyFilterActive = Boolean(q || fStatus || fUrgency || fSource);

  function openRow(r: InboxRow) {
    if (r.statusKey === "QUEUED" || r.statusKey === "PROCESSING") return;
    if (r.kind === "petition" && r.petition) {
      setReviewPetition(r.petition);
      return;
    }
    const u = r.upload!;
    setReview(u); setEditing(false); setModalLang("en");
    setForm({ name: u.name, name_ta: u.name_ta, mobile: u.mobile, category: u.category, urgency: u.urgency, summary: u.summary });
  }

  async function saveEdits() {
    if (!review) return;
    setBusy(true);
    try {
      const r = await fetch(api(`/${review.id}`), {
        method: "PATCH", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify(form),
      });
      const d = await r.json();
      if (r.ok) { toast.success("Saved"); setEditing(false); setReview(d); load(); }
      else toast.error(d.error || "Save failed");
    } catch { toast.error("Network error"); } finally { setBusy(false); }
  }

  async function approve() {
    if (!review) return;
    setBusy(true);
    try {
      const r = await fetch(api(`/${review.id}/approve`), { method: "POST", credentials: "include" });
      const d = await r.json();
      if (r.ok) { toast.success(`Ticket ${d.ticket_number} created`); setReview(null); load(); }
      else toast.error(d.error || "Approve failed");
    } catch { toast.error("Network error"); } finally { setBusy(false); }
  }

  const retry = useCallback(async (ids: number[]) => {
    if (!ids.length) return;
    try {
      const r = await fetch(api("/retry"), {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify({ ids }),
      });
      if (r.ok) { toast.success(`${ids.length} re-queued`); load(); }
      else toast.error("Retry failed");
    } catch { toast.error("Network error"); }
  }, [load]);

  function clearAllFilters() {
    setFStatus(""); setFUrgency(""); setFSource(""); setQ("");
  }

  const pick = <T,>(en: T, ta: T): T => (modalLang === "ta" ? (ta || en) : en);

  return (
    <>
      <TopBar
        title={t("petition.title")}
        subtitle={t("petition.subtitle")}
        icon={<ClipboardCheck className="h-5 w-5" />}
      />
      <main className="flex-1 overflow-y-auto bg-background">
        <div className="space-y-4 px-4 py-6 animate-in-up">

          {/* Search (left, wider) · Retry-all + Refresh (right) */}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="relative w-full sm:max-w-xl sm:flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                defaultValue={q}
                onChange={(e) => onSearchChange(e.target.value)}
                placeholder={t("petition.searchPlaceholder")}
                className="h-10 w-full rounded-lg border border-input bg-card pl-9 pr-3 text-base focus:border-violet-500 focus:outline-none"
              />
            </div>
            <div className="flex items-center gap-2 sm:flex-shrink-0">
              {failedCount > 0 && (
                <Button size="sm" variant="outline" className="border-red-300 text-red-700" onClick={() => retry(uploads.filter(u => u.status === "FAILED").map(u => u.id))}>
                  <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> {t("petition.retryAllFailed")} ({failedCount})
                </Button>
              )}
              <button onClick={() => load()} className="rounded-lg p-2 hover:bg-muted" title={t("petition.refresh")} aria-label={t("petition.refresh")}>
                <RefreshCw className="h-4 w-4 text-muted-foreground" />
              </button>
            </div>
          </div>

          {/* Unified toolbar — segments · filters · clear */}
          <Card className="flex flex-col gap-3 p-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap items-center gap-1.5">
              {SEGMENTS.map((s) => {
                const active = fStatus === s.key;
                const count = counts[s.key];
                return (
                  <button
                    key={s.key || "all"}
                    onClick={() => setFStatus(s.key)}
                    className={cn(
                      "flex items-center gap-2 rounded-lg px-3 py-1.5 text-base font-medium transition-colors",
                      active ? "bg-violet-600 text-white shadow-card" : "text-muted-foreground hover:bg-muted hover:text-foreground"
                    )}
                  >
                    {t(s.tKey)}
                    <span className={cn(
                      "min-w-[20px] rounded-full px-1.5 py-0.5 text-[13px] font-bold tabular-nums",
                      active ? "bg-white/20 text-white" : "bg-muted text-muted-foreground"
                    )}>
                      {count ?? "·"}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => setShowFilters((s) => !s)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-sm font-medium transition-colors",
                  showFilters || advancedFilterCount > 0
                    ? "border-violet-500 bg-violet-50 text-violet-700"
                    : "border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                <SlidersHorizontal className="h-3.5 w-3.5" />
                {t("petition.filters")}
                {advancedFilterCount > 0 && (
                  <span className="ml-0.5 grid h-4 min-w-[16px] place-items-center rounded-full bg-violet-600 px-1 text-xs font-bold text-white">
                    {advancedFilterCount}
                  </span>
                )}
              </button>
              {anyFilterActive && (
                <button
                  onClick={clearAllFilters}
                  className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm font-medium text-muted-foreground transition-colors hover:text-red-600"
                >
                  <X className="h-3.5 w-3.5" /> {t("petition.clearAll")}
                </button>
              )}
            </div>
          </Card>

          {/* Advanced filters — collapsible */}
          {showFilters && (
            <Card className="grid gap-3 p-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1">
                <label className="text-[13px] font-semibold uppercase tracking-wider text-muted-foreground">{t("petition.colSource")}</label>
                <select value={fSource} onChange={(e) => setFSource(e.target.value)}
                  className="h-9 rounded-lg border border-input bg-card px-3 text-base focus:border-violet-500 focus:outline-none">
                  <option value="">{`All ${t("petition.colSource").toLowerCase()}`}</option>
                  {Object.entries(SOURCE_META).map(([k, m]) => <option key={k} value={k}>{t(m.tKey)}</option>)}
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[13px] font-semibold uppercase tracking-wider text-muted-foreground">{t("petition.colUrgency")}</label>
                <select value={fUrgency} onChange={(e) => setFUrgency(e.target.value)}
                  className="h-9 rounded-lg border border-input bg-card px-3 text-base focus:border-violet-500 focus:outline-none">
                  <option value="">{`All ${t("petition.colUrgency").toLowerCase()}`}</option>
                  {URGENCIES.map(u => <option key={u} value={u}>{pretty(u)}</option>)}
                </select>
              </div>
            </Card>
          )}

          {/* Desktop table */}
          <Card className="hidden overflow-hidden p-0 md:block">
            <div className="overflow-x-auto">
              <table className="w-full table-fixed text-left text-base">
                <thead className="bg-muted/50 text-[13px] uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="w-[18%] px-4 py-3">{t("petition.colName")}</th>
                    <th className="w-[12%] px-4 py-3">{t("petition.colPhone")}</th>
                    <th className="w-[14%] px-4 py-3">{t("petition.colSource")}</th>
                    <th className="w-[18%] px-4 py-3">{t("petition.colCategory")}</th>
                    <th className="w-[9%] px-4 py-3">{t("petition.colUrgency")}</th>
                    <th className="w-[17%] px-4 py-3">{t("petition.colStatus")}</th>
                    <th className="w-[12%] px-4 py-3 text-right">{t("petition.colAction")}</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    Array.from({ length: 3 }).map((_, i) => (
                      <tr key={i} className="border-t border-border/60">
                        <td className="px-4 py-3"><Skeleton className="h-4 w-28" /></td>
                        <td className="px-4 py-3"><Skeleton className="h-4 w-24" /></td>
                        <td className="px-4 py-3"><Skeleton className="h-5 w-24 rounded-full" /></td>
                        <td className="px-4 py-3"><Skeleton className="h-4 w-24" /></td>
                        <td className="px-4 py-3"><Skeleton className="h-5 w-12 rounded" /></td>
                        <td className="px-4 py-3"><Skeleton className="h-5 w-24 rounded-full" /></td>
                        <td className="px-4 py-3"><Skeleton className="ml-auto h-8 w-20 rounded-md" /></td>
                      </tr>
                    ))
                  ) : filtered.length === 0 ? (
                    <tr><td colSpan={7} className="px-4 py-16 text-center">
                      <ClipboardCheck className="mx-auto mb-3 h-10 w-10 text-muted-foreground/30" />
                      <div className="text-base font-medium text-foreground">{rows.length === 0 ? t("petition.noResults") : t("petition.noResults")}</div>
                      {anyFilterActive ? (
                        <>
                          <div className="text-sm text-muted-foreground">{t("petition.noResultsFiltered")}</div>
                          <button
                            onClick={clearAllFilters}
                            className="mt-3 inline-flex items-center gap-1 rounded-md border border-border bg-card px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-muted"
                          >
                            <X className="h-3.5 w-3.5" /> {t("petition.clearAllFilters")}
                          </button>
                        </>
                      ) : null}
                    </td></tr>
                  ) : filtered.map(r => (
                    <InboxTableRow key={`${r.kind}-${r.id}`} row={r} t={t} onOpen={openRow} onRetry={retry} />
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {/* Mobile cards */}
          <div className="space-y-2.5 md:hidden">
            {loading ? (
              Array.from({ length: 3 }).map((_, i) => (
                <Card key={i} className="p-3.5"><Skeleton className="h-24 w-full" /></Card>
              ))
            ) : filtered.length === 0 ? (
              <Card className="p-8 text-center">
                <ClipboardCheck className="mx-auto mb-3 h-10 w-10 text-muted-foreground/30" />
                <div className="text-base font-medium text-foreground">{t("petition.noResults")}</div>
                {anyFilterActive && (
                  <button
                    onClick={clearAllFilters}
                    className="mt-3 inline-flex items-center gap-1 rounded-md border border-border bg-card px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-muted"
                  >
                    <X className="h-3.5 w-3.5" /> {t("petition.clearAllFilters")}
                  </button>
                )}
              </Card>
            ) : (
              filtered.map(r => <InboxCard key={`${r.kind}-${r.id}`} row={r} t={t} onOpen={openRow} onRetry={retry} />)
            )}
          </div>
        </div>
      </main>

      {/* Upload review — document left, fields right */}
      {review && (
        <div className="fixed inset-0 z-50 flex bg-slate-900/50" onClick={() => !busy && setReview(null)}>
          <div className="m-auto flex h-[94vh] w-[95vw] overflow-hidden rounded-2xl bg-white shadow-2xl" onClick={e => e.stopPropagation()}>
            {/* Left — document (inline preview, download disabled) */}
            <div className="hidden w-[48%] flex-col border-r border-border bg-slate-100 md:flex">
              <div className="flex items-center gap-1.5 border-b border-border bg-white px-4 py-2.5 text-base font-semibold">
                <FileText className="h-4 w-4 text-muted-foreground" /> <span className="truncate">{review.filename}</span>
              </div>
              <div className="flex-1 overflow-auto p-3" onContextMenu={(e) => e.preventDefault()}>
                {review.file_url ? (
                  review.mime_type === "application/pdf"
                    ? <iframe
                        src={`${review.file_url}#toolbar=0&navpanes=0`}
                        className="h-full w-full rounded-lg border border-border bg-white"
                        title="document"
                        sandbox="allow-same-origin allow-scripts"
                      />
                    : (// eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={review.file_url}
                        alt="petition"
                        className="mx-auto max-w-full select-none rounded-lg shadow"
                        draggable={false}
                      />)
                ) : <div className="grid h-full place-items-center text-muted-foreground">{t("petition.noPreview")}</div>}
              </div>
            </div>

            {/* Right — details */}
            <div className="flex w-full flex-col md:w-[52%]">
              <div className="flex items-start gap-3 border-b border-border px-7 py-5">
                <div className="min-w-0 flex-1">
                  <div className="text-xl font-bold leading-snug">{pick(review.headline, review.headline_ta) || review.name || "Petition"}</div>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <span className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold", STATUS_CLS[review.status])}>{t(STATUS_TKEY[review.status])}</span>
                    {review.urgency && <span className={cn("rounded-full px-2.5 py-0.5 text-xs font-semibold uppercase", URGENCY_CLS[review.urgency])}>{review.urgency}</span>}
                    {review.category && <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">{pretty(review.category)}</span>}
                    {review.ticket_number && <span className="font-mono text-sm text-emerald-600">{review.ticket_number}</span>}
                  </div>
                </div>
                <LangToggle lang={modalLang} onChange={setModalLang} />
                {review.status === "AWAITING_REVIEW" && (
                  !editing
                    ? <Button size="sm" variant="outline" onClick={() => setEditing(true)}><Pencil className="mr-1.5 h-3.5 w-3.5" /> {t("petition.editLabel")}</Button>
                    : <Button size="sm" variant="outline" onClick={saveEdits} disabled={busy}><Check className="mr-1.5 h-3.5 w-3.5" /> {t("petition.saveLabel")}</Button>
                )}
                <button onClick={() => !busy && setReview(null)} className="rounded-md p-1.5 hover:bg-muted"><X className="h-4 w-4" /></button>
              </div>

              <div className="flex-1 space-y-6 overflow-auto p-7">
                <div className="grid grid-cols-2 gap-x-8 gap-y-5">
                  <Field label={t("petition.colName")} editing={editing} value={form.name} fallback={review.name} onChange={v => setForm(f => ({ ...f, name: v }))} />
                  <Field label={t("petition.colPhone")} editing={editing} value={form.mobile} fallback={review.mobile} onChange={v => setForm(f => ({ ...f, mobile: v }))} icon={Phone} />
                  {editing && <Field label={t("petition.fNameTa")} editing value={form.name_ta} fallback={review.name_ta} onChange={v => setForm(f => ({ ...f, name_ta: v }))} />}
                  <SelectField label={t("petition.colCategory")} editing={editing} value={form.category} fallback={review.category} options={CATEGORIES} onChange={v => setForm(f => ({ ...f, category: v }))} />
                  <SelectField label={t("petition.colUrgency")} editing={editing} value={form.urgency} fallback={review.urgency} options={URGENCIES} onChange={v => setForm(f => ({ ...f, urgency: v }))} />
                </div>
                {review.department && <div className="text-sm text-muted-foreground">{t("petition.fDept")}: {pretty(review.department)}</div>}

                <Panel title="Summary">
                  {editing
                    ? <textarea className="w-full rounded-lg border border-input px-3 py-2 text-base" rows={4} value={form.summary ?? ""} onChange={e => setForm(f => ({ ...f, summary: e.target.value }))} />
                    : <p className="text-base leading-relaxed text-foreground">{pick(review.summary, review.summary_ta) || "—"}</p>}
                </Panel>

                {pick(review.citizen_ask, review.citizen_ask_ta) && (
                  <div className="rounded-r-lg border-l-[3px] border-violet-500 bg-violet-50/50 py-3 pl-4 pr-3">
                    <div className="mb-1 text-xs font-bold uppercase tracking-[0.16em] text-violet-700">What they're asking for</div>
                    <p className="text-[15px] font-semibold text-foreground">{pick(review.citizen_ask, review.citizen_ask_ta)}</p>
                  </div>
                )}

                {(() => {
                  const list = pick(review.key_details, review.key_details_ta) || [];
                  if (!list.length) return null;
                  return (
                    <Panel title="Key details">
                      <ul className="space-y-1.5">
                        {list.map((d, i) => <li key={i} className="flex gap-2.5 text-[15px] text-foreground/85"><span className="mt-[8px] h-1.5 w-1.5 shrink-0 rounded-full bg-violet-400" /><span>{d}</span></li>)}
                      </ul>
                    </Panel>
                  );
                })()}

                {review.status === "FAILED" && review.error && (
                  <div className="flex items-start gap-2 rounded-lg bg-red-50 p-3 text-base text-red-700">
                    <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" /><span>{review.error}</span>
                  </div>
                )}
              </div>

              <div className="border-t border-border px-7 py-5">
                {review.status === "AWAITING_REVIEW" && (
                  <Button className="w-full bg-emerald-600 hover:bg-emerald-700 text-white" onClick={approve} disabled={busy || editing}>
                    {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />} {t("petition.approveCta")}
                  </Button>
                )}
                {review.status === "REVIEWED" && (
                  <div className="flex items-center justify-center gap-2 text-base font-semibold text-emerald-600"><TicketIcon className="h-4 w-4" /> {t("petition.approvedAs")} {review.ticket_number}</div>
                )}
                {review.status === "FAILED" && (
                  <Button className="w-full" variant="outline" onClick={() => { retry([review.id]); setReview(null); }}>
                    <RefreshCw className="mr-2 h-4 w-4" /> {t("petition.retryExtraction")}
                  </Button>
                )}
                {editing && <p className="mt-1.5 text-center text-xs text-muted-foreground">{t("petition.saveBeforeApprove")}</p>}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* QR / staff petition review — reuses the appointment detail drawer */}
      <AppointmentDetailDrawer
        row={reviewPetition}
        onClose={() => setReviewPetition(null)}
        onStatusChange={() => { load(); }}
      />
    </>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 text-xs font-bold uppercase tracking-wider text-muted-foreground">{title}</div>
      {children}
    </div>
  );
}

function Field({ label, value, fallback, editing, onChange, icon: Icon }:
  { label: string; value?: string | null; fallback: string | null; editing: boolean; onChange: (v: string) => void; icon?: React.ElementType }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="text-[13px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</div>
      {editing
        ? <input className="w-full rounded-lg border border-input px-3 py-2 text-base" value={value ?? ""} onChange={e => onChange(e.target.value)} />
        : <div className="flex items-center gap-1.5 text-base font-medium leading-relaxed text-foreground">{Icon && <Icon className="h-3.5 w-3.5 text-muted-foreground" />}{fallback || "—"}</div>}
    </div>
  );
}

function SelectField({ label, value, fallback, editing, options, onChange }:
  { label: string; value?: string | null; fallback: string | null; editing: boolean; options: string[]; onChange: (v: string) => void }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="text-[13px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</div>
      {editing
        ? <select className="w-full rounded-lg border border-input bg-white px-2 py-2 text-base" value={value ?? ""} onChange={e => onChange(e.target.value)}>
            {options.map(o => <option key={o} value={o}>{o.replace(/_/g, " ")}</option>)}
          </select>
        : <div className="text-base font-medium leading-relaxed text-foreground">{fallback ? fallback.replace(/_/g, " ") : "—"}</div>}
    </div>
  );
}

function LangToggle({ lang, onChange }: { lang: "en" | "ta"; onChange: (l: "en" | "ta") => void }) {
  return (
    <div className="flex h-8 shrink-0 items-center gap-0.5 rounded-lg border border-border bg-muted/60 p-0.5 text-[13px] font-semibold">
      <Languages className="ml-1 h-3.5 w-3.5 text-muted-foreground" />
      {(["en", "ta"] as const).map(l => (
        <button key={l} onClick={() => onChange(l)}
          className={cn("rounded-md px-2 py-0.5 uppercase tracking-wider transition-colors", lang === l ? "bg-white text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>
          {l === "en" ? "EN" : "த"}
        </button>
      ))}
    </div>
  );
}
