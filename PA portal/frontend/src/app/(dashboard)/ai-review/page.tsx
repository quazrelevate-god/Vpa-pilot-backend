"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  ClipboardCheck, RefreshCw, Check, Pencil, X, FileText, Search,
  AlertTriangle, Clock, Loader2, Ticket as TicketIcon, Phone, Languages, ShieldAlert,
  QrCode, ScanLine, UserCog,
} from "lucide-react";
import { toast } from "sonner";

import TopBar from "@/components/TopBar";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import AppointmentDetailDrawer from "@/components/AppointmentDetailDrawer";
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

// One normalized row for the inbox, regardless of origin.
interface InboxRow {
  kind: "upload" | "petition";
  id: number;
  name: string | null;
  mobile: string | null;
  category: string | null;
  urgency: string | null;
  statusKey: StatusKey;
  source: string;            // qr_citizen | ai_scan | manual_staff
  created_at: string | null;
  ticket_number: string | null;
  upload?: Upload;           // kind === "upload"
  petition?: AppointmentRow; // kind === "petition"
}

const CATEGORIES = ["action_required","proposals","transfer_requests","pension_requests","school_admission","job_requests","rti","associations_unions","school_upgradation","invitation","greetings","general","other"];
const URGENCIES = ["low", "medium", "high", "critical"];
const STATUS_FILTERS: StatusKey[] = ["AWAITING_REVIEW", "REVIEWED", "FAILED", "PROCESSING", "QUEUED"];

const STATUS_META: Record<string, { label: string; cls: string; icon: typeof Clock }> = {
  QUEUED:          { label: "Queued",          cls: "bg-slate-100 text-slate-600",     icon: Clock },
  PROCESSING:      { label: "Processing",      cls: "bg-blue-100 text-blue-700",       icon: Loader2 },
  AWAITING_REVIEW: { label: "Awaiting Review", cls: "bg-amber-100 text-amber-700",     icon: AlertTriangle },
  REVIEWED:        { label: "Reviewed",        cls: "bg-emerald-100 text-emerald-700", icon: Check },
  FAILED:          { label: "Failed",          cls: "bg-red-100 text-red-700",         icon: X },
};
const URGENCY_CLS: Record<string, string> = {
  critical: "bg-red-100 text-red-700", high: "bg-orange-100 text-orange-700",
  medium: "bg-amber-100 text-amber-700", low: "bg-slate-100 text-slate-600",
};

// Where the petition came from — shown so PAs can tell a citizen QR submission
// apart from a staff-scanned document at a glance.
const SOURCE_META: Record<string, { label: string; cls: string; icon: typeof QrCode }> = {
  qr_citizen:  { label: "Citizen QR",       cls: "bg-sky-100 text-sky-700",       icon: QrCode },
  ai_scan:     { label: "Scanned petition", cls: "bg-violet-100 text-violet-700", icon: ScanLine },
  manual_staff:{ label: "Staff entry",      cls: "bg-slate-100 text-slate-600",   icon: UserCog },
};

const pretty = (s: string) => s.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
const api = (p: string) => `/api/ai-uploads${p}`;

function petitionStatusKey(status: string): StatusKey {
  return status === "Reviewed" ? "REVIEWED" : "AWAITING_REVIEW";
}

