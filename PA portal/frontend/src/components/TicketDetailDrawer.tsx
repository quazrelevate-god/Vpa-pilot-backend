"use client";

import { useEffect, useState } from "react";
import {
  ArrowRight, MessageSquare, CheckCircle2, Lock, RotateCcw, Send, Building2,
  Clock, User, Phone, Hash, CalendarDays, X, Languages, Sparkles,
  GitBranch, Flag, UserCheck, Paperclip, FileSignature,
} from "lucide-react";
import type { TicketDetail } from "@/lib/types";
import { fetchTicket, patchTicket, ticketAction } from "@/lib/api";
import {
  TICKET_STATUS_DISPLAY, TICKET_STATUS_COLOR, PRIORITY_COLOR,
  DEPT_DISPLAY, CATEGORY_DISPLAY, CLOSURE_REASON_DISPLAY,
  ticketManualStatusOptions, priorityOptions, deptOptions, closureReasonOptions,
} from "@/lib/enums";
import { AttachmentGallery } from "@/components/ui/attachment-gallery";
import { Sheet, SheetContent, SheetClose, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { InitialsAvatar } from "@/components/ui/avatar";
import { cn, formatDate, formatDateTime, toLocalDateTimeInput, fromLocalDateTimeInput } from "@/lib/utils";

type Action = "forward" | "resolve" | "close" | "reopen";
const NONE = "__none__";

const EVENT_ICON: Record<string, React.ElementType> = {
  created: FileSignature,
  ai_summarised: Sparkles,        // Sparkles == AI-generated event (only)
  status_changed: GitBranch, priority_changed: Flag,
  assigned: UserCheck, unassigned: UserCheck,
  due_date_set: CalendarDays,
  comment_added: MessageSquare, comment: MessageSquare,
  forwarded_to_dept: ArrowRight, forwarded: ArrowRight,
  resolved: CheckCircle2, closed: Lock, reopened: RotateCcw,
};

type Lang = "en" | "ta";

export default function TicketDetailDrawer({
  ticketId, onClose, onMutated,
}: {
  ticketId: number | null;
  onClose: () => void;
  onMutated?: () => void;
}) {
  const [data, setData] = useState<TicketDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState("details");
  const [activeAction, setActiveAction] = useState<Action | null>(null);
  const [lang, setLang] = useState<Lang>("en");

  const [commentText, setCommentText] = useState("");
  const [forwardDept, setForwardDept] = useState("");
  const [forwardNotes, setForwardNotes] = useState("");
  const [resolutionNotes, setResolutionNotes] = useState("");
  const [closureReason, setClosureReason] = useState("");
  const [closeNotes, setCloseNotes] = useState("");
  const [reopenReason, setReopenReason] = useState("");

  const open = ticketId != null;

  useEffect(() => {
    if (ticketId == null) return; // keep last data during the close animation
    setLoading(true);
    setTab("details");
    setActiveAction(null);
    fetchTicket(ticketId)
      .then(setData)
      .catch((e) => alert(`Failed to load ticket: ${e.message}`))
      .finally(() => setLoading(false));
  }, [ticketId]);

  async function patch(p: Parameters<typeof patchTicket>[1]) {
    if (ticketId == null) return;
    setBusy(true);
    try { setData(await patchTicket(ticketId, p)); onMutated?.(); }
    catch (e) { alert((e as Error).message); }
    finally { setBusy(false); }
  }

  async function runAction(action: Action | "comment", body: Record<string, unknown>) {
    if (ticketId == null) return;
    setBusy(true);
    try {
      setData(await ticketAction(ticketId, action, body));
      onMutated?.();
      setActiveAction(null);
      setCommentText(""); setForwardDept(""); setForwardNotes("");
      setResolutionNotes(""); setClosureReason(""); setCloseNotes(""); setReopenReason("");
    } catch (e) { alert((e as Error).message); }
    finally { setBusy(false); }
  }

  const t = data;
  const isClosed = t?.status === "closed";
  const isResolved = t?.status === "resolved";

  // Bilingual field accessor — falls back to EN if a TA variant is missing.
  const pick = <T,>(en: T | null | undefined, ta: T | null | undefined): T | null | undefined =>
    lang === "ta" ? (ta ?? en) : en;

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent
        side="right"
        hideClose
        className="flex w-full flex-col gap-0 p-0 sm:max-w-[60vw]"
      >
        {/* Header */}
        <div className="flex items-start gap-3 border-b border-border bg-card px-6 py-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs font-semibold text-brand">{t?.ticket_number ?? "…"}</span>
              {t?.priority && (
                <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-bold", PRIORITY_COLOR[t.priority])}>{t.priority}</span>
              )}
              {t && (
                <span className={cn("rounded-full border px-2 py-0.5 text-[10px] font-semibold", TICKET_STATUS_COLOR[t.status])}>
                  {TICKET_STATUS_DISPLAY[t.status] ?? t.status}
                </span>
              )}
            </div>
            <SheetTitle className="mt-1 text-base font-bold leading-snug">
              {(t && (pick(t.headline, t.headline_ta) ?? t.headline)) ?? (loading ? "Loading…" : "Ticket")}
            </SheetTitle>
          </div>
          {/* Language toggle */}
          {t && (t.summary_ta || t.headline_ta || t.citizen_ask_ta) && (
            <LangToggle lang={lang} onChange={setLang} />
          )}
          <SheetClose className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
            <X className="h-5 w-5" />
          </SheetClose>
        </div>

        {t ? (
          <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col">
            {/* Tab bar */}
            <div className="border-b border-border bg-card px-6 pt-3">
              <TabsList className="bg-muted">
                <TabsTrigger value="details">Details</TabsTrigger>
                <TabsTrigger value="activity">
                  Activity
                  {t.events.length > 0 && (
                    <span className="ml-1.5 rounded-full bg-background px-1.5 text-[10px] font-bold text-muted-foreground">
                      {t.events.length}
                    </span>
                  )}
                </TabsTrigger>
              </TabsList>
            </div>

            {/* ── Details ─────────────────────────────────────────────── */}
            <TabsContent value="details" className="m-0 min-h-0 flex-1 overflow-y-auto">
              <div className="space-y-4 p-6">
                {/* Citizen strip */}
                <div className="flex items-center gap-3 rounded-xl border border-border bg-card p-4 shadow-card">
                  <InitialsAvatar name={t.citizen_name} className="h-10 w-10 text-sm" />
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-foreground">{t.citizen_name ?? "—"}</div>
                    <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
                      <span className="inline-flex items-center gap-1"><Phone className="h-3 w-3" />{t.citizen_mobile ?? "—"}</span>
                      <span className="inline-flex items-center gap-1"><Hash className="h-3 w-3" />{t.token ?? "—"}</span>
                      <span className="inline-flex items-center gap-1"><CalendarDays className="h-3 w-3" />{formatDate(t.created_at)}</span>
                    </div>
                  </div>
                </div>

                {/* Summary — the briefing */}
                {(t.summary || t.description) && (
                  <section className="relative overflow-hidden rounded-xl border border-border bg-card shadow-card">
                    {/* Top accent bar — signals importance */}
                    <div className="h-1 w-full bg-gradient-to-r from-brand via-brand/70 to-brand/30" />

                    <div className="p-5 sm:p-6">
                      {/* Heading row */}
                      <div className="mb-3 flex items-center justify-between">
                        <h3 className="text-[11px] font-bold uppercase tracking-[0.18em] text-brand">
                          Summary
                        </h3>
                        {!t.summary && (
                          <span className="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400" />
                            Generating
                          </span>
                        )}
                      </div>

                      {/* Metadata strip — context before content */}
                      {(t.urgency || t.department_label || t.category_label) && (
                        <div className="mb-4 flex flex-wrap gap-1.5">
                          {t.urgency && (
                            <span className="rounded-full border border-orange-200 bg-orange-50 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-orange-700">
                              {t.urgency} urgency
                            </span>
                          )}
                          {t.department_label && (
                            <span className="inline-flex items-center gap-1 rounded-full border border-indigo-200 bg-indigo-50 px-2.5 py-0.5 text-[11px] font-semibold text-indigo-700">
                              <Building2 className="h-3 w-3" />{t.department_label}
                            </span>
                          )}
                          {t.category_label && (
                            <span className="rounded-full border border-border bg-muted px-2.5 py-0.5 text-[11px] font-semibold text-muted-foreground">
                              {t.category_label}
                            </span>
                          )}
                        </div>
                      )}

                      {/* Body — the briefing prose */}
                      {pick(t.summary, t.summary_ta) ? (
                        <p className="text-[15px] font-medium leading-[1.75] tracking-[-0.005em] text-foreground">
                          {pick(t.summary, t.summary_ta)}
                        </p>
                      ) : (
                        <p className="text-sm italic text-muted-foreground">
                          Summary is being prepared…
                        </p>
                      )}

                      {/* Citizen ask — the action */}
                      {pick(t.citizen_ask, t.citizen_ask_ta) && (
                        <div className="mt-5 rounded-r-lg border-l-[3px] border-brand bg-brand/[0.04] py-3 pl-4 pr-3">
                          <div className="mb-1 text-[10px] font-bold uppercase tracking-[0.16em] text-brand">
                            What they're asking for
                          </div>
                          <p className="text-[14px] font-semibold leading-relaxed text-foreground">
                            {pick(t.citizen_ask, t.citizen_ask_ta)}
                          </p>
                        </div>
                      )}

                      {/* Key details — supporting evidence */}
                      {(() => {
                        const list = pick(t.key_details, t.key_details_ta) ?? [];
                        if (!list || list.length === 0) return null;
                        return (
                          <div className="mt-5 border-t border-border pt-4">
                            <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
                              Key details
                            </div>
                            <ul className="space-y-2">
                              {list.map((d, i) => (
                                <li key={i} className="flex gap-3 text-[13.5px] leading-relaxed text-foreground/85">
                                  <span className="mt-[9px] h-1.5 w-1.5 shrink-0 rounded-full bg-brand/60" />
                                  <span>{d}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        );
                      })()}
                    </div>
                  </section>
                )}

                {/* Properties */}
                <Panel icon={User} title="Properties">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label>Status</Label>
                      <Select value={t.status} onValueChange={(v) => patch({ status: v })} disabled={busy}>
                        <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {ticketManualStatusOptions.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label>Priority</Label>
                      <Select value={t.priority ?? NONE} onValueChange={(v) => patch({ priority: v === NONE ? "" : v })} disabled={busy}>
                        <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NONE}>— None —</SelectItem>
                          {priorityOptions.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label>Assignee</Label>
                      <Input defaultValue={t.assigned_to_pa ?? ""} disabled={busy} placeholder="PA username" className="h-9"
                        onBlur={(e) => { const v = e.target.value.trim(); if (v !== (t.assigned_to_pa ?? "")) patch({ assigned_to_pa: v }); }} />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Due date (SLA)</Label>
                      <Input type="datetime-local" defaultValue={toLocalDateTimeInput(t.due_date)} disabled={busy} className="h-9"
                        onBlur={(e) => { const v = e.target.value; patch({ due_date: fromLocalDateTimeInput(v) }); }} />
                    </div>
                  </div>
                </Panel>

                {/* Forwarding info */}
                {t.forwarded_to_dept && (
                  <div className="rounded-xl border border-cyan-200 bg-cyan-50 p-4">
                    <SubHead className="text-cyan-700">Forwarded to Department</SubHead>
                    <div className="text-sm font-semibold text-cyan-900">{DEPT_DISPLAY[t.forwarded_to_dept] ?? t.forwarded_to_dept}</div>
                    {t.forwarded_notes && <p className="mt-1 whitespace-pre-wrap text-sm text-cyan-800">{t.forwarded_notes}</p>}
                    <div className="mt-1 text-[11px] text-cyan-600">
                      by {t.forwarded_by ?? "—"} on {formatDateTime(t.forwarded_at)}
                    </div>
                  </div>
                )}

                {/* Resolution info */}
                {t.resolution_notes && (
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
                    <SubHead className="text-emerald-700">Resolution Notes</SubHead>
                    <p className="whitespace-pre-wrap text-sm text-emerald-900">{t.resolution_notes}</p>
                    {t.closure_reason && (
                      <div className="mt-1 text-[11px] text-emerald-700">
                        Closure: {CLOSURE_REASON_DISPLAY[t.closure_reason] ?? t.closure_reason}
                      </div>
                    )}
                  </div>
                )}

                {/* Attachments + voice */}
                {((t.attachments && t.attachments.length > 0) || t.audio_transcript) && (
                  <Panel icon={Paperclip} title="Attachments & recordings">
                    <AttachmentGallery
                      attachments={t.attachments ?? []}
                      audioTranscript={t.audio_transcript}
                    />
                  </Panel>
                )}
              </div>
            </TabsContent>

            {/* ── Activity ────────────────────────────────────────────── */}
            <TabsContent value="activity" className="m-0 min-h-0 flex-1 overflow-y-auto">
              <div className="space-y-4 p-6">
                {/* Comment composer */}
                <div className="rounded-xl border border-border bg-card p-3 shadow-card">
                  <Textarea
                    value={commentText}
                    onChange={(e) => setCommentText(e.target.value)}
                    placeholder="Add a comment or internal note…"
                    rows={3}
                    className="border-0 p-1 shadow-none focus-visible:ring-0"
                  />
                  <div className="mt-2 flex justify-end">
                    <Button size="sm" disabled={busy || !commentText.trim()} onClick={() => runAction("comment", { text: commentText })}>
                      <Send className="h-3.5 w-3.5" /> Comment
                    </Button>
                  </div>
                </div>

                {/* Timeline */}
                {t.events.length === 0 ? (
                  <div className="py-10 text-center text-sm italic text-muted-foreground">No activity yet.</div>
                ) : (
                  <ol className="space-y-1">
                    {t.events.map((e, idx) => {
                      const Icon = EVENT_ICON[e.event_type] ?? Clock;
                      const last = idx === t.events.length - 1;
                      const title = formatEventTitle(e.event_type);
                      const renderedBody = renderEventBody(e);
                      return (
                        <li key={e.id} className="flex gap-3">
                          <div className="flex flex-col items-center">
                            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-brand/10 text-brand ring-1 ring-brand/15">
                              <Icon className="h-3.5 w-3.5" />
                            </span>
                            {!last && <span className="my-1 w-px flex-1 bg-border" />}
                          </div>
                          <div className="min-w-0 flex-1 pb-4">
                            <div className="text-sm font-medium text-foreground">{title}</div>
                            <div className="text-[11px] text-muted-foreground">
                              by <b className="font-semibold text-foreground/80">{e.actor}</b> · {formatDateTime(e.created_at)}
                            </div>
                            {renderedBody}
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                )}
              </div>
            </TabsContent>

            {/* ── Action form (slides above footer) ───────────────────── */}
            {activeAction && (
              <div className="border-t border-border bg-muted/40 p-4">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-wider text-foreground">
                    {activeAction === "forward" ? "Forward to department"
                      : activeAction === "resolve" ? "Resolve ticket"
                      : activeAction === "close" ? "Close ticket"
                      : "Reopen ticket"}
                  </span>
                  <button onClick={() => setActiveAction(null)} className="text-muted-foreground hover:text-foreground">
                    <X className="h-4 w-4" />
                  </button>
                </div>

                {activeAction === "forward" && (
                  <div className="space-y-2">
                    <Select value={forwardDept || undefined} onValueChange={setForwardDept}>
                      <SelectTrigger className="h-9"><SelectValue placeholder="Pick department" /></SelectTrigger>
                      <SelectContent>
                        {deptOptions.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <Textarea value={forwardNotes} onChange={(e) => setForwardNotes(e.target.value)} placeholder="Forwarding notes (contact, ref no.)…" rows={2} />
                    <ActionSubmit busy={busy} label="Forward" disabled={!forwardDept} onClick={() => runAction("forward", { department: forwardDept, notes: forwardNotes })} />
                  </div>
                )}
                {activeAction === "resolve" && (
                  <div className="space-y-2">
                    <Textarea value={resolutionNotes} onChange={(e) => setResolutionNotes(e.target.value)} placeholder="What action was taken? (required)" rows={3} />
                    <ActionSubmit busy={busy} label="Resolve" disabled={!resolutionNotes.trim()} onClick={() => runAction("resolve", { resolution_notes: resolutionNotes })} />
                  </div>
                )}
                {activeAction === "close" && (
                  <div className="space-y-2">
                    <Select value={closureReason || undefined} onValueChange={setClosureReason}>
                      <SelectTrigger className="h-9"><SelectValue placeholder="Closure reason" /></SelectTrigger>
                      <SelectContent>
                        {closureReasonOptions.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <Textarea value={closeNotes} onChange={(e) => setCloseNotes(e.target.value)} placeholder="Optional notes…" rows={2} />
                    <ActionSubmit busy={busy} label="Close" disabled={!closureReason} onClick={() => runAction("close", { closure_reason: closureReason, notes: closeNotes })} />
                  </div>
                )}
                {activeAction === "reopen" && (
                  <div className="space-y-2">
                    <Textarea value={reopenReason} onChange={(e) => setReopenReason(e.target.value)} placeholder="Why is this being reopened?" rows={2} />
                    <ActionSubmit busy={busy} label="Reopen" onClick={() => runAction("reopen", { reason: reopenReason })} />
                  </div>
                )}
              </div>
            )}

            {/* ── Footer actions ──────────────────────────────────────── */}
            <div className="flex flex-wrap items-center gap-2 border-t border-border bg-card px-6 py-3">
              {!isClosed && (
                <Button size="sm" disabled={busy} onClick={() => setActiveAction(activeAction === "resolve" ? null : "resolve")}>
                  <CheckCircle2 className="h-4 w-4" /> Resolve
                </Button>
              )}
              {!isClosed && (
                <Button variant="outline" size="sm" disabled={busy} onClick={() => setActiveAction(activeAction === "forward" ? null : "forward")}>
                  <ArrowRight className="h-4 w-4" /> Forward
                </Button>
              )}
              {!isClosed && (
                <Button variant="outline" size="sm" disabled={busy} onClick={() => setActiveAction(activeAction === "close" ? null : "close")}>
                  <Lock className="h-4 w-4" /> Close
                </Button>
              )}
              {/* Reopen is always available — closed/resolved tickets need this to come back, and even active tickets may need to be reopened after wrong closure. */}
              <Button variant="outline" size="sm" disabled={busy} onClick={() => setActiveAction(activeAction === "reopen" ? null : "reopen")}>
                <RotateCcw className="h-4 w-4" /> Reopen
              </Button>
              <Button variant="ghost" size="sm" className="ml-auto" onClick={() => setTab("activity")}>
                <MessageSquare className="h-4 w-4" /> Comment
              </Button>
            </div>
          </Tabs>
        ) : (
          <div className="flex flex-1 items-center justify-center text-muted-foreground">Loading…</div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Panel({ title, icon: Icon, children }: { title: string; icon?: React.ElementType; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-card">
      <div className="mb-2.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
        {Icon && <Icon className="h-3.5 w-3.5" />} {title}
      </div>
      {children}
    </div>
  );
}

function SubHead({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("mb-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground", className)}>{children}</div>;
}

// ── Activity rendering ──────────────────────────────────────────────────────

const PRETTY_EVENT: Record<string, string> = {
  created: "Ticket created",
  ai_summarised: "Summary generated",
  status_changed: "Status changed",
  priority_changed: "Priority changed",
  assigned: "Assignee set",
  unassigned: "Assignee cleared",
  due_date_set: "Due date set",
  comment_added: "Comment added",
  comment: "Comment added",
  forwarded_to_dept: "Forwarded to department",
  forwarded: "Forwarded to department",
  resolved: "Ticket resolved",
  closed: "Ticket closed",
  reopened: "Ticket reopened",
};

function formatEventTitle(eventType: string): string {
  return PRETTY_EVENT[eventType] ?? eventType.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function ChangeArrow({ from, to, format }: { from: unknown; to: unknown; format?: (v: unknown) => string }) {
  const fmt = (v: unknown) => {
    if (v == null || v === "") return "—";
    return format ? format(v) : String(v).replace(/_/g, " ");
  };
  return (
    <div className="mt-1 inline-flex items-center gap-2 rounded-lg bg-muted/60 px-2.5 py-1 text-[12.5px]">
      <span className="rounded bg-background px-1.5 py-0.5 font-medium text-muted-foreground">{fmt(from)}</span>
      <ArrowRight className="h-3 w-3 text-muted-foreground" />
      <span className="rounded bg-brand/10 px-1.5 py-0.5 font-semibold capitalize text-brand">{fmt(to)}</span>
    </div>
  );
}

function renderEventBody(e: { event_type: string; note?: string | null; payload?: Record<string, unknown> | null }) {
  const p = e.payload ?? {};

  // Status & priority deltas — use payload, not the raw note.
  if (e.event_type === "status_changed") {
    return <ChangeArrow from={p.from} to={p.to} format={(v) => TICKET_STATUS_DISPLAY[String(v)] ?? String(v).replace(/_/g, " ")} />;
  }
  if (e.event_type === "priority_changed") {
    return <ChangeArrow from={p.from} to={p.to} />;
  }
  if (e.event_type === "assigned") {
    return <ChangeArrow from={p.from ?? "unassigned"} to={p.to} />;
  }
  if (e.event_type === "unassigned") {
    return <div className="mt-1 text-[12.5px] text-muted-foreground">Was: <b className="text-foreground/80">{(p.from as string) ?? "—"}</b></div>;
  }
  if (e.event_type === "due_date_set") {
    return <div className="mt-1 text-[12.5px] text-muted-foreground">Due: <b className="text-foreground/80">{p.due_date ? formatDateTime(String(p.due_date)) : "cleared"}</b></div>;
  }

  // AI summarised — render the structured payload, not the raw "urgency=..." note.
  if (e.event_type === "ai_summarised") {
    const u = p.urgency as string | undefined;
    const c = p.category as string | undefined;
    const d = p.department as string | undefined;
    const sp = p.suggested_priority as string | undefined;
    return (
      <div className="mt-1.5 flex flex-wrap gap-1.5 rounded-lg bg-muted/60 p-2">
        {u && <Chip label="Urgency" value={u} tone="orange" />}
        {c && <Chip label="Category" value={CATEGORY_DISPLAY[c] ?? c.replace(/_/g, " ")} tone="slate" />}
        {d && <Chip label="Department" value={DEPT_DISPLAY[d] ?? d.replace(/_/g, " ")} tone="indigo" />}
        {sp && <Chip label="Suggested priority" value={sp} tone="brand" />}
      </div>
    );
  }

  // Forwarded — show department label + notes if present.
  if (e.event_type === "forwarded_to_dept" || e.event_type === "forwarded") {
    return (
      <>
        {p.department && (
          <div className="mt-1 inline-flex items-center gap-1.5 rounded-md border border-cyan-200 bg-cyan-50 px-2 py-0.5 text-[11px] font-semibold text-cyan-700">
            <Building2 className="h-3 w-3" />
            {DEPT_DISPLAY[String(p.department)] ?? String(p.department)}
          </div>
        )}
        {e.note && <p className="mt-1 whitespace-pre-wrap rounded-lg bg-muted/60 p-2 text-sm text-foreground/80">{e.note}</p>}
      </>
    );
  }

  // Default: render the note as a quoted block when present.
  return e.note ? <p className="mt-1 whitespace-pre-wrap rounded-lg bg-muted/60 p-2 text-sm text-foreground/80">{e.note}</p> : null;
}

function Chip({ label, value, tone }: { label: string; value: string; tone: "orange" | "slate" | "indigo" | "brand" }) {
  const toneClass = {
    orange: "border-orange-200 bg-orange-50 text-orange-700",
    slate: "border-border bg-card text-foreground/80",
    indigo: "border-indigo-200 bg-indigo-50 text-indigo-700",
    brand: "border-brand/30 bg-brand/10 text-brand",
  }[tone];
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-semibold capitalize", toneClass)}>
      <span className="text-[9px] font-bold uppercase tracking-wider opacity-60">{label}</span>
      {value}
    </span>
  );
}

function LangToggle({ lang, onChange }: { lang: Lang; onChange: (l: Lang) => void }) {
  return (
    <div className="flex h-8 shrink-0 items-center gap-0.5 rounded-lg border border-border bg-muted/60 p-0.5 text-[11px] font-semibold">
      <Languages className="ml-1 h-3.5 w-3.5 text-muted-foreground" />
      {(["en", "ta"] as Lang[]).map((l) => (
        <button
          key={l}
          onClick={() => onChange(l)}
          className={cn(
            "rounded-md px-2 py-0.5 uppercase tracking-wider transition-colors",
            lang === l ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
          )}
        >
          {l === "en" ? "EN" : "த"}
        </button>
      ))}
    </div>
  );
}

function ActionSubmit({ busy, label, onClick, disabled }: { busy: boolean; label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <div className="flex justify-end">
      <Button size="sm" onClick={onClick} disabled={busy || disabled}>
        <Send className="h-3.5 w-3.5" /> {busy ? "Working…" : label}
      </Button>
    </div>
  );
}
