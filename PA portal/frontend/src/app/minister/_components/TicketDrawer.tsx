"use client";

import {
  X, User, Phone, Tag, GitBranch, BarChart3, Landmark, Building2, CalendarDays,
  ClipboardList, Sparkles, Image as ImageIcon, Activity as ActivityIcon,
  ArrowRight, Flag, UserCheck, CheckCircle2, Lock, RotateCcw, MessageSquare, Inbox, FileSignature,
} from "lucide-react";
import {
  SectionCard, OverviewGrid, OverviewItem, StatusDot, statusTone, priorityTone,
} from "@/components/ui/detail-primitives";
import { SheetClose, SheetTitle } from "@/components/ui/sheet";
import { InlineAttachmentPreview } from "@/components/ui/inline-attachment-preview";
import type { GalleryAttachment } from "@/components/ui/attachment-gallery";
import { cn, formatDateTime } from "@/lib/utils";
import { useT } from "../_lib/i18n";

// Loose superset of the ticket detail dict — every field optional so the full
// TicketDetail returned by the API is assignable, and missing fields render "—".
export interface TicketDetailLike {
  id?: number;
  ticket_number?: string | null;
  token?: string | null;
  status?: string | null;
  priority?: string | null;
  citizen_name?: string | null;
  citizen_mobile?: string | null;
  category?: string | null;
  category_label?: string | null;
  ministry_label?: string | null;
  department?: string | null;
  department_label?: string | null;
  citizen_ask?: string | null;
  citizen_ask_ta?: string | null;
  summary?: string | null;
  summary_ta?: string | null;
  key_details?: string[] | null;
  key_details_ta?: string[] | null;
  attachments?: GalleryAttachment[] | null;
  created_at?: string | null;
  due_date?: string | null;
  events?: TicketEvent[] | null;
}

export interface TicketEvent {
  id?: string | number;
  event_type?: string;
  actor?: string | null;
  note?: string | null;
  payload?: Record<string, unknown> | null;
  created_at?: string | null;
}

const EVENT_ICON: Record<string, React.ElementType> = {
  petition_submitted: Inbox, created: FileSignature, ai_summarised: Sparkles,
  status_changed: GitBranch, priority_changed: Flag, due_date_set: CalendarDays,
  assigned: UserCheck, unassigned: UserCheck, comment_added: MessageSquare, comment: MessageSquare,
  forwarded_to_dept: ArrowRight, forwarded: ArrowRight, routed_to_department: Building2,
  department_accepted: UserCheck, department_forwarded: ArrowRight, progress_update: MessageSquare,
  resolved: CheckCircle2, closed: Lock, reopened: RotateCcw,
};
function prettyEvent(e: string): string {
  return e.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
function fmtTime(iso?: string | null): string {
  if (!iso) return "";
  try { return new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }); }
  catch { return ""; }
}

/**
 * Read-only ticket detail for the Minister app — the same case facts the staff
 * TicketDetailDrawer shows (citizen, routing, summary, uploads), with none of
 * its status/assign/forward/comment controls.
 */
