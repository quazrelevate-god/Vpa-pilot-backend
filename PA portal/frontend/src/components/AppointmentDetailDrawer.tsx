"use client";

import { useEffect, useState } from "react";
import {
  Phone, Hash, CalendarDays, X, User, Languages, FileText, Mic, Pencil, Check, ShieldAlert,
} from "lucide-react";
import type { AppointmentRow, AppointmentStatus } from "@/lib/types";
import { updateAppointmentStatus, updateAppointmentDetails } from "@/lib/api";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetClose, SheetTitle } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { InitialsAvatar } from "@/components/ui/avatar";
import { AttachmentGallery } from "@/components/ui/attachment-gallery";
import { urgencyOptions, deptOptions, categoryOptions, DEPT_DISPLAY, CATEGORY_DISPLAY } from "@/lib/enums";
import { cn, formatDate, formatDateTime } from "@/lib/utils";

type Lang = "en" | "ta";

interface AppointmentDetailDrawerProps {
  row: AppointmentRow | null;
  onClose: () => void;
  onStatusChange?: (row: AppointmentRow, next: AppointmentStatus) => void;
}

const STATUS_OPTIONS: AppointmentStatus[] = ["Scheduled", "Waiting", "Rescheduled", "Submitted"];
const STATUS_COLOR: Record<string, string> = {
  Scheduled:   "bg-emerald-100 text-emerald-700 border-emerald-200",
  Waiting:     "bg-amber-100 text-amber-800 border-amber-200",
  Rescheduled: "bg-violet-100 text-violet-700 border-violet-200",
  Submitted:   "bg-blue-100 text-blue-700 border-blue-200",
};

export default function AppointmentDetailDrawer({
  row, onClose, onStatusChange,
}: AppointmentDetailDrawerProps) {
  const [lang, setLang] = useState<Lang>("en");
  const [busy, setBusy] = useState(false);
  // Local overlay so the UI reflects PA admin edits without a refetch.
  const [overrides, setOverrides] = useState<{ urgency?: string | null; category?: string | null; department?: string | null }>({});
  const [editCategory, setEditCategory] = useState(false);
  const [editDepartment, setEditDepartment] = useState(false);

  const open = row != null;
  const a = row;

  // Reset overrides + edit state when switching rows
  useEffect(() => {
    setOverrides({});
    setEditCategory(false);
    setEditDepartment(false);
  }, [row?.id]);

  const currentUrgency = overrides.urgency !== undefined ? overrides.urgency : a?.urgency ?? null;
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
    } catch (e) {
      toast.error("Update failed", { description: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  async function patchDetails(patch: { urgency?: string | null; category?: string | null; department?: string | null }) {
    if (!a) return;
    setBusy(true);
    try {
      await updateAppointmentDetails(a.id, patch);
      setOverrides((o) => ({ ...o, ...patch }));
      toast.success("Updated", { description: "Classification overridden." });
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
        className="flex w-full flex-col gap-0 p-0 sm:max-w-2xl"
      >
        {!a ? (
          <div className="flex flex-1 items-center justify-center text-muted-foreground">Loading…</div>
        ) : (
          <>
            {/* Header */}
            <div className="flex items-start gap-3 border-b border-border bg-card px-6 py-4">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs font-semibold text-brand">{String(a.token).startsWith("TKN") ? a.token : `TKN${String(a.token).padStart(5, "0")}`}</span>
                  <span className={cn("rounded-full border px-2 py-0.5 text-[10px] font-semibold", STATUS_COLOR[a.status])}>
                    {a.status}
                  </span>
                  {a.urgency && (
                    <span className="rounded-full border border-orange-200 bg-orange-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-orange-700">
                      {a.urgency}
                    </span>
                  )}
                </div>
                <SheetTitle className="mt-1 text-base font-bold leading-snug">
                  {pick(a.headline, a.headline_ta) ?? "Appointment details"}
                </SheetTitle>
              </div>

              {/* Language toggle */}
              <LangToggle lang={lang} onChange={setLang} />

              <SheetClose className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
                <X className="h-5 w-5" />
              </SheetClose>
            </div>

            {/* Scrollable content */}
            <div className="flex-1 overflow-y-auto">
              <div className="space-y-4 p-6">
                {/* Citizen strip — urgency chip pinned top-right */}
                <div className="flex items-start gap-3 rounded-xl border border-border bg-card p-4 shadow-card">
                  <InitialsAvatar name={a.name} className="h-10 w-10 text-sm" />
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-foreground">{a.name ?? "—"}</div>
                    <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
                      <span className="inline-flex items-center gap-1"><Phone className="h-3 w-3" />{a.mobile ?? "—"}</span>
                      <span className="inline-flex items-center gap-1"><Hash className="h-3 w-3" />{String(a.token).startsWith("TKN") ? a.token : `TKN${String(a.token).padStart(5, "0")}`}</span>
                      <span className="inline-flex items-center gap-1"><CalendarDays className="h-3 w-3" />{formatDate(a.created_at)}</span>
                      {a.appointment_time && (
                        <span className="inline-flex items-center gap-1 text-emerald-600">
                          <CalendarDays className="h-3 w-3" />{formatDateTime(a.appointment_time)}
                        </span>
                      )}
                    </div>
                  </div>
                  {currentUrgency && (
                    <span className="ml-2 inline-flex shrink-0 items-center gap-1 rounded-full border border-orange-200 bg-orange-50 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-orange-700">
                      <ShieldAlert className="h-3 w-3" />{currentUrgency} urgency
                    </span>
                  )}
                </div>

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

                {/* Citizen's original description */}
                {a.description && (
                  <Panel icon={FileText} title="Citizen's description">
                    <p className="whitespace-pre-wrap text-[13.5px] leading-relaxed text-foreground/85">
                      {a.description}
                    </p>
                  </Panel>
                )}

                {/* Attachments + audio */}
                <Panel icon={Mic} title="Attachments & recordings">
                  <AttachmentGallery
                    attachments={[
                      ...(a.audio_url
                        ? [{ name: "Voice recording", url: a.audio_url, type: "AUDIO" as const }]
                        : []),
                      ...(a.attachments ?? []),
                    ]}
                    audioTranscript={a.audio_transcript}
                  />
                </Panel>

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

                    {/* Urgency — always editable */}
                    <div className="space-y-1.5">
                      <Label>Urgency</Label>
                      <Select
                        value={currentUrgency ?? undefined}
                        onValueChange={(v) => patchDetails({ urgency: v })}
                        disabled={busy}
                      >
                        <SelectTrigger className="h-9"><SelectValue placeholder="— Set urgency —" /></SelectTrigger>
                        <SelectContent>
                          {urgencyOptions.map((o) => (
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
            </div>
          </>
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
