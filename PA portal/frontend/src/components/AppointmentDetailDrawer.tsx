"use client";

import { useEffect, useState } from "react";
import {
  Phone, Hash, CalendarDays, X, User, Users, Languages, FileText, Mic, Pencil, Check, ShieldAlert,
  Clock, GitBranch, Flag, ArrowRight, Activity as ActivityIcon,
} from "lucide-react";
import type { AppointmentRow, AppointmentStatus, AppointmentActivityEvent } from "@/lib/types";
import { updateAppointmentStatus, updateAppointmentDetails, fetchAppointmentActivity } from "@/lib/api";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetClose, SheetTitle } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { InitialsAvatar } from "@/components/ui/avatar";
import { InlineAttachmentPreview } from "@/components/ui/inline-attachment-preview";
import { priorityOptions, ministryOptions, categoryOptions, MINISTRY_DISPLAY, CATEGORY_DISPLAY } from "@/lib/enums";
import { cn, formatDate, formatDateTime } from "@/lib/utils";
import RescheduleModal from "@/components/RescheduleModal";

type Lang = "en" | "ta";

interface AppointmentDetailDrawerProps {
  row: AppointmentRow | null;
  onClose: () => void;
  onStatusChange?: (row: AppointmentRow, next: AppointmentStatus) => void;
}

const STATUS_OPTIONS: AppointmentStatus[] = ["Waiting", "Scheduled", "Awaiting Review", "Reviewed", "Rescheduled"];
const STATUS_COLOR: Record<string, string> = {
  Scheduled:        "bg-emerald-100 text-emerald-700 border-emerald-200",
  Waiting:          "bg-amber-100 text-amber-800 border-amber-200",
  Rescheduled:      "bg-violet-100 text-violet-700 border-violet-200",
  "Awaiting Review": "bg-orange-100 text-orange-700 border-orange-200",
  Reviewed:         "bg-blue-100 text-blue-700 border-blue-200",
};

