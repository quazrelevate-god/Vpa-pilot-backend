"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  Sparkles, UploadCloud, RefreshCw, Check, Pencil, X, FileText, Image as ImageIcon,
  AlertTriangle, Clock, Loader2, Ticket as TicketIcon,
} from "lucide-react";
import { toast } from "sonner";

import TopBar from "@/components/TopBar";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// ── Types ──────────────────────────────────────────────────────────────────────
interface Upload {
  id: number; filename: string; mime_type: string; file_url: string | null;
  status: "QUEUED" | "PROCESSING" | "AWAITING_REVIEW" | "REVIEWED" | "FAILED";
  name: string | null; name_ta: string | null; mobile: string | null;
  category: string | null; urgency: string | null; department: string | null;
  headline: string | null; summary: string | null; summary_ta: string | null;
  citizen_ask: string | null; error: string | null;
  ticket_number: string | null; appointment_id: number | null; created_at: string | null;
}

const CATEGORIES = [
  "action_required", "proposals", "transfer_requests", "pension_requests",
  "school_admission", "job_requests", "rti", "associations_unions",
  "school_upgradation", "invitation", "greetings", "general", "other",
];
const URGENCIES = ["low", "medium", "high", "critical"];

const STATUS_META: Record<string, { label: string; cls: string; icon: typeof Clock }> = {
  QUEUED:          { label: "Queued",         cls: "bg-slate-100 text-slate-600",  icon: Clock },
  PROCESSING:      { label: "Processing",     cls: "bg-blue-100 text-blue-700",    icon: Loader2 },
  AWAITING_REVIEW: { label: "Awaiting Review", cls: "bg-amber-100 text-amber-700", icon: AlertTriangle },
  REVIEWED:        { label: "Reviewed",       cls: "bg-emerald-100 text-emerald-700", icon: Check },
  FAILED:          { label: "Failed",         cls: "bg-red-100 text-red-700",      icon: X },
};
const URGENCY_CLS: Record<string, string> = {
  critical: "bg-red-100 text-red-700", high: "bg-orange-100 text-orange-700",
  medium: "bg-amber-100 text-amber-700", low: "bg-slate-100 text-slate-600",
};

const api = (path: string) => `/api/ai-uploads${path}`;

