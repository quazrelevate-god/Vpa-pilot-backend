"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  X, Hash, User, Phone, Flag, Building2, Landmark, ShieldCheck, Clock, CalendarClock,
  Check, Forward, Send, Loader2, Paperclip, CheckCircle2, MessageSquare, UserCheck,
  GitBranch, Sparkles, FileSignature, Inbox, ArrowRight, RotateCcw, Image as ImageIcon,
  FileText, AlertTriangle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useDeptLang } from "../_lib/i18n";
import {
  acceptTicket, forwardTicket, progressTicket, resolveTicket,
  slaFor, formatRemaining,
  type DeptTicketDetail, type DeptOption,
} from "../_lib/api";
import { PriorityPill, StatusPill, SlaPill, DrawerCard, KV } from "./parts";

interface Props {
  detail: DeptTicketDetail;
  departments: DeptOption[];
  myDept: string;               // current session's department key
  onClose: () => void;
  onDone: () => void;
}

export default function TicketDetail({ detail, departments, myDept, onClose, onDone }: Props) {
  const { t, lang } = useDeptLang();
  const [showTa, setShowTa] = useState(lang === "ta");

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/40" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex h-full w-full max-w-[720px] flex-col bg-background shadow-card-lg"
      >
        {/* Header */}
        <div className="flex items-start gap-3 border-b border-border bg-card px-6 py-4">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs font-bold text-brand">{detail.ticket_number}</span>
              {detail.priority && <PriorityPill p={detail.priority} />}
              <StatusPill s={detail.status} />
              <SlaPill created_at={detail.created_at} priority={detail.priority} />
            </div>
            <h2 className="mt-2 text-lg font-bold leading-tight text-foreground">
              {detail.citizen_ask || "Petition"}
            </h2>
            <div className="mt-1 flex items-center gap-1.5 text-[12px] text-muted-foreground">
              <User className="h-3 w-3" />
              <span className="font-semibold text-foreground/70">{detail.citizen_name}</span>
              <span>·</span>
              <span className="font-mono">{detail.citizen_mobile}</span>
              {detail.token && (
                <>
                  <span>·</span>
                  <span className="font-mono">{detail.token}</span>
                </>
              )}
            </div>
          </div>

          <div className="flex flex-shrink-0 items-center gap-1.5">
            <button
              onClick={() => setShowTa((v) => !v)}
              className={cn(
                "rounded-md border border-border bg-card px-2.5 py-1 text-[11px] font-semibold shadow-card transition-colors",
                showTa ? "bg-brand text-white" : "text-muted-foreground hover:bg-muted",
              )}
              title={showTa ? t("detail.showEn") : t("detail.showTa")}
            >
              {showTa ? "தமிழ்" : "EN"}
            </button>
            <button
              onClick={onClose}
              className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Body — scrollable */}
        <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
          <OverviewCard detail={detail} />
          <SummaryCard detail={detail} showTa={showTa} />
          {detail.attachments.filter((a) => a.kind !== "resolution").length > 0 && (
            <AttachmentsCard title={t("detail.attachments")} attachments={detail.attachments.filter((a) => a.kind !== "resolution")} />
          )}
          {detail.attachments.filter((a) => a.kind === "resolution").length > 0 && (
            <AttachmentsCard title={t("detail.proofs")} attachments={detail.attachments.filter((a) => a.kind === "resolution")} icon={CheckCircle2} />
          )}
          <TimelineCard detail={detail} />
        </div>

        {/* Action bar */}
        <ActionBar
          detail={detail}
          departments={departments}
          myDept={myDept}
          onDone={onDone}
        />
      </div>
    </div>
  );
}

