"use client";

import { memo, useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  ClipboardCheck, RefreshCw, Check, Pencil, X, FileText, Search,
  AlertTriangle, Clock, Loader2, Ticket as TicketIcon, Phone, ShieldAlert,
  QrCode, ScanLine, UserCog, SlidersHorizontal, Forward, ChevronLeft, ChevronRight,
  ArrowUpDown, ArrowUp, ArrowDown, Download, CalendarDays,
  CalendarCheck, CalendarRange, HelpCircle, LayoutGrid, User, Tag, BarChart3, Building2, MapPin,
  Mail, Landmark, Archive,
} from "lucide-react";
import { toast } from "sonner";
import { motion } from "framer-motion";

import TopBar from "@/components/TopBar";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { InitialsAvatar } from "@/components/ui/avatar";
import { InlineAttachmentPreview } from "@/components/ui/inline-attachment-preview";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useLang } from "@/lib/lang-context";
import { cn } from "@/lib/utils";
import { fetchAppointments } from "@/lib/api";
import { MINISTRY_DISPLAY, DISTRICT_DISPLAY, CATEGORY_DISPLAY_EN, CATEGORY_DISPLAY_TA, priorityOptions } from "@/lib/enums";
import type { AppointmentRow, AppointmentAttachment } from "@/lib/types";

// The default School Education ministry — approve keeps it in the school
// department workflow ("Accept"); any other ministry is "Forward"ed out.
const SCHOOL_MINISTRY = "school_education_tamil_dev_info_publicity";
const MINISTRIES = Object.keys(MINISTRY_DISPLAY);
const DISTRICTS = Object.keys(DISTRICT_DISPLAY);

interface Upload {
  id: number; filename: string; mime_type: string; file_url: string | null;
  status: StatusKey;
  name: string | null; name_ta: string | null; mobile: string | null;
  category: string | null; priority: string | null; ministry: string | null; district: string | null;
  summary: string | null; summary_ta: string | null;
  citizen_ask: string | null; citizen_ask_ta: string | null;
  key_details: string[]; key_details_ta: string[];
  error: string | null; ticket_number: string | null; appointment_id: number | null; created_at: string | null;
  source?: string | null;
  // Unified review drawer: petitions reuse this shape with a source tag +
  // their own attachments/audio (uploads keep the single-file preview).
  _kind?: "upload" | "petition";
  attachments?: AppointmentAttachment[];
  audio_url?: string | null;
  audio_transcript?: string | null;
}

type StatusKey = "QUEUED" | "PROCESSING" | "AWAITING_REVIEW" | "REVIEWED" | "FAILED" | "DISMISSED";

interface InboxRow {
  kind: "upload" | "petition";
  id: number;
  name: string | null;
  name_ta: string | null;
  mobile: string | null;
  token: string | null;
  categoryKey: string | null;   // raw category key — drives label + distribution
  priority: string | null;
  statusKey: StatusKey;
  source: string;
  venue: string | null;         // venue registry key (petitions only)
  venue_label: string | null;   // friendly venue name from the registry
  created_at: string | null;
  ticket_number: string | null;
  summary: string | null;       // citizen's ask ("what they want") shown in the list
  summary_ta: string | null;
  upload?: Upload;
  petition?: AppointmentRow;
}

const CATEGORIES = ["action_required","proposals","transfer_requests","pension_requests","school_admission","job_requests","rti","associations_unions","school_upgradation","invitation","greetings","general","other"];
const PRIORITIES = ["low", "medium", "high", "critical"];
const PRIORITY_RANK: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };

// Note: QUEUED / PROCESSING rows are hidden from the UI entirely — the PA
// has nothing to do with them until they land in AWAITING_REVIEW. The live
// poll below re-fetches while any queued/processing rows exist, so they
// pop into the inbox silently.
const SEGMENTS: { key: "" | StatusKey; tKey: string }[] = [
  { key: "",                tKey: "petition.segAll" },
  { key: "AWAITING_REVIEW", tKey: "petition.segAwaiting" },
  { key: "REVIEWED",        tKey: "petition.segReviewed" },
  { key: "FAILED",          tKey: "petition.segFailed" },
];

const PRIORITY_CLS: Record<string, string> = {
  critical: "bg-red-100 text-red-700", high: "bg-orange-100 text-orange-700",
  medium: "bg-amber-100 text-amber-700", low: "bg-slate-100 text-slate-600",
};
const PRIORITY_DOT: Record<string, string> = {
  critical: "bg-red-500", high: "bg-orange-500", medium: "bg-amber-500", low: "bg-slate-400",
};
const PRIORITY_TKEY: Record<string, string> = {
  low: "petition.urgencyLow", medium: "petition.urgencyMedium",
  high: "petition.urgencyHigh", critical: "petition.urgencyCritical",
};

const SOURCE_META: Record<string, { tKey: string; cls: string; icon: typeof QrCode }> = {
  qr_citizen:  { tKey: "petition.sourceCitizen",  cls: "bg-sky-100 text-sky-700",      icon: QrCode },
  ai_scan:     { tKey: "petition.sourceScanned",  cls: "bg-blue-100 text-blue-700",    icon: ScanLine },
  manual_staff:{ tKey: "petition.sourceStaff",    cls: "bg-slate-100 text-slate-600",  icon: UserCog },
  postal:      { tKey: "petition.sourcePostal",   cls: "bg-amber-100 text-amber-700",  icon: Mail },
  cm_office:   { tKey: "petition.sourceCmOffice", cls: "bg-purple-100 text-purple-700",icon: Landmark },
};
const SOURCE_KEYS = Object.keys(SOURCE_META);

const STATUS_TKEY: Record<StatusKey, string> = {
  QUEUED:          "petition.statusQueued",
  PROCESSING:      "petition.statusProcessing",
  AWAITING_REVIEW: "petition.statusAwaitingReview",
  REVIEWED:        "petition.statusReviewed",
  FAILED:          "petition.statusFailed",
  DISMISSED:       "petition.statusDismissed",
};

const STATUS_CLS: Record<StatusKey, string> = {
  QUEUED:          "bg-slate-100 text-slate-600",
  PROCESSING:      "bg-blue-100 text-blue-700",
  AWAITING_REVIEW: "bg-amber-100 text-amber-700",
  REVIEWED:        "bg-emerald-100 text-emerald-700",
  FAILED:          "bg-red-100 text-red-700",
  DISMISSED:       "bg-slate-100 text-slate-500",
};

const STATUS_ICON: Record<StatusKey, typeof Clock> = {
  QUEUED:          Clock,
  PROCESSING:      Loader2,
  AWAITING_REVIEW: AlertTriangle,
  REVIEWED:        Check,
  FAILED:          X,
  DISMISSED:       Archive,
};

const pretty = (s: string) => s.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
const api = (p: string) => `/api/ai-uploads${p}`;

function petitionStatusKey(status: string): StatusKey {
  return status === "Reviewed" ? "REVIEWED" : "AWAITING_REVIEW";
}

/** Category label in the active language (falls back to a prettified key). */
function catLabel(key: string | null, lang: string): string {
  if (!key) return "—";
  const k = key.toLowerCase();
  return (lang === "ta" ? CATEGORY_DISPLAY_TA[k] : CATEGORY_DISPLAY_EN[k]) ?? pretty(key);
}

/** Citizen name in the active language — PA-entered Tamil name when set. */
function nameText(row: Pick<InboxRow, "name" | "name_ta">, lang: string): string {
  if (lang === "ta" && row.name_ta && row.name_ta.trim()) return row.name_ta.trim();
  return row.name || "—";
}

function dateLocale(lang: string): string {
  return lang === "ta" ? "ta-IN" : (undefined as unknown as string);
}

