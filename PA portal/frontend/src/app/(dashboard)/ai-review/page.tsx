"use client";

import { memo, Suspense, useState, useEffect, useCallback, useMemo, useRef, type ChangeEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ClipboardCheck, RefreshCw, Check, Pencil, X, FileText, Search,
  AlertTriangle, Clock, Loader2, Ticket as TicketIcon, Phone, ShieldAlert,
  QrCode, ScanLine, UserCog, SlidersHorizontal, Forward, ChevronLeft, ChevronRight,
  ArrowUpDown, ArrowUp, ArrowDown, Download, CalendarDays,
  CalendarCheck, CalendarRange, HelpCircle, LayoutGrid, User, Tag, BarChart3, Building2, MapPin,
  Mail, Landmark, Archive, Paperclip, Layers, RotateCcw, Route, Undo2, ExternalLink,
} from "lucide-react";
import { toast } from "sonner";
import { motion } from "framer-motion";

import TopBar from "@/components/TopBar";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DateRangePill } from "@/components/ui/date-range-pill";
import { Skeleton } from "@/components/ui/skeleton";
import { InitialsAvatar } from "@/components/ui/avatar";
import { InlineAttachmentPreview } from "@/components/ui/inline-attachment-preview";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { useLang } from "@/lib/lang-context";
import { cn } from "@/lib/utils";
import { uploadAppointmentAttachment } from "@/lib/api";
import { MINISTRY_DISPLAY, DISTRICT_DISPLAY, CATEGORY_DISPLAY_EN, CATEGORY_DISPLAY_TA, priorityOptions } from "@/lib/enums";
import type { AppointmentRow, AppointmentAttachment } from "@/lib/types";

type StatusKey = "QUEUED" | "PROCESSING" | "AWAITING_REVIEW" | "REVIEWED" | "FAILED" | "DISMISSED" | "ROUTED";

// Aggregate payload from GET /api/ai-uploads/aggregates.
// Filter-scoped (all filters except status + category); the chart bars and
// tab counts show a "given everything else you filtered, here's the split
// across status / category" story. Global badges (total_awaiting, failed_count,
// active_jobs) intentionally IGNORE filters — a hidden FAILED row must
// still poke the notification badge.
interface AggregatesPayload {
  counts_by_status: Record<string, number>; // "" (total_visible), AWAITING_REVIEW, REVIEWED, FAILED, DISMISSED
  distribution: { key: string; count: number }[];
  total_awaiting: number;
  failed_count:   number;
  failed_ids?:    number[]; // global ids of every FAILED upload — drives "Retry all failed"
  active_jobs:    number;
  routed_count?:  number;   // uploads the classifier sent to proposal/association
}

// Batch summary — same shape as the ai-uploads page consumes. We only use
// the id→name map here (for the "showing one batch" banner and any batch
// deep link), so a light `Pick` would do; leaving the full shape keeps the
// two pages symmetrical and lets us grow the banner later.
interface BatchSummary {
  id: string;
  name: string;
  earliest_created_at: string | null;
  counts: Record<StatusKey, number>;
  failed_ids: number[];
}

// The old 500-row client cap is gone. Pagination is server-side across BOTH
// tables via /api/petitions/inbox, so the browser only ever holds the current
// page. Tab counts still come from /ai-uploads/aggregates (uploads-side full
// COUNT) plus the petition bulk fetch below (small feed, always fits).

// The default School Education ministry — approve keeps it in the school
// department workflow ("Accept"); any other ministry is "Forward"ed out.
const SCHOOL_MINISTRY = "school_education_tamil_dev_info_publicity";
const MINISTRIES = Object.keys(MINISTRY_DISPLAY);
const DISTRICTS = Object.keys(DISTRICT_DISPLAY);

interface Upload {
  id: number; filename: string; mime_type: string; file_url: string | null;
  // Groups one upload batch. Already returned by the API; typed here so the
  // "?batch=" deep link from AI Uploads can scope this queue to one batch.
  batch_id?: string | null;
  status: StatusKey;
  name: string | null; name_ta: string | null; mobile: string | null;
  category: string | null; priority: string | null; ministry: string | null; district: string | null;
  summary: string | null; summary_ta: string | null;
  citizen_ask: string | null; citizen_ask_ta: string | null;
  key_details: string[]; key_details_ta: string[];
  error: string | null; ticket_number: string | null; appointment_id: number | null; created_at: string | null;
  source?: string | null;
  // Classifier routing (status === "ROUTED"): what the scan became and where,
  // so the drawer can offer "open in that workflow" + "move back to petitions".
  routed_to?: "proposal" | "association" | null;
  routed_ref_id?: number | null;
  // Unified review drawer: petitions reuse this shape with a source tag +
  // their own attachments/audio (uploads keep the single-file preview).
  _kind?: "upload" | "petition";
  attachments?: AppointmentAttachment[];
  audio_url?: string | null;
  audio_transcript?: string | null;
}

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

// Category picker for the review drawer. `proposals`, `associations_unions`,
// `greetings` and `invitation` are DELIBERATELY EXCLUDED — those documents
// are routed OUT of the petition workflow by the classifier
// (→ proposal-review, → association-review, → the events/courtesy pipeline)
// and never legitimately show up as a petition category. Keeping them in
// the picker would let a PA silently mis-tag a real petition to a
// non-petition category and break downstream analytics/routing. Legacy rows
// that still carry these categories can be moved via the "move-back"
// controls on their respective surfaces.
const CATEGORIES = ["action_required","transfer_requests","pension_requests","school_admission","job_requests","rti","school_upgradation","general","other"];

// Same rule for the Category Distribution filter chips — never surface a
// bar/filter for a non-petition category, even if legacy data still carries
// it (a stale row shouldn't create a filter option that shouldn't exist).
const NON_PETITION_CATEGORY_KEYS = new Set(["proposals", "associations_unions", "greetings", "invitation"]);
const PRIORITIES = ["low", "medium", "high", "critical"];

