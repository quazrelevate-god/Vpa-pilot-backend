"use client";

import { useEffect, useState } from "react";
import { X, ArrowRight, MessageSquare, CheckCircle2, XCircle, RotateCcw, Send } from "lucide-react";
import type { TicketDetail } from "@/lib/types";
import {
  fetchTicket, patchTicket, ticketAction,
} from "@/lib/api";
import {
  TICKET_STATUS_DISPLAY, TICKET_STATUS_COLOR, PRIORITY_COLOR,
  DEPT_DISPLAY, CLOSURE_REASON_DISPLAY,
  ticketStatusOptions, priorityOptions, deptOptions, closureReasonOptions,
} from "@/lib/enums";

type Action = "comment" | "forward" | "resolve" | "close" | "reopen";

export default function TicketDetailDrawer({
  ticketId, onClose, onMutated,
}: {
  ticketId: number | null;
  onClose: () => void;
  onMutated?: () => void;
}) {
  const [data, setData] = useState<TicketDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeAction, setActiveAction] = useState<Action | null>(null);
  const [busy, setBusy] = useState(false);

  // Form fields for actions
  const [commentText, setCommentText] = useState("");
  const [forwardDept, setForwardDept] = useState("");
  const [forwardNotes, setForwardNotes] = useState("");
  const [resolutionNotes, setResolutionNotes] = useState("");
  const [closureReason, setClosureReason] = useState("");
  const [closeNotes, setCloseNotes] = useState("");
  const [reopenReason, setReopenReason] = useState("");

  useEffect(() => {
    if (ticketId == null) { setData(null); return; }
    setLoading(true);
    fetchTicket(ticketId)
      .then(setData)
      .catch(e => alert(`Failed to load ticket: ${e.message}`))
      .finally(() => setLoading(false));
  }, [ticketId]);

  if (ticketId == null) return null;

  async function refresh() {
    if (ticketId == null) return;
    const fresh = await fetchTicket(ticketId);
    setData(fresh);
    onMutated?.();
  }

  async function patch(patch: Parameters<typeof patchTicket>[1]) {
    if (ticketId == null) return;
    setBusy(true);
    try { setData(await patchTicket(ticketId, patch)); onMutated?.(); }
    catch (e) { alert((e as Error).message); }
    finally { setBusy(false); }
  }

  async function runAction(action: Action, body: Record<string, unknown>) {
    if (ticketId == null) return;
    setBusy(true);
    try {
      setData(await ticketAction(ticketId, action, body));
      onMutated?.();
      setActiveAction(null);
      // Reset forms
      setCommentText(""); setForwardDept(""); setForwardNotes("");
      setResolutionNotes(""); setClosureReason(""); setCloseNotes(""); setReopenReason("");
    } catch (e) { alert((e as Error).message); }
    finally { setBusy(false); }
  }

  const t = data;
  const isClosed = t?.status === "closed";
  const isResolved = t?.status === "resolved";

  return (
    <div className="fixed inset-0 z-50 flex justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40" />
      <aside
        className="relative w-full max-w-3xl bg-slate-50 h-full overflow-y-auto shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 z-10 bg-white border-b border-slate-200 px-6 py-4 flex items-center gap-3">
          <div className="flex-1">
            <div className="font-mono text-xs text-slate-500">{t?.ticket_number ?? "…"}</div>
            <div className="font-semibold text-slate-900 truncate">{t?.headline ?? "Loading…"}</div>
          </div>
          {t && (
            <>
              {t.priority && (
                <span className={`text-[11px] font-bold px-2 py-1 rounded ${PRIORITY_COLOR[t.priority] ?? ""}`}>
                  {t.priority}
                </span>
              )}
              <span className={`text-[11px] font-semibold px-2 py-1 rounded border ${TICKET_STATUS_COLOR[t.status] ?? ""}`}>
                {TICKET_STATUS_DISPLAY[t.status] ?? t.status}
              </span>
            </>
          )}
          <button onClick={onClose} className="p-1 hover:bg-slate-100 rounded">
            <X className="w-5 h-5 text-slate-500" />
          </button>
        </div>

        {loading && <div className="p-8 text-center text-slate-500">Loading…</div>}

        {t && (
          <div className="p-6 space-y-5">
            {/* Citizen + token */}
            <div className="grid grid-cols-2 gap-3 bg-white p-4 rounded border border-slate-200 text-sm">
              <div><span className="text-slate-400 text-[10px] uppercase tracking-wider block">Citizen</span>{t.citizen_name ?? "—"}</div>
              <div><span className="text-slate-400 text-[10px] uppercase tracking-wider block">Mobile</span>{t.citizen_mobile ?? "—"}</div>
              <div><span className="text-slate-400 text-[10px] uppercase tracking-wider block">Token</span>{t.token ?? "—"}</div>
              <div><span className="text-slate-400 text-[10px] uppercase tracking-wider block">Created</span>{new Date(t.created_at).toLocaleString()}</div>
            </div>

            {/* AI summary */}
            {(t.summary || t.description) && (
              <div className="bg-white p-4 rounded border border-slate-200">
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">AI Summary</div>
                {t.summary
                  ? <p className="text-sm text-slate-700 leading-relaxed">{t.summary}</p>
                  : <p className="text-sm text-slate-400 italic">Pending…</p>}
                {t.citizen_ask && (
                  <div className="mt-3">
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Citizen Ask</div>
                    <p className="text-sm text-slate-700">{t.citizen_ask}</p>
                  </div>
                )}
                {t.key_details && t.key_details.length > 0 && (
                  <ul className="list-disc pl-4 mt-3 space-y-0.5">
                    {t.key_details.map((d, i) => <li key={i} className="text-sm text-slate-600">{d}</li>)}
                  </ul>
                )}
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {t.urgency && (
                    <span className="text-[11px] font-semibold px-2 py-0.5 rounded bg-orange-50 border border-orange-200 text-orange-700">
                      Urgency: {t.urgency.toUpperCase()}
                    </span>
                  )}
                  {t.department_label && (
                    <span className="text-[11px] font-semibold px-2 py-0.5 rounded bg-indigo-50 border border-indigo-200 text-indigo-700">
                      🏛️ {t.department_label}
                    </span>
                  )}
                  {t.category_label && (
                    <span className="text-[11px] font-semibold px-2 py-0.5 rounded bg-slate-100 border border-slate-200 text-slate-700">
                      {t.category_label}
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* Editable ticket meta — inline patch */}
            <div className="bg-white p-4 rounded border border-slate-200">
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-3">Ticket Settings</div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Status">
                  <select value={t.status} disabled={busy}
                    onChange={e => patch({ status: e.target.value })}
                    className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm">
                    {ticketStatusOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </Field>
                <Field label="Priority">
                  <select value={t.priority ?? ""} disabled={busy}
                    onChange={e => patch({ priority: e.target.value })}
                    className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm">
                    <option value="">— None —</option>
                    {priorityOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </Field>
                <Field label="Assigned to (PA username)">
                  <input type="text" defaultValue={t.assigned_to_pa ?? ""} disabled={busy}
                    placeholder="e.g. admin"
                    onBlur={e => {
                      const v = e.target.value.trim();
                      if (v !== (t.assigned_to_pa ?? "")) patch({ assigned_to_pa: v });
                    }}
                    className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm" />
                </Field>
                <Field label="Due date (manual SLA)">
                  <input type="datetime-local"
                    defaultValue={t.due_date ? t.due_date.slice(0, 16) : ""}
                    disabled={busy}
                    onBlur={e => {
                      const v = e.target.value;
                      patch({ due_date: v ? new Date(v).toISOString() : null });
                    }}
                    className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm" />
                </Field>
              </div>
            </div>

            {/* Forwarding info if applicable */}
            {t.forwarded_to_dept && (
              <div className="bg-cyan-50 border border-cyan-200 p-4 rounded">
                <div className="text-[10px] font-bold text-cyan-700 uppercase tracking-wider mb-1">
                  Forwarded to Department
                </div>
                <div className="text-sm font-semibold text-cyan-900">{DEPT_DISPLAY[t.forwarded_to_dept] ?? t.forwarded_to_dept}</div>
                {t.forwarded_notes && <p className="text-sm text-cyan-800 mt-1 whitespace-pre-wrap">{t.forwarded_notes}</p>}
                <div className="text-[11px] text-cyan-600 mt-1">
                  by {t.forwarded_by ?? "—"} on {t.forwarded_at ? new Date(t.forwarded_at).toLocaleString() : "—"}
                </div>
              </div>
            )}

            {/* Resolution info if applicable */}
            {t.resolution_notes && (
              <div className="bg-green-50 border border-green-200 p-4 rounded">
                <div className="text-[10px] font-bold text-green-700 uppercase tracking-wider mb-1">
                  Resolution Notes
                </div>
                <p className="text-sm text-green-900 whitespace-pre-wrap">{t.resolution_notes}</p>
                {t.closure_reason && (
                  <div className="text-[11px] text-green-700 mt-1">
                    Closure: {CLOSURE_REASON_DISPLAY[t.closure_reason] ?? t.closure_reason}
                  </div>
                )}
              </div>
            )}

            {/* Action bar */}
            <div className="bg-white p-4 rounded border border-slate-200">
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-3">Actions</div>
              <div className="flex flex-wrap gap-2">
                <ActionBtn icon={MessageSquare} label="Add comment"  active={activeAction === "comment"} onClick={() => setActiveAction("comment")} />
                <ActionBtn icon={ArrowRight}    label="Forward"      active={activeAction === "forward"} onClick={() => setActiveAction("forward")} disabled={isClosed} />
                <ActionBtn icon={CheckCircle2}  label="Resolve"      active={activeAction === "resolve"} onClick={() => setActiveAction("resolve")} disabled={isClosed} />
                <ActionBtn icon={XCircle}       label="Close"        active={activeAction === "close"}   onClick={() => setActiveAction("close")} disabled={isClosed} />
                {(isClosed || isResolved) && (
                  <ActionBtn icon={RotateCcw}   label="Reopen"       active={activeAction === "reopen"}  onClick={() => setActiveAction("reopen")} />
                )}
              </div>

              {/* Action forms */}
              {activeAction === "comment" && (
                <div className="mt-3 space-y-2">
                  <textarea value={commentText} onChange={e => setCommentText(e.target.value)}
                    placeholder="Add a note…" rows={3}
                    className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm" />
                  <SubmitBtn busy={busy} onClick={() => runAction("comment", { text: commentText })} disabled={!commentText.trim()} />
                </div>
              )}
              {activeAction === "forward" && (
                <div className="mt-3 space-y-2">
                  <select value={forwardDept} onChange={e => setForwardDept(e.target.value)}
                    className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm">
                    <option value="">— Pick department —</option>
                    {deptOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                  <textarea value={forwardNotes} onChange={e => setForwardNotes(e.target.value)}
                    placeholder="Forwarding notes (contact person, ref no.)…" rows={3}
                    className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm" />
                  <SubmitBtn busy={busy} onClick={() => runAction("forward", { department: forwardDept, notes: forwardNotes })} disabled={!forwardDept} />
                </div>
              )}
              {activeAction === "resolve" && (
                <div className="mt-3 space-y-2">
                  <textarea value={resolutionNotes} onChange={e => setResolutionNotes(e.target.value)}
                    placeholder="What action was taken? (required)" rows={3}
                    className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm" />
                  <SubmitBtn busy={busy} onClick={() => runAction("resolve", { resolution_notes: resolutionNotes })} disabled={!resolutionNotes.trim()} />
                </div>
              )}
              {activeAction === "close" && (
                <div className="mt-3 space-y-2">
                  <select value={closureReason} onChange={e => setClosureReason(e.target.value)}
                    className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm">
                    <option value="">— Closure reason —</option>
                    {closureReasonOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                  <textarea value={closeNotes} onChange={e => setCloseNotes(e.target.value)}
                    placeholder="Optional notes…" rows={2}
                    className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm" />
                  <SubmitBtn busy={busy} onClick={() => runAction("close", { closure_reason: closureReason, notes: closeNotes })} disabled={!closureReason} />
                </div>
              )}
              {activeAction === "reopen" && (
                <div className="mt-3 space-y-2">
                  <textarea value={reopenReason} onChange={e => setReopenReason(e.target.value)}
                    placeholder="Why is this being reopened?" rows={2}
                    className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm" />
                  <SubmitBtn busy={busy} onClick={() => runAction("reopen", { reason: reopenReason })} />
                </div>
              )}
            </div>

            {/* Attachments */}
            {t.attachments && t.attachments.length > 0 && (
              <div className="bg-white p-4 rounded border border-slate-200">
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Attachments</div>
                <div className="grid grid-cols-4 gap-2">
                  {t.attachments.map((a, i) => (
                    <a key={i} href={a.url} target="_blank" rel="noreferrer"
                      className="block border border-slate-200 rounded p-2 text-center text-[11px] hover:bg-slate-50">
                      <div className="text-2xl mb-1">
                        {a.type === "IMAGE" ? "🖼️" : a.type === "DOCUMENT" ? "📄" : a.type === "AUDIO" ? "🎵" : "🎬"}
                      </div>
                      <div className="truncate text-slate-600">{a.name}</div>
                    </a>
                  ))}
                </div>
              </div>
            )}

            {/* Timeline */}
            <div className="bg-white p-4 rounded border border-slate-200">
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-3">Timeline</div>
              {t.events.length === 0 ? (
                <p className="text-sm text-slate-400 italic">No events yet.</p>
              ) : (
                <ol className="space-y-3">
                  {t.events.map(e => (
                    <li key={e.id} className="flex gap-3 text-sm">
                      <div className="w-2 h-2 rounded-full bg-brand mt-1.5 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-slate-800">
                          {e.event_type.replace(/_/g, " ")}
                          <span className="font-normal text-slate-400 ml-2 text-xs">
                            by <b>{e.actor}</b> · {new Date(e.created_at).toLocaleString()}
                          </span>
                        </div>
                        {e.note && <p className="text-slate-600 mt-0.5 whitespace-pre-wrap">{e.note}</p>}
                        {e.payload && Object.keys(e.payload).length > 0 && (
                          <div className="text-[11px] text-slate-400 mt-0.5 font-mono">
                            {JSON.stringify(e.payload)}
                          </div>
                        )}
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </div>
        )}
      </aside>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">{label}</div>
      {children}
    </div>
  );
}

function ActionBtn({ icon: Icon, label, active, onClick, disabled }: {
  icon: React.ElementType; label: string; active: boolean;
  onClick: () => void; disabled?: boolean;
}) {
  return (
    <button onClick={onClick} disabled={disabled}
      className={[
        "flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold border transition",
        active ? "bg-brand text-white border-brand" : "bg-white text-slate-700 border-slate-300 hover:bg-slate-50",
        disabled ? "opacity-40 cursor-not-allowed" : "",
      ].join(" ")}>
      <Icon className="w-3.5 h-3.5" /> {label}
    </button>
  );
}

function SubmitBtn({ busy, onClick, disabled }: { busy: boolean; onClick: () => void; disabled?: boolean }) {
  return (
    <button onClick={onClick} disabled={busy || disabled}
      className="flex items-center gap-1.5 px-4 py-1.5 bg-brand text-white rounded text-xs font-semibold hover:bg-blue-700 disabled:opacity-50">
      <Send className="w-3.5 h-3.5" /> {busy ? "Sending…" : "Submit"}
    </button>
  );
}