export default function AiUploadsPage() {
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [review, setReview] = useState<Upload | null>(null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Partial<Upload>>({});
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const fileRef = useRef<HTMLInputElement | null>(null);

  // ── Load + poll ───────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    try {
      const r = await fetch(api(""), { credentials: "include" });
      const d = await r.json();
      if (Array.isArray(d)) setUploads(d);
    } catch { /* keep last */ }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const anyActive = uploads.some(u => u.status === "QUEUED" || u.status === "PROCESSING");
    if (!anyActive) return;
    const id = setInterval(load, 4000);
    return () => clearInterval(id);
  }, [uploads, load]);

  // keep the open review panel in sync with refreshed data
  useEffect(() => {
    if (!review) return;
    const fresh = uploads.find(u => u.id === review.id);
    if (fresh && !editing) setReview(fresh);
  }, [uploads]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Upload ────────────────────────────────────────────────────────────────────
  async function handleFiles(files: FileList | File[]) {
    const arr = Array.from(files);
    if (!arr.length) return;
    setUploading(true);
    try {
      const fd = new FormData();
      arr.forEach(f => fd.append("files", f));
      const r = await fetch(api("/upload"), { method: "POST", body: fd, credentials: "include" });
      const d = await r.json();
      if (r.ok) {
        toast.success(`${d.count} file(s) queued`);
        // Optimistic: show the rows instantly as Queued so the team sees the job
        // started; polling then flips each to Processing → Awaiting Review.
        const optimistic = (d.items || []).map((it: { id: number; filename: string }) => ({
          id: it.id, filename: it.filename, status: "QUEUED",
        })) as Upload[];
        setUploads(prev => [
          ...optimistic,
          ...prev.filter(p => !optimistic.some(o => o.id === p.id)),
        ]);
        load();
      } else toast.error(d.detail || d.error || "Upload failed");
    } catch { toast.error("Network error"); }
    finally { setUploading(false); if (fileRef.current) fileRef.current.value = ""; }
  }

  // ── Actions ───────────────────────────────────────────────────────────────────
  function openReview(u: Upload) {
    setReview(u); setEditing(false);
    setForm({ name: u.name, name_ta: u.name_ta, mobile: u.mobile, category: u.category, urgency: u.urgency, summary: u.summary });
  }

  async function saveEdits() {
    if (!review) return;
    setBusy(true);
    try {
      const r = await fetch(api(`/${review.id}`), {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        credentials: "include", body: JSON.stringify(form),
      });
      const d = await r.json();
      if (r.ok) { toast.success("Saved"); setEditing(false); setReview(d); load(); }
      else toast.error(d.error || "Save failed");
    } catch { toast.error("Network error"); }
    finally { setBusy(false); }
  }

  async function approve() {
    if (!review) return;
    setBusy(true);
    try {
      const r = await fetch(api(`/${review.id}/approve`), { method: "POST", credentials: "include" });
      const d = await r.json();
      if (r.ok) { toast.success(`Ticket ${d.ticket_number} created`); setReview(null); load(); }
      else toast.error(d.error || "Approve failed");
    } catch { toast.error("Network error"); }
    finally { setBusy(false); }
  }

  async function retry(ids: number[]) {
    if (!ids.length) return;
    try {
      const r = await fetch(api("/retry"), {
        method: "POST", headers: { "Content-Type": "application/json" },
        credentials: "include", body: JSON.stringify({ ids }),
      });
      if (r.ok) { toast.success(`${ids.length} re-queued`); setSelected(new Set()); load(); }
      else toast.error("Retry failed");
    } catch { toast.error("Network error"); }
  }

  const failedSelected = [...selected].filter(id => uploads.find(u => u.id === id)?.status === "FAILED");
  const counts = uploads.reduce((a, u) => { a[u.status] = (a[u.status] || 0) + 1; return a; }, {} as Record<string, number>);

  return (
    <>
      <TopBar />
      <main className="flex-1 overflow-y-auto bg-background">
        <div className="mx-auto max-w-[1200px] space-y-6 p-6 animate-in-up">
          {/* Header */}
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-extrabold tracking-tight">
              <Sparkles className="h-6 w-6 text-violet-600" /> AI Uploads
            </h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Bulk-upload scanned petitions — Gemini extracts the petitioner & grievance, you review and approve into a ticket.
            </p>
          </div>

          {/* Dropzone */}
          <Card
            onDragOver={e => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={e => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files); }}
            className={cn(
              "flex flex-col items-center justify-center gap-2 border-2 border-dashed p-8 text-center transition-colors cursor-pointer",
              dragOver ? "border-violet-500 bg-violet-50" : "border-border hover:border-violet-300"
            )}
            onClick={() => fileRef.current?.click()}
          >
            <input ref={fileRef} type="file" multiple accept=".pdf,image/*" className="hidden"
              onChange={e => e.target.files && handleFiles(e.target.files)} />
            {uploading
              ? <Loader2 className="h-8 w-8 animate-spin text-violet-600" />
              : <UploadCloud className="h-8 w-8 text-violet-500" />}
            <div className="text-sm font-semibold">{uploading ? "Uploading…" : "Drop petition PDFs / images here, or click to select"}</div>
            <div className="text-xs text-muted-foreground">Many files at once · processed one by one · PDF, JPG, PNG, HEIC</div>
          </Card>

          {/* Toolbar */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex flex-wrap gap-2 text-xs">
              {Object.entries(STATUS_META).map(([k, m]) => (
                <span key={k} className={cn("rounded-full px-2.5 py-1 font-semibold", m.cls)}>
                  {m.label}: {counts[k] || 0}
                </span>
              ))}
            </div>
            <div className="ml-auto flex items-center gap-2">
              {failedSelected.length > 0 && (
                <Button size="sm" variant="outline" className="border-red-300 text-red-700"
                  onClick={() => retry(failedSelected)}>
                  <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Retry selected ({failedSelected.length})
                </Button>
              )}
              <button onClick={load} className="rounded-lg p-2 hover:bg-muted" title="Refresh">
                <RefreshCw className="h-4 w-4 text-muted-foreground" />
              </button>
            </div>
          </div>

          {/* Table */}
          <Card className="overflow-hidden p-0">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] text-left text-sm">
                <thead className="bg-muted/50 text-[11px] uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="w-10 px-3 py-2.5"></th>
                    <th className="px-4 py-2.5">File</th>
                    <th className="px-4 py-2.5">Status</th>
                    <th className="px-4 py-2.5">Name</th>
                    <th className="px-4 py-2.5">Phone</th>
                    <th className="px-4 py-2.5">Category</th>
                    <th className="px-4 py-2.5">Urgency</th>
                    <th className="px-4 py-2.5 text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {uploads.length === 0 ? (
                    <tr><td colSpan={8} className="px-4 py-12 text-center text-muted-foreground">No uploads yet — drop some petitions above.</td></tr>
                  ) : uploads.map(u => {
                    const m = STATUS_META[u.status];
                    const Icon = m.icon;
                    return (
                      <tr key={u.id} className="border-t border-border/70 hover:bg-muted/30">
                        <td className="px-3 py-2.5">
                          {u.status === "FAILED" && (
                            <input type="checkbox" checked={selected.has(u.id)}
                              onChange={e => { const s = new Set(selected); e.target.checked ? s.add(u.id) : s.delete(u.id); setSelected(s); }} />
                          )}
                        </td>
                        <td className="px-4 py-2.5">
                          <span className="flex items-center gap-1.5 font-medium text-foreground">
                            {u.mime_type === "application/pdf" ? <FileText className="h-3.5 w-3.5 text-muted-foreground" /> : <ImageIcon className="h-3.5 w-3.5 text-muted-foreground" />}
                            <span className="max-w-[180px] truncate" title={u.filename}>{u.filename}</span>
                          </span>
                        </td>
                        <td className="px-4 py-2.5">
                          <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold", m.cls)}>
                            <Icon className={cn("h-3 w-3", u.status === "PROCESSING" && "animate-spin")} /> {m.label}
                          </span>
                          {u.ticket_number && <span className="ml-1 text-[11px] font-mono text-emerald-600">{u.ticket_number}</span>}
                        </td>
                        <td className="px-4 py-2.5 font-medium">{u.name || "—"}</td>
                        <td className="px-4 py-2.5 text-muted-foreground">{u.mobile || "—"}</td>
                        <td className="px-4 py-2.5 text-muted-foreground">{u.category?.replace(/_/g, " ") || "—"}</td>
                        <td className="px-4 py-2.5">
                          {u.urgency ? <span className={cn("rounded px-1.5 py-0.5 text-[11px] font-semibold", URGENCY_CLS[u.urgency])}>{u.urgency}</span> : "—"}
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          {u.status === "AWAITING_REVIEW" && (
                            <Button size="sm" className="bg-violet-600 hover:bg-violet-700 text-white" onClick={() => openReview(u)}>Review</Button>
                          )}
                          {u.status === "REVIEWED" && (
                            <span className="inline-flex items-center gap-1 text-xs text-emerald-600"><TicketIcon className="h-3.5 w-3.5" /> Done</span>
                          )}
                          {u.status === "FAILED" && (
                            <Button size="sm" variant="outline" onClick={() => retry([u.id])}>
                              <RefreshCw className="mr-1 h-3.5 w-3.5" /> Retry
                            </Button>
                          )}
                          {(u.status === "QUEUED" || u.status === "PROCESSING") && (
                            <span className="text-xs text-muted-foreground">…</span>
                          )}
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

      {/* Split review panel */}
      {review && (
        <div className="fixed inset-0 z-50 flex bg-slate-900/50" onClick={() => !busy && setReview(null)}>
          <div className="m-auto flex h-[88vh] w-[94vw] max-w-[1100px] overflow-hidden rounded-2xl bg-white shadow-2xl"
            onClick={e => e.stopPropagation()}>
            {/* Left — document */}
            <div className="hidden w-1/2 flex-col border-r border-border bg-slate-50 md:flex">
              <div className="flex items-center justify-between border-b border-border px-4 py-2.5 text-sm font-semibold">
                <span className="flex items-center gap-1.5"><FileText className="h-4 w-4" /> {review.filename}</span>
              </div>
              <div className="flex-1 overflow-auto p-2">
                {review.file_url ? (
                  review.mime_type === "application/pdf"
                    ? <iframe src={review.file_url} className="h-full w-full rounded-lg border border-border" title="document" />
                    : <img src={review.file_url} alt="petition" className="mx-auto max-w-full rounded-lg" />
                ) : <div className="grid h-full place-items-center text-muted-foreground">No preview</div>}
              </div>
            </div>

            {/* Right — fields */}
            <div className="flex w-full flex-col md:w-1/2">
              <div className="flex items-center justify-between border-b border-border px-5 py-3">
                <div className="text-base font-bold">Extracted details</div>
                <div className="flex items-center gap-2">
                  {!editing
                    ? <Button size="sm" variant="outline" onClick={() => setEditing(true)}><Pencil className="mr-1.5 h-3.5 w-3.5" /> Edit</Button>
                    : <Button size="sm" variant="outline" onClick={saveEdits} disabled={busy}><Check className="mr-1.5 h-3.5 w-3.5" /> Save</Button>}
                  <button onClick={() => !busy && setReview(null)} className="rounded-md p-1.5 hover:bg-muted"><X className="h-4 w-4" /></button>
                </div>
              </div>

              <div className="flex-1 space-y-4 overflow-auto p-5">
                <Field label="Name" value={form.name} editing={editing} onChange={v => setForm(f => ({ ...f, name: v }))} fallback={review.name} />
                <Field label="Name (Tamil)" value={form.name_ta} editing={editing} onChange={v => setForm(f => ({ ...f, name_ta: v }))} fallback={review.name_ta} />
                <Field label="Phone" value={form.mobile} editing={editing} onChange={v => setForm(f => ({ ...f, mobile: v }))} fallback={review.mobile} />
                <div className="grid grid-cols-2 gap-3">
                  <SelectField label="Category" value={form.category} editing={editing} options={CATEGORIES} onChange={v => setForm(f => ({ ...f, category: v }))} fallback={review.category} />
                  <SelectField label="Urgency" value={form.urgency} editing={editing} options={URGENCIES} onChange={v => setForm(f => ({ ...f, urgency: v }))} fallback={review.urgency} />
                </div>
                {review.department && <div className="text-xs text-muted-foreground">Dept: {review.department.replace(/_/g, " ")}</div>}
                <div>
                  <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Summary</div>
                  {editing
                    ? <textarea className="w-full rounded-lg border border-input px-3 py-2 text-sm" rows={4} value={form.summary ?? ""} onChange={e => setForm(f => ({ ...f, summary: e.target.value }))} />
                    : <p className="text-sm leading-relaxed text-foreground">{review.summary || "—"}</p>}
                </div>
                {review.summary_ta && !editing && (
                  <div>
                    <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">சுருக்கம்</div>
                    <p className="text-sm leading-relaxed text-foreground">{review.summary_ta}</p>
                  </div>
                )}
              </div>

              <div className="border-t border-border p-4">
                <Button className="w-full bg-emerald-600 hover:bg-emerald-700 text-white" onClick={approve} disabled={busy || editing}>
                  {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
                  Approve → create ticket
                </Button>
                {editing && <p className="mt-1.5 text-center text-[11px] text-muted-foreground">Save your edits before approving.</p>}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ── Small field components ──────────────────────────────────────────────────────
function Field({ label, value, fallback, editing, onChange }:
  { label: string; value: string | null | undefined; fallback: string | null; editing: boolean; onChange: (v: string) => void }) {
  return (
    <div>
      <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</div>
      {editing
        ? <input className="w-full rounded-lg border border-input px-3 py-2 text-sm" value={value ?? ""} onChange={e => onChange(e.target.value)} />
        : <div className="text-sm font-medium text-foreground">{fallback || "—"}</div>}
    </div>
  );
}

function SelectField({ label, value, fallback, editing, options, onChange }:
  { label: string; value: string | null | undefined; fallback: string | null; editing: boolean; options: string[]; onChange: (v: string) => void }) {
  return (
    <div>
      <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</div>
      {editing
        ? <select className="w-full rounded-lg border border-input bg-white px-2 py-2 text-sm" value={value ?? ""} onChange={e => onChange(e.target.value)}>
            {options.map(o => <option key={o} value={o}>{o.replace(/_/g, " ")}</option>)}
          </select>
        : <div className="text-sm font-medium text-foreground">{(fallback || "—").replace(/_/g, " ")}</div>}
    </div>
  );
}