// Note: QUEUED / PROCESSING rows are hidden from the UI entirely — the PA
// has nothing to do with them until they land in AWAITING_REVIEW. The live
// poll below re-fetches while any queued/processing rows exist, so they
// pop into the inbox silently.
const SEGMENTS: { key: "" | StatusKey; tKey: string }[] = [
  { key: "",                tKey: "petition.segAll" },
  { key: "AWAITING_REVIEW", tKey: "petition.segAwaiting" },
  { key: "REVIEWED",        tKey: "petition.segReviewed" },
  { key: "FAILED",          tKey: "petition.segFailed" },
  // Dismissed rows (courtesy audio, blank scans, duplicates) used to be
  // reachable only via "All"; they get their own tab + count now.
  { key: "DISMISSED",       tKey: "petition.segDismissed" },
  // Routed rows — scans the classifier sent to the proposal/association
  // workflow. Kept out of the petition tabs; this is the recovery view where
  // a PA can move a mis-classified scan back into the petition queue.
  { key: "ROUTED",          tKey: "petition.segRouted" },
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
  ROUTED:          "petition.statusRouted",
};

const STATUS_CLS: Record<StatusKey, string> = {
  QUEUED:          "bg-slate-100 text-slate-600",
  PROCESSING:      "bg-blue-100 text-blue-700",
  AWAITING_REVIEW: "bg-amber-100 text-amber-700",
  REVIEWED:        "bg-emerald-100 text-emerald-700",
  FAILED:          "bg-red-100 text-red-700",
  DISMISSED:       "bg-slate-100 text-slate-500",
  ROUTED:          "bg-violet-100 text-violet-700",
};

const STATUS_ICON: Record<StatusKey, typeof Clock> = {
  QUEUED:          Clock,
  PROCESSING:      Loader2,
  AWAITING_REVIEW: AlertTriangle,
  REVIEWED:        Check,
  FAILED:          X,
  DISMISSED:       Archive,
  ROUTED:          Route,
};

const pretty = (s: string) => s.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
const api = (p: string) => `/api/ai-uploads${p}`;

