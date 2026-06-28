"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  ClipboardCheck, RefreshCw, Check, Pencil, X, FileText, Search,
  AlertTriangle, Clock, Loader2, Ticket as TicketIcon, Phone, Languages, ShieldAlert,
} from "lucide-react";
import { toast } from "sonner";

import TopBar from "@/components/TopBar";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

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

const CATEGORIES = ["action_required","proposals","transfer_requests","pension_requests","school_admission","job_requests","rti","associations_unions","school_upgradation","invitation","greetings","general","other"];
const URGENCIES = ["low", "medium", "high", "critical"];
const STATUS_FILTERS = ["AWAITING_REVIEW", "REVIEWED", "FAILED", "PROCESSING", "QUEUED"];

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
const pretty = (s: string) => s.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
const api = (p: string) => `/api/ai-uploads${p}`;

export default function AiReviewPage() {
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [review, setReview] = useState<Upload | null>(null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Partial<Upload>>({});
  const [lang, setLang] = useState<"en" | "ta">("en");
  const [busy, setBusy] = useState(false);
  // filters
  const [fStatus, setFStatus] = useState("");
  const [fUrgency, setFUrgency] = useState("");
  const [q, setQ] = useState("");

  const load = useCallback(async () => {
    try {
      const r = await fetch(api(""), { credentials: "include" });
      const d = await r.json();
      if (Array.isArray(d)) setUploads(d);
    } catch { /* keep */ }
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

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    return uploads.filter(u =>
      (!fStatus || u.status === fStatus) &&
      (!fUrgency || u.urgency === fUrgency) &&
      (!query || (u.name || "").toLowerCase().includes(query) || (u.mobile || "").includes(query) || (u.filename || "").toLowerCase().includes(query))
    );
  }, [uploads, fStatus, fUrgency, q]);

  const failedCount = uploads.filter(u => u.status === "FAILED").length;

  function openRow(u: Upload) {
    if (u.status === "QUEUED" || u.status === "PROCESSING") return;
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
              <ClipboardCheck className="h-6 w-6 text-violet-600" /> AI Review
            </h1>
            <p className="mt-0.5 text-sm text-muted-foreground">Click a row to review the petition, verify the details, and approve into a ticket.</p>
          </div>

          {/* Filters */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search name / phone / file"
                className="w-56 rounded-lg border border-input bg-card py-2 pl-8 pr-3 text-sm focus:border-violet-500 focus:outline-none" />
            </div>
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
            {(fStatus || fUrgency || q) && (
              <button onClick={() => { setFStatus(""); setFUrgency(""); setQ(""); }} className="text-xs font-medium text-muted-foreground hover:text-foreground">Clear</button>
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
              <table className="w-full min-w-[760px] text-left text-sm">
                <thead className="bg-muted/50 text-[11px] uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2.5">Name</th>
                    <th className="px-4 py-2.5">Phone</th>
                    <th className="px-4 py-2.5">Category</th>
                    <th className="px-4 py-2.5">Urgency</th>
                    <th className="px-4 py-2.5">Status</th>
                    <th className="px-4 py-2.5 text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 ? (
                    <tr><td colSpan={6} className="px-4 py-12 text-center text-muted-foreground">
                      {uploads.length === 0 ? "Nothing to review yet — upload petitions in AI Uploads." : "No rows match the filters."}
                    </td></tr>
                  ) : filtered.map(u => {
                    const m = STATUS_META[u.status]; const Icon = m.icon;
                    const clickable = u.status === "AWAITING_REVIEW" || u.status === "REVIEWED" || u.status === "FAILED";
                    return (
                      <tr key={u.id} onClick={() => openRow(u)}
                        className={cn("border-t border-border/70", clickable ? "cursor-pointer hover:bg-muted/40" : "opacity-80")}>
                        <td className="px-4 py-2.5 font-medium text-foreground">{u.name || <span className="text-muted-foreground">—</span>}</td>
                        <td className="px-4 py-2.5 text-muted-foreground">{u.mobile || "—"}</td>
                        <td className="px-4 py-2.5 text-muted-foreground">{u.category ? pretty(u.category) : "—"}</td>
                        <td className="px-4 py-2.5">{u.urgency ? <span className={cn("rounded px-1.5 py-0.5 text-[11px] font-semibold", URGENCY_CLS[u.urgency])}>{u.urgency}</span> : "—"}</td>
                        <td className="px-4 py-2.5">
                          <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold", m.cls)}>
                            <Icon className={cn("h-3 w-3", u.status === "PROCESSING" && "animate-spin")} /> {m.label}
                          </span>
                          {u.ticket_number && <span className="ml-1 font-mono text-[11px] text-emerald-600">{u.ticket_number}</span>}
                        </td>
                        <td className="px-4 py-2.5 text-right" onClick={e => e.stopPropagation()}>
                          {u.status === "AWAITING_REVIEW" && <Button size="sm" className="bg-violet-600 hover:bg-violet-700 text-white" onClick={() => openRow(u)}>Review</Button>}
                          {u.status === "REVIEWED" && <span className="inline-flex items-center gap-1 text-xs text-emerald-600"><TicketIcon className="h-3.5 w-3.5" /> Done</span>}
                          {u.status === "FAILED" && <Button size="sm" variant="outline" onClick={() => retry([u.id])}><RefreshCw className="mr-1 h-3.5 w-3.5" /> Retry</Button>}
                          {(u.status === "QUEUED" || u.status === "PROCESSING") && <span className="text-xs text-muted-foreground">…</span>}
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

      {/* Detail — document left, fields right */}
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