/** Split a timestamp into a date line + time line for the Submitted column. */
function fmtSubmitted(raw: string | null, lang: string): { date: string; time: string } {
  if (!raw) return { date: "—", time: "" };
  const d = new Date(raw);
  if (isNaN(d.getTime())) return { date: raw, time: "" };
  return {
    date: d.toLocaleDateString(dateLocale(lang), { day: "numeric", month: "short", year: "numeric" }),
    time: d.toLocaleTimeString(dateLocale(lang), { hour: "2-digit", minute: "2-digit", hour12: true }),
  };
}

function toISODate(d: Date) {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, "0"), day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

type DateChip = "today" | "yesterday" | "this_week" | "this_month" | "custom";

/** Quick submitted-date presets. */
function computeDateChip(chip: DateChip): { from: string; to: string } {
  const now = new Date(); now.setHours(0, 0, 0, 0);
  if (chip === "today") { const s = toISODate(now); return { from: s, to: s }; }
  if (chip === "yesterday") {
    const y = new Date(now); y.setDate(y.getDate() - 1); const s = toISODate(y);
    return { from: s, to: s };
  }
  if (chip === "this_week") {
    const day = now.getDay(); const monOffset = day === 0 ? -6 : 1 - day;
    const start = new Date(now); start.setDate(start.getDate() + monOffset);
    const end = new Date(start); end.setDate(end.getDate() + 6);
    return { from: toISODate(start), to: toISODate(end) };
  }
  // this_month
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return { from: toISODate(start), to: toISODate(end) };
}

/** Nice "Jul 1 – Jul 7, 2026" label for the submitted-date summary tile. */
function dateRangeLabel(from: string, to: string, lang: string): string {
  const fmt = (iso: string) => new Date(iso + "T00:00:00").toLocaleDateString(dateLocale(lang), { day: "numeric", month: "short", year: "numeric" });
  const fmtShort = (iso: string) => new Date(iso + "T00:00:00").toLocaleDateString(dateLocale(lang), { day: "numeric", month: "short" });
  if (from && to) return from === to ? fmt(from) : `${fmtShort(from)} – ${fmt(to)}`;
  if (from) return `${fmt(from)} →`;
  if (to) return `→ ${fmt(to)}`;
  return "";
}

// Map a QR/staff petition (AppointmentRow) into the unified review-drawer shape
// so every source renders in the scanned-petition drawer.
function mapPetitionToReview(p: AppointmentRow): Upload {
  return {
    _kind: "petition",
    id: p.id, filename: "Petition", mime_type: "", file_url: null,
    status: petitionStatusKey(p.status),
    name: p.name ?? null, name_ta: p.name_ta ?? null, mobile: p.mobile ?? null,
    category: p.category ?? null, priority: p.priority ?? null, ministry: p.ministry ?? null, district: p.district ?? null,
    summary: p.summary ?? null, summary_ta: p.summary_ta ?? null,
    citizen_ask: p.citizen_ask ?? null, citizen_ask_ta: p.citizen_ask_ta ?? null,
    key_details: p.key_details ?? [], key_details_ta: p.key_details_ta ?? [],
    error: null, ticket_number: null, appointment_id: p.id, created_at: p.created_at,
    attachments: p.attachments ?? [], audio_url: p.audio_url ?? null, audio_transcript: p.audio_transcript ?? null,
  };
}

/** Numbered pagination — 1 … current−1 current current+1 … last. */
function pageList(current: number, last: number): (number | "…")[] {
  if (last <= 7) return Array.from({ length: last }, (_, i) => i + 1);
  const wanted = [1, current - 1, current, current + 1, last].filter((p) => p >= 1 && p <= last);
  const sorted = [...new Set(wanted)].sort((a, b) => a - b);
  const out: (number | "…")[] = [];
  let prev = 0;
  for (const p of sorted) {
    if (p - prev > 1) out.push("…");
    out.push(p);
    prev = p;
  }
  return out;
}

const InboxTableRow = memo(function InboxTableRow({
  row, t, lang, active, onOpen,
}: {
  row: InboxRow;
  t: (k: string) => string;
  lang: string;
  active: boolean;
  onOpen: (r: InboxRow) => void;
}) {
  const sm = SOURCE_META[row.source] ?? { tKey: "petition.sourceStaff", cls: "bg-muted text-muted-foreground", icon: FileText };
  const SIcon = sm.icon;
  const sub = fmtSubmitted(row.created_at, lang);
  const summaryText = lang === "ta" ? (row.summary_ta || row.summary) : row.summary;
  return (
    <tr
      onClick={() => onOpen(row)}
      className={cn(
        "group cursor-pointer border-b border-border/60 transition-[background-color,box-shadow] duration-150",
        active
          ? "bg-brand/[0.05] shadow-[inset_3px_0_0_hsl(var(--accent-blue)),inset_0_0_0_1px_hsl(var(--accent-blue)/0.14)]"
          : "hover:bg-[#EFF3FB] hover:shadow-[inset_3px_0_0_hsl(var(--accent-blue)/0.45)]",
      )}
    >
      <td className="px-4 py-4">
        <div className="flex items-center gap-3">
          <InitialsAvatar name={row.name ?? "—"} className="h-9 w-9 rounded-lg text-xs" />
          <div className="min-w-0">
            <div className="type-table-row truncate text-foreground">{nameText(row, lang)}</div>
            {row.token && <div className="font-mono text-[13px] font-semibold text-brand">{row.token}</div>}
          </div>
        </div>
      </td>
      <td className="max-w-[340px] px-4 py-4">
        {summaryText
          ? <div className="line-clamp-2 text-sm leading-snug text-foreground/85">{summaryText}</div>
          : <span className="text-sm italic text-muted-foreground/40">—</span>}
      </td>
      <td className="whitespace-nowrap px-4 py-4">
        <span className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[13px] font-semibold", sm.cls)}>
          <SIcon className="h-3.5 w-3.5" /> {t(sm.tKey)}
        </span>
      </td>
      <td className="max-w-[200px] px-4 py-4">
        {row.venue ? (
          <span className="inline-flex items-center gap-1.5 text-sm text-foreground/85">
            <MapPin className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <span className="truncate">{row.venue_label || row.venue}</span>
          </span>
        ) : <span className="text-muted-foreground/40">—</span>}
      </td>
      <td className="px-4 py-4 text-[15px] font-semibold text-foreground">{catLabel(row.categoryKey, lang)}</td>
      <td className="px-4 py-4">
        {row.priority
          ? <span className={cn("rounded-md px-2 py-0.5 text-[12px] font-bold uppercase", PRIORITY_CLS[row.priority])}>{row.priority}</span>
          : <span className="text-muted-foreground/40">—</span>}
      </td>
      <td className="whitespace-nowrap px-4 py-4">
        {row.created_at ? (
          <div>
            <div className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
              <CalendarDays className="h-3.5 w-3.5 text-muted-foreground" />{sub.date}
            </div>
            {sub.time && <div className="mt-0.5 pl-5 text-[13px] text-muted-foreground">{sub.time}</div>}
          </div>
        ) : <span className="text-muted-foreground/40">—</span>}
      </td>
    </tr>
  );
});

