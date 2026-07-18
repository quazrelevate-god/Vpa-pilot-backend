"use client";

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { toast } from "sonner";
import {
  ArrowRight, MessageSquare, CheckCircle2, Lock, RotateCcw, Send, Building2,
  Clock, User, Phone, Hash, CalendarDays, X, Sparkles, MapPin, Undo2,
  GitBranch, Flag, UserCheck, Paperclip, FileSignature, FileCheck2, Inbox,
  ClipboardList, Landmark, Tag, BarChart3, Image as ImageIcon,
} from "lucide-react";
import {
  SectionCard, OverviewGrid, OverviewItem, StatusDot, statusTone, priorityTone,
} from "@/components/ui/detail-primitives";
import type { TicketDetail } from "@/lib/types";
import type { GalleryAttachment } from "@/components/ui/attachment-gallery";
import { fetchTicket, patchTicket, ticketAction, uploadTicketAttachment } from "@/lib/api";
import {
  TICKET_STATUS_DISPLAY, TICKET_STATUS_COLOR,
  MINISTRY_DISPLAY, CATEGORY_DISPLAY, CATEGORY_DISPLAY_TA, CLOSURE_REASON_DISPLAY,
  closureReasonOptions, priorityOptions,
  SCHOOL_DEPARTMENTS, SCHOOL_DEPT_LABEL,
} from "@/lib/enums";
import { useLang } from "@/lib/lang-context";
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

type Action = "close" | "reopen" | "revert";

// Localized labels for priority + ticket status (fall back to English display).
const PRIORITY_TKEY: Record<string, string> = {
  low: "petition.urgencyLow", medium: "petition.urgencyMedium",
  high: "petition.urgencyHigh", critical: "petition.urgencyCritical",
};
const STATUS_TKEY: Record<string, string> = {
  open: "tkt.stOpen", triaged: "tkt.stTriaged", assigned: "tkt.stAssigned",
  in_progress: "tkt.stInProgress", forwarded_to_dept: "tkt.stForwarded",
  pending_citizen: "tkt.stPendingCitizen", resolved: "tkt.stResolved",
  closed: "tkt.stClosed", reopened: "tkt.stReopened",
};

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

// Department actions log the department key as the actor — show its full name.
const prettyActor = (a: string) => SCHOOL_DEPT_LABEL[a] ?? a;

// Tamil Nadu districts (38 as of 2020). Keys mirror the backend District enum
// exactly — do not localise the key. Display labels are English here; Tamil
// UI still sees English labels for now (the enum is EN by design).
const TN_DISTRICTS: { key: string; label: string }[] = [
  { key: "ariyalur", label: "Ariyalur" },
  { key: "chengalpattu", label: "Chengalpattu" },
  { key: "chennai", label: "Chennai" },
  { key: "coimbatore", label: "Coimbatore" },
  { key: "cuddalore", label: "Cuddalore" },
  { key: "dharmapuri", label: "Dharmapuri" },
  { key: "dindigul", label: "Dindigul" },
  { key: "erode", label: "Erode" },
  { key: "kallakurichi", label: "Kallakurichi" },
  { key: "kanchipuram", label: "Kanchipuram" },
  { key: "kanyakumari", label: "Kanyakumari" },
  { key: "karur", label: "Karur" },
  { key: "krishnagiri", label: "Krishnagiri" },
  { key: "madurai", label: "Madurai" },
  { key: "mayiladuthurai", label: "Mayiladuthurai" },
  { key: "nagapattinam", label: "Nagapattinam" },
  { key: "namakkal", label: "Namakkal" },
  { key: "nilgiris", label: "The Nilgiris" },
  { key: "perambalur", label: "Perambalur" },
  { key: "pudukkottai", label: "Pudukkottai" },
  { key: "ramanathapuram", label: "Ramanathapuram" },
  { key: "ranipet", label: "Ranipet" },
  { key: "salem", label: "Salem" },
  { key: "sivaganga", label: "Sivaganga" },
  { key: "tenkasi", label: "Tenkasi" },
  { key: "thanjavur", label: "Thanjavur" },
  { key: "theni", label: "Theni" },
  { key: "thoothukudi", label: "Thoothukudi" },
  { key: "tiruchirappalli", label: "Tiruchirappalli" },
  { key: "tirunelveli", label: "Tirunelveli" },
  { key: "tirupattur", label: "Tirupattur" },
  { key: "tiruppur", label: "Tiruppur" },
  { key: "tiruvallur", label: "Tiruvallur" },
  { key: "tiruvannamalai", label: "Tiruvannamalai" },
  { key: "tiruvarur", label: "Tiruvarur" },
  { key: "vellore", label: "Vellore" },
  { key: "viluppuram", label: "Viluppuram" },
  { key: "virudhunagar", label: "Virudhunagar" },
];
// Sentinel used inside the Select to represent "clear the district".
// Radix Select refuses "" as an item value, so we round-trip through this
// token and translate it back to "" in the patch call.
const DISTRICT_CLEAR = "__none__";