export function TicketDrawer({ d, onClose }: { d: TicketDetailLike; onClose: () => void }) {
  const { t, lang } = useT();
  const pick = <T,>(en: T | null | undefined, ta: T | null | undefined) => (lang === "ta" ? (ta ?? en) : en);

  const title = pick(d.citizen_ask, d.citizen_ask_ta) ?? t("Ticket detail", "புகார் விவரம்");
  const summary = pick(d.summary, d.summary_ta);
  const keyDetails = pick(d.key_details, d.key_details_ta) ?? [];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-start gap-3 border-b border-border bg-card px-6 py-4">
        <div className="min-w-0 flex-1">
          <SheetTitle className="text-xl font-bold leading-snug tracking-tight">{title}</SheetTitle>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {d.ticket_number && <span className="font-mono text-base font-semibold text-brand">{d.ticket_number}</span>}
            {d.status && <StatusDot label={d.status} tone={statusTone(d.status)} />}
            {d.priority && <StatusDot label={<span className="uppercase tracking-wide">{d.priority}</span>} tone={priorityTone(d.priority)} />}
            {(d.category_label || d.category) && <StatusDot label={d.category_label || d.category || ""} tone="slate" />}
            {d.created_at && (
              <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-muted px-2.5 py-1 text-xs font-semibold text-foreground/80">
                <CalendarDays className="h-3 w-3 text-brand" />
                <span className="font-mono tabular-nums">{formatDateTime(d.created_at)}</span>
              </span>
            )}
          </div>
        </div>
        <SheetClose onClick={onClose} className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
          <X className="h-5 w-5" />
        </SheetClose>
      </div>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <aside className="flex min-h-0 flex-shrink-0 flex-col border-b border-border bg-muted/30 p-5 lg:w-[52%] lg:border-b-0 lg:border-r">
          <div className="mb-3 flex flex-shrink-0 items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
            <span className="grid h-6 w-6 place-items-center rounded-md bg-brand/10 text-brand"><ImageIcon className="h-3.5 w-3.5" /></span>
            {t("Citizen uploads", "குடிமகன் பதிவேற்றங்கள்")}
            {(d.attachments?.length ?? 0) > 0 && (
              <span className="rounded-full bg-brand/10 px-1.5 text-[10px] font-bold text-brand">{d.attachments!.length}</span>
            )}
          </div>
          <div className="min-h-0 flex-1">
            <InlineAttachmentPreview attachments={d.attachments ?? []} defaultOpenFirst />
          </div>
        </aside>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="space-y-4 p-6">
            <SectionCard icon={ClipboardList} title={t("Overview", "மேலோட்டம்")}>
              <OverviewGrid>
                <OverviewItem icon={User} label={t("Citizen", "குடிமகன்")} value={d.citizen_name} />
                <OverviewItem icon={Phone} label={t("Phone", "தொலைபேசி")} value={d.citizen_mobile} mono />
                <OverviewItem icon={Tag} label={t("Category", "வகை")} value={d.category_label || d.category || null} />
                <OverviewItem icon={GitBranch} label={t("Status", "நிலை")} value={d.status ? <StatusDot label={d.status} tone={statusTone(d.status)} /> : null} />
                <OverviewItem icon={BarChart3} label={t("Priority", "முன்னுரிமை")} value={d.priority ? <StatusDot label={<span className="uppercase tracking-wide">{d.priority}</span>} tone={priorityTone(d.priority)} /> : null} />
                {(d.department_label || d.department) && <OverviewItem icon={Building2} label={t("Department", "துறை")} value={d.department_label || d.department} />}
                {d.ministry_label && <OverviewItem icon={Landmark} label={t("Ministry", "அமைச்சகம்")} value={d.ministry_label} />}
                {d.due_date && <OverviewItem icon={CalendarDays} label={t("Due", "காலக்கெடு")} value={formatDateTime(d.due_date)} />}
              </OverviewGrid>
            </SectionCard>

            {(d.events?.length ?? 0) > 0 && (
              <SectionCard icon={ActivityIcon} title={t("Activity", "செயல்பாடு")}>
                <ol className="relative space-y-4 pl-1">
                  {d.events!.map((e, i) => {
                    const Icon = EVENT_ICON[e.event_type || ""] ?? ActivityIcon;
                    const from = e.payload?.from, to = e.payload?.to;
                    return (
                      <li key={e.id ?? i} className="flex gap-3">
                        <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-brand/10 text-brand">
                          <Icon className="h-3.5 w-3.5" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-baseline justify-between gap-2">
                            <span className="text-[13.5px] font-semibold text-foreground">{prettyEvent(e.event_type || "")}</span>
                            <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{fmtTime(e.created_at)}</span>
                          </div>
                          {(from != null || to != null) && (
                            <div className="mt-1 inline-flex items-center gap-2 rounded-lg bg-muted/60 px-2.5 py-1 text-[12.5px]">
                              <span className="rounded bg-background px-1.5 py-0.5 font-medium capitalize text-muted-foreground">{String(from ?? "—").replace(/_/g, " ")}</span>
                              <ArrowRight className="h-3 w-3 text-muted-foreground" />
                              <span className="rounded bg-brand/10 px-1.5 py-0.5 font-semibold capitalize text-brand">{String(to ?? "—").replace(/_/g, " ")}</span>
                            </div>
                          )}
                          {e.note && <p className="mt-1 whitespace-pre-wrap rounded-lg bg-muted/60 p-2 text-[13px] text-foreground/80">{e.note}</p>}
                          {e.actor && <div className="mt-0.5 text-[11px] text-muted-foreground">— {e.actor}</div>}
                        </div>
                      </li>
                    );
                  })}
                </ol>
              </SectionCard>
            )}

            {(summary || pick(d.citizen_ask, d.citizen_ask_ta) || keyDetails.length > 0) && (
              <SectionCard icon={Sparkles} title={t("Summary", "சுருக்கம்")}>
                {summary && (
                  <p className={cn("text-[15px] font-medium leading-[1.75] text-foreground", lang === "ta" && "font-[Mukta_Malar,_'Noto_Sans_Tamil',_system-ui]")}>{summary}</p>
                )}
                {pick(d.citizen_ask, d.citizen_ask_ta) && (
                  <div className="mt-5 rounded-r-lg border-l-[3px] border-brand bg-brand/[0.04] py-3 pl-4 pr-3">
                    <div className="mb-1 text-[10px] font-bold uppercase tracking-[0.16em] text-brand">{t("The ask", "கோரிக்கை")}</div>
                    <p className="text-[14px] font-semibold leading-relaxed text-foreground">{pick(d.citizen_ask, d.citizen_ask_ta)}</p>
                  </div>
                )}
                {keyDetails.length > 0 && (
                  <div className="mt-5 border-t border-border pt-4">
                    <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">{t("Key details", "முக்கிய விவரங்கள்")}</div>
                    <ul className="space-y-2">
                      {keyDetails.map((dd, i) => (
                        <li key={i} className="flex gap-3 text-[13.5px] leading-relaxed text-foreground/85">
                          <span className="mt-[9px] h-1.5 w-1.5 shrink-0 rounded-full bg-brand/60" />
                          <span>{dd}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </SectionCard>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
