"use client";

import { useState, useRef, type ChangeEvent } from "react";
import { toast } from "sonner";
import {
  X, Hash, User, Phone, Flag, Building2, Landmark, ShieldCheck, CalendarClock,
  Check, Forward, Send, Loader2, Paperclip, CheckCircle2, MessageSquare, UserCheck,
  GitBranch, Sparkles, FileSignature, Inbox, ArrowRight, RotateCcw,
  Image as ImageIcon, FileCheck2, ClipboardList, Tag, BarChart3,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  SectionCard, OverviewGrid, OverviewItem, StatusDot, statusTone, priorityTone,
} from "@/components/ui/detail-primitives";
import { InlineAttachmentPreview } from "@/components/ui/inline-attachment-preview";
import type { GalleryAttachment } from "@/components/ui/attachment-gallery";
import { useDeptLang } from "../_lib/i18n";
import {
  acceptTicket, forwardTicket, progressTicket, resolveTicket, uploadDeptTicketAttachment,
  slaFor, formatRemaining,
  type DeptTicketDetail, type DeptOption,
} from "../_lib/api";

interface Props {
  detail: DeptTicketDetail;
  departments: DeptOption[];
  myDept: string;               // current session's department key
  onClose: () => void;
  onDone: () => void;
}

const STATUS_LABEL: Record<string, string> = {
  assigned: "To accept", awaiting_department: "To accept", in_progress: "In progress",
  resolved: "Resolved", closed: "Closed", reopened: "Reopened", forwarded_to_dept: "Forwarded",
};

function galleryType(mime?: string): GalleryAttachment["type"] {
  if (mime?.startsWith("image/")) return "IMAGE";
  if (mime?.startsWith("video/")) return "VIDEO";
  if (mime?.startsWith("audio/")) return "AUDIO";
  return "DOCUMENT";
}

