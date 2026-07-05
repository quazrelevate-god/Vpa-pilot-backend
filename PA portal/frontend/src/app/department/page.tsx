"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Building2, LogOut, RefreshCw, Check, Forward, Send, Loader2, Paperclip,
  X, Clock, AlertTriangle, CheckCircle2, ChevronRight,
} from "lucide-react";

type Ticket = {
  id: number; ticket_number: string; status: string;
  department: string | null; department_label: string | null; progress_pct: number;
  citizen_name: string; citizen_mobile: string; token: string | null;
  citizen_ask: string | null; priority: string | null;
  created_at: string; accepted_at: string | null; resolved_at: string | null;
};
type Detail = Ticket & {
  description: string | null; summary: string | null; summary_ta: string | null;
  citizen_ask: string | null; key_details: string[]; resolution_notes: string | null;
  events: { type: string; actor: string; note: string | null; payload: any; at: string }[];
  attachments: { url: string; mime: string; name: string | null; kind: string; by: string | null; at: string }[];
};

const SEGMENTS = [
  { key: "awaiting_department", label: "To Accept", icon: Clock, cls: "text-amber-600" },
  { key: "in_progress", label: "In Progress", icon: RefreshCw, cls: "text-blue-600" },
  { key: "resolved", label: "Resolved", icon: CheckCircle2, cls: "text-emerald-600" },
  { key: "", label: "All", icon: Building2, cls: "text-slate-600" },
];
const STATUS_LABEL: Record<string, string> = {
  awaiting_department: "To Accept", in_progress: "In Progress", resolved: "Resolved",
  closed: "Closed", reopened: "Reopened", forwarded_to_dept: "Forwarded",
};
const PRIORITY_CLS: Record<string, string> = {
  critical: "bg-red-100 text-red-700", high: "bg-orange-100 text-orange-700",
  medium: "bg-amber-100 text-amber-700", low: "bg-slate-100 text-slate-600",
};
const EVENT_LABEL: Record<string, string> = {
  created: "Ticket created", ai_summarised: "AI summarised", routed_to_department: "Routed to department",
  department_accepted: "Accepted by department", department_forwarded: "Forwarded to another department",
  progress_update: "Progress update", resolved: "Resolved", closed: "Closed", reopened: "Reopened",
  forwarded_to_dept: "Forwarded out", status_changed: "Status changed", comment_added: "Comment",
};

const api = (p: string) => `/department/api${p}`;

