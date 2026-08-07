"use client";

import {
  X, User, Phone, Tag, GitBranch, BarChart3, Landmark, MapPin, CalendarDays,
  ClipboardList, Sparkles, Mic, Image as ImageIcon,
} from "lucide-react";
import {
  SectionCard, OverviewGrid, OverviewItem, StatusDot, statusTone, priorityTone,
} from "@/components/ui/detail-primitives";
import { SheetClose, SheetTitle } from "@/components/ui/sheet";
import { InlineAttachmentPreview } from "@/components/ui/inline-attachment-preview";
import type { AppointmentRow } from "@/lib/types";
import { cn, formatDateTime } from "@/lib/utils";
import { useT } from "../_lib/i18n";

/**
 * Read-only petition detail for the Minister app — the same case facts the
 * staff AppointmentDetailDrawer shows (citizen, summary, citizen ask, key
 * details, uploaded documents), with none of its edit selects, status actions,
 * reschedule, or activity feed. The Minister looks; the PA acts on the desk.
 */
export function PetitionDrawer({ d, onClose }: { d: AppointmentRow; onClose: () => void }) {
  const { t, lang } = useT();
  const pick = <T,>(en: T | null | undefined, ta: T | null | undefined) => (lang === "ta" ? (ta ?? en) : en);
  const a = d as AppointmentRow & {
    citizen_ask_ta?: string | null; summary_ta?: string | null;
    key_details?: string[]; key_details_ta?: string[]; transcript?: string | null;
    audio_transcript?: string | null; description?: string | null;
    category_label?: string | null; ministry_label?: string | null; district_label?: string | null;
    appointment_time?: string | null;
  };

  const title = pick(a.citizen_ask, a.citizen_ask_ta) ?? t("Petition detail", "மனு விவரம்");
  const token = a.token ? (String(a.token).startsWith("TKN") ? a.token : `TKN${a.token}`) : null;
  const summary = pick(a.summary, a.summary_ta);
  const keyDetails = pick(a.key_details, a.key_details_ta) ?? [];

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Header */}
      <div className="flex items-start gap-3 border-b border-border bg-card px-6 py-4">
        <div className="min-w-0 flex-1">
          <SheetTitle className="text-xl font-bold leading-snug tracking-tight">{title}</SheetTitle>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {token && <span className="font-mono text-base font-semibold text-brand">{token}</span>}
            {a.status && <StatusDot label={a.status} tone={statusTone(a.status)} />}
            {a.priority && <StatusDot label={<span className="uppercase tracking-wide">{a.priority}</span>} tone={priorityTone(a.priority)} />}
            {(a.category_label || a.category) && <StatusDot label={a.category_label || a.category || ""} tone="slate" />}
            {a.created_at && (
              <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-muted px-2.5 py-1 text-xs font-semibold text-foreground/80">
                <CalendarDays className="h-3 w-3 text-brand" />
                <span className="font-mono tabular-nums">{formatDateTime(a.created_at)}</span>
              </span>
            )}
          </div>
        </div>
        <SheetClose onClick={onClose} className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
          <X className="h-5 w-5" />
        </SheetClose>
      </div>

      {/* Body — 2 panes on lg+ */}
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <aside className="flex min-h-0 flex-shrink-0 flex-col border-b border-border bg-muted/30 p-5 lg:w-[52%] lg:border-b-0 lg:border-r">
          <div className="mb-3 flex flex-shrink-0 items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
            <span className="grid h-6 w-6 place-items-center rounded-md bg-brand/10 text-brand"><ImageIcon className="h-3.5 w-3.5" /></span>
            {t("Citizen uploads", "குடிமகன் பதிவேற்றங்கள்")}
            {(a.attachments?.length ?? 0) > 0 && (
              <span className="rounded-full bg-brand/10 px-1.5 text-[10px] font-bold text-brand">{a.attachments!.length}</span>
            )}
          </div>
          <div className="min-h-0 flex-1">
            <InlineAttachmentPreview attachments={a.attachments ?? []} audioTranscript={a.audio_transcript || a.description || null} defaultOpenFirst />
          </div>
        </aside>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="space-y-4 p-6">
            <SectionCard icon={ClipboardList} title={t("Overview", "மேலோட்டம்")}>
              <OverviewGrid>
                <OverviewItem icon={User} label={t("Name", "பெயர்")} value={a.name} />
                <OverviewItem icon={Phone} label={t("Phone", "தொலைபேசி")} value={a.mobile} mono />
                <OverviewItem icon={Tag} label={t("Category", "வகை")} value={a.category_label || a.category || null} />
                <OverviewItem icon={GitBranch} label={t("Status", "நிலை")} value={a.status ? <StatusDot label={a.status} tone={statusTone(a.status)} /> : null} />
                <OverviewItem icon={BarChart3} label={t("Urgency", "அவசரம்")} value={a.priority ? <StatusDot label={<span className="uppercase tracking-wide">{a.priority}</span>} tone={priorityTone(a.priority)} /> : null} />
                {a.ministry_label && <OverviewItem icon={Landmark} label={t("Ministry", "அமைச்சகம்")} value={a.ministry_label} />}
                {a.district_label && <OverviewItem icon={MapPin} label={t("District", "மாவட்டம்")} value={a.district_label} />}
                {a.appointment_time && <OverviewItem icon={CalendarDays} label={t("Appointment", "சந்திப்பு")} value={formatDateTime(a.appointment_time)} accent="emerald" />}
              </OverviewGrid>
            </SectionCard>

            {a.transcript && (
              <SectionCard icon={Mic} title={t("Voice message", "குரல் செய்தி")}>
                <p className={cn("text-[15px] font-medium leading-[1.75] text-foreground", lang === "ta" && "font-[Mukta_Malar,_'Noto_Sans_Tamil',_system-ui]")}>{a.transcript}</p>
              </SectionCard>
            )}

            {(summary || pick(a.citizen_ask, a.citizen_ask_ta) || keyDetails.length > 0) && (
              <SectionCard icon={Sparkles} title={t("Summary", "சுருக்கம்")}>
                {summary && (
                  <p className={cn("text-[15px] font-medium leading-[1.75] text-foreground", lang === "ta" && "font-[Mukta_Malar,_'Noto_Sans_Tamil',_system-ui]")}>{summary}</p>
                )}
                {pick(a.citizen_ask, a.citizen_ask_ta) && (
                  <div className="mt-5 rounded-r-lg border-l-[3px] border-brand bg-brand/[0.04] py-3 pl-4 pr-3">
                    <div className="mb-1 text-[10px] font-bold uppercase tracking-[0.16em] text-brand">{t("The ask", "கோரிக்கை")}</div>
                    <p className="text-[14px] font-semibold leading-relaxed text-foreground">{pick(a.citizen_ask, a.citizen_ask_ta)}</p>
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
