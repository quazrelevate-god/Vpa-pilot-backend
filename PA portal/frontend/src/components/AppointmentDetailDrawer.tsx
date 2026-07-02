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
import { priorityOptions, deptOptions, categoryOptions, DEPT_DISPLAY, CATEGORY_DISPLAY } from "@/lib/enums";
import { cn, formatDate, formatDateTime } from "@/lib/utils";

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
  const [overrides, setOverrides] = useState<{ priority?: string | null; category?: string | null; department?: string | null }>({});
  const [editCategory, setEditCategory] = useState(false);
  const [editDepartment, setEditDepartment] = useState(false);

  const open = row != null;
  const a = row;

  // Reset overrides + edit state when switching rows
  useEffect(() => {
    setOverrides({});
    setEditCategory(false);
    setEditDepartment(false);
    setTab("details");
  }, [row?.id]);

  // Fetch activity events when row opens
  useEffect(() => {
    if (row?.id == null) return;
    fetchAppointmentActivity(row.id).then((r) => setActivity(r.items)).catch(() => setActivity([]));
  }, [row?.id]);

  const currentPriority = overrides.priority !== undefined ? overrides.priority : a?.priority ?? null;
  const currentCategoryKey = overrides.category !== undefined ? overrides.category : null; // null means use AI label
  const currentDeptKey = overrides.department !== undefined ? overrides.department : null;
  const categoryLabel = currentCategoryKey
    ? (CATEGORY_DISPLAY[currentCategoryKey] ?? currentCategoryKey)
    : (a?.category_label ?? a?.category ?? null);
  const departmentLabel = currentDeptKey
    ? (DEPT_DISPLAY[currentDeptKey] ?? currentDeptKey)
    : (a?.department_label ?? null);

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

  async function patchDetails(patch: { priority?: string | null; category?: string | null; department?: string | null }) {
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
        className="flex w-full flex-col gap-0 p-0 sm:max-w-[95vw]"
      >
        {!a ? (
          <div className="flex flex-1 items-center justify-center text-muted-foreground">Loading…</div>
        ) : (
          <>
            {/* Header */}
            <div className="flex items-start gap-3 border-b border-border bg-card px-6 py-4">
              <div className="min-w-0 flex-1">
                <SheetTitle className="text-xl font-bold leading-snug tracking-tight">
                  {pick(a.headline, a.headline_ta) ?? "Appointment details"}
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

              <Tabs value={tab} onValueChange={setTab} className="flex min-w-0 min-h-0 flex-1 flex-col">
              {/* Tab bar */}
              <div className="border-b border-border bg-card px-6 pt-3">
                <TabsList className="bg-muted">
                  <TabsTrigger value="details">Details</TabsTrigger>
                  <TabsTrigger value="activity">
                    Activity
                    {activity.length > 0 && (
                      <span className="ml-1.5 rounded-full bg-background px-1.5 text-[10px] font-bold text-muted-foreground">
                        {activity.length}
                      </span>
                    )}
                  </TabsTrigger>
                </TabsList>
              </div>

              {/* ── Details tab ─────────────────────────────────────────── */}
              <TabsContent value="details" className="m-0 min-h-0 flex-1 overflow-y-auto">
                <div className="space-y-4 p-6">
                {/* Summary — the briefing */}
                {(a.summary || a.summary_ta || a.description) && (
                  <section className="relative overflow-hidden rounded-xl border border-border bg-card shadow-card">
                    <div className="h-1 w-full bg-gradient-to-r from-brand via-brand/70 to-brand/30" />

                    <div className="p-5 sm:p-6">
                      <div className="mb-3 flex items-center justify-between">
                        <h3 className="text-[11px] font-bold uppercase tracking-[0.18em] text-brand">
                          Summary
                        </h3>
                        {!a.summary && !a.summary_ta && (
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
                      ) : (
                        <p className="text-sm italic text-muted-foreground">Summary is being prepared…</p>
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

                {/* Properties — admin overrides for AI-derived fields */}
                <Panel icon={User} title="Properties">
                  <div className="grid grid-cols-2 gap-4">
                    {/* Status — always editable */}
                    <div className="space-y-1.5">
                      <Label>Status</Label>
                      <Select value={a.status} onValueChange={(v) => changeStatus(v as AppointmentStatus)} disabled={busy}>
                        <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {STATUS_OPTIONS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>

                    {/* Priority — always editable */}
                    <div className="space-y-1.5">
                      <Label>Priority</Label>
                      <Select
                        value={currentPriority ?? undefined}
                        onValueChange={(v) => patchDetails({ priority: v })}
                        disabled={busy}
                      >
                        <SelectTrigger className="h-9"><SelectValue placeholder="— Set priority —" /></SelectTrigger>
                        <SelectContent>
                          {priorityOptions.map((o) => (
                            <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    {/* Category — read-only with Edit toggle */}
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <Label>Category</Label>
                        {!editCategory && (
                          <button
                            onClick={() => setEditCategory(true)}
                            className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-brand hover:underline"
                            disabled={busy}
                          >
                            <Pencil className="h-3 w-3" /> Edit
                          </button>
                        )}
                      </div>
                      {editCategory ? (
                        <div className="flex gap-1.5">
                          <Select
                            value={currentCategoryKey ?? a.category ?? undefined}
                            onValueChange={(v) => patchDetails({ category: v }).then(() => setEditCategory(false))}
                            disabled={busy}
                          >
                            <SelectTrigger className="h-9 flex-1"><SelectValue placeholder="— Select —" /></SelectTrigger>
                            <SelectContent className="max-h-72">
                              {categoryOptions.map((o) => (
                                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Button variant="ghost" size="sm" className="h-9 px-2" onClick={() => setEditCategory(false)} disabled={busy}>
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      ) : (
                        <div className="flex h-9 items-center rounded-md border border-input bg-muted/40 px-3 text-sm text-foreground">
                          {categoryLabel ?? <span className="text-muted-foreground">—</span>}
                        </div>
                      )}
                    </div>

                    {/* Department — read-only with Edit toggle */}
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <Label>Department</Label>
                        {!editDepartment && (
                          <button
                            onClick={() => setEditDepartment(true)}
                            className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-brand hover:underline"
                            disabled={busy}
                          >
                            <Pencil className="h-3 w-3" /> Edit
                          </button>
                        )}
                      </div>
                      {editDepartment ? (
                        <div className="flex gap-1.5">
                          <Select
                            value={currentDeptKey ?? undefined}
                            onValueChange={(v) => patchDetails({ department: v }).then(() => setEditDepartment(false))}
                            disabled={busy}
                          >
                            <SelectTrigger className="h-9 flex-1"><SelectValue placeholder="— Select —" /></SelectTrigger>
                            <SelectContent className="max-h-72">
                              {deptOptions.map((o) => (
                                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Button variant="ghost" size="sm" className="h-9 px-2" onClick={() => setEditDepartment(false)} disabled={busy}>
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      ) : (
                        <div className="flex h-9 items-center rounded-md border border-input bg-muted/40 px-3 text-sm text-foreground">
                          {departmentLabel ?? <span className="text-muted-foreground">—</span>}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="mt-3 inline-flex items-center gap-1.5 text-[10.5px] text-muted-foreground">
                    <Check className="h-3 w-3 text-emerald-500" />
                    Edits override the model's suggestion and are saved immediately.
                  </div>
                </Panel>
              </div>
            </TabsContent>

              {/* ── Activity tab ────────────────────────────────────────── */}
              <TabsContent value="activity" className="m-0 min-h-0 flex-1 overflow-y-auto">
                <div className="space-y-4 p-6">
                  {activity.length === 0 ? (
                    <div className="py-10 text-center text-sm italic text-muted-foreground">No activity yet.</div>
                  ) : (
                    <ol className="space-y-1">
                      {activity.map((e, idx) => {
                        const Icon = APPT_EVENT_ICON[e.event_type] ?? Clock;
                        const last = idx === activity.length - 1;
                        const title = formatApptEventTitle(e.event_type);
                        const renderedBody = renderApptEventBody(e);
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
            </Tabs>
            </div>
          </>
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
  department_changed: ArrowRight,
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
  department_changed: "Department changed",
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
      e.event_type === "category_changed" || e.event_type === "department_changed") {
    return <ApptChangeArrow from={p.from} to={p.to} />;
  }

  return e.note ? <p className="mt-1 whitespace-pre-wrap rounded-lg bg-muted/60 p-2 text-sm text-foreground/80">{e.note}</p> : null;
}