export default function TicketDetail({ detail, departments, myDept, onClose, onDone }: Props) {
  const { t, lang } = useDeptLang();
  const [tab, setTab] = useState("details");
  const attachRef = useRef<HTMLInputElement>(null);
  const [attaching, setAttaching] = useState(false);

  async function handleAttach(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";               // allow re-picking the same file
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { toast.error(t("attach.tooLarge")); return; }
    setAttaching(true);
    try {
      await uploadDeptTicketAttachment(detail.id, file);
      toast.success(t("attach.added"));
      onDone();                        // refresh so the new file shows
    } catch (err) {
      toast.error((err as Error).message || t("attach.failed"));
    } finally {
      setAttaching(false);
    }
  }

  const toGallery = (a: DeptTicketDetail["attachments"][number]): GalleryAttachment => ({
    name: a.name || "attachment", url: a.url, type: galleryType(a.mime),
  });
  const petitionAtt = detail.attachments.filter((a) => a.kind !== "resolution").map(toGallery);
  const resAtt      = detail.attachments.filter((a) => a.kind === "resolution").map(toGallery);

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/40" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex h-full w-full max-w-[1500px] flex-col bg-background shadow-card-lg sm:max-w-[97vw] lg:max-w-[1500px]"
      >
        {/* Header */}
        <div className="flex items-start gap-3 border-b border-border bg-card px-6 py-4">
          <div className="min-w-0 flex-1">
            <h2 className="text-xl font-bold leading-snug tracking-tight text-foreground">
              {detail.citizen_ask || "Petition"}
            </h2>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="font-mono text-base font-semibold text-brand">{detail.ticket_number}</span>
              <StatusDot label={STATUS_LABEL[detail.status] ?? detail.status} tone={statusTone(detail.status)} />
              {detail.priority && (
                <StatusDot label={<span className="uppercase tracking-wide">{detail.priority}</span>} tone={priorityTone(detail.priority)} />
              )}
              {detail.category_label && <StatusDot label={detail.category_label} tone="slate" />}
            </div>
            <div className="mt-1.5 flex items-center gap-1.5 text-[12px] text-muted-foreground">
              <User className="h-3 w-3" />
              <span className="font-semibold text-foreground/70">{detail.citizen_name}</span>
              <span>·</span>
              <span className="font-mono">{detail.citizen_mobile}</span>
              {detail.token && (<><span>·</span><span className="font-mono">{detail.token}</span></>)}
            </div>
          </div>

          <input
            ref={attachRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,application/pdf"
            className="hidden"
            onChange={handleAttach}
          />
          <Button variant="outline" size="sm" disabled={attaching} className="flex-shrink-0" onClick={() => attachRef.current?.click()}>
            <Paperclip className="mr-1.5 h-4 w-4" /> {t("attach.cta")}
          </Button>
          <button
            onClick={onClose}
            className="grid h-8 w-8 flex-shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body — two-pane: uploads preview (left) + tabs (right) */}
        <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
          {/* Preview pane */}
          <aside className="flex min-h-0 flex-shrink-0 flex-col border-b border-border bg-muted/30 p-5 lg:w-[54%] lg:border-b-0 lg:border-r">
            <div className="mb-3 flex flex-shrink-0 items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              <span className="grid h-6 w-6 place-items-center rounded-md bg-brand/10 text-brand">
                <ImageIcon className="h-3.5 w-3.5" />
              </span>
              {t("detail.attachments")}
              {petitionAtt.length > 0 && (
                <span className="rounded-full bg-brand/10 px-1.5 text-[10px] font-bold text-brand">{petitionAtt.length}</span>
              )}
            </div>
            <div className="min-h-0 flex-1">
              <InlineAttachmentPreview attachments={petitionAtt} />
            </div>

            {resAtt.length > 0 && (
              <div className="mt-4 flex-shrink-0 border-t border-border pt-4">
                <div className="mb-3 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-emerald-600">
                  <FileCheck2 className="h-3.5 w-3.5" /> {t("detail.proofs")}
                  <span className="rounded-full bg-emerald-100 px-1.5 text-[10px] font-bold text-emerald-700">{resAtt.length}</span>
                </div>
                <InlineAttachmentPreview attachments={resAtt} />
              </div>
            )}
          </aside>

          {/* Right — tabs + action bar */}
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col">
              <div className="border-b border-border bg-card px-6 pt-3">
                <TabsList className="gap-1 bg-muted p-1">
                  <TabsTrigger
                    value="details"
                    className="rounded-md px-3 font-semibold text-muted-foreground data-[state=active]:bg-card data-[state=active]:text-brand data-[state=active]:shadow-card"
                  >
                    {t("detail.overview")}
                  </TabsTrigger>
                  <TabsTrigger
                    value="activity"
                    className="rounded-md px-3 font-semibold text-muted-foreground data-[state=active]:bg-card data-[state=active]:text-brand data-[state=active]:shadow-card"
                  >
                    {t("detail.timeline")}
                    {detail.events.length > 0 && (
                      <span className="ml-1.5 rounded-full bg-background px-1.5 text-[10px] font-bold text-muted-foreground">{detail.events.length}</span>
                    )}
                  </TabsTrigger>
                </TabsList>
              </div>

              {/* Details */}
              <TabsContent value="details" className="m-0 min-h-0 flex-1 overflow-y-auto">
                <div className="space-y-4 p-6">
                  <OverviewSection detail={detail} />
                  <SummarySection detail={detail} showTa={lang === "ta"} />
                  {detail.resolution_notes && (
                    <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
                      <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-emerald-700">{t("detail.proofs")}</div>
                      <p className="whitespace-pre-wrap text-sm text-emerald-900">{detail.resolution_notes}</p>
                    </div>
                  )}
                </div>
              </TabsContent>

              {/* Activity */}
              <TabsContent value="activity" className="m-0 min-h-0 flex-1 overflow-y-auto">
                <div className="p-6">
                  <Timeline detail={detail} />
                </div>
              </TabsContent>
            </Tabs>

            {/* Action bar */}
            <ActionBar detail={detail} departments={departments} myDept={myDept} onDone={onDone} />
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Overview ────────────────────────────────────────────────────────────────
function OverviewSection({ detail }: { detail: DeptTicketDetail }) {
  const { t } = useDeptLang();
  return (
    <SectionCard icon={ClipboardList} title={t("detail.overview")}>
      <OverviewGrid>
        <OverviewItem icon={Hash}  label={t("field.ticket")}   value={detail.ticket_number} mono />
        <OverviewItem icon={User}  label={t("field.citizen")}  value={detail.citizen_name} />
        <OverviewItem icon={Phone} label={t("field.mobile")}   value={detail.citizen_mobile} mono />
        <OverviewItem icon={Tag}   label={t("field.category")} value={detail.category_label} />
        <OverviewItem
          icon={BarChart3}
          label={t("field.priority")}
          value={detail.priority ? <StatusDot label={<span className="uppercase tracking-wide">{detail.priority}</span>} tone={priorityTone(detail.priority)} /> : null}
        />
        {detail.ministry_label && (
          <OverviewItem icon={Landmark} label={t("field.ministry")} value={detail.ministry_label} />
        )}
        <OverviewItem icon={ShieldCheck} label={t("field.sla")} value={<SlaBar created_at={detail.created_at} priority={detail.priority} />} />
        <OverviewItem icon={CalendarClock} label={t("field.created")} value={new Date(detail.created_at).toLocaleString()} />
      </OverviewGrid>
    </SectionCard>
  );
}

function SlaBar({ created_at, priority }: { created_at: string; priority: string | null }) {
  const sla = slaFor(created_at, priority);
  if (!sla) return <span className="text-muted-foreground">No SLA</span>;
  const clamped = Math.min(100, sla.pct_used);
  const barColor = sla.breached ? "bg-red-500" : sla.pct_used > 75 ? "bg-amber-500" : "bg-emerald-500";
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[11px] font-semibold">
        <span className={cn(sla.breached ? "text-red-700" : "text-foreground/80")}>{formatRemaining(sla.remaining_hours)}</span>
        <span className="font-mono text-muted-foreground">{Math.round(sla.pct_used)}%</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div className={cn("h-full transition-[width]", barColor)} style={{ width: `${clamped}%` }} />
      </div>
    </div>
  );
}

// ── Summary ─────────────────────────────────────────────────────────────────
function SummarySection({ detail, showTa }: { detail: DeptTicketDetail; showTa: boolean }) {
  const { t } = useDeptLang();
  const summary = showTa ? (detail.summary_ta ?? detail.summary) : detail.summary;
  const ask     = showTa ? (detail.citizen_ask_ta ?? detail.citizen_ask) : detail.citizen_ask;
  const details = showTa ? (detail.key_details_ta ?? detail.key_details) : detail.key_details;

  return (
    <SectionCard icon={Sparkles} title={t("detail.summary")}>
      {ask && (
        <div className="mb-4 rounded-r-lg border-l-[3px] border-brand bg-brand/[0.04] py-3 pl-4 pr-3">
          <div className="mb-1 text-[10px] font-bold uppercase tracking-[0.16em] text-brand">{t("detail.ask")}</div>
          <p className="text-[15px] font-semibold leading-relaxed text-foreground">{ask}</p>
        </div>
      )}
      {summary ? (
        <div className="whitespace-pre-wrap text-[14px] leading-relaxed text-foreground/85">{summary}</div>
      ) : (
        <p className="text-sm italic text-muted-foreground">Summary is being prepared…</p>
      )}
      {details && details.length > 0 && (
        <div className="mt-4 border-t border-border pt-4">
          <div className="mb-2 text-[10.5px] font-bold uppercase tracking-wider text-foreground/70">{t("detail.details")}</div>
          <ul className="space-y-1.5">
            {details.map((d, i) => (
              <li key={i} className="flex gap-2.5 text-[14px] text-foreground/85">
                <span className="mt-[8px] h-1.5 w-1.5 shrink-0 rounded-full bg-brand/60" />
                <span>{d}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </SectionCard>
  );
}

// ── Timeline ────────────────────────────────────────────────────────────────
const EVENT_ICON: Record<string, React.ElementType> = {
  created: FileSignature, petition_submitted: Inbox, ai_summarised: Sparkles,
  routed_to_department: Building2, department_accepted: UserCheck,
  department_forwarded: ArrowRight, progress_update: Send, resolved: CheckCircle2,
  closed: ShieldCheck, reopened: RotateCcw, forwarded_to_dept: ArrowRight,
  status_changed: GitBranch, comment_added: MessageSquare,
};
const EVENT_LABEL: Record<string, string> = {
  created: "Ticket created", petition_submitted: "Petition submitted", ai_summarised: "AI summarised",
  routed_to_department: "Routed to department", department_accepted: "Accepted by department",
  department_forwarded: "Forwarded to another department", progress_update: "Progress update",
  resolved: "Resolved", closed: "Closed", reopened: "Reopened", forwarded_to_dept: "Forwarded out",
  status_changed: "Status changed", comment_added: "Comment",
};

function Timeline({ detail }: { detail: DeptTicketDetail }) {
  const { t } = useDeptLang();
  if (!detail.events || detail.events.length === 0) {
    return <div className="py-10 text-center text-sm italic text-muted-foreground">{t("detail.noEvents")}</div>;
  }
  return (
    <ol className="space-y-1">
      {detail.events.map((e, idx) => {
        const Icon = EVENT_ICON[e.type] ?? GitBranch;
        const last = idx === detail.events.length - 1;
        const label = EVENT_LABEL[e.type] ?? e.type.replace(/_/g, " ");
        return (
          <li key={idx} className="flex gap-3">
            <div className="flex flex-col items-center">
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-brand/10 text-brand ring-1 ring-brand/15">
                <Icon className="h-3.5 w-3.5" />
              </span>
              {!last && <span className="my-1 w-px flex-1 bg-border" />}
            </div>
            <div className="min-w-0 flex-1 pb-4">
              <div className="text-sm font-medium text-foreground">{label}</div>
              <div className="text-[11px] text-muted-foreground">
                by <b className="font-semibold text-foreground/80">{e.actor}</b> · {new Date(e.at).toLocaleString()}
              </div>
              {e.note && (
                <p className="mt-1 whitespace-pre-wrap rounded-lg bg-muted/60 p-2 text-[13px] text-foreground/80">{e.note}</p>
              )}
              {typeof e.payload?.to === "string" && (
                <div className="mt-1 inline-flex items-center gap-1 rounded-md border border-cyan-200 bg-cyan-50 px-2 py-0.5 text-[11px] font-semibold text-cyan-700">
                  <ArrowRight className="h-3 w-3" /> {String(e.payload.to).replace(/_/g, " ")}
                </div>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

// ── Action bar ──────────────────────────────────────────────────────────────
type Mode = "" | "forward" | "progress" | "resolve";

function ActionBar({
  detail, departments, myDept, onDone,
}: {
  detail: DeptTicketDetail; departments: DeptOption[]; myDept: string; onDone: () => void;
}) {
  const { t } = useDeptLang();
  const [mode, setMode] = useState<Mode>("");
  const [busy, setBusy] = useState(false);

  const s = detail.status;
  const ownedByOther = detail.department !== myDept;

  if (ownedByOther) {
    const currentDept = departments.find((d) => d.key === detail.department)?.label ?? detail.department ?? "another department";
    return (
      <div className="border-t border-border bg-card px-6 py-4">
        <div className="flex items-start gap-3 rounded-xl border border-dashed border-border bg-muted/30 p-4">
          <ArrowRight className="mt-0.5 h-4 w-4 flex-shrink-0 text-muted-foreground" />
          <div className="text-sm text-muted-foreground">
            You forwarded this ticket to <b className="text-foreground">{currentDept}</b>. It is theirs to act on now — this view is read-only for your audit trail.
          </div>
        </div>
      </div>
    );
  }

  async function run(action: () => Promise<void>, successMsg: string) {
    setBusy(true);
    try {
      await action();
      toast.success(successMsg);
      onDone();
    } catch (e) {
      toast.error("Action failed", { description: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border-t border-border bg-card px-6 py-4">
      {mode === "" && (
        <>
          {(s === "assigned" || s === "awaiting_department") && (
            <div className="flex flex-wrap items-center gap-2">
              <Button className="aurora-primary flex-1 text-white" disabled={busy} onClick={() => run(() => acceptTicket(detail.id), "Accepted")}>
                {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Check className="mr-1.5 h-4 w-4" />}
                {t("action.accept")}
              </Button>
              <Button variant="outline" onClick={() => setMode("forward")}>
                <Forward className="mr-1.5 h-4 w-4" /> {t("action.forward")}
              </Button>
            </div>
          )}

          {s === "in_progress" && (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                // !bg-none kills the aurora-primary blue GRADIENT (background-image);
                // without it a bg-* colour is painted under the gradient and the
                // button still renders blue.
                className="flex-1 border-transparent !bg-none !bg-emerald-600 text-white hover:!bg-emerald-700"
                onClick={() => setMode("progress")}
              >
                <Send className="mr-1.5 h-4 w-4" /> {t("action.updateProgress")}
              </Button>
              <Button variant="outline" onClick={() => setMode("forward")}>
                <Forward className="mr-1.5 h-4 w-4" /> {t("action.forward")}
              </Button>
              <Button className="aurora-primary flex-1 text-white" onClick={() => setMode("resolve")}>
                <CheckCircle2 className="mr-1.5 h-4 w-4" /> {t("action.resolve")}
              </Button>
            </div>
          )}

          {["resolved", "closed", "forwarded_to_dept"].includes(s) && (
            <div className="rounded-lg border border-dashed border-border p-3 text-center text-sm text-muted-foreground">
              {t("state.done")} <b className="mx-1 text-foreground">{s.replace(/_/g, " ")}</b>. {t("state.doneAfter")}
            </div>
          )}
        </>
      )}

      {mode === "forward" && (
        <ForwardForm
          departments={departments}
          currentDept={detail.department}
          busy={busy}
          onCancel={() => setMode("")}
          onSubmit={(to, reason) => run(() => forwardTicket(detail.id, to, reason), "Forwarded")}
        />
      )}

      {mode === "progress" && (
        <ProgressForm
          initialPct={detail.progress_pct}
          busy={busy}
          onCancel={() => setMode("")}
          onSubmit={(note, pct) => run(() => progressTicket(detail.id, note, pct), "Progress posted")}
        />
      )}

      {mode === "resolve" && (
        <ResolveForm
          busy={busy}
          onCancel={() => setMode("")}
          onSubmit={(remarks, files) => run(() => resolveTicket(detail.id, remarks, files), "Resolved")}
        />
      )}
    </div>
  );
}

// ── Forward form ────────────────────────────────────────────────────────────
function ForwardForm({
  departments, currentDept, busy, onCancel, onSubmit,
}: {
  departments: DeptOption[]; currentDept: string | null; busy: boolean;
  onCancel: () => void; onSubmit: (to: string, reason: string) => void;
}) {
  const { t } = useDeptLang();
  const [to, setTo] = useState("");
  const [reason, setReason] = useState("");
  const opts = departments.filter((d) => d.key !== currentDept);
  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label>{t("form.forwardTo")}</Label>
        <Select value={to} onValueChange={setTo}>
          <SelectTrigger><SelectValue placeholder={t("form.forwardTo")} /></SelectTrigger>
          <SelectContent>
            {opts.map((d) => <SelectItem key={d.key} value={d.key}>{d.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label>{t("form.reason")}</Label>
        <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
      </div>
      <div className="flex gap-2">
        <Button variant="outline" onClick={onCancel}>{t("action.cancel")}</Button>
        <Button className="aurora-primary flex-1 text-white" disabled={busy || !to || !reason.trim()} onClick={() => onSubmit(to, reason.trim())}>
          {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Forward className="mr-1.5 h-4 w-4" />}
          {t("action.forwardWith")}
        </Button>
      </div>
    </div>
  );
}

function ProgressForm({
  initialPct, busy, onCancel, onSubmit,
}: {
  initialPct: number; busy: boolean;
  onCancel: () => void; onSubmit: (note: string, pct: number) => void;
}) {
  const { t } = useDeptLang();
  const [note, setNote] = useState("");
  const [pct, setPct]   = useState(initialPct || 0);
  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label>{t("form.note")}</Label>
        <Textarea rows={6} value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label>{t("form.progress")}</Label>
          <span className="font-mono text-sm font-bold text-brand">{pct}%</span>
        </div>
        <input type="range" min={0} max={99} value={pct} onChange={(e) => setPct(Number(e.target.value))} className="w-full accent-brand" />
      </div>
      <div className="flex gap-2">
        <Button variant="outline" onClick={onCancel}>{t("action.cancel")}</Button>
        <Button className="aurora-primary flex-1 text-white" disabled={busy || !note.trim()} onClick={() => onSubmit(note.trim(), pct)}>
          {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Send className="mr-1.5 h-4 w-4" />}
          {t("action.post")}
        </Button>
      </div>
    </div>
  );
}

function ResolveForm({
  busy, onCancel, onSubmit,
}: {
  busy: boolean; onCancel: () => void; onSubmit: (remarks: string, files: File[]) => void;
}) {
  const { t } = useDeptLang();
  const [remarks, setRemarks] = useState("");
  const [files, setFiles]     = useState<File[]>([]);
  const canSubmit = remarks.trim() && files.length > 0;
  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label>{t("form.remarks")}</Label>
        <Textarea rows={3} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
      </div>
      <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-dashed border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground hover:bg-muted/60">
        <Paperclip className="h-4 w-4" />
        <span className="flex-1">
          {files.length > 0 ? `${files.length} ${t("form.filesSelected")}` : t("form.attachProof")}
        </span>
        <input type="file" multiple accept="image/*,application/pdf" onChange={(e) => setFiles(Array.from(e.target.files ?? []))} className="hidden" />
      </label>
      <div className="flex gap-2">
        <Button variant="outline" onClick={onCancel}>{t("action.cancel")}</Button>
        <Button className="aurora-primary flex-1 text-white" disabled={busy || !canSubmit} onClick={() => onSubmit(remarks.trim(), files)}>
          {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-1.5 h-4 w-4" />}
          {t("action.resolve")}
        </Button>
      </div>
    </div>
  );
}