export default function AppointmentDetailDrawer({
  row, onClose, onStatusChange,
}: AppointmentDetailDrawerProps) {
  const [lang, setLang] = useState<Lang>("en");
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState("details");
  const [activity, setActivity] = useState<AppointmentActivityEvent[]>([]);
  // Local overlay so the UI reflects PA admin edits without a refetch.
  const [overrides, setOverrides] = useState<{ priority?: string | null; category?: string | null; ministry?: string | null }>({});
  const [editCategory, setEditCategory] = useState(false);
  const [editMinistry, setEditMinistry] = useState(false);
  const [rescheduleOpen, setRescheduleOpen] = useState(false);

  const open = row != null;
  const a = row;

  // Reset overrides + edit state when switching rows
  useEffect(() => {
    setOverrides({});
    setEditCategory(false);
    setEditMinistry(false);
    setTab("details");
  }, [row?.id]);

  // Fetch activity events when row opens
  useEffect(() => {
    if (row?.id == null) return;
    fetchAppointmentActivity(row.id).then((r) => setActivity(r.items)).catch(() => setActivity([]));
  }, [row?.id]);

  const currentPriority = overrides.priority !== undefined ? overrides.priority : a?.priority ?? null;
  const currentCategoryKey = overrides.category !== undefined ? overrides.category : null; // null means use AI label
  const currentMinistryKey = overrides.ministry !== undefined ? overrides.ministry : null;
  const categoryLabel = currentCategoryKey
    ? (CATEGORY_DISPLAY[currentCategoryKey] ?? currentCategoryKey)
    : (a?.category_label ?? a?.category ?? null);
  const ministryLabel = currentMinistryKey
    ? (MINISTRY_DISPLAY[currentMinistryKey] ?? currentMinistryKey)
    : (a?.ministry_label ?? null);

  // Lazy bilingual field accessor.
  const pick = <T,>(en: T | null | undefined, ta: T | null | undefined): T | null | undefined =>
    lang === "ta" ? (ta ?? en) : en;

  async function changeStatus(next: AppointmentStatus) {
    if (!a) return;
    setBusy(true);
    try {
      await updateAppointmentStatus(a.id, next);
      onStatusChange?.(a, next);
      toast.success("Status updated", { description: `Marked as “${next}”.` });
      fetchAppointmentActivity(a.id).then((r) => setActivity(r.items)).catch(() => {});
    } catch (e) {
      toast.error("Update failed", { description: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  async function patchDetails(patch: { priority?: string | null; category?: string | null; ministry?: string | null }) {
    if (!a) return;
    setBusy(true);
    try {
      await updateAppointmentDetails(a.id, patch);
      setOverrides((o) => ({ ...o, ...patch }));
      toast.success("Updated", { description: "Classification overridden." });
      fetchAppointmentActivity(a.id).then((r) => setActivity(r.items)).catch(() => {});
    } catch (e) {
      toast.error("Update failed", { description: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent
        side="right"
        hideClose
        className="aurora-sweep flex w-full flex-col gap-0 p-0 sm:max-w-[95vw]"
      >
        {!a ? (
          <div className="flex flex-1 items-center justify-center text-muted-foreground">Loading…</div>
        ) : (
          <>
            {/* Header */}
            <div className="flex items-start gap-3 border-b border-border bg-card px-6 py-4">
              <div className="min-w-0 flex-1">
                <SheetTitle className="text-xl font-bold leading-snug tracking-tight">
                  {pick(a.citizen_ask, a.citizen_ask_ta) ?? "Appointment details"}
                </SheetTitle>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span className="font-mono text-base font-semibold text-brand">
                    {String(a.token).startsWith("TKN") ? a.token : `TKN${a.token}`}
                  </span>
                  <span className={cn("rounded-full border px-2.5 py-0.5 text-xs font-semibold", STATUS_COLOR[a.status])}>
                    {a.status}
                  </span>
                  {a.priority && (
                    <span className="rounded-full border border-orange-200 bg-orange-50 px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide text-orange-700">
                      {a.priority}
                    </span>
                  )}
                </div>
              </div>

              {/* Language toggle */}
              <LangToggle lang={lang} onChange={setLang} />

              <SheetClose className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
                <X className="h-5 w-5" />
              </SheetClose>
            </div>

            {/* Action bar — workflow actions per current status. Every
                Appointments-tab row where the PA has real work to do gets
                a colour-coded strip below the header:

                  Rescheduled — needs to be re-booked or converted to a petition
                  Waiting     — same options; Schedule opens the same picker
                  Scheduled   — only convert-to-petition (the meeting is set)

                All other statuses (Awaiting Review, Reviewed, Not Came,
                Courtesy Done) have no interactive bar — they're terminal or
                already routed through Petition Review. */}
            {(() => {
              const s = a.status;
              const cfg =
                s === "Rescheduled" ? {
                  bg: "bg-violet-50/50", tone: "text-violet-700", sub: "text-violet-900/80",
                  title: "Needs rescheduling",
                  hint: "Call the citizen — book a new slot, or convert to a petition.",
                  primary: { kind: "reschedule" as const, label: "Reschedule to new slot" },
                }
                : s === "Waiting" ? {
                  bg: "bg-amber-50/60", tone: "text-amber-700", sub: "text-amber-900/80",
                  title: "In the waiting queue",
                  hint: "Book them into a slot when one opens, or convert to a petition.",
                  primary: { kind: "reschedule" as const, label: "Schedule" },
                }
                : s === "Scheduled" ? {
                  bg: "bg-emerald-50/60", tone: "text-emerald-700", sub: "text-emerald-900/80",
                  title: "Scheduled meeting",
                  hint: "Convert to a petition if the citizen no longer wants to meet.",
                  primary: null,
                }
                : null;
              if (!cfg) return null;
              return (
                <div className={cn("flex items-center justify-between gap-3 border-b border-border px-6 py-3", cfg.bg)}>
                  <div className="min-w-0">
                    <div className={cn("text-[11px] font-bold uppercase tracking-wider", cfg.tone)}>
                      {cfg.title}
                    </div>
                    <div className={cn("text-[13px]", cfg.sub)}>
                      {cfg.hint}
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <Button size="sm" variant="outline"
                      disabled={busy}
                      onClick={async () => {
                        if (!a) return;
                        setBusy(true);
                        try {
                          await updateAppointmentStatus(a.id, "Awaiting Review");
                          toast.success("Moved to Awaiting Review");
                          onStatusChange?.(a, "Awaiting Review");
                          onClose();
                        } catch (e) {
                          toast.error("Failed", { description: (e as Error).message });
                        } finally {
                          setBusy(false);
                        }
                      }}>
                      Convert to petition
                    </Button>
                    {cfg.primary && (
                      <Button size="sm" onClick={() => setRescheduleOpen(true)} disabled={busy}>
                        <CalendarDays className="h-4 w-4" />
                        {cfg.primary.label}
                      </Button>
                    )}
                  </div>
                </div>
              );
            })()}

            <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
              {/* Preview pane — uploads at-a-glance */}
              <aside className="flex min-h-0 flex-shrink-0 flex-col border-b border-border bg-muted/30 p-5 lg:w-[52%] lg:border-b-0 lg:border-r">
                <div className="mb-3 flex flex-shrink-0 items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                  <Mic className="h-3.5 w-3.5" /> Uploads
                </div>
                <div className="min-h-0 flex-1">
                  <InlineAttachmentPreview
                    attachments={a.attachments ?? []}
                    audioTranscript={a.audio_transcript || a.description || null}
                  />
                </div>
              </aside>

              {/* Activity feed removed — the drawer is Details only. */}
              <div className="flex min-w-0 min-h-0 flex-1 flex-col">
              <div className="m-0 min-h-0 flex-1 overflow-y-auto">
                <div className="space-y-4 p-6">
                {/* Voice message transcript — courtesy submissions (invitation /
                     greetings) don't run through the AI summariser, so their
                     voice message is transcribed on its own and shown here. */}
                {a.transcript && (
                  <section className="relative overflow-hidden rounded-xl border border-border bg-card shadow-card">
                    <div className="h-1 w-full bg-gradient-to-r from-emerald-500 via-emerald-500/70 to-emerald-500/30" />
                    <div className="p-5 sm:p-6">
                      <h3 className="mb-3 text-[11px] font-bold uppercase tracking-[0.18em] text-emerald-700">
                        Voice message
                      </h3>
                      <p className={cn(
                        "text-[15px] font-medium leading-[1.75] tracking-[-0.005em] text-foreground",
                        lang === "ta" && "font-[Mukta_Malar,_'Noto_Sans_Tamil',_system-ui]",
                      )}>
                        {a.transcript}
                      </p>
                    </div>
                  </section>
                )}

                {/* Summary — the AI briefing.
                    Hidden entirely for the edge cases where no AI runs:
                      - invitation / greetings (voice message is the whole ask)
                      - floor walk-ins where the operator only filed the
                        auto-generated placeholder description
                    Rendered normally when there's real text (summary or
                    citizen-typed description) or when AI is actively running. */}
                {(() => {
                  const cat = (a.category || "").toLowerCase();
                  if (cat === "invitation" || cat === "greetings") return false;
                  const desc = (a.description || "").trim();
                  const isFloorPlaceholder = a.source === "manual_staff"
                    && /^Walk-in (appointment|petition) registered by /i.test(desc);
                  const meaningfulDesc = desc && !isFloorPlaceholder;
                  return !!(a.summary || a.summary_ta || meaningfulDesc
                    || (a.summary_status && a.summary_status !== "DONE" && a.summary_status !== "FAILED"));
                })() && (
                  <section className="relative overflow-hidden rounded-xl border border-border bg-card shadow-card">
                    <div className="h-1 w-full bg-gradient-to-r from-brand via-brand/70 to-brand/30" />

                    <div className="p-5 sm:p-6">
                      <div className="mb-3 flex items-center justify-between">
                        <h3 className="text-[11px] font-bold uppercase tracking-[0.18em] text-brand">
                          Summary
                        </h3>
                        {!a.summary && !a.summary_ta
                          && (a.summary_status === "PENDING" || a.summary_status === "PROCESSING") && (
                          <span className="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400" />
                            Generating
                          </span>
                        )}
                      </div>

                      {/* Body */}
                      {pick(a.summary, a.summary_ta) ? (
                        <p className={cn(
                          "text-[15px] font-medium leading-[1.75] tracking-[-0.005em] text-foreground",
                          lang === "ta" && "font-[Mukta_Malar,_'Noto_Sans_Tamil',_system-ui]"
                        )}>
                          {pick(a.summary, a.summary_ta)}
                        </p>
                      ) : (a.summary_status === "PENDING" || a.summary_status === "PROCESSING") ? (
                        <p className="text-sm italic text-muted-foreground">Summary is being prepared…</p>
                      ) : (
                        <p className={cn(
                          "text-[15px] font-medium leading-[1.75] tracking-[-0.005em] text-foreground",
                          lang === "ta" && "font-[Mukta_Malar,_'Noto_Sans_Tamil',_system-ui]"
                        )}>
                          {a.description || "—"}
                        </p>
                      )}

                      {/* Citizen ask */}
                      {pick(a.citizen_ask, a.citizen_ask_ta) && (
                        <div className="mt-5 rounded-r-lg border-l-[3px] border-brand bg-brand/[0.04] py-3 pl-4 pr-3">
                          <div className="mb-1 text-[10px] font-bold uppercase tracking-[0.16em] text-brand">
                            What they're asking for
                          </div>
                          <p className="text-[14px] font-semibold leading-relaxed text-foreground">
                            {pick(a.citizen_ask, a.citizen_ask_ta)}
                          </p>
                        </div>
                      )}

                      {/* Key details */}
                      {(() => {
                        const list = pick(a.key_details, a.key_details_ta) ?? [];
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
                    <InitialsAvatar name={a.name} className="h-12 w-12 text-base" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-base font-semibold text-foreground">{a.name ?? "—"}</div>
                      <div className="mt-0.5 text-xs uppercase tracking-wider text-muted-foreground">Citizen</div>
                    </div>
                    {currentPriority && (
                      <span className="ml-2 inline-flex shrink-0 items-center gap-1 rounded-full border border-orange-200 bg-orange-50 px-3 py-1.5 text-xs font-bold uppercase tracking-wide text-orange-700">
                        <ShieldAlert className="h-3.5 w-3.5" />{currentPriority} priority
                      </span>
                    )}
                  </div>
                  <dl className="grid grid-cols-1 gap-x-8 gap-y-5 pt-5 sm:grid-cols-2">
                    <Field icon={Phone} label="Mobile" value={a.mobile} mono />
                    <Field
                      icon={Hash}
                      label="Token"
                      value={String(a.token).startsWith("TKN") ? a.token : `TKN${a.token}`}
                      mono
                      accent="brand"
                    />
                    <Field icon={CalendarDays} label="Submitted" value={formatDate(a.created_at)} />
                    {a.appointment_time && (
                      <Field
                        icon={CalendarDays}
                        label="Appointment"
                        value={formatDateTime(a.appointment_time)}
                        accent="emerald"
                      />
                    )}
                    {a.appointment_time && a.num_persons && a.num_persons > 0 && (
                      <Field
                        icon={Users}
                        label="Visitors"
                        value={`${a.num_persons} ${a.num_persons === 1 ? "person" : "persons"}`}
                        accent="violet"
                      />
                    )}
                  </dl>
                </Panel>

                {/* Citizen's description / audio transcript now rendered under
                    the audio player in the left preview pane. */}

                {/* Properties panel removed — workflow actions now live in
                    the top action bar (Scheduled / Waiting / Rescheduled). */}
              </div>
            </div>
            </div>
            </div>
          </>
        )}
      </SheetContent>

      <RescheduleModal
        open={rescheduleOpen}
        appointmentId={a?.id ?? null}
        onClose={() => setRescheduleOpen(false)}
        onRebooked={() => {
          // Backend flipped this row back to SCHEDULED with the new date.
          // Close the drawer so the parent list refetches and the row moves
          // off the Rescheduled tab immediately.
          if (a) onStatusChange?.(a, "Scheduled");
          onClose();
        }}
      />
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

// ── Activity rendering ──────────────────────────────────────────────────────

const APPT_EVENT_ICON: Record<string, React.ElementType> = {
  created: ActivityIcon,
  status_changed: GitBranch,
  priority_changed: ShieldAlert,
  urgency_changed: ShieldAlert,   // legacy events logged before the rename
  category_changed: Flag,
  ministry_changed: ArrowRight,
  department_changed: ArrowRight, // legacy: events logged before dept→ministry rename
  rescheduled: CalendarDays,
  slot_blocked: Clock,
  slot_unblocked: Clock,
  moved_to_waiting: Clock,
  auto_allocated: Check,
};

const APPT_PRETTY_EVENT: Record<string, string> = {
  created: "Appointment created",
  status_changed: "Status changed",
  priority_changed: "Priority changed",
  urgency_changed: "Priority changed",   // legacy events logged before the rename
  category_changed: "Category changed",
  ministry_changed: "Ministry changed",
  department_changed: "Ministry changed",   // legacy events logged before the rename
  rescheduled: "Rescheduled",
  slot_blocked: "Slot blocked",
  slot_unblocked: "Slot unblocked",
  moved_to_waiting: "Moved to waiting queue",
  auto_allocated: "Auto-allocated to slot",
};

function formatApptEventTitle(eventType: string): string {
  return APPT_PRETTY_EVENT[eventType] ?? eventType.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function ApptChangeArrow({ from, to }: { from: unknown; to: unknown }) {
  const fmt = (v: unknown) => {
    if (v == null || v === "") return "—";
    return String(v).replace(/_/g, " ");
  };
  return (
    <div className="mt-1 inline-flex items-center gap-2 rounded-lg bg-muted/60 px-2.5 py-1 text-[12.5px]">
      <span className="rounded bg-background px-1.5 py-0.5 font-medium text-muted-foreground">{fmt(from)}</span>
      <ArrowRight className="h-3 w-3 text-muted-foreground" />
      <span className="rounded bg-brand/10 px-1.5 py-0.5 font-semibold capitalize text-brand">{fmt(to)}</span>
    </div>
  );
}

function renderApptEventBody(e: { event_type: string; note?: string | null; payload?: Record<string, unknown> | null }) {
  const p = e.payload ?? {};

  if (e.event_type === "status_changed" || e.event_type === "priority_changed" ||
      e.event_type === "urgency_changed" ||
      e.event_type === "category_changed" || e.event_type === "ministry_changed" ||
      e.event_type === "department_changed") {
    return <ApptChangeArrow from={p.from} to={p.to} />;
  }

  return e.note ? <p className="mt-1 whitespace-pre-wrap rounded-lg bg-muted/60 p-2 text-sm text-foreground/80">{e.note}</p> : null;
}