// ── Overview ────────────────────────────────────────────────────────────────
function OverviewCard({ detail }: { detail: DeptTicketDetail }) {
  const { t } = useDeptLang();
  return (
    <DrawerCard icon={Hash} title={t("detail.overview")}>
      <dl className="grid grid-cols-1 gap-x-8 gap-y-5 sm:grid-cols-2">
        <KV icon={Hash}     label={t("field.ticket")}   value={<span className="font-mono">{detail.ticket_number}</span>} />
        <KV icon={User}     label={t("field.citizen")}  value={detail.citizen_name} />
        <KV icon={Phone}    label={t("field.mobile")}   value={<span className="font-mono">{detail.citizen_mobile}</span>} />
        <KV icon={Flag}     label={t("field.priority")} value={detail.priority ? <PriorityPill p={detail.priority} /> : null} />
        {detail.category_label && (
          <KV icon={Building2} label={t("field.category")} value={detail.category_label} />
        )}
        {detail.ministry_label && (
          <KV icon={Landmark}  label={t("field.ministry")}  value={detail.ministry_label} />
        )}
        <KV
          icon={ShieldCheck}
          label={t("field.sla")}
          value={<SlaBar created_at={detail.created_at} priority={detail.priority} />}
        />
        <KV
          icon={CalendarClock}
          label={t("field.created")}
          value={new Date(detail.created_at).toLocaleString()}
        />
      </dl>
    </DrawerCard>
  );
}

function SlaBar({ created_at, priority }: { created_at: string; priority: string | null }) {
  const sla = slaFor(created_at, priority);
  if (!sla) return <span className="text-muted-foreground">No SLA</span>;
  const clamped = Math.min(100, sla.pct_used);
  const barColor =
    sla.breached ? "bg-red-500" :
    sla.pct_used > 75 ? "bg-amber-500" : "bg-emerald-500";
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[11px] font-semibold">
        <span className={cn(sla.breached ? "text-red-700" : "text-foreground/80")}>
          {formatRemaining(sla.remaining_hours)}
        </span>
        <span className="font-mono text-muted-foreground">{Math.round(sla.pct_used)}%</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div className={cn("h-full transition-[width]", barColor)} style={{ width: `${clamped}%` }} />
      </div>
    </div>
  );
}

