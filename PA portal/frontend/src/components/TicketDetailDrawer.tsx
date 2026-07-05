"use client";

import { useEffect, useState } from "react";
import {
  ArrowRight, MessageSquare, CheckCircle2, Lock, RotateCcw, Send, Building2,
  Clock, User, Phone, Hash, CalendarDays, X, Languages, Sparkles,
  GitBranch, Flag, UserCheck, Paperclip, FileSignature, FileCheck2, Inbox,
} from "lucide-react";
import type { TicketDetail } from "@/lib/types";
import type { GalleryAttachment } from "@/components/ui/attachment-gallery";
import { fetchTicket, patchTicket, ticketAction } from "@/lib/api";
import {
  TICKET_STATUS_DISPLAY, TICKET_STATUS_COLOR,
  MINISTRY_DISPLAY, CATEGORY_DISPLAY, CLOSURE_REASON_DISPLAY,
  ticketManualStatusOptions, closureReasonOptions,
} from "@/lib/enums";
import PriorityBadge from "@/components/PriorityBadge";
import { InlineAttachmentPreview } from "@/components/ui/inline-attachment-preview";
import { Sheet, SheetContent, SheetClose, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { InitialsAvatar } from "@/components/ui/avatar";
import { cn, formatDate, formatDateTime, toLocalDateTimeInput, fromLocalDateTimeInput } from "@/lib/utils";

type Action = "close" | "reopen";

const EVENT_ICON: Record<string, React.ElementType> = {
  petition_submitted: Inbox,
  created: FileSignature,
  ai_summarised: Sparkles,        // Sparkles == AI-generated event (only)
  status_changed: GitBranch, priority_changed: Flag,
  assigned: UserCheck, unassigned: UserCheck,
  due_date_set: CalendarDays,
  comment_added: MessageSquare, comment: MessageSquare,
  forwarded_to_dept: ArrowRight, forwarded: ArrowRight,
  routed_to_department: Building2, department_accepted: UserCheck,
  department_forwarded: ArrowRight, progress_update: MessageSquare,
  resolved: CheckCircle2, closed: Lock, reopened: RotateCcw,
};

// The 10 School Education departments a ticket can be routed to.
const SCHOOL_DEPARTMENTS: { key: string; label: string }[] = [
  { key: "director_school_education", label: "Director of School Education" },
  { key: "private_schools", label: "Directorate of Private Schools" },
  { key: "elementary_education", label: "Elementary Education" },
  { key: "govt_examination", label: "Government Examinations" },
  { key: "non_formal_adult_education", label: "Non-Formal & Adult Education" },
  { key: "public_libraries", label: "Public Libraries" },
  { key: "scert", label: "SCERT" },
  { key: "teacher_recruitment_board", label: "Teacher Recruitment Board (TRB)" },
  { key: "tn_education_service_corp", label: "TN Education Service Corporation" },
  { key: "samagra_shiksha", label: "Samagra Shiksha" },
];

const SCHOOL_DEPT_LABEL: Record<string, string> = Object.fromEntries(
  SCHOOL_DEPARTMENTS.map((d) => [d.key, d.label]),
);
// Department actions log the department key as the actor — show its full name.
const prettyActor = (a: string) => SCHOOL_DEPT_LABEL[a] ?? a;

function galleryType(mime?: string): GalleryAttachment["type"] {
  if (mime?.startsWith("image/")) return "IMAGE";
  if (mime?.startsWith("video/")) return "VIDEO";
  if (mime?.startsWith("audio/")) return "AUDIO";
  return "DOCUMENT";
}

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

  async function routeToDepartment(dept: string) {
    if (ticketId == null || !dept || dept === t?.assigned_department) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/tickets/${ticketId}/route`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        credentials: "include", body: JSON.stringify({ department: dept }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || "Routing failed");
      setData(await fetchTicket(ticketId));
      onMutated?.();
    } catch (e) { alert((e as Error).message); }
    finally { setBusy(false); }
  }

  async function runAction(action: Action | "comment", body: Record<string, unknown>) {
    if (ticketId == null) return;
    setBusy(true);
    try {
      setData(await ticketAction(ticketId, action, body));
      onMutated?.();
      setActiveAction(null);
      setCommentText(""); setClosureReason(""); setCloseNotes(""); setReopenReason("");
    } catch (e) { alert((e as Error).message); }
    finally { setBusy(false); }
  }

  const t = data;
  const isClosed = t?.status === "closed";
  const isResolved = t?.status === "resolved";

  // Department resolution proofs → gallery shape for the preview pane.
  const resAtt: GalleryAttachment[] = (t?.resolution_attachments ?? []).map((a) => ({
    name: a.name || "attachment",
    url: a.url,
    type: galleryType(a.mime),
  }));

  // Bilingual field accessor — falls back to EN if a TA variant is missing.
  const pick = <T,>(en: T | null | undefined, ta: T | null | undefined): T | null | undefined =>
    lang === "ta" ? (ta ?? en) : en;

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent
        side="right"
        hideClose
        className="flex w-full flex-col gap-0 p-0 sm:max-w-[95vw]"
      >
        {/* Header */}
        <div className="flex items-start gap-3 border-b border-border bg-card px-6 py-4">
          <div className="min-w-0 flex-1">
            <SheetTitle className="text-xl font-bold leading-snug tracking-tight">
              {(t && (pick(t.citizen_ask, t.citizen_ask_ta) ?? t.citizen_ask)) ?? (loading ? "Loading…" : "Ticket")}
            </SheetTitle>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="font-mono text-base font-semibold text-brand">{t?.ticket_number ?? "…"}</span>
              {t?.priority && <PriorityBadge priority={t.priority} />}
              {t && (
                <span className={cn("rounded-full border px-2.5 py-0.5 text-xs font-semibold", TICKET_STATUS_COLOR[t.status])}>
                  {TICKET_STATUS_DISPLAY[t.status] ?? t.status}
                </span>
              )}
            </div>
          </div>
          {/* Language toggle */}
          {t && (t.summary_ta || t.citizen_ask_ta) && (
            <LangToggle lang={lang} onChange={setLang} />
          )}
          <SheetClose className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
            <X className="h-5 w-5" />
          </SheetClose>
        </div>

        {t ? (
          <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
            {/* Preview pane — uploads at-a-glance */}
            <aside className="flex min-h-0 flex-shrink-0 flex-col border-b border-border bg-muted/30 p-5 lg:w-[52%] lg:border-b-0 lg:border-r">
              <div className="mb-3 flex flex-shrink-0 items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                <Paperclip className="h-3.5 w-3.5" /> Citizen uploads
              </div>
              <div className="min-h-0 flex-1">
                <InlineAttachmentPreview attachments={t.attachments ?? []} audioTranscript={t.audio_transcript} />
              </div>

              {/* Resolution proof — attachments the department uploaded on resolve */}
              {resAtt.length > 0 && (
                <div className="mt-4 flex-shrink-0 border-t border-border pt-4">
                  <div className="mb-3 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-emerald-600">
                    <FileCheck2 className="h-3.5 w-3.5" /> Resolution proof
                    <span className="rounded-full bg-emerald-100 px-1.5 text-[10px] font-bold text-emerald-700">
                      {resAtt.length}
                    </span>
                  </div>
                  <InlineAttachmentPreview attachments={resAtt} />
                </div>
              )}
            </aside>

            <Tabs value={tab} onValueChange={setTab} className="flex min-w-0 min-h-0 flex-1 flex-col">
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
                      {(t.priority || t.ministry_label || t.category_label) && (
                        <div className="mb-4 flex flex-wrap gap-1.5">
                          {t.priority && (
                            <span className="rounded-full border border-orange-200 bg-orange-50 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-orange-700">
                              {t.priority} priority
                            </span>
                          )}
                          {t.ministry_label && (
                            <span className="inline-flex items-center gap-1 rounded-full border border-indigo-200 bg-indigo-50 px-2.5 py-0.5 text-[11px] font-semibold text-indigo-700">
                              <Building2 className="h-3 w-3" />{t.ministry_label}
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

                {/* Citizen — structured form */}
                <Panel icon={User} title="Citizen">
                  <div className="flex items-center gap-4 border-b border-border pb-5">
                    <InitialsAvatar name={t.citizen_name} className="h-12 w-12 text-base" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-base font-semibold text-foreground">{t.citizen_name ?? "—"}</div>
                      <div className="mt-0.5 text-xs uppercase tracking-wider text-muted-foreground">Citizen</div>
                    </div>
                  </div>
                  <dl className="grid grid-cols-1 gap-x-8 gap-y-5 pt-5 sm:grid-cols-2">
                    <Field icon={Phone} label="Mobile" value={t.citizen_mobile} mono />
                    <Field icon={Hash} label="Token" value={t.token} mono accent="brand" />
                    <Field icon={CalendarDays} label="Created" value={formatDate(t.created_at)} />
                  </dl>
                </Panel>

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
                    {/* Assign — routes to a school department (logs "routed").
                        Once a department accepts, ownership is locked here. */}
                    <div className="space-y-1.5">
                      <Label>Assign</Label>
                      {t.accepted_at ? (
                        <div className="flex h-9 items-center gap-2">
                          <span className="inline-flex items-center gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
                            <Building2 className="h-3.5 w-3.5" />
                            {t.assigned_department_label ?? t.assigned_department}
                          </span>
                          <span className="text-[11px] text-muted-foreground">accepted · locked</span>
                        </div>
                      ) : (
                        <Select value={t.assigned_department || undefined} onValueChange={routeToDepartment} disabled={busy}>
                          <SelectTrigger className="h-9"><SelectValue placeholder="Assign a department" /></SelectTrigger>
                          <SelectContent>
                            {SCHOOL_DEPARTMENTS.map((d) => <SelectItem key={d.key} value={d.key}>{d.label}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      )}
                    </div>
                    <div className="space-y-1.5">
                      <Label>Priority (from review)</Label>
                      <div className="flex h-9 items-center">
                        {t.priority
                          ? <PriorityBadge priority={t.priority} />
                          : <span className="text-sm text-muted-foreground">— not yet reviewed —</span>}
                      </div>
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
                    <div className="text-sm font-semibold text-cyan-900">{MINISTRY_DISPLAY[t.forwarded_to_dept] ?? t.forwarded_to_dept}</div>
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
                              by <b className="font-semibold text-foreground/80">{prettyActor(e.actor)}</b> · {formatDateTime(e.created_at)}
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
                    {activeAction === "close" ? "Close ticket" : "Reopen ticket"}
                  </span>
                  <button onClick={() => setActiveAction(null)} className="text-muted-foreground hover:text-foreground">
                    <X className="h-4 w-4" />
                  </button>
                </div>

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
            {/* Resolve + Forward belong to the department workspace, not the PA
                monitor — the PA only assigns, closes, reopens, and comments. */}
            <div className="flex flex-wrap items-center gap-2 border-t border-border bg-card px-6 py-3">
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
          </div>
        ) : (
          <div className="flex flex-1 items-center justify-center text-muted-foreground">Loading…</div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Field({
  icon: Icon, label, value, mono, accent,
}: {
  icon: React.ElementType;
  label: string;
  value: React.ReactNode;
  mono?: boolean;
  accent?: "brand" | "emerald" | "violet";
}) {
  const accentText =
    accent === "brand"   ? "text-brand"   :
    accent === "emerald" ? "text-emerald-600" :
    accent === "violet"  ? "text-violet-600"  : "text-foreground";
  return (
    <div className="flex flex-col gap-1.5">
      <dt className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </dt>
      <dd className={cn("pl-[22px] text-sm font-medium leading-relaxed", mono && "font-mono", accentText)}>
        {value ?? <span className="text-muted-foreground">—</span>}
      </dd>
    </div>
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
  petition_submitted: "Petition submitted",
  created: "Ticket created",
  ai_summarised: "Summary generated",
  status_changed: "Status changed",
  priority_changed: "Priority changed",
  assigned: "Assignee set",
  unassigned: "Assignee cleared",
  due_date_set: "Due date set",
  comment_added: "Comment added",
  comment: "Comment added",
  routed_to_department: "Routed to department",
  department_accepted: "Department accepted",
  department_forwarded: "Forwarded to department",
  progress_update: "Progress update",
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
    // New events use `ministry`; keep `department` fallback for legacy events.
    const m = (p.ministry ?? p.department) as string | undefined;
    const sp = p.suggested_priority as string | undefined;
    return (
      <div className="mt-1.5 flex flex-wrap gap-1.5 rounded-lg bg-muted/60 p-2">
        {u && <Chip label="Priority" value={u} tone="orange" />}
        {c && <Chip label="Category" value={CATEGORY_DISPLAY[c] ?? c.replace(/_/g, " ")} tone="slate" />}
        {m && <Chip label="Ministry" value={MINISTRY_DISPLAY[m] ?? m.replace(/_/g, " ")} tone="indigo" />}
        {sp && <Chip label="Suggested priority" value={sp} tone="brand" />}
      </div>
    );
  }

  // Routed / forwarded between School Education departments — show the target
  // department (the "to whom") plus the reason note when present.
  if (e.event_type === "routed_to_department" || e.event_type === "department_forwarded") {
    const to = p.to ? String(p.to) : "";
    return (
      <>
        {to && (
          <div className="mt-1 inline-flex items-center gap-1.5 rounded-md border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-[11px] font-semibold text-indigo-700">
            <Building2 className="h-3 w-3" />
            {SCHOOL_DEPT_LABEL[to] ?? to.replace(/_/g, " ")}
          </div>
        )}
        {e.note && <p className="mt-1 whitespace-pre-wrap rounded-lg bg-muted/60 p-2 text-sm text-foreground/80">{e.note}</p>}
      </>
    );
  }

  // Forwarded — show ministry label + notes if present.
  if (e.event_type === "forwarded_to_dept" || e.event_type === "forwarded") {
    const ministry = (p.ministry ?? p.department) as string | undefined;
    return (
      <>
        {ministry && (
          <div className="mt-1 inline-flex items-center gap-1.5 rounded-md border border-cyan-200 bg-cyan-50 px-2 py-0.5 text-[11px] font-semibold text-cyan-700">
            <Building2 className="h-3 w-3" />
            {MINISTRY_DISPLAY[String(ministry)] ?? String(ministry)}
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
