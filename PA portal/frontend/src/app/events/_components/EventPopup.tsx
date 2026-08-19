"use client";

// Event detail popup: Dialog with two tabs — the uploaded invitation photo and
// the extracted details (+ optional note). Details are editable; deleting asks
// for confirmation in its own dialog; FAILED extractions can be retried.

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  Dialog, DialogContent, DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ImageLightbox } from "@/components/ui/image-lightbox";
import { api } from "../_lib/api";
import type { EventItem } from "../_lib/types";
import { EVENT_TYPE_META, displayTitle, pickRawSummary, pickTitle, pickVenue, typeMeta } from "../_lib/types";
import { fmtLongDate, fmtTime } from "../_lib/dates";
import { useT } from "../_lib/i18n";
import {
  AlertTriangle, Check, Clock, Loader2, MapPin, Mic, Pencil, RotateCcw, StickyNote, Trash2, X as XIcon,
} from "../_lib/icons";

type Draft = {
  title_en: string; title_ta: string;
  venue_en: string; venue_ta: string;
  note: string; event_type: string;
  event_date: string; start_time: string; end_time: string;
};

function toDraft(e: EventItem): Draft {
  return {
    title_en: e.title_en ?? "",
    title_ta: e.title_ta ?? "",
    venue_en: e.venue_en ?? "",
    venue_ta: e.venue_ta ?? "",
    note: e.note ?? "",
    event_type: e.event_type ?? "",
    event_date: e.date ?? "",
    start_time: e.start_time ?? "",
    end_time: e.end_time ?? "",
  };
}