// ── Summary card ────────────────────────────────────────────────────────────
function SummaryCard({ detail, showTa }: { detail: DeptTicketDetail; showTa: boolean }) {
  const { t } = useDeptLang();
  const summary = showTa ? (detail.summary_ta ?? detail.summary) : detail.summary;
  const ask     = showTa ? (detail.citizen_ask_ta ?? detail.citizen_ask) : detail.citizen_ask;
  const details = showTa ? (detail.key_details_ta ?? detail.key_details) : detail.key_details;

  if (!summary && !ask && (!details || details.length === 0)) {
    return (
      <DrawerCard icon={Sparkles} title={t("detail.summary")}>
        <p className="text-sm italic text-muted-foreground">Summary is being prepared…</p>
      </DrawerCard>
    );
  }

  return (
    <DrawerCard icon={Sparkles} title={t("detail.summary")}>
      {ask && (
        <div className="mb-4 rounded-r-lg border-l-[3px] border-brand bg-brand/5 py-3 pl-4 pr-3">
          <div className="mb-1 text-[10px] font-bold uppercase tracking-[0.16em] text-brand">
            {t("detail.ask")}
          </div>
          <p className="text-[15px] font-semibold leading-relaxed text-foreground">{ask}</p>
        </div>
      )}

      {summary && (
        <div className="mb-4 whitespace-pre-wrap text-[14px] leading-relaxed text-foreground/85">
          {summary}
        </div>
      )}

      {details && details.length > 0 && (
        <div>
          <div className="mb-2 text-[10.5px] font-bold uppercase tracking-wider text-foreground/70">
            {t("detail.details")}
          </div>
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
    </DrawerCard>
  );
}

// ── Attachments ─────────────────────────────────────────────────────────────
function AttachmentsCard({
  title, attachments, icon,
}: {
  title: string;
  attachments: DeptTicketDetail["attachments"];
  icon?: React.ElementType;
}) {
  return (
    <DrawerCard icon={icon ?? Paperclip} title={title}>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {attachments.map((a, i) => {
          const isImg = a.mime?.startsWith("image/");
          return (
            <a
              key={i}
              href={a.url}
              target="_blank"
              rel="noreferrer"
              className="group overflow-hidden rounded-xl border border-border bg-muted/30 transition-colors hover:border-brand/40"
            >
              {isImg ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={a.url} alt={a.name ?? ""} className="aspect-[4/3] w-full object-cover" />
              ) : (
                <div className="aspect-[4/3] grid place-items-center bg-muted">
                  <FileText className="h-8 w-8 text-muted-foreground" />
                </div>
              )}
              <div className="border-t border-border bg-card p-2">
                <div className="truncate text-[11px] font-semibold text-foreground">{a.name ?? "File"}</div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{a.mime?.split("/")[1] ?? ""}</div>
              </div>
            </a>
          );
        })}
      </div>
    </DrawerCard>
  );
}

// ── Timeline ────────────────────────────────────────────────────────────────
const EVENT_ICON: Record<string, React.ElementType> = {
  created:              FileSignature,
  petition_submitted:   Inbox,
  ai_summarised:        Sparkles,
  routed_to_department: Building2,
  department_accepted:  UserCheck,
  department_forwarded: ArrowRight,
  progress_update:      Send,
  resolved:             CheckCircle2,
  closed:               ShieldCheck,
  reopened:             RotateCcw,
  forwarded_to_dept:    ArrowRight,
  status_changed:       GitBranch,
  comment_added:        MessageSquare,
};
const EVENT_LABEL: Record<string, string> = {
  created:              "Ticket created",
  petition_submitted:   "Petition submitted",
  ai_summarised:        "AI summarised",
  routed_to_department: "Routed to department",
  department_accepted:  "Accepted by department",
  department_forwarded: "Forwarded to another department",
  progress_update:      "Progress update",
  resolved:             "Resolved",
  closed:               "Closed",
  reopened:             "Reopened",
  forwarded_to_dept:    "Forwarded out",
  status_changed:       "Status changed",
  comment_added:        "Comment",
};

function TimelineCard({ detail }: { detail: DeptTicketDetail }) {
  const { t } = useDeptLang();
  if (!detail.events || detail.events.length === 0) {
    return (
      <DrawerCard icon={GitBranch} title={t("detail.timeline")}>
        <p className="text-sm italic text-muted-foreground">{t("detail.noEvents")}</p>
      </DrawerCard>
    );
  }
  return (
    <DrawerCard icon={GitBranch} title={t("detail.timeline")}>
      <ol className="relative space-y-4 pl-6">
        <span className="absolute inset-y-1 left-2 w-px bg-border" />
        {detail.events.map((e, i) => {
          const Icon = EVENT_ICON[e.type] ?? GitBranch;
          const label = EVENT_LABEL[e.type] ?? e.type.replace(/_/g, " ");
          return (
            <li key={i} className="relative">
              <span className="absolute -left-[22px] top-0.5 grid h-4 w-4 place-items-center rounded-full border border-border bg-card">
                <Icon className="h-2.5 w-2.5 text-brand" />
              </span>
              <div className="flex items-center gap-1.5">
                <span className="text-[13px] font-semibold text-foreground">{label}</span>
                <span className="text-[11.5px] text-muted-foreground">
                  · {e.actor} · {new Date(e.at).toLocaleString()}
                </span>
              </div>
              {e.note && (
                <div className="mt-1 whitespace-pre-wrap rounded-lg bg-muted/60 p-2 text-[13px] text-foreground/80">
                  {e.note}
                </div>
              )}
              {e.payload?.to && typeof e.payload.to === "string" && (
                <div className="mt-1 inline-flex items-center gap-1 rounded-md border border-cyan-200 bg-cyan-50 px-2 py-0.5 text-[11px] font-semibold text-cyan-700">
                  <ArrowRight className="h-3 w-3" /> {String(e.payload.to).replace(/_/g, " ")}
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </DrawerCard>
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
  // Ticket has moved on to another dept (Forwarded-tab view). We shouldn't
  // let this dept take actions — the backend would 403, and even for
  // `assigned` state showing Accept would be misleading.
  const ownedByOther = detail.department !== myDept;

  if (ownedByOther) {
    const currentDept =
      departments.find((d) => d.key === detail.department)?.label
      ?? detail.department
      ?? "another department";
    return (
      <div className="border-t border-border bg-card px-6 py-4">
        <div className="flex items-start gap-3 rounded-xl border border-dashed border-border bg-muted/30 p-4">
          <ArrowRight className="mt-0.5 h-4 w-4 flex-shrink-0 text-muted-foreground" />
          <div className="text-sm text-muted-foreground">
            You forwarded this ticket to{" "}
            <b className="text-foreground">{currentDept}</b>. It is theirs to
            act on now — this view is read-only for your audit trail.
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
              <Button
                className="aurora-primary flex-1 text-white"
                disabled={busy}
                onClick={() => run(() => acceptTicket(detail.id), "Accepted")}
              >
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
              <Button variant="outline" className="flex-1" onClick={() => setMode("progress")}>
                <Send className="mr-1.5 h-4 w-4" /> {t("action.updateProgress")}
              </Button>
              <Button variant="outline" onClick={() => setMode("forward")}>
                <Forward className="mr-1.5 h-4 w-4" /> {t("action.forward")}
              </Button>
              <Button
                className="aurora-primary flex-1 text-white"
                onClick={() => setMode("resolve")}
              >
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
          onSubmit={(to, reason) =>
            run(() => forwardTicket(detail.id, to, reason), "Forwarded")
          }
        />
      )}

      {mode === "progress" && (
        <ProgressForm
          initialPct={detail.progress_pct}
          busy={busy}
          onCancel={() => setMode("")}
          onSubmit={(note, pct) =>
            run(() => progressTicket(detail.id, note, pct), "Progress posted")
          }
        />
      )}

      {mode === "resolve" && (
        <ResolveForm
          busy={busy}
          onCancel={() => setMode("")}
          onSubmit={(remarks, files) =>
            run(() => resolveTicket(detail.id, remarks, files), "Resolved")
          }
        />
      )}
    </div>
  );
}

// ── Forward form ────────────────────────────────────────────────────────────
function ForwardForm({
  departments, currentDept, busy, onCancel, onSubmit,
}: {
  departments: DeptOption[];
  currentDept: string | null;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (to: string, reason: string) => void;
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
        <Button
          className="aurora-primary flex-1 text-white"
          disabled={busy || !to || !reason.trim()}
          onClick={() => onSubmit(to, reason.trim())}
        >
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
  onCancel: () => void;
  onSubmit: (note: string, pct: number) => void;
}) {
  const { t } = useDeptLang();
  const [note, setNote] = useState("");
  const [pct, setPct]   = useState(initialPct || 0);
  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label>{t("form.note")}</Label>
        <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label>{t("form.progress")}</Label>
          <span className="font-mono text-sm font-bold text-brand">{pct}%</span>
        </div>
        <input
          type="range" min={0} max={99} value={pct}
          onChange={(e) => setPct(Number(e.target.value))}
          className="w-full accent-brand"
        />
      </div>
      <div className="flex gap-2">
        <Button variant="outline" onClick={onCancel}>{t("action.cancel")}</Button>
        <Button
          className="aurora-primary flex-1 text-white"
          disabled={busy || !note.trim()}
          onClick={() => onSubmit(note.trim(), pct)}
        >
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
  busy: boolean; onCancel: () => void;
  onSubmit: (remarks: string, files: File[]) => void;
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
          {files.length > 0
            ? `${files.length} ${t("form.filesSelected")}`
            : t("form.attachProof")}
        </span>
        <input
          type="file" multiple accept="image/*,application/pdf"
          onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
          className="hidden"
        />
      </label>
      <div className="flex gap-2">
        <Button variant="outline" onClick={onCancel}>{t("action.cancel")}</Button>
        <Button
          className="aurora-primary flex-1 text-white"
          disabled={busy || !canSubmit}
          onClick={() => onSubmit(remarks.trim(), files)}
        >
          {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-1.5 h-4 w-4" />}
          {t("action.resolve")}
        </Button>
      </div>
    </div>
  );
}