export default function AiReviewPage() {
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [petitions, setPetitions] = useState<AppointmentRow[]>([]);
  const [review, setReview] = useState<Upload | null>(null);            // upload review modal
  const [reviewPetition, setReviewPetition] = useState<AppointmentRow | null>(null); // QR petition drawer
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Partial<Upload>>({});
  const [lang, setLang] = useState<"en" | "ta">("en");
  const [busy, setBusy] = useState(false);
  // filters
  const [fStatus, setFStatus] = useState("");
  const [fUrgency, setFUrgency] = useState("");
  const [fSource, setFSource] = useState("");
  const [q, setQ] = useState("");

  const load = useCallback(async () => {
    try {
      const [uploadsRes, petitionsRes] = await Promise.allSettled([
        fetch(api(""), { credentials: "include" }).then(r => r.json()),
        // Direct petitions live in the appointments table; ai_scan ones are already
        // represented by the upload rows, so exclude them to avoid double-listing.
        fetchAppointments({ kind: "petition", status: "All", pageSize: 2000 }),
      ]);
      if (uploadsRes.status === "fulfilled" && Array.isArray(uploadsRes.value)) setUploads(uploadsRes.value);
      if (petitionsRes.status === "fulfilled") {
        setPetitions((petitionsRes.value.items || []).filter((p: AppointmentRow) => p.source !== "ai_scan"));
      }
    } catch { /* keep last good */ }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const active = uploads.some(u => u.status === "QUEUED" || u.status === "PROCESSING");
    if (!active) return;
    const id = setInterval(load, 4000);
    return () => clearInterval(id);
  }, [uploads, load]);
  useEffect(() => {
    if (review && !editing) {
      const fresh = uploads.find(u => u.id === review.id);
      if (fresh) setReview(fresh);
    }
  }, [uploads]); // eslint-disable-line react-hooks/exhaustive-deps
  // Esc closes the upload review modal (keyboard a11y; the Radix drawers below
  // already handle this themselves).
  useEffect(() => {
    if (!review) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !busy) setReview(null); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [review, busy]);

  // Merge both origins into one inbox, newest first.
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
  const awaitingCount = rows.filter(r => r.statusKey === "AWAITING_REVIEW").length;

  function openRow(r: InboxRow) {
    if (r.statusKey === "QUEUED" || r.statusKey === "PROCESSING") return;
    if (r.kind === "petition" && r.petition) {
      setReviewPetition(r.petition);
      return;
    }
    const u = r.upload!;
    setReview(u); setEditing(false); setLang("en");
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

  async function retry(ids: number[]) {
    if (!ids.length) return;
    try {
      const r = await fetch(api("/retry"), {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify({ ids }),
      });
      if (r.ok) { toast.success(`${ids.length} re-queued`); load(); }
      else toast.error("Retry failed");
    } catch { toast.error("Network error"); }
  }

  const pick = <T,>(en: T, ta: T): T => (lang === "ta" ? (ta || en) : en);

  return (
    <>
      <TopBar />
      <main className="flex-1 overflow-y-auto bg-background">
        <div className="mx-auto max-w-[1200px] space-y-5 p-6 animate-in-up">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-extrabold tracking-tight">
              <span className="grid h-9 w-9 place-items-center rounded-xl bg-violet-100 text-violet-600">
                <ClipboardCheck className="h-5 w-5" />
              </span>
              Petition Review
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Every petition to verify and approve into a ticket — citizen QR submissions and scanned uploads in one place.
              {awaitingCount > 0 && <span className="ml-1 font-medium text-amber-700">{awaitingCount} awaiting review.</span>}
            </p>
          </div>

          {/* Filters */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search name / phone"
                className="w-56 rounded-lg border border-input bg-card py-2 pl-8 pr-3 text-sm focus:border-violet-500 focus:outline-none" />
            </div>
            <select value={fSource} onChange={e => setFSource(e.target.value)}
              className="rounded-lg border border-input bg-card px-3 py-2 text-sm focus:border-violet-500 focus:outline-none">
              <option value="">All sources</option>
              {Object.entries(SOURCE_META).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}
            </select>
            <select value={fStatus} onChange={e => setFStatus(e.target.value)}
              className="rounded-lg border border-input bg-card px-3 py-2 text-sm focus:border-violet-500 focus:outline-none">
              <option value="">All statuses</option>
              {STATUS_FILTERS.map(s => <option key={s} value={s}>{STATUS_META[s].label}</option>)}
            </select>
            <select value={fUrgency} onChange={e => setFUrgency(e.target.value)}
              className="rounded-lg border border-input bg-card px-3 py-2 text-sm focus:border-violet-500 focus:outline-none">
              <option value="">All urgency</option>
              {URGENCIES.map(u => <option key={u} value={u}>{pretty(u)}</option>)}
            </select>
            {(fStatus || fUrgency || fSource || q) && (
              <button onClick={() => { setFStatus(""); setFUrgency(""); setFSource(""); setQ(""); }} className="text-xs font-medium text-muted-foreground hover:text-foreground">Clear</button>
            )}
            <div className="ml-auto flex items-center gap-2">
              {failedCount > 0 && (
                <Button size="sm" variant="outline" className="border-red-300 text-red-700" onClick={() => retry(uploads.filter(u => u.status === "FAILED").map(u => u.id))}>
                  <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Retry all failed ({failedCount})
                </Button>
              )}
              <button onClick={load} className="rounded-lg p-2 hover:bg-muted" title="Refresh"><RefreshCw className="h-4 w-4 text-muted-foreground" /></button>
            </div>
          </div>

          {/* Table */}
          <Card className="overflow-hidden p-0">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] text-left text-sm">
                <thead className="bg-muted/50 text-[11px] uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2.5">Name</th>
                    <th className="px-4 py-2.5">Phone</th>
                    <th className="px-4 py-2.5">Source</th>
                    <th className="px-4 py-2.5">Category</th>
                    <th className="px-4 py-2.5">Urgency</th>
                    <th className="px-4 py-2.5">Status</th>
                    <th className="px-4 py-2.5 text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 ? (
                    <tr><td colSpan={7} className="px-4 py-12 text-center text-muted-foreground">
                      {rows.length === 0 ? "Nothing to review yet." : "No rows match the filters."}
                    </td></tr>
                  ) : filtered.map(r => {
                    const m = STATUS_META[r.statusKey]; const Icon = m.icon;
                    const sm = SOURCE_META[r.source] ?? { label: r.source, cls: "bg-muted text-muted-foreground", icon: FileText };
                    const SIcon = sm.icon;
                    const clickable = r.statusKey === "AWAITING_REVIEW" || r.statusKey === "REVIEWED" || r.statusKey === "FAILED";
                    return (
                      <tr key={`${r.kind}-${r.id}`} onClick={() => openRow(r)}
                        className={cn("border-t border-border/70", clickable ? "cursor-pointer hover:bg-muted/40" : "opacity-80")}>
                        <td className="px-4 py-2.5 font-medium text-foreground">{r.name || <span className="text-muted-foreground">—</span>}</td>
                        <td className="px-4 py-2.5 text-muted-foreground">{r.mobile || "—"}</td>
                        <td className="px-4 py-2.5">
                          <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold", sm.cls)}>
                            <SIcon className="h-3 w-3" /> {sm.label}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-muted-foreground">{r.category ? pretty(r.category) : "—"}</td>
                        <td className="px-4 py-2.5">{r.urgency ? <span className={cn("rounded px-1.5 py-0.5 text-[11px] font-semibold", URGENCY_CLS[r.urgency])}>{r.urgency}</span> : "—"}</td>
                        <td className="px-4 py-2.5">
                          <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold", m.cls)}>
                            <Icon className={cn("h-3 w-3", r.statusKey === "PROCESSING" && "animate-spin")} /> {m.label}
                          </span>
                          {r.ticket_number && <span className="ml-1 font-mono text-[11px] text-emerald-600">{r.ticket_number}</span>}
                        </td>
                        <td className="px-4 py-2.5 text-right" onClick={e => e.stopPropagation()}>
                          {r.statusKey === "AWAITING_REVIEW" && <Button size="sm" className="bg-violet-600 hover:bg-violet-700 text-white" onClick={() => openRow(r)}>Review</Button>}
                          {r.statusKey === "REVIEWED" && <span className="inline-flex items-center gap-1 text-xs text-emerald-600"><TicketIcon className="h-3.5 w-3.5" /> Done</span>}
                          {r.statusKey === "FAILED" && <Button size="sm" variant="outline" onClick={() => retry([r.id])}><RefreshCw className="mr-1 h-3.5 w-3.5" /> Retry</Button>}
                          {(r.statusKey === "QUEUED" || r.statusKey === "PROCESSING") && <span className="text-xs text-muted-foreground">…</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      </main>

      {/* Upload review — document left, fields right */}
      {review && (
        <div className="fixed inset-0 z-50 flex bg-slate-900/50" onClick={() => !busy && setReview(null)}>
          <div className="m-auto flex h-[90vh] w-[95vw] max-w-[1180px] overflow-hidden rounded-2xl bg-white shadow-2xl" onClick={e => e.stopPropagation()}>
            {/* Left — document */}
            <div className="hidden w-[46%] flex-col border-r border-border bg-slate-100 md:flex">
              <div className="flex items-center gap-1.5 border-b border-border bg-white px-4 py-2.5 text-sm font-semibold">
                <FileText className="h-4 w-4 text-muted-foreground" /> <span className="truncate">{review.filename}</span>
              </div>
              <div className="flex-1 overflow-auto p-3">
                {review.file_url ? (
                  review.mime_type === "application/pdf"
                    ? <iframe src={review.file_url} className="h-full w-full rounded-lg border border-border bg-white" title="document" />
                    : <img src={review.file_url} alt="petition" className="mx-auto max-w-full rounded-lg shadow" />
                ) : <div className="grid h-full place-items-center text-muted-foreground">No preview</div>}
              </div>
            </div>

            {/* Right — details */}
            <div className="flex w-full flex-col md:w-[54%]">
              <div className="flex items-start gap-3 border-b border-border px-5 py-3.5">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold", STATUS_META[review.status].cls)}>{STATUS_META[review.status].label}</span>
                    {review.urgency && <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase", URGENCY_CLS[review.urgency])}>{review.urgency}</span>}
                    {review.category && <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">{pretty(review.category)}</span>}
                    {review.ticket_number && <span className="font-mono text-[11px] text-emerald-600">{review.ticket_number}</span>}
                  </div>
                  <div className="mt-1 truncate text-base font-bold">{pick(review.headline, review.headline_ta) || review.name || "Petition"}</div>
                </div>
                <LangToggle lang={lang} onChange={setLang} />
                {review.status === "AWAITING_REVIEW" && (
                  !editing
                    ? <Button size="sm" variant="outline" onClick={() => setEditing(true)}><Pencil className="mr-1.5 h-3.5 w-3.5" /> Edit</Button>
                    : <Button size="sm" variant="outline" onClick={saveEdits} disabled={busy}><Check className="mr-1.5 h-3.5 w-3.5" /> Save</Button>
                )}
                <button onClick={() => !busy && setReview(null)} className="rounded-md p-1.5 hover:bg-muted"><X className="h-4 w-4" /></button>
              </div>

              <div className="flex-1 space-y-4 overflow-auto p-5">
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Name" editing={editing} value={form.name} fallback={review.name} onChange={v => setForm(f => ({ ...f, name: v }))} />
                  <Field label="Phone" editing={editing} value={form.mobile} fallback={review.mobile} onChange={v => setForm(f => ({ ...f, mobile: v }))} icon={Phone} />
                  {editing && <Field label="Name (Tamil)" editing value={form.name_ta} fallback={review.name_ta} onChange={v => setForm(f => ({ ...f, name_ta: v }))} />}
                  <SelectField label="Category" editing={editing} value={form.category} fallback={review.category} options={CATEGORIES} onChange={v => setForm(f => ({ ...f, category: v }))} />
                  <SelectField label="Urgency" editing={editing} value={form.urgency} fallback={review.urgency} options={URGENCIES} onChange={v => setForm(f => ({ ...f, urgency: v }))} />
                </div>
                {review.department && <div className="text-xs text-muted-foreground">Dept: {pretty(review.department)}</div>}

                <Panel title="Summary">
                  {editing
                    ? <textarea className="w-full rounded-lg border border-input px-3 py-2 text-sm" rows={4} value={form.summary ?? ""} onChange={e => setForm(f => ({ ...f, summary: e.target.value }))} />
                    : <p className="text-[14px] leading-relaxed text-foreground">{pick(review.summary, review.summary_ta) || "—"}</p>}
                </Panel>

                {pick(review.citizen_ask, review.citizen_ask_ta) && (
                  <div className="rounded-r-lg border-l-[3px] border-violet-500 bg-violet-50/50 py-3 pl-4 pr-3">
                    <div className="mb-1 text-[10px] font-bold uppercase tracking-[0.16em] text-violet-700">What they're asking for</div>
                    <p className="text-[13.5px] font-semibold text-foreground">{pick(review.citizen_ask, review.citizen_ask_ta)}</p>
                  </div>
                )}

                {(() => {
                  const list = pick(review.key_details, review.key_details_ta) || [];
                  if (!list.length) return null;
                  return (
                    <Panel title="Key details">
                      <ul className="space-y-1.5">
                        {list.map((d, i) => <li key={i} className="flex gap-2.5 text-[13px] text-foreground/85"><span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-violet-400" /><span>{d}</span></li>)}
                      </ul>
                    </Panel>
                  );
                })()}

                {review.status === "FAILED" && review.error && (
                  <div className="flex items-start gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700">
                    <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" /><span>{review.error}</span>
                  </div>
                )}
              </div>

              <div className="border-t border-border p-4">
                {review.status === "AWAITING_REVIEW" && (
                  <Button className="w-full bg-emerald-600 hover:bg-emerald-700 text-white" onClick={approve} disabled={busy || editing}>
                    {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />} Approve → create ticket
                  </Button>
                )}
                {review.status === "REVIEWED" && (
                  <div className="flex items-center justify-center gap-2 text-sm font-semibold text-emerald-600"><TicketIcon className="h-4 w-4" /> Approved as {review.ticket_number}</div>
                )}
                {review.status === "FAILED" && (
                  <Button className="w-full" variant="outline" onClick={() => { retry([review.id]); setReview(null); }}>
                    <RefreshCw className="mr-2 h-4 w-4" /> Retry extraction
                  </Button>
                )}
                {editing && <p className="mt-1.5 text-center text-[11px] text-muted-foreground">Save your edits before approving.</p>}
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
      <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{title}</div>
      {children}
    </div>
  );
}

function Field({ label, value, fallback, editing, onChange, icon: Icon }:
  { label: string; value?: string | null; fallback: string | null; editing: boolean; onChange: (v: string) => void; icon?: React.ElementType }) {
  return (
    <div>
      <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</div>
      {editing
        ? <input className="w-full rounded-lg border border-input px-3 py-2 text-sm" value={value ?? ""} onChange={e => onChange(e.target.value)} />
        : <div className="flex items-center gap-1.5 text-sm font-medium text-foreground">{Icon && <Icon className="h-3.5 w-3.5 text-muted-foreground" />}{fallback || "—"}</div>}
    </div>
  );
}

function SelectField({ label, value, fallback, editing, options, onChange }:
  { label: string; value?: string | null; fallback: string | null; editing: boolean; options: string[]; onChange: (v: string) => void }) {
  return (
    <div>
      <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</div>
      {editing
        ? <select className="w-full rounded-lg border border-input bg-white px-2 py-2 text-sm" value={value ?? ""} onChange={e => onChange(e.target.value)}>
            {options.map(o => <option key={o} value={o}>{o.replace(/_/g, " ")}</option>)}
          </select>
        : <div className="text-sm font-medium text-foreground">{fallback ? fallback.replace(/_/g, " ") : "—"}</div>}
    </div>
  );
}

function LangToggle({ lang, onChange }: { lang: "en" | "ta"; onChange: (l: "en" | "ta") => void }) {
  return (
    <div className="flex h-8 shrink-0 items-center gap-0.5 rounded-lg border border-border bg-muted/60 p-0.5 text-[11px] font-semibold">
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