const InboxCard = memo(function InboxCard({
  row, t, lang, onOpen, onRetry,
}: {
  row: InboxRow;
  t: (k: string) => string;
  lang: string;
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
      <div className="flex items-start gap-2.5">
        <InitialsAvatar name={row.name ?? "—"} />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="truncate text-base font-semibold text-foreground">{nameText(row, lang)}</div>
              {row.token
                ? <div className="font-mono text-[13px] font-semibold text-brand">{row.token}</div>
                : <div className="text-sm text-muted-foreground">{row.mobile || "—"}</div>}
            </div>
            <span className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[13px] font-semibold", STATUS_CLS[row.statusKey])}>
              <Icon className={cn("h-3.5 w-3.5", row.statusKey === "PROCESSING" && "animate-spin")} /> {t(STATUS_TKEY[row.statusKey])}
            </span>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[13px] font-semibold", sm.cls)}>
              <SIcon className="h-3.5 w-3.5" /> {t(sm.tKey)}
            </span>
            {row.priority && (
              <span className={cn("rounded px-2 py-0.5 text-[13px] font-semibold uppercase", PRIORITY_CLS[row.priority])}>{row.priority}</span>
            )}
            {row.categoryKey && (
              <span className="text-sm text-muted-foreground">{catLabel(row.categoryKey, lang)}</span>
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
      </div>
    </div>
  );
});

export default function AiReviewPage() {
  const { t, lang } = useLang();
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [petitions, setPetitions] = useState<AppointmentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [review, setReview] = useState<Upload | null>(null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Partial<Upload>>({});
  const [busy, setBusy] = useState(false);

  // Default to Awaiting Review — that's the actionable queue PAs care about on
  // open. They can widen to All via the tabs if they want history.
  const [fStatus, setFStatus] = useState<"" | StatusKey>("AWAITING_REVIEW");
  const [fPriority, setFPriority] = useState("");
  const [fSource, setFSource] = useState("");
  const [fCategory, setFCategory] = useState("");   // driven by the distribution chart
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [dateChip, setDateChip] = useState<DateChip | null>(null);
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<"submitted_desc" | "submitted_asc" | "priority_desc">("submitted_desc");
  const [showRail, setShowRail] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);

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

  // Aurora Recall — ⌘K / Ctrl-K focuses the header search from anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
  }, []);

  function onSearchChange(v: string) {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => { setPage(1); setQ(v); }, 300);
  }

  const rows = useMemo<InboxRow[]>(() => {
    const up: InboxRow[] = uploads.map(u => ({
      kind: "upload", id: u.id, name: u.name, name_ta: u.name_ta, mobile: u.mobile,
      token: u.ticket_number, categoryKey: u.category,
      priority: u.priority, statusKey: u.status, source: u.source || "ai_scan", venue: null, venue_label: null,
      created_at: u.created_at, ticket_number: u.ticket_number,
      summary: u.citizen_ask ?? null, summary_ta: u.citizen_ask_ta ?? null,
      upload: u,
    }));
    const pet: InboxRow[] = petitions.map(p => ({
      kind: "petition", id: p.id, name: p.name, name_ta: p.name_ta ?? null, mobile: p.mobile,
      token: p.token != null ? String(p.token) : null,
      categoryKey: p.category ?? null, priority: p.priority ?? null,
      statusKey: petitionStatusKey(p.status), source: p.source || "qr_citizen", venue: p.venue ?? null, venue_label: p.venue_label ?? null,
      created_at: p.created_at, ticket_number: null,
      summary: p.citizen_ask ?? null, summary_ta: p.citizen_ask_ta ?? null,
      petition: p,
    }));
    return [...up, ...pet].sort((a, b) =>
      (b.created_at || "").localeCompare(a.created_at || ""));
  }, [uploads, petitions]);

  // Rows the PA can actually act on — QUEUED / PROCESSING are hidden from
  // the whole surface (feed + counts + tabs) so nothing "processing" shows.
  const visibleRows = useMemo(
    () => rows.filter(r => r.statusKey !== "QUEUED" && r.statusKey !== "PROCESSING"),
    [rows],
  );

  const counts = useMemo(() => {
    const c: Record<string, number> = { "": visibleRows.length, AWAITING_REVIEW: 0, REVIEWED: 0, FAILED: 0 };
    for (const r of visibleRows) c[r.statusKey] = (c[r.statusKey] ?? 0) + 1;
    return c;
  }, [visibleRows]);

  // Everything except the chart-driven category filter — the table's base
  // scope and the distribution chart's own scope (so every bar stays visible).
  const scoped = useMemo(() => {
    const query = q.trim().toLowerCase();
    const fromKey = dateFrom || "";
    const toKey = dateTo || "";
    return visibleRows.filter(r => {
      if (fStatus && r.statusKey !== fStatus) return false;
      if (fPriority && r.priority !== fPriority) return false;
      if (fSource && r.source !== fSource) return false;
      if (fromKey || toKey) {
        const day = (r.created_at || "").slice(0, 10);
        if (!day) return false;
        if (fromKey && day < fromKey) return false;
        if (toKey && day > toKey) return false;
      }
      if (query) {
        const inName = (r.name || "").toLowerCase().includes(query);
        const inMobile = (r.mobile || "").includes(query);
        const inToken = (r.token || "").toLowerCase().includes(query);
        if (!inName && !inMobile && !inToken) return false;
      }
      return true;
    });
  }, [visibleRows, fStatus, fPriority, fSource, dateFrom, dateTo, q]);

  const filtered = useMemo(() => {
    const base = fCategory
      ? scoped.filter(r => (r.categoryKey || "other").toLowerCase() === fCategory)
      : scoped;
    const sorted = [...base];
    sorted.sort((a, b) => {
      if (sort === "priority_desc") {
        const d = (PRIORITY_RANK[b.priority || ""] ?? 0) - (PRIORITY_RANK[a.priority || ""] ?? 0);
        if (d) return d;
        return (b.created_at || "").localeCompare(a.created_at || "");
      }
      const cmp = (a.created_at || "").localeCompare(b.created_at || "");
      return sort === "submitted_asc" ? cmp : -cmp;
    });
    return sorted;
  }, [scoped, fCategory, sort]);

  // Category distribution — stable axis (every category seen), counts scoped.
  const distribution = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of visibleRows) {
      const k = (r.categoryKey || "other").toLowerCase();
      if (!counts.has(k)) counts.set(k, 0);
    }
    for (const r of scoped) {
      const k = (r.categoryKey || "other").toLowerCase();
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    return Array.from(counts, ([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count);
  }, [visibleRows, scoped]);

  const total = filtered.length;
  const lastPage = Math.max(1, Math.ceil(total / pageSize));
  useEffect(() => { if (page > lastPage) setPage(lastPage); }, [page, lastPage]);
  const offset = (page - 1) * pageSize;
  const pageRows = filtered.slice(offset, offset + pageSize);

  const failedCount = uploads.filter(u => u.status === "FAILED").length;
  const advancedFilterCount = (fPriority ? 1 : 0) + (fSource ? 1 : 0) + (fCategory ? 1 : 0) + ((dateFrom || dateTo) ? 1 : 0);
  const anyFilterActive = Boolean(q || fPriority || fSource || fCategory || dateFrom || dateTo);

  function openRow(r: InboxRow) {
    if (r.statusKey === "QUEUED" || r.statusKey === "PROCESSING") return;
    setEditing(false);
    if (r.kind === "petition" && r.petition) {
      const rv = mapPetitionToReview(r.petition);
      setReview(rv);
      // Phone is OTP-verified (kept read-only); everything else is editable.
      setForm({ name: rv.name, name_ta: rv.name_ta, summary: rv.summary, category: rv.category, priority: rv.priority, ministry: rv.ministry, district: rv.district });
      return;
    }
    const u = r.upload!;
    setReview({ ...u, _kind: "upload" });
    setForm({ name: u.name, name_ta: u.name_ta, mobile: u.mobile, category: u.category, priority: u.priority, ministry: u.ministry, district: u.district, summary: u.summary });
  }

  async function saveEdits() {
    if (!review) return;
    setBusy(true);
    try {
      if (review._kind === "petition") {
        const r = await fetch(`/api/appointments/${review.id}/details`, {
          method: "PATCH", headers: { "Content-Type": "application/json" }, credentials: "include",
          body: JSON.stringify({
            name: form.name, name_ta: form.name_ta, summary: form.summary,
            category: form.category, priority: form.priority, ministry: form.ministry, district: form.district,
          }),
        });
        if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d.error || "Save failed"); }
        toast.success("Saved"); setEditing(false);
        setReview({
          ...review,
          name: form.name ?? review.name, name_ta: form.name_ta ?? review.name_ta, summary: form.summary ?? review.summary,
          category: form.category ?? review.category, priority: form.priority ?? review.priority, ministry: form.ministry ?? review.ministry, district: form.district ?? review.district,
        });
        load();
      } else {
        const r = await fetch(api(`/${review.id}`), {
          method: "PATCH", headers: { "Content-Type": "application/json" }, credentials: "include",
          body: JSON.stringify(form),
        });
        const d = await r.json();
        if (r.ok) { toast.success("Saved"); setEditing(false); setReview({ ...d, _kind: "upload" }); load(); }
        else toast.error(d.error || "Save failed");
      }
    } catch (e) { toast.error((e as Error).message || "Network error"); } finally { setBusy(false); }
  }

  async function approve() {
    if (!review) return;
    setBusy(true);
    try {
      const url = review._kind === "petition"
        ? `/api/appointments/${review.id}/approve`
        : api(`/${review.id}/approve`);
      const r = await fetch(url, { method: "POST", credentials: "include" });
      const d = await r.json().catch(() => ({}));
      if (r.ok) {
        toast.success(d.forwarded
          ? `Forwarded to ministry${d.ticket_number ? ` — ticket ${d.ticket_number}` : ""}`
          : (d.ticket_number ? `Ticket ${d.ticket_number} created` : "Approved"));
        setReview(null); load();
      } else toast.error(d.error || "Action failed");
    } catch { toast.error("Network error"); } finally { setBusy(false); }
  }

  // Dismiss — mark reviewed WITHOUT creating a ticket / citizen / appointment.
  // Uploads only; the corresponding path for citizen-submitted petitions is
  // a status flip we haven't wired yet, so surface a clear error there for now.
  async function dismiss() {
    if (!review) return;
    if (review._kind === "petition") {
      toast.error("Dismiss is only available for AI Uploads right now.");
      return;
    }
    if (!confirm("Dismiss this petition without creating a ticket? It stays in the All list for reference.")) return;
    setBusy(true);
    try {
      const r = await fetch(api(`/${review.id}/dismiss`), { method: "POST", credentials: "include" });
      const d = await r.json().catch(() => ({}));
      if (r.ok) { toast.success("Dismissed — no ticket created"); setReview(null); load(); }
      else toast.error(d.error || "Dismiss failed");
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

  const applyDateChip = useCallback((chip: DateChip) => {
    setPage(1);
    if (chip === "custom") { setDateChip("custom"); return; }
    if (dateChip === chip) { setDateChip(null); setDateFrom(""); setDateTo(""); return; }
    const { from, to } = computeDateChip(chip);
    setDateChip(chip); setDateFrom(from); setDateTo(to);
  }, [dateChip]);

  function clearAllFilters() {
    setFPriority(""); setFSource(""); setFCategory("");
    setDateFrom(""); setDateTo(""); setDateChip(null); setQ(""); setPage(1);
  }

  async function doExport() {
    const headers = ["Token", "Name", "Phone", "Source", "Venue", "Category", "Priority", "Status", "Submitted"];
    const lines = filtered.map((r) => [
      r.token ?? "", r.name ?? "", r.mobile ?? "",
      t(SOURCE_META[r.source]?.tKey ?? "petition.sourceStaff"),
      r.venue ?? "",
      catLabel(r.categoryKey, "en"), r.priority ?? "",
      t(STATUS_TKEY[r.statusKey]), r.created_at ?? "",
    ]);
    const csv = [headers, ...lines].map((row) => row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = "data:text/csv;charset=utf-8," + encodeURIComponent(csv);
    a.download = `petitions_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    toast.success(`${filtered.length} ${t("petition.results")}`);
  }

  const pick = <T,>(en: T, ta: T): T => (lang === "ta" ? (ta || en) : en);

  // Localized option labels for the Overview selects (respect the global lang).
  const catLabels = lang === "ta" ? CATEGORY_DISPLAY_TA : CATEGORY_DISPLAY_EN;
  const priorityLabels: Record<string, string> = {
    low: t("petition.urgencyLow"), medium: t("petition.urgencyMedium"),
    high: t("petition.urgencyHigh"), critical: t("petition.urgencyCritical"),
  };

  const th = "px-4 py-3.5 text-left text-[11px] font-semibold uppercase tracking-[0.09em] text-muted-foreground/80";
  const lo = total === 0 ? 0 : offset + 1;
  const hi = Math.min(offset + pageSize, total);


  return (
    <>
      <TopBar
        title={t("petition.title")}
        subtitle={t("petition.subtitle")}
        icon={<ClipboardCheck className="h-5 w-5" />}
        searchSlot={
          <div className="relative w-full">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={searchRef}
              defaultValue={q}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder={t("petition.searchPlaceholder")}
              className="peer h-10 rounded-full border-transparent bg-muted/70 pl-10 pr-14 text-sm transition-all duration-200 focus-visible:border-border focus-visible:bg-card focus-visible:shadow-[0_0_0_3px_hsl(var(--accent-blue)/0.14),0_2px_8px_rgba(28,30,41,0.06)]"
            />
            <kbd className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 font-mono text-[11px] font-semibold text-muted-foreground transition-all duration-200 peer-focus-visible:scale-90 peer-focus-visible:opacity-0">
              ⌘ K
            </kbd>
          </div>
        }
      />
      <main className="flex-1 overflow-y-auto bg-background xl:overflow-hidden">
        <div className="flex flex-col gap-4 px-4 py-6 animate-in-up xl:h-full">
          {/* Tabs (left) · Filters toggle + Export (right) */}
          <div className="flex shrink-0 flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap items-center gap-1.5">
              {SEGMENTS.map((s) => {
                const active = fStatus === s.key;
                const count = counts[s.key];
                return (
                  <button
                    key={s.key || "all"}
                    onClick={() => { setFStatus(s.key); setPage(1); }}
                    className={cn(
                      "relative flex items-center gap-2 rounded-[10px] px-3.5 py-2 text-[15px] font-semibold transition-colors duration-150",
                      active ? "text-brand" : "text-muted-foreground hover:bg-muted hover:text-foreground",
                    )}
                  >
                    {active && (
                      <motion.span
                        layoutId="petition-tab-pill"
                        className="aurora-tab-active absolute inset-0 rounded-[10px]"
                        transition={{ type: "spring", stiffness: 420, damping: 38 }}
                      />
                    )}
                    <span className="relative z-[1]">{t(s.tKey)}</span>
                    <span className={cn(
                      "relative z-[1] min-w-[22px] rounded-md px-1.5 py-0.5 text-center text-[12px] font-bold tabular-nums",
                      active ? "bg-white text-brand shadow-card" : "bg-muted text-muted-foreground",
                    )}>
                      {count ?? "·"}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {failedCount > 0 && (
                <Button size="sm" variant="outline" className="h-[38px] rounded-xl border-red-300 text-red-700"
                  onClick={() => retry(uploads.filter(u => u.status === "FAILED").map(u => u.id))}>
                  <RefreshCw className="mr-1 h-3.5 w-3.5" /> {t("petition.retryAllFailed")} ({failedCount})
                </Button>
              )}
              {([
                ["today", t("petition.dateToday"), CalendarCheck],
                ["this_week", t("petition.dateThisWeek"), CalendarRange],
                ["this_month", t("petition.dateThisMonth"), CalendarDays],
              ] as [DateChip, string, React.ElementType][]).map(([key, label, Icon]) => (
                <button
                  key={key}
                  onClick={() => applyDateChip(key)}
                  className={cn(
                    "inline-flex h-[38px] items-center gap-1.5 rounded-xl border px-3.5 text-sm font-semibold transition-colors",
                    dateChip === key
                      ? "border-[#CFE0FB] bg-accent text-brand"
                      : "border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  <Icon className="h-4 w-4" /> {label}
                </button>
              ))}
              <button
                onClick={() => setShowRail((s) => !s)}
                className={cn(
                  "inline-flex h-[38px] items-center gap-1.5 rounded-xl border px-3.5 text-sm font-semibold transition-colors",
                  showRail || advancedFilterCount > 0
                    ? "border-[#CFE0FB] bg-accent text-brand"
                    : "border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                <SlidersHorizontal className="h-4 w-4" />
                {t("petition.filters")}
                {advancedFilterCount > 0 && (
                  <span className="grid h-5 min-w-[20px] place-items-center rounded-full bg-brand px-1 text-[11px] font-bold text-brand-foreground">
                    {advancedFilterCount}
                  </span>
                )}
              </button>
              <button onClick={() => load()} title={t("petition.refresh")} aria-label={t("petition.refresh")}
                className="grid h-[38px] w-[38px] place-items-center rounded-xl border border-border bg-card text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
                <RefreshCw className="h-4 w-4" />
              </button>
              <Button variant="outline" onClick={doExport} className="h-[38px] rounded-xl">
                <Download className="h-4 w-4 text-brand" /> {t("petition.export")}
              </Button>
            </div>
          </div>

          {/* Two-column workspace: table (left) · filters + insights rail (right) */}
          <div className={cn(
            "grid gap-4 xl:min-h-0 xl:flex-1",
            showRail ? "xl:grid-cols-[minmax(0,1fr)_360px]" : "xl:grid-cols-1",
          )}>
            <div className="flex min-w-0 flex-col gap-4 xl:min-h-0">
              {/* Desktop table — fills to the bottom of the page; body scrolls */}
              <Card className="hidden overflow-hidden p-0 shadow-card-md md:block xl:flex xl:min-h-0 xl:flex-1 xl:flex-col">
                <div className="overflow-x-auto xl:min-h-0 xl:flex-1 xl:overflow-y-auto">
                  <table className="w-full min-w-[860px] text-base">
                    <thead className="sticky top-0 z-10 bg-card">
                      <tr className="border-b border-border">
                        <th className={cn(th, "w-[210px]")}>{t("petition.colName")}</th>
                        <th className={th}>{t("petition.colAsk")}</th>
                        <th className={cn(th, "w-36")}>{t("petition.colSource")}</th>
                        <th className={cn(th, "w-40")}>{t("petition.colVenue")}</th>
                        <th className={cn(th, "w-44")}>{t("petition.colCategory")}</th>
                        <th className={cn(th, "w-28")}>
                          <SortHeader label={t("petition.colUrgency")} state={sort === "priority_desc" ? "desc" : null}
                            onClick={() => { setPage(1); setSort((s) => s === "priority_desc" ? "submitted_desc" : "priority_desc"); }} />
                        </th>
                        <th className={cn(th, "w-40")}>
                          <SortHeader label={t("petition.colSubmitted")}
                            state={sort === "submitted_asc" ? "asc" : sort === "submitted_desc" ? "desc" : null}
                            onClick={() => { setPage(1); setSort((s) => s === "submitted_desc" ? "submitted_asc" : "submitted_desc"); }} />
                        </th>
                      </tr>
                    </thead>
                    <tbody key={`${fStatus}-${page}-${sort}`}>
                      {loading ? (
                        Array.from({ length: 4 }).map((_, i) => (
                          <tr key={i} className="border-b border-border/60">
                            <td className="px-4 py-4"><div className="flex items-center gap-2.5"><Skeleton className="h-9 w-9 rounded-lg" /><div className="space-y-1.5"><Skeleton className="h-3.5 w-28" /><Skeleton className="h-3 w-20" /></div></div></td>
                            <td className="px-4 py-4"><div className="space-y-1.5"><Skeleton className="h-3.5 w-full max-w-[240px]" /><Skeleton className="h-3.5 w-3/4 max-w-[180px]" /></div></td>
                            <td className="px-4 py-4"><Skeleton className="h-5 w-24 rounded-full" /></td>
                            <td className="px-4 py-4"><Skeleton className="h-4 w-20" /></td>
                            <td className="px-4 py-4"><Skeleton className="h-4 w-24" /></td>
                            <td className="px-4 py-4"><Skeleton className="h-5 w-12 rounded" /></td>
                            <td className="px-4 py-4"><Skeleton className="h-4 w-20" /></td>
                          </tr>
                        ))
                      ) : pageRows.length === 0 ? (
                        <tr><td colSpan={7} className="px-4 py-16 text-center">
                          <ClipboardCheck className="mx-auto mb-3 h-10 w-10 text-muted-foreground/30" />
                          <div className="text-base font-semibold text-foreground">{t("petition.noResults")}</div>
                          {anyFilterActive && (
                            <>
                              <div className="text-sm text-muted-foreground">{t("petition.noResultsFiltered")}</div>
                              <button
                                onClick={clearAllFilters}
                                className="mt-3 inline-flex items-center gap-1 rounded-md border border-border bg-card px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-muted"
                              >
                                <X className="h-3.5 w-3.5" /> {t("petition.clearAllFilters")}
                              </button>
                            </>
                          )}
                        </td></tr>
                      ) : pageRows.map(r => (
                        <InboxTableRow key={`${r.kind}-${r.id}`} row={r} t={t} lang={lang}
                          active={review?.id === r.id && review?._kind === r.kind} onOpen={openRow} />
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Pagination */}
                <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3 text-sm">
                  <span className="text-muted-foreground">
                    {total > 0
                      ? `${t("petition.showing")} ${lo} ${t("petition.to")} ${hi} ${t("petition.of")} ${total} ${t("petition.results")}`
                      : t("petition.noResults")}
                  </span>
                  {lastPage > 1 && (
                    <div className="flex items-center gap-1">
                      <button disabled={page <= 1} onClick={() => setPage(page - 1)} aria-label={t("petition.prev")}
                        className="grid h-9 w-9 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40">
                        <ChevronLeft className="h-4 w-4" />
                      </button>
                      {pageList(page, lastPage).map((p, i) =>
                        p === "…" ? (
                          <span key={`e${i}`} className="px-1.5 text-muted-foreground">…</span>
                        ) : (
                          <button key={p} onClick={() => setPage(p)}
                            className={cn(
                              "grid h-9 min-w-9 place-items-center rounded-lg px-1 text-sm font-semibold tabular-nums transition-colors",
                              p === page ? "aurora-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground",
                            )}>
                            {p}
                          </button>
                        )
                      )}
                      <button disabled={page >= lastPage} onClick={() => setPage(page + 1)} aria-label={t("petition.next")}
                        className="grid h-9 w-9 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40">
                        <ChevronRight className="h-4 w-4" />
                      </button>
                    </div>
                  )}
                  <div className="flex items-center gap-2 text-muted-foreground">
                    {t("petition.rowsPerPage")}
                    <Select value={String(pageSize)} onValueChange={(v) => { setPage(1); setPageSize(Number(v)); }}>
                      <SelectTrigger className="h-9 w-[76px] rounded-lg text-sm font-semibold text-foreground">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {[10, 25, 50].map((n) => (
                          <SelectItem key={n} value={String(n)}>{n}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </Card>

              {/* Mobile cards */}
              <div className="space-y-2.5 md:hidden">
                {loading ? (
                  Array.from({ length: 3 }).map((_, i) => (
                    <Card key={i} className="p-3.5"><Skeleton className="h-24 w-full" /></Card>
                  ))
                ) : pageRows.length === 0 ? (
                  <Card className="p-8 text-center">
                    <ClipboardCheck className="mx-auto mb-3 h-10 w-10 text-muted-foreground/30" />
                    <div className="text-base font-semibold text-foreground">{t("petition.noResults")}</div>
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
                  <>
                    {pageRows.map(r => <InboxCard key={`${r.kind}-${r.id}`} row={r} t={t} lang={lang} onOpen={openRow} onRetry={retry} />)}
                    {lastPage > 1 && (
                      <div className="flex items-center justify-between rounded-xl border border-border bg-card px-3 py-2 text-base">
                        <span className="text-muted-foreground">{lo}–{hi} {t("petition.of")} {total}</span>
                        <div className="flex items-center gap-2">
                          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}><ChevronLeft className="h-4 w-4" /></Button>
                          <span className="text-sm tabular-nums">{page} / {lastPage}</span>
                          <Button variant="outline" size="sm" disabled={page >= lastPage} onClick={() => setPage(page + 1)}><ChevronRight className="h-4 w-4" /></Button>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>{/* left column */}

            {/* Right rail — Filters + Category Distribution */}
            {showRail && (
              <aside className="flex flex-col gap-4 xl:min-h-0">
                {/* Filters */}
                <Card className="flex flex-col p-5 shadow-card-md xl:min-h-0 xl:flex-1">
                  <div className="mb-4 flex shrink-0 items-center justify-between">
                    <h3 className="type-card-heading flex items-center gap-2 text-foreground">
                      <button onClick={() => setShowRail(false)} aria-label={t("petition.filters")}
                        className="grid h-6 w-6 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
                        <ChevronLeft className="h-4 w-4" />
                      </button>
                      {t("petition.filters")}
                      {advancedFilterCount > 0 && (
                        <span className="grid h-5 min-w-[20px] place-items-center rounded-full bg-brand px-1 text-[11px] font-bold text-brand-foreground">
                          {advancedFilterCount}
                        </span>
                      )}
                    </h3>
                    {anyFilterActive && (
                      <button onClick={clearAllFilters}
                        className="inline-flex items-center gap-1 text-[13px] font-semibold text-muted-foreground transition-colors hover:text-destructive">
                        <X className="h-3.5 w-3.5" /> {t("petition.clearAll")}
                      </button>
                    )}
                  </div>

                  <div className="-mr-2 flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto pr-2">
                    {/* Source */}
                    <div className="flex flex-col gap-2">
                      <FilterSectionLabel label={t("petition.colSource")} onReset={fSource ? () => { setPage(1); setFSource(""); } : undefined} resetLabel={t("petition.reset")} />
                      <div className="flex flex-col gap-1.5">
                        {SOURCE_KEYS.map((key) => {
                          const m = SOURCE_META[key]; const SIcon = m.icon;
                          const selected = fSource === key;
                          return (
                            <button
                              key={key}
                              onClick={() => { setPage(1); setFSource((s) => (s === key ? "" : key)); }}
                              aria-pressed={selected}
                              className={cn(
                                "flex items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left transition-colors",
                                selected ? "border-brand/40 bg-brand/5" : "border-border bg-card hover:bg-muted/50",
                              )}
                            >
                              <span className={cn("grid h-7 w-7 shrink-0 place-items-center rounded-lg", m.cls)}>
                                <SIcon className="h-3.5 w-3.5" />
                              </span>
                              <span className={cn("min-w-0 flex-1 truncate text-sm font-medium", selected ? "text-brand" : "text-foreground")}>{t(m.tKey)}</span>
                              <span className={cn(
                                "grid h-4 w-4 shrink-0 place-items-center rounded-full border-2",
                                selected ? "border-brand" : "border-muted-foreground/40",
                              )}>
                                {selected && <span className="h-2 w-2 rounded-full bg-brand" />}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Priority */}
                    <div className="flex flex-col gap-2">
                      <FilterSectionLabel label={t("petition.colUrgency")} onReset={fPriority ? () => { setPage(1); setFPriority(""); } : undefined} resetLabel={t("petition.reset")} />
                      <FilterSelect label={t("petition.colUrgency")} value={fPriority}
                        onChange={(v) => { setPage(1); setFPriority(v); }} options={priorityOptions} />
                    </div>

                    {/* Submitted date — picker only (Today / This week / This month
                        live in the top toolbar). */}
                    <div className="flex flex-col gap-2.5">
                      <FilterSectionLabel label={t("appts.dateSubmitted")}
                        onReset={(dateFrom || dateTo || dateChip) ? () => { setPage(1); setDateFrom(""); setDateTo(""); setDateChip(null); } : undefined}
                        resetLabel={t("petition.reset")} />
                      <div className="flex h-11 w-full items-center gap-1.5 rounded-xl border border-border bg-card px-3">
                        <Input type="date" value={dateFrom}
                          onChange={(e) => { setPage(1); setDateFrom(e.target.value); setDateChip("custom"); }}
                          className="h-7 min-w-0 flex-1 border-0 p-0 text-sm shadow-none focus-visible:ring-0" aria-label={`${t("appts.dateSubmitted")} from`} />
                        <span className="shrink-0 px-0.5 text-sm text-muted-foreground">→</span>
                        <Input type="date" value={dateTo}
                          onChange={(e) => { setPage(1); setDateTo(e.target.value); setDateChip("custom"); }}
                          className="h-7 min-w-0 flex-1 border-0 p-0 text-sm shadow-none focus-visible:ring-0" aria-label={`${t("appts.dateSubmitted")} to`} />
                      </div>
                    </div>
                  </div>
                </Card>

                {/* Category Distribution — click a bar to filter the table */}
                <CategoryDistributionCard
                  bars={distribution}
                  lang={lang}
                  activeCategory={fCategory}
                  onSelect={(key) => { setPage(1); setFCategory((c) => (c === key ? "" : key)); }}
                  className="xl:min-h-0 xl:flex-1"
                />
              </aside>
            )}
          </div>{/* two-column grid */}
        </div>
      </main>

      {/* Petition review — document (left) · details (right); no title header */}
      {review && (
        <div className="fixed inset-0 z-50 flex bg-slate-900/50 p-3" onClick={() => !busy && setReview(null)}>
          <motion.div
            initial={{ opacity: 0, scale: 0.97, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ duration: 0.2, ease: [0.25, 0.8, 0.35, 1] }}
            className="m-auto flex h-[94vh] w-[95vw] overflow-hidden rounded-2xl bg-card shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            {/* Left — document preview (desktop) */}
            <div className="hidden w-[48%] flex-col border-r border-border bg-muted md:flex">
              <div className="flex items-center gap-1.5 border-b border-border bg-card px-4 py-2.5 text-sm font-semibold text-foreground">
                <FileText className="h-4 w-4 text-muted-foreground" /> <span className="truncate">{review._kind === "petition" ? t("petition.citizenUploads") : review.filename}</span>
              </div>
              <div className="flex-1 overflow-auto p-3" onContextMenu={(e) => e.preventDefault()}>
                <DocPreview review={review} t={t} />
              </div>
            </div>

            {/* Right — details */}
            <div className="flex w-full flex-col md:w-[52%]">
              {/* Title (the citizen's ask) + status pills · controls */}
              <div className="flex shrink-0 items-start justify-between gap-4 border-b border-border px-5 py-5 md:px-7">
                <div className="min-w-0">
                  <h2 className="text-2xl font-bold leading-snug text-foreground">
                    {pick(review.citizen_ask, review.citizen_ask_ta) || review.name || "Petition"}
                  </h2>
                  <div className="mt-2.5 flex flex-wrap items-center gap-2">
                    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold", STATUS_CLS[review.status])}>
                      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" /> {t(STATUS_TKEY[review.status])}
                    </span>
                    {review.priority && (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-xs font-semibold uppercase text-foreground/80">
                        <span className={cn("h-1.5 w-1.5 rounded-full", PRIORITY_DOT[review.priority] ?? "bg-slate-400")} /> {t(PRIORITY_TKEY[review.priority] ?? review.priority)}
                      </span>
                    )}
                    {review.category && (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-xs font-semibold text-foreground/80">
                        <span className="h-1.5 w-1.5 rounded-full bg-brand" /> {catLabel(review.category, lang)}
                      </span>
                    )}
                    {review.created_at && (() => {
                      const s = fmtSubmitted(review.created_at, lang);
                      return (
                        <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-muted px-2.5 py-1 text-xs font-semibold text-foreground/80">
                          <CalendarDays className="h-3 w-3 text-brand" />
                          <span>{t("petition.colSubmitted")}</span>
                          <span className="font-mono tabular-nums">{s.date}{s.time ? `, ${s.time}` : ""}</span>
                        </span>
                      );
                    })()}
                    {review.ticket_number && <span className="font-mono text-[13px] font-semibold text-emerald-600">{review.ticket_number}</span>}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  {review.status === "AWAITING_REVIEW" && (
                    editing
                      ? <>
                          <Button size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={busy}>{t("petition.cancel")}</Button>
                          <Button size="sm" variant="outline" onClick={saveEdits} disabled={busy}><Check className="mr-1.5 h-3.5 w-3.5" /> {t("petition.saveLabel")}</Button>
                        </>
                      : <Button size="sm" variant="outline" onClick={() => setEditing(true)}><Pencil className="mr-1.5 h-3.5 w-3.5" /> {t("petition.editLabel")}</Button>
                  )}
                  <button onClick={() => !busy && setReview(null)} aria-label={t("petition.cancel")}
                    className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"><X className="h-4 w-4" /></button>
                </div>
              </div>

              <div className="flex-1 space-y-5 overflow-auto bg-background/40 p-5 md:p-6">
                {/* Document — mobile only (desktop shows it in the left panel) */}
                <div className="h-72 overflow-auto rounded-2xl border border-border bg-card p-2 md:hidden" onContextMenu={(e) => e.preventDefault()}>
                  <DocPreview review={review} t={t} />
                </div>

                {/* Overview */}
                <section className="rounded-2xl border border-border bg-card p-5 shadow-card">
                  <SectionHeader icon={LayoutGrid} title={t("petition.grpOverview")} />
                  <div className="grid grid-cols-2 gap-x-8 gap-y-5">
                    <Field label={t("petition.colName")} labelIcon={User} editing={editing} value={form.name} fallback={lang === "ta" && review.name_ta?.trim() ? review.name_ta : review.name} onChange={v => setForm(f => ({ ...f, name: v }))} />
                    {/* Phone stays read-only for petitions — it's the OTP-verified, uniquely-indexed citizen mobile. */}
                    <Field label={t("petition.colPhone")} labelIcon={Phone} editing={editing && review._kind !== "petition"} value={form.mobile} fallback={review.mobile} onChange={v => setForm(f => ({ ...f, mobile: v }))} />
                    {editing && <Field label={t("petition.fNameTa")} editing value={form.name_ta} fallback={review.name_ta} onChange={v => setForm(f => ({ ...f, name_ta: v }))} />}
                    <SelectField label={t("petition.colCategory")} icon={Tag} editing={editing} value={form.category} fallback={review.category} options={CATEGORIES} labels={catLabels} onChange={v => setForm(f => ({ ...f, category: v }))} />
                    <SelectField label={t("petition.colUrgency")} icon={BarChart3} editing={editing} value={form.priority} fallback={review.priority} options={PRIORITIES} labels={priorityLabels} onChange={v => setForm(f => ({ ...f, priority: v }))} />
                    <SelectField label={t("petition.fMinistry")} icon={Building2} editing={editing} value={form.ministry} fallback={review.ministry} options={MINISTRIES} labels={MINISTRY_DISPLAY} onChange={v => setForm(f => ({ ...f, ministry: v }))} />
                    <SelectField label={t("petition.fDistrict")} icon={MapPin} editing={editing} value={form.district} fallback={review.district} options={DISTRICTS} labels={DISTRICT_DISPLAY} onChange={v => setForm(f => ({ ...f, district: v }))} />
                  </div>
                </section>

                {/* Summary */}
                <section className="rounded-2xl border border-border bg-card p-5 shadow-card">
                  <SectionHeader icon={FileText} title={t("petition.colSummary")} />
                  {editing
                    ? <textarea className="w-full rounded-xl border border-input bg-card px-3 py-2 text-base" rows={4} value={form.summary ?? ""} onChange={e => setForm(f => ({ ...f, summary: e.target.value }))} />
                    : <p className="text-[15px] leading-relaxed text-foreground/85">{pick(review.summary, review.summary_ta) || "—"}</p>}

                  {pick(review.citizen_ask, review.citizen_ask_ta) && (
                    <div className="mt-4 rounded-r-xl border-l-[3px] border-brand bg-accent/60 py-3 pl-4 pr-3">
                      <div className="mb-1 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.12em] text-brand">
                        <HelpCircle className="h-3.5 w-3.5" /> {t("petition.colAsk")}
                      </div>
                      <p className="text-[15px] font-semibold text-foreground">{pick(review.citizen_ask, review.citizen_ask_ta)}</p>
                    </div>
                  )}

                  {(() => {
                    const list = pick(review.key_details, review.key_details_ta) || [];
                    if (!list.length) return null;
                    return (
                      <div className="mt-5">
                        <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.09em] text-muted-foreground">{t("petition.keyDetails")}</div>
                        <ul className="space-y-1.5">
                          {list.map((d, i) => <li key={i} className="flex gap-2.5 text-[15px] text-foreground/85"><span className="mt-[8px] h-1.5 w-1.5 shrink-0 rounded-full bg-brand" /><span>{d}</span></li>)}
                        </ul>
                      </div>
                    );
                  })()}
                </section>

                {review.status === "FAILED" && review.error && (
                  <div className="flex items-start gap-2 rounded-2xl border border-red-200 bg-red-50 p-3 text-base text-red-700">
                    <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" /><span>{review.error}</span>
                  </div>
                )}
              </div>

              <div className="shrink-0 border-t border-border bg-card px-5 py-4 md:px-7 md:py-5">
                {review.status === "AWAITING_REVIEW" && (() => {
                  // Ministry drives the action: School → Accept (school department
                  // workflow); any other ministry → Forward (out to that ministry).
                  // Dismiss is a secondary escape hatch (courtesy audio, duplicate,
                  // blank scan) that marks the row reviewed without creating a case.
                  const isSchool = (review.ministry ?? SCHOOL_MINISTRY) === SCHOOL_MINISTRY;
                  const ministryLabel = review.ministry ? (MINISTRY_DISPLAY[review.ministry] ?? review.ministry) : "";
                  return (
                    <div className="flex flex-col gap-2">
                      <Button
                        className={cn(
                          "w-full text-white !bg-none border-transparent",
                          isSchool ? "!bg-emerald-600 hover:!bg-emerald-700" : "!bg-amber-600 hover:!bg-amber-700",
                        )}
                        onClick={approve}
                        disabled={busy || editing}
                      >
                        {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          : isSchool ? <Check className="mr-2 h-4 w-4" /> : <Forward className="mr-2 h-4 w-4" />}
                        {isSchool ? t("petition.acceptCta") : `${t("petition.forwardCta")}${ministryLabel ? ` — ${ministryLabel}` : ""}`}
                      </Button>
                      <Button
                        variant="ghost"
                        className="w-full text-muted-foreground hover:bg-muted hover:text-foreground"
                        onClick={dismiss}
                        disabled={busy || editing}
                      >
                        <Archive className="mr-2 h-4 w-4" />
                        {t("petition.dismissCta")}
                      </Button>
                    </div>
                  );
                })()}
                {review.status === "REVIEWED" && (
                  <div className="flex items-center justify-center gap-2 rounded-xl bg-emerald-50 px-4 py-3 text-base font-semibold text-emerald-700">
                    <TicketIcon className="h-4 w-4" /> {t("petition.approvedAs")} {review.ticket_number}
                  </div>
                )}
                {review.status === "FAILED" && (
                  <Button className="w-full" variant="outline" onClick={() => { retry([review.id]); setReview(null); }}>
                    <RefreshCw className="mr-2 h-4 w-4" /> {t("petition.retryExtraction")}
                  </Button>
                )}
                {editing && <p className="mt-1.5 text-center text-xs text-muted-foreground">{t("petition.saveBeforeApprove")}</p>}
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </>
  );
}

/* ── Local components ─────────────────────────────────────────────────── */

const ALL = "__all__";

function FilterSectionLabel({ label, onReset, resetLabel }: { label: string; onReset?: () => void; resetLabel: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[11px] font-semibold uppercase tracking-[0.09em] text-muted-foreground">{label}</span>
      {onReset && (
        <button onClick={onReset} className="text-[12px] font-semibold text-brand transition-colors hover:underline">{resetLabel}</button>
      )}
    </div>
  );
}

/** Single-select pill used inside the filters card. */
function FilterSelect({ label, value, onChange, options }: {
  label: string; value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <Select value={value === "" ? ALL : value} onValueChange={(v) => onChange(v === ALL ? "" : v)}>
      <SelectTrigger className={cn("h-11 rounded-xl text-sm", value && "border-brand/40 bg-brand/5 font-semibold text-brand")}>
        <SelectValue placeholder={`All ${label.toLowerCase()}`} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>All {label.toLowerCase()}</SelectItem>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function SortHeader({ label, state, onClick }: {
  label: string; state: "asc" | "desc" | null; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1 font-semibold uppercase tracking-[0.09em] transition-colors hover:text-foreground",
        state ? "text-brand" : "text-muted-foreground/80",
      )}
    >
      {label}
      {state === "asc" && <ArrowUp className="h-3.5 w-3.5" />}
      {state === "desc" && <ArrowDown className="h-3.5 w-3.5" />}
      {!state && <ArrowUpDown className="h-3.5 w-3.5 opacity-60" />}
    </button>
  );
}

const BAR_PALETTE = ["#1E40AF", "#4C82F2", "#EE9A3C", "#34A26C", "#E5484D", "#35839B"];

function CategoryDistributionCard({ bars, lang, activeCategory, onSelect, className }: {
  bars: { key: string; count: number }[];
  lang: string;
  activeCategory: string;
  onSelect: (key: string) => void;
  className?: string;
}) {
  const { t } = useLang();
  const total = bars.reduce((a, b) => a + b.count, 0);
  const max = Math.max(1, ...bars.map((b) => b.count));

  return (
    <Card className={cn("flex flex-col p-5 shadow-card-md", className)}>
      <div className="mb-4 flex shrink-0 items-center justify-between">
        <h3 className="type-card-heading text-foreground">{t("petition.categoryDistribution")}</h3>
        <span className="text-[13px] text-muted-foreground">
          {t("petition.total")}: <span className="font-semibold tabular-nums text-foreground">{total}</span>
        </span>
      </div>
      {bars.length === 0 ? (
        <div className="grid flex-1 place-items-center text-center text-sm text-muted-foreground">{t("petition.noData")}</div>
      ) : (
        <>
          <div className="-mr-2 flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto pr-2">
            {bars.map((b, i) => {
              const share = total ? Math.round((b.count / total) * 100) : 0;
              const isActive = activeCategory === b.key;
              const dimmed = Boolean(activeCategory) && !isActive;
              return (
                <button
                  key={b.key}
                  onClick={() => onSelect(b.key)}
                  aria-pressed={isActive}
                  className={cn(
                    "w-full rounded-lg px-2 py-1.5 text-left transition-all",
                    isActive ? "bg-accent ring-1 ring-[#BBD3FA]" : "hover:bg-muted/60",
                    dimmed && "opacity-45 hover:opacity-100",
                  )}
                >
                  <div className="flex items-center gap-2 text-[13px]">
                    <span className="w-4 shrink-0 text-right font-semibold tabular-nums text-foreground">{b.count}</span>
                    <span className={cn("w-28 shrink-0 truncate", isActive ? "font-semibold text-brand" : "text-foreground")}>{catLabel(b.key, lang)}</span>
                    <span className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
                      <span className="block h-full rounded-full transition-all"
                        style={{ width: `${(b.count / max) * 100}%`, backgroundColor: BAR_PALETTE[i % BAR_PALETTE.length] }} />
                    </span>
                    <span className="w-10 shrink-0 text-right tabular-nums text-muted-foreground">({share}%)</span>
                  </div>
                </button>
              );
            })}
          </div>
          <div className="mt-3 flex shrink-0 items-center gap-1.5 border-t border-border pt-3 text-[12px] text-muted-foreground">
            <SlidersHorizontal className="h-3.5 w-3.5" /> {t("petition.clickCategoryHint")}
          </div>
        </>
      )}
    </Card>
  );
}

function SectionHeader({ icon: Icon, title }: { icon: React.ElementType; title: string }) {
  return (
    <div className="mb-4 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.12em] text-brand">
      <Icon className="h-3.5 w-3.5" /> {title}
    </div>
  );
}

function Field({ label, value, fallback, editing, onChange, icon: Icon, labelIcon: LabelIcon }:
  { label: string; value?: string | null; fallback: string | null; editing: boolean; onChange: (v: string) => void; icon?: React.ElementType; labelIcon?: React.ElementType }) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.09em] text-muted-foreground">
        {LabelIcon && <LabelIcon className="h-3.5 w-3.5" />}{label}
      </div>
      {editing
        ? <input className="w-full rounded-xl border border-input bg-card px-3 py-2 text-base" value={value ?? ""} onChange={e => onChange(e.target.value)} />
        : <div className="flex items-center gap-1.5 truncate text-lg font-medium leading-relaxed text-foreground">{Icon && <Icon className="h-4 w-4 text-muted-foreground" />}{fallback || "—"}</div>}
    </div>
  );
}

function SelectField({ label, value, fallback, editing, options, onChange, labels, icon: Icon }:
  { label: string; value?: string | null; fallback: string | null; editing: boolean; options: string[]; onChange: (v: string) => void; labels?: Record<string, string>; icon?: React.ElementType }) {
  const disp = (o: string) => labels?.[o] ?? o.replace(/_/g, " ");
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.09em] text-muted-foreground">
        {Icon && <Icon className="h-3.5 w-3.5" />}{label}
      </div>
      {editing
        ? <select className="w-full rounded-xl border border-input bg-card px-3 py-2 text-base" value={value ?? ""} onChange={e => onChange(e.target.value)}>
            {options.map(o => <option key={o} value={o}>{disp(o)}</option>)}
          </select>
        : <div className="truncate text-lg font-medium leading-relaxed text-foreground">{fallback ? disp(fallback) : "—"}</div>}
    </div>
  );
}


/** Inline document / attachment preview (download disabled). Shared by the
 *  desktop left panel and the mobile in-body preview. */
function DocPreview({ review, t }: { review: Upload; t: (k: string) => string }) {
  if (review._kind === "petition") {
    const att = [...(review.attachments ?? [])];
    if (review.audio_url && !att.some(a => a.type === "AUDIO")) att.push({ name: "Voice recording", url: review.audio_url, type: "AUDIO" });
    return att.length || review.audio_transcript
      ? <InlineAttachmentPreview attachments={att} audioTranscript={review.audio_transcript} />
      : <div className="grid h-full place-items-center text-muted-foreground">{t("petition.noPreview")}</div>;
  }
  if (review.file_url) {
    if (review.mime_type === "application/pdf") {
      // Chrome/Edge's built-in PDF viewer is treated as a plugin and gets
      // silently blocked inside a `sandbox` iframe — you'd see either a
      // blank pane or the 🚫 no-entry glyph. Serve without sandbox and
      // hide the toolbar via the #toolbar=0 fragment. <object> is the
      // preferred renderer; <iframe> is the fallback for browsers that
      // don't wire up <object type="application/pdf">. Matches the
      // pattern used by @/components/ui/inline-attachment-preview.tsx.
      const src = `${review.file_url}#toolbar=0&navpanes=0&view=FitH`;
      return (
        <object data={src} type="application/pdf" className="h-full min-h-[240px] w-full rounded-lg border border-border bg-white">
          <iframe src={src} title="document" className="h-full min-h-[240px] w-full rounded-lg border border-border bg-white" />
        </object>
      );
    }
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={review.file_url} alt="petition" className="mx-auto max-w-full select-none rounded-lg shadow" draggable={false} />;
  }
  return <div className="grid h-full place-items-center text-muted-foreground">{t("petition.noPreview")}</div>;
}