function Row({ icon, label, children }: {
  icon: React.ReactNode; label: string; children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3 border-b border-slate-100 py-3 last:border-b-0">
      <span className="mt-0.5 text-slate-400 [&_svg]:h-5 [&_svg]:w-5">{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="text-[0.72rem] font-bold uppercase tracking-wide text-slate-400">{label}</div>
        <div className="mt-0.5 text-base text-slate-800">{children}</div>
      </div>
    </div>
  );
}

export default function EventPopup({ event, onClose, onChanged, onDeleted }: {
  event: EventItem | null;
  onClose: () => void;
  onChanged: (updated: EventItem) => void;
  onDeleted: () => void;
}) {
  const { t, lang } = useT();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [lightbox, setLightbox] = useState(false);

  // Reset transient state whenever a different event is opened.
  useEffect(() => {
    setEditing(false);
    setDraft(event ? toDraft(event) : null);
    setConfirmOpen(false);
  }, [event]);

  // While the row is still extracting — after a Retry, or a fresh capture
  // opened straight away — poll the single event so the popup shows the live
  // outcome without the reviewer closing and reopening: Extracting… →
  // Approve banner (success) or the error + Retry banner (failure). Stops the
  // moment the status leaves QUEUED/PROCESSING (onChanged updates the event
  // prop → this effect re-evaluates and clears the interval).
  const isProcessing = !!event && (event.status === "QUEUED" || event.status === "PROCESSING");
  useEffect(() => {
    // Pause while the reviewer is actively editing — delivering a terminal
    // status via onChanged would reset the popup and silently wipe their
    // in-progress edit. Polling resumes when they save/cancel (editing → false
    // re-runs this effect).
    if (!event || !isProcessing || editing) return;
    const id = event.id;
    let live = true;
    const timer = setInterval(async () => {
      try {
        const fresh = await api.get(id);
        if (!live) return;
        if (fresh.status !== "QUEUED" && fresh.status !== "PROCESSING") {
          onChanged(fresh);
        }
      } catch (err) {
        if (!live) return;
        // Event deleted server-side — stop and close instead of spinning
        // "Extracting…" against a 404 forever. Other errors are transient.
        if ((err as { status?: number }).status === 404) {
          live = false;
          clearInterval(timer);
          toast(t("This event was removed.", "இந்த நிகழ்வு நீக்கப்பட்டது."));
          onClose();
        }
      }
    }, 3000);
    return () => { live = false; clearInterval(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event?.id, isProcessing, editing]);

  if (!event) return null;
  const meta = typeMeta(event.event_type);
  const processing = event.status === "QUEUED" || event.status === "PROCESSING";

  const set = (k: keyof Draft) => (v: string) =>
    setDraft((d) => (d ? { ...d, [k]: v } : d));

  async function save() {
    if (!event || !draft) return;
    setBusy(true);
    try {
      const updated = await api.update(event.id, { ...draft });
      toast.success(t("Saved", "சேமிக்கப்பட்டது"));
      setEditing(false);
      onChanged(updated);
    } catch (err) {
      toast.error((err as Error).message || t("Could not save.", "சேமிக்க முடியவில்லை."));
    } finally {
      setBusy(false);
    }
  }

  async function doDelete() {
    if (!event) return;
    setBusy(true);
    try {
      await api.remove(event.id);
      toast.success(t("Event deleted", "நிகழ்வு நீக்கப்பட்டது"));
      setConfirmOpen(false);
      onDeleted();
    } catch (err) {
      toast.error((err as Error).message || t("Could not delete.", "நீக்க முடியவில்லை."));
    } finally {
      setBusy(false);
    }
  }

  async function doRetry() {
    if (!event) return;
    setBusy(true);
    try {
      const updated = await api.retry(event.id);
      toast(t("Retrying extraction…", "மீண்டும் முயற்சிக்கிறது…"));
      onChanged(updated);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function doApprove() {
    if (!event) return;
    setBusy(true);
    try {
      const updated = await api.approve(event.id);
      toast.success(t("Approved — now on the calendar", "அனுமதிக்கப்பட்டது — நாட்காட்டியில் காட்டப்படுகிறது"));
      onChanged(updated);
    } catch (err) {
      toast.error((err as Error).message || t("Approve failed", "அனுமதி தோல்வி"));
    } finally {
      setBusy(false);
    }
  }

  const inputCls = "h-12 text-base";

  return (
    <>
      <Dialog open={!!event} onOpenChange={(o) => { if (!o) onClose(); }}>
        <DialogContent className="max-h-[88vh] w-[calc(100vw-2rem)] max-w-[520px] overflow-y-auto rounded-2xl p-0">
          {/* Header */}
          <div className="border-b border-slate-100 px-4 pb-3 pt-4">
            <div className="flex items-start gap-2.5">
              <span className="mt-1.5 h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: meta.color }} />
              <div className="min-w-0 flex-1">
                <DialogTitle className="break-words text-lg font-extrabold leading-snug text-slate-900">
                  {displayTitle(event, lang)}
                </DialogTitle>
                <div className="mt-0.5 text-sm font-semibold text-slate-400">
                  {t(meta.en, meta.ta)}
                  {processing && (
                    <span className="ml-2 inline-flex items-center gap-1 text-[#CC6A1F]">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      {t("Extracting details…", "விவரங்கள் எடுக்கப்படுகிறது…")}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* One of three tab layouts depending on capture mode:
                 • photo   → Photo + Details
                 • voice   → Voice + Details
                 • manual  → Details only (full width) */}
          <Tabs defaultValue="details" className="px-4 pb-4">
            <TabsList className={cn(
              "grid h-12 w-full",
              (event.has_photo || event.has_audio) ? "grid-cols-2" : "grid-cols-1",
            )}>
              {event.has_photo && (
                <TabsTrigger value="photo" className="text-base font-bold">{t("Photo", "படம்")}</TabsTrigger>
              )}
              {event.has_audio && (
                <TabsTrigger value="voice" className="text-base font-bold">{t("Voice", "குரல்")}</TabsTrigger>
              )}
              <TabsTrigger value="details" className="text-base font-bold">
                {t("Details", "விவரங்கள்")}
              </TabsTrigger>
            </TabsList>

            {/* ── Photo tab ── */}
            {event.has_photo && event.image_url && (
            <TabsContent value="photo" className="mt-3">
              <button onClick={() => setLightbox(true)} className="block w-full">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={event.image_url} alt={t("Invitation photo", "அழைப்பிதழ் படம்")}
                  className="max-h-[52vh] w-full rounded-lg border border-slate-200 object-contain" />
              </button>
              <p className="mt-2 text-center text-sm text-slate-400">
                {t("Tap the photo to zoom.", "பெரிதாக்க படத்தை தட்டவும்.")}
              </p>
              <ImageLightbox
                images={[{ url: event.image_url, name: displayTitle(event, lang) }]}
                open={lightbox} onClose={() => setLightbox(false)} />
            </TabsContent>
            )}

            {/* ── Voice tab (voice-captured events only) ── */}
            {event.has_audio && event.audio_url && (
            <TabsContent value="voice" className="mt-3">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                <div className="mb-2 flex items-center gap-2 text-[13px] font-bold text-slate-700">
                  <Mic className="h-4 w-4 text-[#4F8A5B]" strokeWidth={1.75} />
                  {t("Recorded audio", "பதிவான குரல்")}
                </div>
                <audio controls src={event.audio_url} className="w-full" preload="metadata" />
              </div>

              {(event.transcript_ta || event.transcript_en) && (
                <div className="mt-4 space-y-3">
                  <div className="text-[0.72rem] font-bold uppercase tracking-wide text-slate-400">
                    {t("Transcript", "எழுத்துப்படி")}
                  </div>
                  {event.transcript_ta && (
                    <div className="rounded-lg border border-slate-200 bg-white p-3">
                      <div className="mb-1 text-[11px] font-bold uppercase tracking-wide text-slate-400">
                        {t("Source (Tamil)", "மூல மொழி (தமிழ்)")}
                      </div>
                      <p className="text-[14px] leading-relaxed text-slate-800">{event.transcript_ta}</p>
                    </div>
                  )}
                  {event.transcript_en && (
                    <div className="rounded-lg border border-slate-200 bg-white p-3">
                      <div className="mb-1 text-[11px] font-bold uppercase tracking-wide text-slate-400">
                        {t("English", "ஆங்கிலம்")}
                      </div>
                      <p className="text-[14px] leading-relaxed text-slate-800">{event.transcript_en}</p>
                    </div>
                  )}
                </div>
              )}
            </TabsContent>
            )}

            {/* ── Details tab ── */}
            <TabsContent value="details" className="mt-3">
              {event.status === "FAILED" && (event.has_photo || event.has_audio) && (
                <div className="mb-3 flex items-start gap-2.5 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                  <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" strokeWidth={1.75} />
                  <div>
                    <div className="font-bold">{t("Extraction failed", "விவரம் எடுக்க முடியவில்லை")}</div>
                    {event.error_message && <div className="mt-0.5 break-words opacity-80">{event.error_message}</div>}
                    <Button size="sm" variant="outline" disabled={busy} onClick={doRetry}
                      className="mt-2 h-10 gap-1.5 border-red-300 bg-white text-sm font-bold text-red-700">
                      <RotateCcw className="h-4 w-4" /> {t("Retry", "மீண்டும் முயற்சி")}
                    </Button>
                  </div>
                </div>
              )}

              {/* Approve-to-mark-attended banner. Only shown when the row is
                  fully-formed AND today or later — approval is forward-looking
                  under the new semantics; past events can't be marked
                  attended from the UI (server 409s too). */}
              {(() => {
                if (event.is_approved) return null;
                if (event.status !== "READY") return null;
                // end_time is optional — start alone is enough to approve.
                if (!event.date || !event.start_time) return null;
                const today = new Date();
                const todayISO = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
                if (event.date < todayISO) return null;
                return (
                  <div className="mb-3 flex items-start gap-2.5 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">
                    <div className="mt-0.5 h-5 w-5 shrink-0 rounded-full bg-blue-500/15" />
                    <div className="min-w-0 flex-1">
                      <div className="font-bold">{t("Awaiting confirmation", "உறுதிசெய்ய காத்திருக்கிறது")}</div>
                      <div className="mt-0.5 opacity-80">
                        {t(
                          "Confirm with the Minister, then approve to mark as attending.",
                          "அமைச்சரிடம் உறுதிசெய்து, வருகை பதிய அனுமதிக்கவும்.",
                        )}
                      </div>
                      <Button size="sm" disabled={busy} onClick={doApprove}
                        className="mt-2 h-10 gap-1.5 bg-[#2F6FED] px-4 text-sm font-bold text-white hover:bg-[#2456bd]">
                        {t("Approve", "அனுமதி")}
                      </Button>
                    </div>
                  </div>
                );
              })()}

              {/* Past + unapproved hint. These rows now surface in Needs
                  Review (a retry can re-extract to a past date); a past event
                  can't be approved as-is, so point the reviewer at the fix. */}
              {(() => {
                if (event.is_approved) return null;
                if (event.status !== "READY") return null;
                if (!event.date || !event.start_time) return null;
                const today = new Date();
                const todayISO = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
                if (event.date >= todayISO) return null;
                return (
                  <div className="mb-3 flex items-start gap-2.5 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
                    <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-slate-500" strokeWidth={1.75} />
                    <div>
                      <div className="font-bold text-slate-700">{t("This event is in the past", "இந்த நிகழ்வு கடந்துவிட்டது")}</div>
                      <div className="mt-0.5 opacity-90">
                        {t(
                          "Approval is forward-looking — edit the date to a future day to approve it, or delete it.",
                          "அனுமதி எதிர்கால நிகழ்வுகளுக்கே — அனுமதிக்க தேதியை எதிர்கால நாளாக மாற்றவும், அல்லது நீக்கவும்.",
                        )}
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* Attended banner removed — calendar now filters to approved
                  rows only, so anything the reviewer opens from the calendar
                  is by definition attended. The banner was redundant noise. */}

              {!editing ? (
                <>
                  <div className="rounded-lg border border-slate-200 bg-white px-3">
                    <Row icon={<Clock strokeWidth={1.75} />} label={t("Date & time", "தேதி & நேரம்")}>
                      {event.date ? (
                        <span className="font-mono text-base tabular-nums">
                          {fmtLongDate(event.date, lang)}
                          {event.start_time
                            ? <> · {fmtTime(event.start_time)}</>
                            : <span className="text-[#CC6A1F]"> · {t("no start time", "தொடக்க நேரம் இல்லை")}</span>}
                          {/* end_time is optional — if missing, just show
                              start alone, no orange warning. */}
                          {event.end_time && <> – {fmtTime(event.end_time)}</>}
                        </span>
                      ) : (
                        <span className="font-semibold text-[#CC6A1F]">
                          {t("No date detected — set one", "தேதி கண்டறியப்படவில்லை — அமைக்கவும்")}
                        </span>
                      )}
                    </Row>
                    <Row icon={<MapPin strokeWidth={1.75} />} label={t("Venue", "இடம்")}>
                      {pickVenue(event, lang) || <span className="text-slate-400">—</span>}
                    </Row>
                    <Row icon={<Pencil strokeWidth={1.75} />} label={t("Extracted title", "எடுக்கப்பட்ட தலைப்பு")}>
                      {pickTitle(event, lang) || <span className="text-slate-400">—</span>}
                    </Row>
                    {pickRawSummary(event, lang) && (
                      <Row icon={<StickyNote strokeWidth={1.75} />} label={t("More context", "மேலும் விவரம்")}>
                        <span className="text-sm leading-relaxed text-slate-600">{pickRawSummary(event, lang)}</span>
                      </Row>
                    )}
                    <Row icon={<StickyNote strokeWidth={1.75} />} label={t("Your note (shown on calendar)", "உங்கள் குறிப்பு (நாட்காட்டியில்)")}>
                      {event.note || <span className="text-slate-400">—</span>}
                    </Row>
                  </div>

                  <div className="mt-3 flex gap-2">
                    <Button variant="outline" onClick={() => setEditing(true)}
                      className="h-12 flex-1 gap-2 text-base font-bold">
                      <Pencil className="h-5 w-5" strokeWidth={1.75} /> {t("Edit", "திருத்து")}
                    </Button>
                    <Button variant="outline" onClick={() => setConfirmOpen(true)}
                      className="h-12 gap-2 border-red-200 px-5 text-base font-bold text-red-600 hover:border-red-300 hover:bg-red-50 hover:text-red-700">
                      <Trash2 className="h-5 w-5" strokeWidth={1.75} /> {t("Delete", "நீக்கு")}
                    </Button>
                  </div>
                </>
              ) : draft && (
                <div className="space-y-3">
                  <div className="space-y-1">
                    <Label className="text-[0.78rem] font-bold uppercase text-slate-500">{t("Note (shown on calendar)", "குறிப்பு (நாட்காட்டியில்)")}</Label>
                    <Textarea value={draft.note} rows={2} className="text-base"
                      onChange={(e) => set("note")(e.target.value)} />
                  </div>
                  {/* Bilingual title — one input per script, both saved. The
                       backend keeps them in sync; the toggle picks which side
                       to render on read screens. */}
                  <div className="space-y-1">
                    <Label className="text-[0.78rem] font-bold uppercase text-slate-500">
                      {t("Title (English)", "தலைப்பு (English)")}
                    </Label>
                    <Input value={draft.title_en} className={inputCls} placeholder="e.g. Karthik & Priya Wedding"
                      onChange={(e) => set("title_en")(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[0.78rem] font-bold uppercase text-slate-500">
                      {t("Title (Tamil)", "தலைப்பு (தமிழ்)")}
                    </Label>
                    <Input value={draft.title_ta} className={inputCls} placeholder="எ.கா. கார்த்திக் & பிரியா திருமண விழா"
                      onChange={(e) => set("title_ta")(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[0.78rem] font-bold uppercase text-slate-500">
                      {t("Venue (English)", "இடம் (English)")}
                    </Label>
                    <Input value={draft.venue_en} className={inputCls} placeholder="e.g. SRM Mahal, Tambaram"
                      onChange={(e) => set("venue_en")(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[0.78rem] font-bold uppercase text-slate-500">
                      {t("Venue (Tamil)", "இடம் (தமிழ்)")}
                    </Label>
                    <Input value={draft.venue_ta} className={inputCls} placeholder="எ.கா. எஸ்.ஆர்.எம். மஹால், தாம்பரம்"
                      onChange={(e) => set("venue_ta")(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[0.78rem] font-bold uppercase text-slate-500">{t("Event type", "நிகழ்வு வகை")}</Label>
                    <select value={draft.event_type}
                      onChange={(e) => set("event_type")(e.target.value)}
                      className="h-12 w-full rounded-md border border-slate-200 bg-white px-3 text-base">
                      <option value="">{t("— none —", "— இல்லை —")}</option>
                      {EVENT_TYPE_META.map((m) => (
                        <option key={m.value} value={m.value}>{t(m.en, m.ta)}</option>
                      ))}
                    </select>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <div className="col-span-3 space-y-1 sm:col-span-1">
                      <Label className="text-[0.78rem] font-bold uppercase text-slate-500">{t("Date", "தேதி")}</Label>
                      <Input type="date" value={draft.event_date} className={cn(inputCls, "font-mono tabular-nums")}
                        onChange={(e) => set("event_date")(e.target.value)} />
                    </div>
                    <div className="space-y-1 max-sm:col-span-2 sm:col-span-1">
                      <Label className="text-[0.78rem] font-bold uppercase text-slate-500">{t("Start", "தொடக்கம்")} *</Label>
                      <Input type="time" required value={draft.start_time}
                        className={cn(inputCls, "font-mono tabular-nums", !draft.start_time && "border-red-400")}
                        onChange={(e) => set("start_time")(e.target.value)} />
                    </div>
                    <div className="space-y-1 max-sm:col-span-1 sm:col-span-1">
                      <Label className="text-[0.78rem] font-bold uppercase text-slate-500">
                        {t("End", "முடிவு")}
                        <span className="ml-1 font-normal normal-case text-slate-400">{t("(optional)", "(விருப்பம்)")}</span>
                      </Label>
                      <Input type="time" value={draft.end_time}
                        className={cn(inputCls, "font-mono tabular-nums")}
                        onChange={(e) => set("end_time")(e.target.value)} />
                    </div>
                  </div>

                  <div className="flex gap-2 pt-1">
                    {/* Save gated on start_time only — end is optional,
                        matching the server approve rule. */}
                    <Button disabled={busy || !draft.start_time} onClick={save}
                      className="h-12 flex-1 gap-2 bg-[#2F6FED] text-base font-bold text-white hover:bg-[#2558C4]">
                      {busy && <Loader2 className="h-5 w-5 animate-spin" />}
                      {t("Save", "சேமி")}
                    </Button>
                    <Button variant="outline" disabled={busy}
                      onClick={() => { setEditing(false); setDraft(toDraft(event)); }}
                      className="h-12 px-5 text-base font-bold">
                      {t("Cancel", "ரத்து")}
                    </Button>
                  </div>
                </div>
              )}
            </TabsContent>
          </Tabs>

          {/* ── Delete confirmation (overlay inside the popup — a second Radix
                 dialog would register as an outside interaction and close
                 everything) ── */}
          {confirmOpen && (
            <div className="fixed inset-0 z-50 flex items-center justify-center rounded-2xl bg-black/45 p-5"
              role="alertdialog" aria-modal="true">
              <div className="w-full max-w-[360px] rounded-2xl bg-white p-5 shadow-2xl">
                <div className="flex items-start gap-3">
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-red-50 text-red-600">
                    <Trash2 className="h-5 w-5" strokeWidth={1.75} />
                  </span>
                  <div>
                    <div className="text-lg font-extrabold text-slate-900">
                      {t("Delete this event?", "இந்த நிகழ்வை நீக்கவா?")}
                    </div>
                    <p className="mt-1 text-base leading-relaxed text-slate-500">
                      {t("The photo and all details will be removed for everyone. This cannot be undone.",
                         "படமும் விவரங்களும் அனைவருக்கும் நீக்கப்படும். இதை மீட்க முடியாது.")}
                    </p>
                  </div>
                </div>
                <div className="mt-4 flex gap-2">
                  <Button variant="outline" disabled={busy} onClick={() => setConfirmOpen(false)}
                    className="h-12 flex-1 text-base font-bold">
                    {t("Cancel", "ரத்து")}
                  </Button>
                  <Button variant="destructive" disabled={busy} onClick={doDelete}
                    className="h-12 flex-1 gap-2 text-base font-bold">
                    {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Trash2 className="h-5 w-5" strokeWidth={1.75} />}
                    {t("Delete", "நீக்கு")}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