function petitionStatusKey(status: string): StatusKey {
  if (status === "Reviewed")  return "REVIEWED";
  if (status === "Dismissed") return "DISMISSED";
  return "AWAITING_REVIEW";
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

/**
 * useSearchParams() forces this page out of static prerendering, and Next 15
 * FAILS `next build` unless the consumer sits under a Suspense boundary
 * ("useSearchParams() should be wrapped in a suspense boundary"). `next dev`
 * does not enforce it, so this only breaks the production build — same wrapper
 * pattern AppointmentsPage already uses for exactly this reason.
 */
export default function AiReviewPage() {
  return (
    <Suspense fallback={null}>
      <AiReviewPageInner />
    </Suspense>
  );
}

function AiReviewPageInner() {
  const { t, lang } = useLang();
  // "?batch=<id>" deep link from the AI Uploads tab — scopes this queue to the
  // files of one upload batch. Absent/empty means the normal, full queue.
  const router = useRouter();
  const searchParams = useSearchParams();
  const batchFilter = searchParams.get("batch") ?? "";
  // `inboxItems` is the current PAGE, in the exact interleaved order returned
  // by /api/petitions/inbox. `uploads` is derived so the drawer-sync effect
  // (which speaks the Upload shape) works unchanged.
  const [inboxItems, setInboxItems] = useState<Array<Record<string, unknown> & { _kind: "upload" | "petition" }>>([]);
  const uploads = useMemo<Upload[]>(
    () => inboxItems.filter((i) => i._kind === "upload") as unknown as Upload[], [inboxItems],
  );
  // Tab counts + chart distribution now come from a single server endpoint
  // (/api/petitions/inbox/facets) that aggregates BOTH tables under the same
  // filter set as /inbox. The old code bulk-fetched up to 2000 petitions,
  // decrypted them client-side, then computed counts/distribution in JS —
  // which silently truncated past 2000 rows and mixed status scopes so the
  // chart total (141) disagreed with the tab count (133).
  const [facets, setFacets] = useState<{
    counts_by_status: Record<string, number>;
    distribution: { key: string; count: number }[];
  } | null>(null);
  const [inboxTotal, setInboxTotal] = useState(0);
  const [aggregates, setAggregates] = useState<AggregatesPayload | null>(null);
  const [batchesLookup, setBatchesLookup] = useState<Record<string, BatchSummary>>({});
  const [loading, setLoading] = useState(true);
  const [review, setReview] = useState<Upload | null>(null);
  const [editing, setEditing] = useState(false);
  const reviewAttachRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState<Partial<Upload>>({});
  const [busy, setBusy] = useState(false);
  // Dismiss confirmation — pretty Radix dialog instead of the browser's
  // native window.confirm() (which some engines style like an "alert").
  const [dismissOpen, setDismissOpen] = useState(false);
  // Move-back confirmation — parallel dialog for a much more destructive
  // action (hard-deletes the routed-to proposal/association). Was previously
  // a one-click hazard.
  const [moveBackOpen, setMoveBackOpen] = useState(false);

  // ── Signature-petition merging (v054) ─────────────────────────────────────
  // `similar` is the last Find-similar payload for the currently open drawer.
  // `keptSignatoryIds` is the set the reviewer curated — start = all
  // candidates, ✕ removes one, click-to-restore adds it back. On Approve, if
  // the set is non-empty, we hit /approve-with-signatories to merge into one
  // ticket. If it's empty, plain approve — the current behavior is unchanged.
  const [similar, setSimilar] = useState<null | {
    source: { id: number; ask?: string; category?: string | null; district?: string | null } | null;
    candidates: Array<{
      id: number; score: number; ask?: string | null; name?: string | null;
      source?: string | null; token?: number | null; created_at?: string | null;
    }>;
    reason?: string | null;
  }>(null);
  const [similarLoading, setSimilarLoading] = useState(false);
  const [keptSignatoryIds, setKeptSignatoryIds] = useState<Set<number>>(new Set());

  // Default to Awaiting Review — that's the actionable queue PAs care about on
  // open. They can widen to All via the tabs if they want history.
  // Arriving from a batch link starts on "All": a batch that is already fully
  // reviewed would otherwise open on an empty "Awaiting Review" tab and look
  // just as broken as the unfiltered queue it replaced.
  const [fStatus, setFStatus] = useState<"" | StatusKey>(batchFilter ? "" : "AWAITING_REVIEW");
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

  // Build the querystring for the unified /api/petitions/inbox endpoint —
  // server-paginated across BOTH ai_uploads and appointments. `page` and
  // `page_size` are the real UI values now (used to be pinned to 1/500 with
  // a client-side slice, which is what made the pagination footer disagree
  // with the ALL tab past 500 uploads).
  const buildInboxQuery = useCallback((): string => {
    const p = new URLSearchParams();
    p.set("page", String(page));
    p.set("page_size", String(pageSize));
    if (fStatus)     p.set("status",    fStatus);
    if (fCategory)   p.set("category",  fCategory);
    if (fPriority)   p.set("priority",  fPriority);
    if (fSource)     p.set("source",    fSource);
    if (batchFilter) p.set("batch_id",  batchFilter);
    if (dateFrom)    p.set("from_date", dateFrom);
    if (dateTo)      p.set("to_date",   dateTo);
    if (q.trim())    p.set("q",         q.trim());
    p.set("sort", sort);
    return p.toString();
  }, [page, pageSize, fStatus, fCategory, fPriority, fSource, batchFilter, dateFrom, dateTo, q, sort]);

  // TAB PILL counts scope — ONLY the structural filters (search + date +
  // batch). Refinement filters (priority / source / category) must not
  // collapse the tab pill counts; otherwise selecting "priority=high" makes
  // Awaiting jump from 128 → 3 and Reviewed → 0, reading as if the queue
  // vanished. Same fix as the tickets page. Status is also omitted here —
  // that's the axis /facets counts across.
  const buildTabsFacetsQuery = useCallback((): string => {
    const p = new URLSearchParams();
    if (batchFilter) p.set("batch_id",  batchFilter);
    if (dateFrom)    p.set("from_date", dateFrom);
    if (dateTo)      p.set("to_date",   dateTo);
    if (q.trim())    p.set("q",         q.trim());
    return p.toString();
  }, [batchFilter, dateFrom, dateTo, q]);

  // DISTRIBUTION chart scope — the full current slice (status + refinements)
  // MINUS the axis the chart itself drives (category). Same rule as the
  // tickets DistributionCard: bars should stay clickable representations of
  // "how does my current slice break down by category".
  const buildDistributionFacetsQuery = useCallback((): string => {
    const p = new URLSearchParams();
    if (fStatus)     p.set("status",    fStatus);
    if (fPriority)   p.set("priority",  fPriority);
    if (fSource)     p.set("source",    fSource);
    if (batchFilter) p.set("batch_id",  batchFilter);
    if (dateFrom)    p.set("from_date", dateFrom);
    if (dateTo)      p.set("to_date",   dateTo);
    if (q.trim())    p.set("q",         q.trim());
    return p.toString();
  }, [fStatus, fPriority, fSource, batchFilter, dateFrom, dateTo, q]);

  // Aggregates take the same filters EXCEPT status + category — those are
  // what /aggregates COUNTS across (see backend `list_aggregates`).
  const buildAggregatesQuery = useCallback((): string => {
    const p = new URLSearchParams();
    if (fPriority)   p.set("priority",  fPriority);
    if (fSource)     p.set("source",    fSource);
    if (batchFilter) p.set("batch_id",  batchFilter);
    if (dateFrom)    p.set("from_date", dateFrom);
    if (dateTo)      p.set("to_date",   dateTo);
    if (q.trim())    p.set("q",         q.trim());
    return p.toString();
  }, [fPriority, fSource, batchFilter, dateFrom, dateTo, q]);

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      // Four feeds, one round-trip. Each has a purpose-built scope:
      //  1. /api/petitions/inbox         — CURRENT PAGE (server pagination),
      //     full filter set.
      //  2. /facets (tabs scope)          — tab pill counts; scoped to just
      //     search + date + batch so refinement filters (priority/source/
      //     category) don't collapse the pills into 0s.
      //  3. /facets (distribution scope)  — the category chart's bars +
      //     total; scoped to status + priority + source (minus category —
      //     that's the axis the chart drives) so bars reflect the current
      //     slice.
      //  4. /ai-uploads/aggregates        — upload-only globals: active_jobs
      //     (poll trigger) and failed_count (banner). Filter-independent.
      const [inboxRes, tabsRes, distRes, aggRes] = await Promise.allSettled([
        fetch(`/api/petitions/inbox?${buildInboxQuery()}`,                     { credentials: "include", signal }).then(r => r.json()),
        fetch(`/api/petitions/inbox/facets?${buildTabsFacetsQuery()}`,         { credentials: "include", signal }).then(r => r.json()),
        fetch(`/api/petitions/inbox/facets?${buildDistributionFacetsQuery()}`, { credentials: "include", signal }).then(r => r.json()),
        fetch(api(`/aggregates?${buildAggregatesQuery()}`),                    { credentials: "include", signal }).then(r => r.json()),
      ]);
      if (signal?.aborted) return;

      if (inboxRes.status === "fulfilled" && inboxRes.value && Array.isArray(inboxRes.value.items)) {
        const items = inboxRes.value.items as Array<Record<string, unknown> & { _kind: "upload" | "petition" }>;
        setInboxItems(items);
        setInboxTotal(Number(inboxRes.value.total ?? items.length));
      }
      // Combine: pill counts from the tabs-scoped call, chart bars from the
      // distribution-scoped call. Prefer either individually if only one
      // fulfilled, so a transient failure on one doesn't blank the other.
      const tabsOk = tabsRes.status === "fulfilled" && tabsRes.value;
      const distOk = distRes.status === "fulfilled" && distRes.value;
      if (tabsOk || distOk) {
        setFacets({
          counts_by_status: tabsOk
            ? (tabsRes.value.counts_by_status ?? {})
            : (distOk ? (distRes.value.counts_by_status ?? {}) : {}),
          distribution: distOk
            ? (distRes.value.distribution ?? [])
            : (tabsOk ? (tabsRes.value.distribution ?? []) : []),
        });
      }
      if (aggRes.status === "fulfilled" && aggRes.value) {
        setAggregates(aggRes.value as AggregatesPayload);
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") { /* keep last good */ }
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [buildInboxQuery, buildTabsFacetsQuery, buildDistributionFacetsQuery, buildAggregatesQuery]);

  // Batches lookup — fetched once for the "showing one batch" banner and
  // any future batch UI. Not filter-scoped: banner must be able to name any
  // batch someone deep-links to via ?batch=<id>.
  useEffect(() => {
    const ctrl = new AbortController();
    fetch(api("/batches"), { credentials: "include", signal: ctrl.signal })
      .then(r => r.json())
      .then((d: { batches?: BatchSummary[] }) => {
        if (!Array.isArray(d.batches)) return;
        const map: Record<string, BatchSummary> = {};
        for (const b of d.batches) map[b.id] = b;
        setBatchesLookup(map);
      })
      .catch(() => { /* non-fatal; banner falls back to raw id */ });
    return () => ctrl.abort();
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    load(ctrl.signal);
    return () => ctrl.abort();
  }, [load]);

  // Live poll while any file is still QUEUED / PROCESSING anywhere on the
  // system — pre-refactor this checked the visible upload list, which is now
  // paginated and would miss active jobs older than page 1. The aggregates
  // endpoint tracks active_jobs globally.
  useEffect(() => {
    const active = (aggregates?.active_jobs ?? 0) > 0;
    if (!active) return;
    const id = setInterval(() => load(), 4000);
    return () => clearInterval(id);
  }, [aggregates, load]);

  useEffect(() => {
    // Sync the open drawer with fresh list data (e.g. after a live poll ticks).
    // The list payload is "light" post-refactor — it doesn't carry summary /
    // summary_ta / key_details*. Overwriting the drawer with that would blank
    // out the narrative fetched via GET /{id} on open, so we selectively
    // reapply the light fields on top of whatever full detail we already have.
    if (review && !editing) {
      const fresh = uploads.find(u => u.id === review.id);
      if (fresh) setReview({
        ...review,
        ...fresh,
        summary:        review.summary,
        summary_ta:     review.summary_ta,
        key_details:    review.key_details,
        key_details_ta: review.key_details_ta,
      });
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

  // The visible page — one InboxRow per server-returned item, in server order.
  // No client-side sort or slice: server already did that across BOTH tables
  // via the unified /api/petitions/inbox query (which is what fixed the
  // "showing 1285 of 2901" pagination-vs-tab-count divergence).
  const pageRows = useMemo<InboxRow[]>(() => {
    return inboxItems.map((it) => {
      if (it._kind === "upload") {
        const u = it as unknown as Upload;
        // Routed scans carry no extracted petition name/ask (they left the
        // petition workflow), so fall back to the filename + a routed hint —
        // otherwise the recovery list would be a column of dashes.
        const routed = u.status === "ROUTED";
        return {
          kind: "upload", id: u.id, name: u.name || (routed ? u.filename : u.name), name_ta: u.name_ta, mobile: u.mobile,
          token: u.ticket_number, categoryKey: u.category,
          priority: u.priority, statusKey: u.status, source: u.source || "ai_scan", venue: null, venue_label: null,
          created_at: u.created_at, ticket_number: u.ticket_number,
          summary: u.citizen_ask ?? (routed ? u.filename : null), summary_ta: u.citizen_ask_ta ?? null,
          upload: u,
        };
      }
      const p = it as unknown as AppointmentRow;
      return {
        kind: "petition", id: p.id, name: p.name, name_ta: p.name_ta ?? null, mobile: p.mobile,
        token: p.token != null ? String(p.token) : null,
        categoryKey: p.category ?? null, priority: p.priority ?? null,
        statusKey: petitionStatusKey(p.status), source: p.source || "qr_citizen", venue: p.venue ?? null, venue_label: p.venue_label ?? null,
        created_at: p.created_at, ticket_number: null,
        summary: p.citizen_ask ?? null, summary_ta: p.citizen_ask_ta ?? null,
        petition: p,
      };
    });
  }, [inboxItems]);

  // Friendly batch label — served by GET /ai-uploads/batches on mount so the
  // banner names any deep-linked batch even if it lies outside the first
  // page of the uploads feed.
  const batchLabel = useMemo(
    () => (batchFilter ? (batchesLookup[batchFilter]?.name ?? batchFilter.slice(0, 8)) : ""),
    [batchesLookup, batchFilter],
  );

  // Tab counts and chart distribution — served directly by
  // /api/petitions/inbox/facets, which aggregates uploads + petitions in one
  // consistent filter pass. No client-side petition scoping needed anymore.
  const counts = useMemo<Record<string, number>>(() => {
    const c = facets?.counts_by_status ?? {};
    return {
      "":               c[""]               ?? 0,
      AWAITING_REVIEW:  c.AWAITING_REVIEW   ?? 0,
      REVIEWED:         c.REVIEWED          ?? 0,
      FAILED:           c.FAILED            ?? 0,
      DISMISSED:        c.DISMISSED         ?? 0,
      ROUTED:           c.ROUTED            ?? 0,
    };
  }, [facets]);

  const distribution = useMemo(
    // Filter out non-petition categories so their bars never become filter
    // chips here (see NON_PETITION_CATEGORY_KEYS above).
    () => (facets?.distribution ?? []).filter((b) => !NON_PETITION_CATEGORY_KEYS.has(b.key)),
    [facets],
  );

  // Server-side pagination: `total` is the true count across BOTH tables
  // under the current filters (unified /api/petitions/inbox), and `pageRows`
  // is already the correct sorted slice from the server. No client sort or
  // slice — the old approach capped uploads at 500 in memory and produced a
  // pagination total that lagged the tab count.
  const total = inboxTotal;
  const lastPage = Math.max(1, Math.ceil(total / pageSize));
  useEffect(() => { if (page > lastPage) setPage(lastPage); }, [page, lastPage]);
  const offset = (page - 1) * pageSize;

  // Global counts — filter-independent (from /aggregates). The FAILED banner
  // is a global signal: a hidden filter must not mask an active failure.
  const failedCount = aggregates?.failed_count ?? 0;
  const advancedFilterCount = (fPriority ? 1 : 0) + (fSource ? 1 : 0) + (fCategory ? 1 : 0) + ((dateFrom || dateTo) ? 1 : 0);
  const anyFilterActive = Boolean(q || fPriority || fSource || fCategory || dateFrom || dateTo);

  async function openRow(r: InboxRow) {
    if (r.statusKey === "QUEUED" || r.statusKey === "PROCESSING") return;
    setEditing(false);
    // Reset merge state whenever a new row opens — the previous drawer's
    // Find-similar payload is no longer relevant.
    setSimilar(null);
    setKeptSignatoryIds(new Set());
    if (r.kind === "petition" && r.petition) {
      const rv = mapPetitionToReview(r.petition);
      setReview(rv);
      // Phone is OTP-verified (kept read-only); everything else is editable.
      setForm({ name: rv.name, name_ta: rv.name_ta, summary: rv.summary, category: rv.category, priority: rv.priority, ministry: rv.ministry, district: rv.district });
      return;
    }
    const u = r.upload!;
    // Show the drawer immediately from the light row so it feels instant, then
    // hydrate summary / key_details via the detail endpoint — the list payload
    // no longer carries the long narrative fields (that's the whole point of
    // the pagination refactor). The subsequent setReview merges the fuller
    // record in place without flashing the drawer.
    setReview({ ...u, _kind: "upload" });
    setForm({ name: u.name, name_ta: u.name_ta, mobile: u.mobile, category: u.category, priority: u.priority, ministry: u.ministry, district: u.district, summary: u.summary });
    try {
      const resp = await fetch(api(`/${u.id}`), { credentials: "include" });
      if (!resp.ok) return;
      const full: Upload = await resp.json();
      setReview((prev) => (prev && prev.id === full.id) ? { ...full, _kind: "upload" } : prev);
      setForm((prev) => ({ ...prev, summary: prev.summary ?? full.summary }));
    } catch { /* keep the light preview */ }
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

  async function handleReviewAttach(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";               // allow re-picking the same file
    if (!file || !review) return;
    if (file.size > 5 * 1024 * 1024) { toast.error(t("attach.tooLarge")); return; }
    setBusy(true);
    try {
      const att = await uploadAppointmentAttachment(review.id, file);
      setReview({
        ...review,
        attachments: [...(review.attachments ?? []),
          { name: att.name, url: att.url, type: att.type as AppointmentAttachment["type"] }],
      });
      toast.success(t("attach.added"));
      load();
    } catch (err) {
      toast.error((err as Error).message || t("attach.failed"));
    } finally {
      setBusy(false);
    }
  }

  async function approve() {
    if (!review) return;
    setBusy(true);
    try {
      // Signature-petition path: petitions only, and only if the reviewer
      // curated at least one signatory. Otherwise fall through to the plain
      // single-petition approve so the existing behavior is unchanged.
      const sigIds = review._kind === "petition" ? Array.from(keptSignatoryIds) : [];
      const isMerge = sigIds.length > 0;
      const url = isMerge
        ? `/api/appointments/${review.id}/approve-with-signatories`
        : (review._kind === "petition"
            ? `/api/appointments/${review.id}/approve`
            : api(`/${review.id}/approve`));
      const init: RequestInit = { method: "POST", credentials: "include" };
      if (isMerge) {
        init.headers = { "Content-Type": "application/json" };
        init.body = JSON.stringify({ signatory_ids: sigIds });
      }
      const r = await fetch(url, init);
      const d = await r.json().catch(() => ({}));
      if (r.ok) {
        const nSig = d.signatory_count ?? (isMerge ? 1 + sigIds.length : 1);
        toast.success(
          nSig > 1
            ? `Ticket ${d.ticket_number ?? ""} · ${nSig} signatures merged`
            : (d.forwarded
                ? `Forwarded to ministry${d.ticket_number ? ` — ticket ${d.ticket_number}` : ""}`
                : (d.ticket_number ? `Ticket ${d.ticket_number} created` : "Approved"))
        );
        setReview(null); load();
      } else toast.error(d.error || "Action failed");
    } catch { toast.error("Network error"); } finally { setBusy(false); }
  }

  // ── Find similar (petition-only, on-demand) ──────────────────────────────
  async function loadSimilar() {
    if (!review || review._kind !== "petition") return;
    setSimilarLoading(true);
    try {
      const r = await fetch(`/api/appointments/${review.id}/similar`, { credentials: "include" });
      if (!r.ok) throw new Error(`Find similar failed (${r.status})`);
      const d = await r.json();
      setSimilar(d);
      // Default: keep all candidates the AI found. The reviewer ✕'s the false
      // positives; on Approve, only what's still in `keptSignatoryIds` is merged.
      setKeptSignatoryIds(new Set((d.candidates || []).map((c: { id: number }) => c.id)));
    } catch (e) {
      toast.error((e as Error).message || "Find similar failed");
    } finally {
      setSimilarLoading(false);
    }
  }

  // Dismiss — mark reviewed WITHOUT creating a ticket / citizen / appointment.
  // Works for both AI uploads and citizen/staff petitions; each has its own
  // backend endpoint but the UX is identical.
  async function dismissConfirmed() {
    if (!review) return;
    setDismissOpen(false);
    setBusy(true);
    try {
      const url = review._kind === "petition"
        ? `/api/appointments/${review.id}/dismiss`
        : api(`/${review.id}/dismiss`);
      const r = await fetch(url, { method: "POST", credentials: "include" });
      const d = await r.json().catch(() => ({}));
      if (r.ok) { toast.success(t("petition.dismissedToast")); setReview(null); load(); }
      else toast.error(d.error || t("petition.dismissFailed"));
    } catch { toast.error(t("petition.networkError")); } finally { setBusy(false); }
  }
  function dismiss() {
    if (!review) return;
    setDismissOpen(true);
  }

  // Undo a dismissal — send the row back to AWAITING_REVIEW. Same dual-endpoint
  // shape as dismiss; no confirm dialog since it is the safe, reversible action.
  async function restore() {
    if (!review) return;
    setBusy(true);
    try {
      const url = review._kind === "petition"
        ? `/api/appointments/${review.id}/restore`
        : api(`/${review.id}/restore`);
      const r = await fetch(url, { method: "POST", credentials: "include" });
      const d = await r.json().catch(() => ({}));
      if (r.ok) { toast.success(t("petition.restoredToast")); setReview(null); load(); }
      else toast.error(d.error || t("petition.restoreFailed"));
    } catch { toast.error(t("petition.networkError")); } finally { setBusy(false); }
  }

  // Recover a mis-classified scan — DELETES the proposal/association the
  // classifier created and re-queues this upload for petition extraction (the
  // backend locks it so it won't route out again). Uploads only; petitions are
  // never routed. Gated behind moveBackOpen confirmation because a mis-click
  // on a legitimately routed proposal is unrecoverable.
  function moveBack() {
    if (!review || review._kind === "petition") return;
    setMoveBackOpen(true);
  }
  async function moveBackConfirmed() {
    if (!review) return;
    setMoveBackOpen(false);
    setBusy(true);
    try {
      const r = await fetch(api(`/${review.id}/move-back`), { method: "POST", credentials: "include" });
      const d = await r.json().catch(() => ({}));
      if (r.ok) { toast.success(t("petition.movedBackToast")); setReview(null); load(); }
      else toast.error(d.error || t("petition.moveBackFailed"));
    } catch { toast.error(t("petition.networkError")); } finally { setBusy(false); }
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
    // Export the WHOLE filtered set, not just the current page. Ask the inbox
    // endpoint for a max-cap slice (server enforces page_size≤200) via a
    // pagination loop — small feed today, and the loop is bounded by `total`
    // so it can't run away.
    const params = new URLSearchParams(buildInboxQuery());
    params.set("page_size", "200");
    const rows: Array<Record<string, unknown> & { _kind: "upload" | "petition" }> = [];
    let p = 1;
    // Safety cap: at page_size=200 this covers 20k rows, well beyond any real
    // filter. Prevents an infinite loop if `total` ever drifts from `items`.
    while (p <= 100) {
      params.set("page", String(p));
      const resp = await fetch(`/api/petitions/inbox?${params.toString()}`, { credentials: "include" });
      if (!resp.ok) break;
      const body = await resp.json();
      const items = (body.items ?? []) as typeof rows;
      rows.push(...items);
      if (!body.has_more || items.length === 0) break;
      p += 1;
    }
    const headers = ["Token", "Name", "Phone", "Source", "Venue", "Category", "Priority", "Status", "Submitted"];
    const lines = rows.map((it) => {
      if (it._kind === "upload") {
        const u = it as unknown as Upload;
        return [
          u.ticket_number ?? "", u.name ?? "", u.mobile ?? "",
          t(SOURCE_META[u.source || "ai_scan"]?.tKey ?? "petition.sourceStaff"),
          "",
          catLabel(u.category, "en"), u.priority ?? "",
          t(STATUS_TKEY[u.status] ?? "petition.statusAwaitingReview"), u.created_at ?? "",
        ];
      }
      const pt = it as unknown as AppointmentRow;
      return [
        pt.token != null ? String(pt.token) : "", pt.name ?? "", pt.mobile ?? "",
        t(SOURCE_META[pt.source || "qr_citizen"]?.tKey ?? "petition.sourceStaff"),
        pt.venue ?? "",
        catLabel(pt.category ?? null, "en"), pt.priority ?? "",
        t(STATUS_TKEY[petitionStatusKey(pt.status)]), pt.created_at ?? "",
      ];
    });
    const csv = [headers, ...lines].map((row) => row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = "data:text/csv;charset=utf-8," + encodeURIComponent(csv);
    a.download = `petitions_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    toast.success(`${rows.length} ${t("petition.results")}`);
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
          {/* Batch scope banner — makes it obvious the queue is showing one
              upload batch (and not the whole inbox), with a way back out. */}
          {batchFilter && (
            <div className="flex shrink-0 flex-wrap items-center gap-2 rounded-xl border border-brand/30 bg-brand/5 px-3.5 py-2.5">
              <Layers className="h-4 w-4 shrink-0 text-brand" />
              <span className="text-[13px] text-foreground">
                {t("petition.batchScope")}{" "}
                <span className="font-mono text-[12.5px] font-bold text-brand">{batchLabel}</span>
              </span>
              <span className="font-mono text-[12.5px] font-semibold text-muted-foreground">
                {(() => {
                  // "Rows in this batch" = every non-in-flight file. Comes
                  // straight from the /batches lookup so the number matches
                  // regardless of which status/category tab the PA is on.
                  const c = batchesLookup[batchFilter]?.counts;
                  if (!c) return "";
                  const n = (c.AWAITING_REVIEW || 0) + (c.REVIEWED || 0)
                          + (c.FAILED || 0) + (c.DISMISSED || 0);
                  return `(${n})`;
                })()}
              </span>
              <button
                onClick={() => router.replace("/ai-review")}
                className="ml-auto inline-flex items-center gap-1 rounded-lg border border-border bg-card px-2.5 py-1 text-[12.5px] font-semibold text-foreground transition-colors hover:bg-muted"
              >
                <X className="h-3.5 w-3.5" /> {t("petition.batchScopeClear")}
              </button>
            </div>
          )}

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
                      active ? "bg-white text-brand shadow-card"
                        : s.key === "FAILED" && (count ?? 0) > 0 ? "bg-red-100 text-red-700"
                        : "bg-muted text-muted-foreground",
                    )}>
                      {count ?? "·"}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {failedCount > 0 && (
                <div className="flex items-center gap-1.5">
                  {/* A failed scan needs attention, but sits behind its own tab
                      out of the default Awaiting queue. This always-on red flag
                      surfaces the count and jumps straight to the failed rows. */}
                  <button
                    onClick={() => { setFStatus("FAILED"); setPage(1); }}
                    className="inline-flex h-[38px] items-center gap-1.5 rounded-xl border border-red-300 bg-red-50 px-3 text-[13px] font-semibold text-red-700 transition-colors hover:bg-red-100">
                    <AlertTriangle className="h-3.5 w-3.5" /> {failedCount} {t("petition.segFailed")}
                  </button>
                  <Button size="sm" variant="outline" className="h-[38px] rounded-xl border-red-300 text-red-700"
                    onClick={() => retry(aggregates?.failed_ids ?? [])}>
                    <RefreshCw className="mr-1 h-3.5 w-3.5" /> {t("petition.retryAllFailed")}
                  </Button>
                </div>
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
                      <DateRangePill
                        from={dateFrom} to={dateTo}
                        onFrom={(v) => { setPage(1); setDateFrom(v); setDateChip("custom"); }}
                        onTo={(v) => { setPage(1); setDateTo(v); setDateChip("custom"); }}
                        ariaFromLabel={`${t("appts.dateSubmitted")} from`}
                        ariaToLabel={`${t("appts.dateSubmitted")} to`}
                      />
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
                    {pick(review.citizen_ask, review.citizen_ask_ta) || review.name
                      || (review._kind === "upload" ? review.filename : null) || "Petition"}
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
                    <Field label={editing ? t("petition.fNameEn") : t("petition.colName")} labelIcon={User} editing={editing} value={form.name} fallback={lang === "ta" && review.name_ta?.trim() ? review.name_ta : review.name} onChange={v => setForm(f => ({ ...f, name: v }))} />
                    {/* Phone stays read-only for petitions — it's the OTP-verified, uniquely-indexed citizen mobile. */}
                    <Field label={t("petition.colPhone")} labelIcon={Phone} editing={editing && review._kind !== "petition"} value={form.mobile} fallback={review.mobile} onChange={v => setForm(f => ({ ...f, mobile: v }))} />
                    {editing && <Field label={t("petition.fNameTa")} editing value={form.name_ta} fallback={review.name_ta} onChange={v => setForm(f => ({ ...f, name_ta: v }))} />}
                    <SelectField label={t("petition.colCategory")} icon={Tag} editing={editing} value={form.category} fallback={review.category} options={CATEGORIES} labels={catLabels} onChange={v => setForm(f => ({ ...f, category: v }))} />
                    <SelectField label={t("petition.colUrgency")} icon={BarChart3} editing={editing} value={form.priority} fallback={review.priority} options={PRIORITIES} labels={priorityLabels} onChange={v => setForm(f => ({ ...f, priority: v }))} />
                    <SelectField label={t("petition.fMinistry")} icon={Building2} editing={editing} value={form.ministry} fallback={review.ministry} options={MINISTRIES} labels={MINISTRY_DISPLAY} onChange={v => setForm(f => ({ ...f, ministry: v }))} />
                    <SelectField label={t("petition.fDistrict")} icon={MapPin} editing={editing} value={form.district} fallback={review.district} options={DISTRICTS} labels={DISTRICT_DISPLAY} onChange={v => setForm(f => ({ ...f, district: v }))} />
                  </div>
                </section>

                {/* Add attachment — available while editing a petition */}
                {editing && review._kind === "petition" && (
                  <section className="rounded-2xl border border-dashed border-border bg-card p-4 shadow-card">
                    <input
                      ref={reviewAttachRef}
                      type="file"
                      accept="image/jpeg,image/png,image/webp,application/pdf"
                      className="hidden"
                      onChange={handleReviewAttach}
                    />
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-[13px] text-muted-foreground">{t("attach.help")}</span>
                      <Button size="sm" variant="outline" disabled={busy} onClick={() => reviewAttachRef.current?.click()}>
                        <Paperclip className="mr-1.5 h-3.5 w-3.5" /> {t("attach.cta")}
                      </Button>
                    </div>
                  </section>
                )}

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

                {/* Duplicate check — petition-only, awaiting-only. Reviewer
                    clicks Find similar; results appear here and are curated
                    with ✕. Approve merges what remains into one ticket. */}
                {review._kind === "petition" && review.status === "AWAITING_REVIEW" && (
                  <section className="rounded-2xl border border-border bg-card p-5 shadow-card">
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                      <SectionHeader icon={User} title="Duplicate check" />
                      <Button size="sm" variant="outline"
                        onClick={loadSimilar}
                        disabled={similarLoading || busy || editing}>
                        {similarLoading
                          ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                          : <Search className="mr-1.5 h-3.5 w-3.5" />}
                        {similar ? "Refresh similar" : "Find similar"}
                      </Button>
                    </div>
                    {!similar && (
                      <p className="text-[13px] leading-relaxed text-muted-foreground">
                        Look for other awaiting petitions with the same demand in this district. If any are found, approving here will merge them into <strong>one ticket with a signatory list</strong> — every citizen is preserved on the roster.
                      </p>
                    )}
                    {similar && similar.candidates.length === 0 && (
                      <p className="text-[13px] text-muted-foreground">{similar.reason || "No similar petitions found."}</p>
                    )}
                    {similar && similar.candidates.length > 0 && (
                      <div className="space-y-2.5">
                        <div className="rounded-lg border border-brand/25 bg-brand/[0.04] px-3 py-2 text-[13px] text-foreground">
                          <strong>{keptSignatoryIds.size}</strong> of {similar.candidates.length} kept — approving creates{" "}
                          <strong>1 ticket with {keptSignatoryIds.size + 1} signatures</strong>. Use <X className="inline h-3 w-3 align-[-2px]" /> to drop any that aren't actually the same.
                        </div>
                        {similar.candidates.map((c) => {
                          const kept = keptSignatoryIds.has(c.id);
                          return (
                            <div key={c.id} className={cn(
                              "flex items-start gap-3 rounded-xl border px-3 py-2.5 transition-colors",
                              kept ? "border-border bg-background/60" : "border-dashed border-muted-foreground/30 bg-muted/20 opacity-60",
                            )}>
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="truncate text-[13.5px] font-semibold text-foreground">{c.name || "Unnamed"}</span>
                                  <span className="num rounded bg-brand/10 px-1.5 py-0.5 text-[10.5px] font-bold tabular-nums text-brand">
                                    {Math.round((c.score || 0) * 100)}%
                                  </span>
                                  {c.source && <span className="text-[11.5px] uppercase tracking-wider text-muted-foreground">{c.source}</span>}
                                </div>
                                <p className="mt-1 line-clamp-2 text-[13px] text-foreground/85">{c.ask || "—"}</p>
                              </div>
                              <button
                                type="button"
                                onClick={() => setKeptSignatoryIds((s) => {
                                  const next = new Set(s);
                                  if (kept) next.delete(c.id); else next.add(c.id);
                                  return next;
                                })}
                                aria-label={kept ? "Not a duplicate — remove from merge" : "Add back to merge"}
                                title={kept ? "Not a duplicate — remove from merge" : "Add back to merge"}
                                className={cn(
                                  "grid h-8 w-8 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors",
                                  kept ? "hover:bg-red-100 hover:text-red-700" : "hover:bg-brand/10 hover:text-brand",
                                )}
                              >
                                {kept ? <X className="h-4 w-4" /> : <RotateCcw className="h-4 w-4" />}
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </section>
                )}

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
                  // Audio-only petitions can't become tickets: a recording is not
                  // readable evidence for the department that receives it. Blocked
                  // server-side too — this just explains it before they click.
                  // No attachments at all is fine (a typed description carries it).
                  const attTypes = new Set((review.attachments ?? []).map(a => a.type));
                  const audioOnly = attTypes.has("AUDIO") && !attTypes.has("IMAGE") && !attTypes.has("DOCUMENT");
                  return (
                    <div className="flex flex-col gap-2">
                      {audioOnly && (
                        <div className="flex gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-[13px] leading-relaxed text-amber-900">
                          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
                          <span>{t("petition.audioOnlyBlock")}</span>
                        </div>
                      )}
                      <Button
                        className={cn(
                          "w-full text-white !bg-none border-transparent",
                          isSchool ? "!bg-emerald-600 hover:!bg-emerald-700" : "!bg-amber-600 hover:!bg-amber-700",
                        )}
                        onClick={approve}
                        disabled={busy || editing || audioOnly}
                      >
                        {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          : isSchool ? <Check className="mr-2 h-4 w-4" /> : <Forward className="mr-2 h-4 w-4" />}
                        {(() => {
                          const nSig = review._kind === "petition" ? keptSignatoryIds.size : 0;
                          const base = isSchool
                            ? t("petition.acceptCta")
                            : `${t("petition.forwardCta")}${ministryLabel ? ` — ${ministryLabel}` : ""}`;
                          return nSig > 0 ? `${base} · ${nSig + 1} signatures` : base;
                        })()}
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
                {review.status === "DISMISSED" && (
                  <Button className="w-full" variant="outline" onClick={restore} disabled={busy}>
                    {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RotateCcw className="mr-2 h-4 w-4" />}
                    {t("petition.restoreCta")}
                  </Button>
                )}
                {review.status === "ROUTED" && (() => {
                  // The classifier moved this scan out of the petition workflow.
                  // Offer to open it where it now lives, or pull it back if the
                  // AI mis-typed a petition as a proposal/association.
                  const isAssoc = review.routed_to === "association";
                  const workflowLabel = isAssoc ? t("petition.routedAssociation") : t("petition.routedProposal");
                  // Preserve the routed row's downstream id in the query so
                  // the target workflow can auto-open THAT specific proposal /
                  // association, not just drop the PA on the list.
                  const refId = review.routed_ref_id;
                  const workflowHref = (isAssoc ? "/association-review" : "/proposal-review")
                    + (refId ? `?id=${refId}` : "");
                  return (
                    <div className="flex flex-col gap-3">
                      <div className="flex gap-2 rounded-xl border border-violet-200 bg-violet-50 px-3.5 py-3 text-[13px] leading-relaxed text-violet-900">
                        <Route className="mt-0.5 h-4 w-4 shrink-0" />
                        <span>{t("petition.routedExplain").replace("{workflow}", workflowLabel)}</span>
                      </div>
                      <div className="flex flex-col gap-2 sm:flex-row">
                        <Button variant="outline" className="flex-1" onClick={() => router.push(workflowHref)} disabled={busy}>
                          <ExternalLink className="mr-2 h-4 w-4" /> {t("petition.routedOpenCta").replace("{workflow}", workflowLabel)}
                        </Button>
                        <Button
                          variant="outline"
                          className="flex-1 border-brand/40 text-brand hover:bg-brand/5"
                          onClick={moveBack}
                          disabled={busy}
                        >
                          {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Undo2 className="mr-2 h-4 w-4" />}
                          {t("petition.moveBackCta")}
                        </Button>
                      </div>
                    </div>
                  );
                })()}
                {editing && <p className="mt-1.5 text-center text-xs text-muted-foreground">{t("petition.saveBeforeApprove")}</p>}
              </div>
            </div>
          </motion.div>
        </div>
      )}

      {/* Dismiss confirmation dialog — replaces the browser's native
          window.confirm() so the modal matches the rest of the app. */}
      <Dialog open={dismissOpen} onOpenChange={setDismissOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Archive className="h-4 w-4 text-amber-600" />
              {t("petition.dismissDialogTitle")}
            </DialogTitle>
            <DialogDescription>{t("petition.dismissDialogBody")}</DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="ghost" onClick={() => setDismissOpen(false)} disabled={busy}>
              {t("petition.cancel")}
            </Button>
            <Button
              className="bg-amber-600 text-white hover:bg-amber-700 !bg-none"
              onClick={dismissConfirmed}
              disabled={busy}
            >
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Archive className="mr-2 h-4 w-4" />}
              {t("petition.dismissConfirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Move-back confirmation — this one is DESTRUCTIVE (the created
          proposal/association is deleted), so the confirm text is explicit
          about that and the button is red, not brand. */}
      <Dialog open={moveBackOpen} onOpenChange={setMoveBackOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Undo2 className="h-4 w-4 text-red-600" />
              Move back to petitions?
            </DialogTitle>
            <DialogDescription>
              This will <strong>delete</strong> the {review?.routed_to === "association" ? "association" : "proposal"} the classifier created and re-queue this upload as a petition. This can't be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="ghost" onClick={() => setMoveBackOpen(false)} disabled={busy}>
              {t("petition.cancel")}
            </Button>
            <Button
              className="bg-red-600 text-white hover:bg-red-700 !bg-none"
              onClick={moveBackConfirmed}
              disabled={busy}
            >
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Undo2 className="mr-2 h-4 w-4" />}
              Yes, move back
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
  // Declared before any early return so the hook order stays stable.
  const [imgError, setImgError] = useState(false);
  useEffect(() => { setImgError(false); }, [review.file_url]);
  if (review._kind === "petition") {
    const att = [...(review.attachments ?? [])];
    if (review.audio_url && !att.some(a => a.type === "AUDIO")) att.push({ name: "Voice recording", url: review.audio_url, type: "AUDIO" });
    return att.length || review.audio_transcript
      ? <InlineAttachmentPreview attachments={att} audioTranscript={review.audio_transcript} defaultOpenFirst />
      : <div className="grid h-full place-items-center text-muted-foreground">{t("petition.noPreview")}</div>;
  }
  if (review.file_url) {
    if (review.mime_type === "application/pdf") {
      // Chrome/Edge's built-in PDF viewer is treated as a plugin and gets
      // silently blocked inside a `sandbox` iframe — you'd see either a
      // blank pane or the 🚫 no-entry glyph. Serve without sandbox and
      // hide the toolbar via the #toolbar=0 fragment.
      // Single <iframe> only — we used to wrap in <object> with iframe as
      // fallback, but Chromium loads BOTH concurrently which surfaces the
      // "This site attempted to download multiple files automatically"
      // browser warning whenever the inline PDF viewer can't take over.
      const src = `${review.file_url}#toolbar=0&navpanes=0&view=FitH`;
      return (
        <iframe src={src} title="document" className="h-full min-h-[240px] w-full rounded-lg border border-border bg-white" />
      );
    }
    if (imgError) {
      return <div className="grid h-full place-items-center text-muted-foreground">{t("petition.noPreview")}</div>;
    }
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={review.file_url} alt="petition" onError={() => setImgError(true)} className="mx-auto max-w-full select-none rounded-lg shadow" draggable={false} />;
  }
  return <div className="grid h-full place-items-center text-muted-foreground">{t("petition.noPreview")}</div>;
}