function galleryType(mime?: string): GalleryAttachment["type"] {
  if (mime?.startsWith("image/")) return "IMAGE";
  if (mime?.startsWith("video/")) return "VIDEO";
  if (mime?.startsWith("audio/")) return "AUDIO";
  return "DOCUMENT";
}

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
  const { lang, t: tr } = useLang();

  const [commentText, setCommentText] = useState("");
  const attachRef = useRef<HTMLInputElement>(null);
  const [closureReason, setClosureReason] = useState("");
  const [closeNotes, setCloseNotes] = useState("");
  const [reopenReason, setReopenReason] = useState("");
  const [revertReason, setRevertReason] = useState("");

  // Assignment is now click-to-confirm rather than click-to-save.
  // Selecting a department or due date only stages the change; the PA
  // clicks the "Assign ticket" button below to commit both at once.
  const [pendingDept, setPendingDept] = useState<string | null>(null);
  const [pendingDue, setPendingDue]   = useState<string | null>(null); // ISO string or ""
  const [assigning, setAssigning]     = useState(false);
  const dueDateRef = useRef<HTMLInputElement | null>(null);

  const open = ticketId != null;

  useEffect(() => {
    if (ticketId == null) return; // keep last data during the close animation
    setLoading(true);
    setData(null);   // drop the previous ticket so the loader shows, not stale data
    setTab("details");
    setActiveAction(null);
    setPendingDept(null); setPendingDue(null); setAssigning(false);
    let cancelled = false;   // guard against a slow earlier fetch overwriting a newer one
    fetchTicket(ticketId)
      .then((d) => { if (!cancelled) setData(d); })
      .catch((e) => { if (!cancelled) alert(`Failed to load ticket: ${e.message}`); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [ticketId]);

  async function patch(p: Parameters<typeof patchTicket>[1]) {
    if (ticketId == null) return;
    setBusy(true);
    try { setData(await patchTicket(ticketId, p)); onMutated?.(); }
    catch (e) { alert((e as Error).message); }
    finally { setBusy(false); }
  }

  async function handleAssign() {
    if (ticketId == null || !t) return;
    const dept = pendingDept ?? t.assigned_department ?? "";
    const due  = pendingDue  ?? (t.due_date ?? "");
    if (!dept || !due) return; // guarded by disabled state; belt-and-braces

    setAssigning(true);
    try {
      // Route first (server logs "routed" event).
      if (dept !== t.assigned_department) {
        const r = await fetch(`/api/tickets/${ticketId}/route`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          credentials: "include", body: JSON.stringify({ department: dept }),
        });
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || "Routing failed");
      }
      // Then persist the SLA if it changed.
      if (due !== (t.due_date ?? "")) {
        await patchTicket(ticketId, { due_date: due });
      }
      toast.success(tr("tkt.assignedToast"));
      onMutated?.();
      onClose();
    } catch (e) {
      toast.error((e as Error).message || "Assignment failed");
    } finally {
      setAssigning(false);
    }
  }

  async function runAction(action: Action | "comment", body: Record<string, unknown>) {
    if (ticketId == null) return;
    setBusy(true);
    try {
      const updated = await ticketAction(ticketId, action, body);
      onMutated?.();
      setActiveAction(null);
      setCommentText(""); setClosureReason(""); setCloseNotes(""); setReopenReason(""); setRevertReason("");
      if (action === "revert") {
        // Ticket is out of every workflow tab now; close the drawer so the
        // PA lands back on the tickets list, and toast the outcome. The
        // appointment now shows in Petition Review.
        toast.success(tr("tkt.revertedToast"));
        onClose();
        return;
      }
      setData(updated);
    } catch (e) {
      // Use a toast for revert (matches Dismiss), keep the legacy alert for
      // close/reopen so their existing UX is unchanged.
      if (action === "revert") toast.error((e as Error).message || tr("tkt.revertedFailed"));
      else alert((e as Error).message);
    } finally { setBusy(false); }
  }

  async function handleAttach(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";               // allow re-picking the same file
    if (!file || ticketId == null) return;
    if (file.size > 5 * 1024 * 1024) { toast.error(tr("attach.tooLarge")); return; }
    setBusy(true);
    try {
      await uploadTicketAttachment(ticketId, file);
      setData(await fetchTicket(ticketId));   // refresh so the new file shows
      onMutated?.();
      toast.success(tr("attach.added"));
    } catch (err) {
      toast.error((err as Error).message || tr("attach.failed"));
    } finally {
      setBusy(false);
    }
  }

  const t = data;
  const isClosed = t?.status === "closed";
  const isResolved = t?.status === "resolved";
  // Assign + SLA are editable only while the ticket is still open.
  const isOpen = t?.status === "open";
  const canEdit = Boolean(isOpen) && !busy;

  // Localized value helpers (respect the global language).
  const statusText = (s?: string | null) => { if (!s) return ""; const k = STATUS_TKEY[s]; return k ? tr(k) : (TICKET_STATUS_DISPLAY[s] ?? s); };
  const priorityText = (p?: string | null) => { if (!p) return ""; const k = PRIORITY_TKEY[p]; return k ? tr(k) : p; };
  const categoryText = t?.category
    ? ((lang === "ta" ? CATEGORY_DISPLAY_TA[t.category] : CATEGORY_DISPLAY[t.category]) ?? t.category_label ?? t.category)
    : (t?.category_label ?? null);

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
              {(t && (pick(t.citizen_ask, t.citizen_ask_ta) ?? t.citizen_ask)) ?? (loading ? tr("tkt.loading") : tr("tkt.ticket"))}
            </SheetTitle>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="font-mono text-base font-semibold text-brand">{t?.ticket_number ?? "…"}</span>
              {t && (
                <StatusDot
                  label={statusText(t.status)}
                  tone={statusTone(TICKET_STATUS_DISPLAY[t.status] ?? t.status)}
                />
              )}
              {t?.priority && (
                <StatusDot label={<span className="uppercase tracking-wide">{priorityText(t.priority)}</span>} tone={priorityTone(t.priority)} />
              )}
              {categoryText && <StatusDot label={categoryText} tone="slate" />}
              {t?.district && (
                <span
                  title={`District — ${t.district_label ?? t.district}`}
                  className="inline-flex items-center gap-1 rounded-full border border-brand/20 bg-brand/5 px-2 py-0.5 text-[11px] font-semibold text-brand"
                >
                  <MapPin className="h-3 w-3" />
                  {t.district_label ?? t.district}
                </span>
              )}
              {t?.created_at && (
                <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-muted px-2.5 py-1 text-xs font-semibold text-foreground/80">
                  <CalendarDays className="h-3 w-3 text-brand" />
                  <span>{tr("petition.colSubmitted")}</span>
                  <span className="font-mono tabular-nums">{formatDateTime(t.created_at)}</span>
                </span>
              )}
            </div>
          </div>
          {t && (
            <>
              <input
                ref={attachRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,application/pdf"
                className="hidden"
                onChange={handleAttach}
              />
              <Button variant="outline" size="sm" disabled={busy} className="shrink-0" onClick={() => attachRef.current?.click()}>
                <Paperclip className="h-4 w-4" /> {tr("attach.cta")}
              </Button>
            </>
          )}
          <SheetClose className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
            <X className="h-5 w-5" />
          </SheetClose>
        </div>

        {t ? (
          <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
            {/* Preview pane — uploads at-a-glance */}
            <aside className="flex min-h-0 flex-shrink-0 flex-col border-b border-border bg-muted/30 p-5 lg:w-[52%] lg:border-b-0 lg:border-r">
              <div className="mb-3 flex flex-shrink-0 items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                <span className="grid h-6 w-6 place-items-center rounded-md bg-brand/10 text-brand">
                  <ImageIcon className="h-3.5 w-3.5" />
                </span>
                {tr("petition.citizenUploads")}
                {(t.attachments?.length ?? 0) > 0 && (
                  <span className="rounded-full bg-brand/10 px-1.5 text-[10px] font-bold text-brand">
                    {t.attachments!.length}
                  </span>
                )}
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
              <TabsList className="gap-1 bg-muted p-1">
                <TabsTrigger
                  value="details"
                  className="rounded-md px-3 font-semibold text-muted-foreground data-[state=active]:bg-card data-[state=active]:text-brand data-[state=active]:shadow-card"
                >
                  {tr("tkt.details")}
                </TabsTrigger>
                <TabsTrigger
                  value="activity"
                  className="rounded-md px-3 font-semibold text-muted-foreground data-[state=active]:bg-card data-[state=active]:text-brand data-[state=active]:shadow-card"
                >
                  {tr("tkt.activity")}
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
                {/* Assignment & SLA — the only editable fields, pinned to the top;
                    editable only while the ticket is still open. */}
                <Panel icon={UserCheck} title={tr("tkt.assignmentSla")}>
                  {(() => {
                    // Effective (staged if the PA has picked something, otherwise persisted).
                    const effDept = pendingDept ?? t.assigned_department ?? "";
                    const effDue  = pendingDue  ?? (t.due_date ?? "");
                    const dirty   = (effDept !== (t.assigned_department ?? "")) || (effDue !== (t.due_date ?? ""));
                    const ready   = !!effDept && !!effDue;
                    const showBtn = canEdit && !t.accepted_at;
                    return (
                      <>
                        {/* Priority — live-save Select. Editable while the ticket
                            is Open; kept separate from the staged Assign flow
                            because PA may correct priority independently of
                            routing (e.g. after seeing the citizen's uploads). */}
                        <div className="mb-4 space-y-1.5">
                          <Label>{tr("petition.colUrgency")}</Label>
                          <Select
                            value={t.priority ?? undefined}
                            onValueChange={(v) => patch({ priority: v })}
                            disabled={!canEdit || assigning}
                          >
                            <SelectTrigger className="h-10">
                              <SelectValue placeholder={tr("tkt.priorityPlaceholder")} />
                            </SelectTrigger>
                            <SelectContent>
                              {priorityOptions.map((o) => (
                                <SelectItem key={o.value} value={o.value}>
                                  <span className="uppercase tracking-wide">{tr(`petition.urgency${o.value.charAt(0).toUpperCase()}${o.value.slice(1)}`) || o.label}</span>
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                          {/* Assign — routes to a school department (logs "routed").
                              Once a department accepts, ownership is locked here. */}
                          <div className="space-y-1.5">
                            <Label>{tr("tkt.assign")}</Label>
                            {t.accepted_at ? (
                              <div className="flex h-9 items-center gap-2">
                                <span className="inline-flex items-center gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
                                  <Building2 className="h-3.5 w-3.5" />
                                  {t.assigned_department_label ?? t.assigned_department}
                                </span>
                                <span className="text-[11px] text-muted-foreground">{tr("tkt.accepted")}</span>
                              </div>
                            ) : (
                              <Select value={effDept || undefined} onValueChange={(v) => setPendingDept(v)} disabled={!canEdit || assigning}>
                                <SelectTrigger className="h-10"><SelectValue placeholder={tr("tkt.assignPlaceholder")} /></SelectTrigger>
                                <SelectContent>
                                  {SCHOOL_DEPARTMENTS.map((d) => <SelectItem key={d.key} value={d.key}>{d.label}</SelectItem>)}
                                </SelectContent>
                              </Select>
                            )}
                          </div>
                          <div className="space-y-1.5">
                            <Label>{tr("tkt.dueDate")}</Label>
                            {/* Button wraps the input so clicking anywhere in the
                                cell fires showPicker(). The old bare <input> only
                                responded to clicks on the tiny native calendar
                                glyph. */}
                            <button
                              type="button"
                              onClick={() => {
                                const el = dueDateRef.current;
                                if (!el) return;
                                el.focus();
                                try { (el as HTMLInputElement & { showPicker?: () => void }).showPicker?.(); } catch { /* ignore */ }
                              }}
                              disabled={!canEdit || assigning}
                              className={cn(
                                "flex h-10 w-full items-center gap-2 rounded-md border border-input bg-background px-3 text-left text-sm transition-colors",
                                "hover:bg-muted/40 focus:outline-none focus:ring-2 focus:ring-ring",
                                "disabled:cursor-not-allowed disabled:opacity-60",
                              )}
                            >
                              <CalendarDays className="h-4 w-4 shrink-0 text-muted-foreground" />
                              <span className={cn("truncate", effDue ? "font-mono text-foreground" : "text-muted-foreground")}>
                                {effDue ? formatDateTime(effDue) : tr("tkt.dueDatePlaceholder")}
                              </span>
                              <Input
                                ref={dueDateRef}
                                type="datetime-local"
                                value={toLocalDateTimeInput(effDue) || ""}
                                onChange={(e) => setPendingDue(fromLocalDateTimeInput(e.target.value) || "")}
                                className="pointer-events-none absolute h-0 w-0 border-0 p-0 opacity-0"
                                tabIndex={-1} aria-hidden="true"
                              />
                            </button>
                          </div>
                        </div>

                        {showBtn && (
                          <div className="mt-4 flex flex-col gap-2">
                            <Button
                              size="sm"
                              onClick={handleAssign}
                              disabled={!ready || !dirty || assigning}
                              className="w-full sm:w-auto sm:self-end"
                            >
                              {assigning ? (
                                <><Clock className="mr-1.5 h-3.5 w-3.5 animate-spin" /> {tr("tkt.assigning")}</>
                              ) : (
                                <><Send className="mr-1.5 h-3.5 w-3.5" /> {tr("tkt.assignCta")}</>
                              )}
                            </Button>
                            {!ready && (
                              <p className="text-[11px] text-muted-foreground sm:text-right">{tr("tkt.assignHint")}</p>
                            )}
                          </div>
                        )}

                        {!isOpen && (
                          <p className="mt-3 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                            <Lock className="h-3 w-3" /> {tr("tkt.editOnlyOpen")}
                          </p>
                        )}
                      </>
                    );
                  })()}
                </Panel>

                {/* Overview — read-only case facts, incl. status + priority.
                    District lives here (moved out of the Assignment panel) so
                    it doesn't get mixed up with the workflow-critical
                    department + SLA fields the PA has to fill in. */}
                <SectionCard icon={ClipboardList} title={tr("petition.grpOverview")}>
                  <OverviewGrid>
                    <OverviewItem icon={User} label={tr("petition.colName")} value={t.citizen_name} />
                    <OverviewItem icon={Phone} label={tr("petition.colPhone")} value={t.citizen_mobile} mono />
                    <OverviewItem icon={Tag} label={tr("petition.colCategory")} value={categoryText} />
                    <OverviewItem
                      icon={GitBranch}
                      label={tr("petition.colStatus")}
                      value={<StatusDot label={statusText(t.status)} tone={statusTone(TICKET_STATUS_DISPLAY[t.status] ?? t.status)} />}
                    />
                    <OverviewItem
                      icon={BarChart3}
                      label={tr("petition.colUrgency")}
                      value={t.priority ? <StatusDot label={<span className="uppercase tracking-wide">{priorityText(t.priority)}</span>} tone={priorityTone(t.priority)} /> : null}
                    />
                    {t.ministry_label && (
                      <OverviewItem icon={Landmark} label={tr("petition.fMinistry")} value={t.ministry_label} />
                    )}
                    <OverviewItem icon={CalendarDays} label={tr("tickets.dateRange")} value={formatDate(t.created_at)} />
                  </OverviewGrid>

                  {/* District — moved here from Assignment. Still editable while
                      the ticket is Open (AI extracts when confident; PA can
                      override or clear).  Empty selection sends "" which the
                      backend maps to NULL. */}
                  <div className="mt-4 space-y-1.5">
                    <Label className="flex items-center gap-1.5">
                      <MapPin className="h-3.5 w-3.5" />
                      {tr("tkt.district")}
                      {!t.district && (
                        <span className="rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-700">
                          {tr("tkt.districtNotIdentified")}
                        </span>
                      )}
                    </Label>
                    <Select
                      value={t.district ?? DISTRICT_CLEAR}
                      onValueChange={(v) => patch({ district: v === DISTRICT_CLEAR ? "" : v })}
                      disabled={!canEdit}
                    >
                      <SelectTrigger className="h-10">
                        <SelectValue placeholder={tr("tkt.districtPlaceholder")} />
                      </SelectTrigger>
                      <SelectContent className="max-h-72">
                        <SelectItem value={DISTRICT_CLEAR}>
                          <span className="text-muted-foreground">{tr("tkt.districtNone")}</span>
                        </SelectItem>
                        {TN_DISTRICTS.map((d) => (
                          <SelectItem key={d.key} value={d.key}>{d.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </SectionCard>

                {/* Summary — the briefing */}
                {(t.summary || t.description) && (
                  <SectionCard
                    icon={Sparkles}
                    title={tr("petition.colSummary")}
                    right={!t.summary ? (
                      <span className="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400" />
                        Generating
                      </span>
                    ) : undefined}
                  >
                    <div>
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
                            {tr("petition.colAsk")}
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
                              {tr("petition.keyDetails")}
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
                  </SectionCard>
                )}

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
                    placeholder={tr("evt.commentPlaceholder")}
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
                  <div className="py-10 text-center text-sm italic text-muted-foreground">{tr("evt.noActivity")}</div>
                ) : (
                  <ol className="space-y-1">
                    {t.events.map((e, idx) => {
                      const Icon = EVENT_ICON[e.event_type] ?? Clock;
                      const last = idx === t.events.length - 1;
                      const title = eventTitle(e.event_type, tr);
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
                    {activeAction === "close" ? tr("tkt.closeTicket")
                      : activeAction === "reopen" ? tr("tkt.reopenTicket")
                      : tr("tkt.revertTicket")}
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
                {activeAction === "revert" && (
                  <div className="space-y-2">
                    <div className="rounded-md border border-amber-200 bg-amber-50/70 p-2.5 text-[12.5px] text-amber-900">
                      <b>{tr("tkt.revertWarnTitle")}</b> {tr("tkt.revertWarnBody")}
                    </div>
                    <Textarea value={revertReason} onChange={(e) => setRevertReason(e.target.value)}
                      placeholder={tr("tkt.revertPlaceholder")} rows={3} />
                    <ActionSubmit busy={busy} label={tr("tkt.revertCta")}
                      disabled={revertReason.trim().length < 4}
                      onClick={() => runAction("revert", { reason: revertReason.trim() })} />
                  </div>
                )}
              </div>
            )}

            {/* ── Footer actions ──────────────────────────────────────── */}
            {/* Resolve + Forward belong to the department workspace, not the PA
                monitor — the PA only assigns, closes, reopens, and comments. */}
            <div className="flex flex-wrap items-center gap-2 border-t border-border bg-card px-6 py-3">
              {/* Close is a PA-only sign-off after the department has already
                  resolved the ticket. Showing it on open / assigned /
                  in_progress led PAs to close tickets that hadn't been worked
                  yet — Revert or Forward is the right action for those. */}
              {isResolved && (
                <Button size="sm" disabled={busy} onClick={() => setActiveAction(activeAction === "close" ? null : "close")}>
                  <Lock className="h-4 w-4" /> {tr("tkt.close")}
                </Button>
              )}
              {/* Reopen only shows on already-closed tickets — an open ticket has
                  nothing to reopen, and showing the button next to Close was
                  causing PAs to mis-click and immediately reopen what they just
                  closed. */}
              {isClosed && (
                <Button variant="outline" size="sm" disabled={busy} className="border-brand/40 text-brand hover:bg-brand/5 hover:text-brand" onClick={() => setActiveAction(activeAction === "reopen" ? null : "reopen")}>
                  <RotateCcw className="h-4 w-4" /> {tr("tkt.reopen")}
                </Button>
              )}
              {/* Revert to Petition Review — only when the ticket is still OPEN.
                  Past that (assigned / accepted / in progress / closed) a
                  department may have invested work; revert would silently
                  drop it. For those states, Close is the correct action. */}
              {t.status === "open" && (
                <Button variant="outline" size="sm" disabled={busy}
                  className="border-amber-300 text-amber-700 hover:bg-amber-50 hover:text-amber-800"
                  onClick={() => setActiveAction(activeAction === "revert" ? null : "revert")}>
                  <Undo2 className="h-4 w-4" /> {tr("tkt.revert")}
                </Button>
              )}
              <Button variant="outline" size="sm" className="ml-auto border-brand/40 text-brand hover:bg-brand/5 hover:text-brand" onClick={() => setTab("activity")}>
                <MessageSquare className="h-4 w-4" /> {tr("tkt.comment")}
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
    accent === "violet"  ? "text-blue-600"  : "text-foreground";
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

// Localized event title — uses the shared `evt.*` keys so the timeline switches
// with the global language; falls back to the English pretty-print.
function eventTitle(eventType: string, tr: (k: string) => string): string {
  const key = `evt.${eventType}`;
  const localized = tr(key);
  return localized === key ? formatEventTitle(eventType) : localized;
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

function ActionSubmit({ busy, label, onClick, disabled }: { busy: boolean; label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <div className="flex justify-end">
      <Button size="sm" onClick={onClick} disabled={busy || disabled}>
        <Send className="h-3.5 w-3.5" /> {busy ? "Working…" : label}
      </Button>
    </div>
  );
}