export default function DepartmentDashboard() {
  const router = useRouter();
  const [label, setLabel] = useState("");
  const [seg, setSeg] = useState("awaiting_department");
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [depts, setDepts] = useState<{ key: string; label: string }[]>([]);
  const [open, setOpen] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [t, c] = await Promise.all([
        fetch(api(`/tickets${seg ? `?status=${seg}` : ""}`), { credentials: "include" }).then(r => r.json()),
        fetch(api("/counts"), { credentials: "include" }).then(r => r.json()),
      ]);
      setTickets(Array.isArray(t) ? t : []);
      setCounts(c || {});
    } catch { /* keep */ } finally { setLoading(false); }
  }, [seg]);

  useEffect(() => {
    fetch(api("/session"), { credentials: "include" })
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(d => setLabel(d.label))
      .catch(() => router.push("/department/login"));
    fetch(api("/departments"), { credentials: "include" }).then(r => r.json()).then(setDepts).catch(() => {});
  }, [router]);
  useEffect(() => { load(); }, [load]);

  async function openDetail(id: number) {
    const d = await fetch(api(`/tickets/${id}`), { credentials: "include" }).then(r => r.json());
    setOpen(d);
  }
  async function logout() {
    await fetch(api("/logout"), { method: "POST", credentials: "include" });
    router.push("/department/login");
  }
  function afterAction() { setOpen(null); load(); }

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-slate-200 bg-white px-6 py-3">
        <span className="grid h-9 w-9 place-items-center rounded-xl bg-indigo-100 text-indigo-600"><Building2 className="h-5 w-5" /></span>
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Department Workspace</div>
          <div className="text-sm font-bold text-slate-900">{label || "…"}</div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button onClick={load} className="rounded-lg p-2 hover:bg-slate-100" title="Refresh"><RefreshCw className="h-4 w-4 text-slate-500" /></button>
          <button onClick={logout} className="flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100"><LogOut className="h-4 w-4" /> Sign out</button>
        </div>
      </header>

      <main className="mx-auto max-w-4xl p-6">
        <div className="mb-4 flex flex-wrap gap-1.5 rounded-xl border border-slate-200 bg-white p-1.5">
          {SEGMENTS.map(s => {
            const active = seg === s.key; const n = s.key ? counts[s.key] : Object.values(counts).reduce((a, b) => a + b, 0);
            return (
              <button key={s.key || "all"} onClick={() => setSeg(s.key)}
                className={`flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors ${active ? "bg-indigo-600 text-white" : "text-slate-600 hover:bg-slate-100"}`}>
                {s.label}
                <span className={`min-w-[20px] rounded-full px-1.5 py-0.5 text-[11px] font-bold ${active ? "bg-white/20" : "bg-slate-100 text-slate-500"}`}>{n ?? 0}</span>
              </button>
            );
          })}
        </div>

        <div className="space-y-2">
          {loading ? (
            <div className="py-16 text-center text-sm text-slate-400"><Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" /> Loading…</div>
          ) : tickets.length === 0 ? (
            <div className="py-16 text-center text-sm text-slate-400">No tickets in this view.</div>
          ) : tickets.map(t => (
            <button key={t.id} onClick={() => openDetail(t.id)}
              className="flex w-full items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 text-left transition-colors hover:border-indigo-300 hover:bg-indigo-50/30">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs font-semibold text-indigo-600">{t.ticket_number}</span>
                  {t.priority && <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${PRIORITY_CLS[t.priority] || ""}`}>{t.priority}</span>}
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">{STATUS_LABEL[t.status] || t.status}</span>
                </div>
                <div className="mt-1 truncate text-sm font-medium text-slate-900">{t.citizen_ask || "Petition"}</div>
                <div className="mt-0.5 text-xs text-slate-500">{t.citizen_name} · {t.citizen_mobile}</div>
              </div>
              {t.status === "in_progress" && <div className="text-xs font-semibold text-blue-600">{t.progress_pct}%</div>}
              <ChevronRight className="h-4 w-4 text-slate-300" />
            </button>
          ))}
        </div>
      </main>

      {open && <DetailDrawer detail={open} depts={depts} onClose={() => setOpen(null)} onDone={afterAction} />}
    </div>
  );
}

function DetailDrawer({ detail, depts, onClose, onDone }: {
  detail: Detail; depts: { key: string; label: string }[]; onClose: () => void; onDone: () => void;
}) {
  const [mode, setMode] = useState<"" | "forward" | "progress" | "resolve">("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [reason, setReason] = useState("");
  const [toDept, setToDept] = useState("");
  const [note, setNote] = useState("");
  const [pct, setPct] = useState(detail.progress_pct || 0);
  const [remarks, setRemarks] = useState("");
  const [files, setFiles] = useState<FileList | null>(null);

  const s = detail.status;
  async function post(path: string, body?: FormData) {
    setBusy(true); setErr("");
    try {
      const r = await fetch(api(`/tickets/${detail.id}${path}`), { method: "POST", credentials: "include", body });
      if (r.ok) { onDone(); return; }
      const d = await r.json().catch(() => ({})); setErr(d.error || d.detail || "Action failed.");
    } catch { setErr("Network error."); } finally { setBusy(false); }
  }
  const accept = () => post("/accept");
  const forward = () => { const f = new FormData(); f.set("to_department", toDept); f.set("reason", reason); post("/forward", f); };
  const progress = () => { const f = new FormData(); f.set("note", note); f.set("progress_pct", String(pct)); post("/progress", f); };
  const resolve = () => {
    if (!remarks.trim()) { setErr("Resolution remarks are required."); return; }
    if (!files || files.length === 0) { setErr("At least one proof attachment is required."); return; }
    const f = new FormData(); f.set("remarks", remarks); Array.from(files).forEach(x => f.append("files", x)); post("/resolve", f);
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/40" onClick={onClose}>
      <div className="flex h-full w-full max-w-xl flex-col bg-white shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-start gap-3 border-b border-slate-200 p-5">
          <div className="min-w-0 flex-1">
            <div className="font-mono text-xs font-semibold text-indigo-600">{detail.ticket_number}</div>
            <div className="mt-0.5 text-base font-bold text-slate-900">{detail.citizen_ask || "Petition"}</div>
            <div className="mt-1 text-xs text-slate-500">{detail.citizen_name} · {detail.citizen_mobile} · {detail.token}</div>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 hover:bg-slate-100"><X className="h-4 w-4" /></button>
        </div>

        <div className="flex-1 space-y-4 overflow-auto p-5">
          {detail.summary && <Panel title="Summary"><p className="text-sm leading-relaxed text-slate-700">{detail.summary}</p></Panel>}
          {detail.citizen_ask && <Panel title="What they're asking"><p className="text-sm font-medium text-slate-800">{detail.citizen_ask}</p></Panel>}
          {detail.key_details?.length > 0 && (
            <Panel title="Key details"><ul className="space-y-1 text-sm text-slate-700">{detail.key_details.map((d, i) => <li key={i} className="flex gap-2"><span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-indigo-400" />{d}</li>)}</ul></Panel>
          )}

          <Panel title="Activity">
            <ol className="space-y-2.5">
              {detail.events.map((e, i) => (
                <li key={i} className="flex gap-2.5 text-sm">
                  <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-indigo-500" />
                  <div>
                    <span className="font-medium text-slate-800">{EVENT_LABEL[e.type] || e.type}</span>
                    <span className="text-slate-400"> · {e.actor} · {new Date(e.at).toLocaleString()}</span>
                    {e.note && <div className="text-slate-600">{e.note}</div>}
                    {e.payload?.to && <div className="text-xs text-slate-500">→ {e.payload.to}</div>}
                  </div>
                </li>
              ))}
            </ol>
          </Panel>

          {detail.attachments?.length > 0 && (
            <Panel title="Attachments">
              <div className="flex flex-wrap gap-2">
                {detail.attachments.map((a, i) => <a key={i} href={a.url} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-slate-600 hover:bg-slate-50"><Paperclip className="h-3.5 w-3.5" />{a.name || a.kind}</a>)}
              </div>
            </Panel>
          )}
        </div>

        {/* Action bar — depends on status */}
        <div className="border-t border-slate-200 p-4">
          {err && <div className="mb-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{err}</div>}

          {s === "awaiting_department" && !mode && (
            <div className="flex gap-2">
              <button onClick={accept} disabled={busy} className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-emerald-600 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Accept</button>
              <button onClick={() => setMode("forward")} className="flex items-center justify-center gap-1.5 rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-100"><Forward className="h-4 w-4" /> Forward</button>
            </div>
          )}
          {s === "in_progress" && !mode && (
            <div className="flex gap-2">
              <button onClick={() => setMode("progress")} className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-blue-300 py-2.5 text-sm font-semibold text-blue-700 hover:bg-blue-50"><Send className="h-4 w-4" /> Update progress</button>
              <button onClick={() => setMode("forward")} className="flex items-center justify-center gap-1.5 rounded-lg border border-slate-300 px-3 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-100"><Forward className="h-4 w-4" /> Forward</button>
              <button onClick={() => setMode("resolve")} className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-emerald-600 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700"><CheckCircle2 className="h-4 w-4" /> Resolve</button>
            </div>
          )}
          {["resolved", "closed", "forwarded_to_dept"].includes(s) && !mode && (
            <div className="text-center text-sm text-slate-500">This ticket is <b>{STATUS_LABEL[s] || s}</b>. No action needed from your department.</div>
          )}

          {mode === "forward" && (
            <div className="space-y-2">
              <select value={toDept} onChange={e => setToDept(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
                <option value="">Forward to which department?</option>
                {depts.filter(d => d.key !== detail.department).map(d => <option key={d.key} value={d.key}>{d.label}</option>)}
              </select>
              <textarea value={reason} onChange={e => setReason(e.target.value)} rows={2} placeholder="Reason for forwarding (required)" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
              <div className="flex gap-2">
                <button onClick={() => setMode("")} className="rounded-lg border border-slate-300 px-4 py-2 text-sm">Cancel</button>
                <button onClick={forward} disabled={busy || !toDept || !reason.trim()} className="flex-1 rounded-lg bg-slate-800 py-2 text-sm font-semibold text-white disabled:opacity-50">Forward with reason</button>
              </div>
            </div>
          )}
          {mode === "progress" && (
            <div className="space-y-2">
              <textarea value={note} onChange={e => setNote(e.target.value)} rows={2} placeholder="Progress note" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
              <label className="flex items-center gap-2 text-sm text-slate-600">Progress <input type="range" min={0} max={99} value={pct} onChange={e => setPct(Number(e.target.value))} className="flex-1" /> <b>{pct}%</b></label>
              <div className="flex gap-2">
                <button onClick={() => setMode("")} className="rounded-lg border border-slate-300 px-4 py-2 text-sm">Cancel</button>
                <button onClick={progress} disabled={busy || !note.trim()} className="flex-1 rounded-lg bg-blue-600 py-2 text-sm font-semibold text-white disabled:opacity-50">Post update</button>
              </div>
            </div>
          )}
          {mode === "resolve" && (
            <div className="space-y-2">
              <textarea value={remarks} onChange={e => setRemarks(e.target.value)} rows={2} placeholder="Resolution remarks (required)" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
              <label className="flex items-center gap-2 rounded-lg border border-dashed border-slate-300 px-3 py-2 text-sm text-slate-600">
                <Paperclip className="h-4 w-4" /> {files && files.length ? `${files.length} file(s) selected` : "Attach proof (required)"}
                <input type="file" multiple accept="image/*,application/pdf" onChange={e => setFiles(e.target.files)} className="hidden" />
              </label>
              <div className="flex gap-2">
                <button onClick={() => setMode("")} className="rounded-lg border border-slate-300 px-4 py-2 text-sm">Cancel</button>
                <button onClick={resolve} disabled={busy} className="flex-1 rounded-lg bg-emerald-600 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? <Loader2 className="mx-auto h-4 w-4 animate-spin" /> : "Mark resolved"}</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-400">{title}</div>
      {children}
    </div>
  );
}
