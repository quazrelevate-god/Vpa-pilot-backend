"use client";

// Event detail popup: Dialog with two tabs — the uploaded invitation photo and
// the extracted details (+ optional note). Details are editable; the event can
// be deleted; FAILED extractions can be retried.

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
import { EVENT_TYPE_META, typeMeta } from "../_lib/types";
import { fmtLongDate, fmtTime } from "../_lib/dates";
import { useT } from "../_lib/i18n";
import {
  AlertTriangle, Clock, Loader2, MapPin, Pencil, RotateCcw, StickyNote, Trash2,
} from "../_lib/icons";

type Draft = {
  title: string; note: string; venue: string; event_type: string;
  event_date: string; start_time: string; end_time: string;
};

function toDraft(e: EventItem): Draft {
  return {
    title: e.title ?? "",
    note: e.note ?? "",
    venue: e.venue ?? "",
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
    <div className="flex items-start gap-2.5 border-b border-slate-100 py-2.5 last:border-b-0">
      <span className="mt-0.5 text-slate-400 [&_svg]:h-4 [&_svg]:w-4">{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="text-[0.6rem] font-bold uppercase tracking-wide text-slate-400">{label}</div>
        <div className="mt-0.5 text-sm text-slate-800">{children}</div>
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
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [lightbox, setLightbox] = useState(false);

  // Reset transient state whenever a different event is opened.
  useEffect(() => {
    setEditing(false);
    setDraft(event ? toDraft(event) : null);
    setConfirmDelete(false);
  }, [event]);

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
      onDeleted();
    } catch (err) {
      toast.error((err as Error).message || t("Could not delete.", "நீக்க முடியவில்லை."));
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

  const inputCls = "h-10 text-sm";

  return (
    <Dialog open={!!event} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[88vh] w-[calc(100vw-2rem)] max-w-[520px] overflow-y-auto rounded-2xl p-0">
        {/* Header */}
        <div className="border-b border-slate-100 px-4 pb-3 pt-4">
          <div className="flex items-start gap-2">
            <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: meta.color }} />
            <div className="min-w-0 flex-1">
              <DialogTitle className="break-words text-base font-extrabold leading-snug text-slate-900">
                {event.display_title}
              </DialogTitle>
              <div className="mt-0.5 text-xs font-semibold text-slate-400">
                {t(meta.en, meta.ta)}
                {processing && (
                  <span className="ml-2 inline-flex items-center gap-1 text-[#CC6A1F]">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    {t("Extracting details…", "விவரங்கள் எடுக்கப்படுகிறது…")}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        <Tabs defaultValue="details" className="px-4 pb-4">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="photo">{t("Photo", "படம்")}</TabsTrigger>
            <TabsTrigger value="details">{t("Details", "விவரங்கள்")}</TabsTrigger>
          </TabsList>

          {/* ── Photo tab ── */}
          <TabsContent value="photo" className="mt-3">
            <button onClick={() => setLightbox(true)} className="block w-full">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={event.image_url} alt={t("Invitation photo", "அழைப்பிதழ் படம்")}
                className="max-h-[52vh] w-full rounded-lg border border-slate-200 object-contain" />
            </button>
            <p className="mt-1.5 text-center text-[0.65rem] text-slate-400">
              {t("Tap the photo to zoom.", "பெரிதாக்க படத்தை தட்டவும்.")}
            </p>
            <ImageLightbox
              images={[{ url: event.image_url, name: event.display_title }]}
              open={lightbox} onClose={() => setLightbox(false)} />
          </TabsContent>

          {/* ── Details tab ── */}
          <TabsContent value="details" className="mt-3">
            {event.status === "FAILED" && (
              <div className="mb-3 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.75} />
                <div>
                  <div className="font-bold">{t("Extraction failed", "விவரம் எடுக்க முடியவில்லை")}</div>
                  {event.error_message && <div className="mt-0.5 break-words opacity-80">{event.error_message}</div>}
                  <Button size="sm" variant="outline" disabled={busy} onClick={doRetry}
                    className="mt-2 h-8 gap-1.5 border-red-300 bg-white text-xs font-bold text-red-700">
                    <RotateCcw className="h-3.5 w-3.5" /> {t("Retry", "மீண்டும் முயற்சி")}
                  </Button>
                </div>
              </div>
            )}

            {!editing ? (
              <>
                <div className="rounded-lg border border-slate-200 bg-white px-3">
                  <Row icon={<Clock strokeWidth={1.75} />} label={t("Date & time", "தேதி & நேரம்")}>
                    {event.date ? (
                      <span className="font-mono text-sm tabular-nums">
                        {fmtLongDate(event.date, lang)}
                        {event.start_time && <> · {fmtTime(event.start_time)}</>}
                        {event.end_time && <> – {fmtTime(event.end_time)}</>}
                      </span>
                    ) : (
                      <span className="font-semibold text-[#CC6A1F]">
                        {t("No date detected — set one", "தேதி கண்டறியப்படவில்லை — அமைக்கவும்")}
                      </span>
                    )}
                  </Row>
                  <Row icon={<MapPin strokeWidth={1.75} />} label={t("Venue", "இடம்")}>
                    {event.venue || <span className="text-slate-400">—</span>}
                  </Row>
                  <Row icon={<Pencil strokeWidth={1.75} />} label={t("Extracted title", "எடுக்கப்பட்ட தலைப்பு")}>
                    {event.title || <span className="text-slate-400">—</span>}
                  </Row>
                  <Row icon={<StickyNote strokeWidth={1.75} />} label={t("Your note (shown on calendar)", "உங்கள் குறிப்பு (நாட்காட்டியில்)")}>
                    {event.note || <span className="text-slate-400">—</span>}
                  </Row>
                </div>

                <div className="mt-3 flex gap-2">
                  <Button variant="outline" onClick={() => setEditing(true)}
                    className="h-10 flex-1 gap-1.5 text-sm font-bold">
                    <Pencil className="h-4 w-4" strokeWidth={1.75} /> {t("Edit", "திருத்து")}
                  </Button>
                  {!confirmDelete ? (
                    <Button variant="outline" onClick={() => setConfirmDelete(true)}
                      className="h-10 gap-1.5 border-red-200 text-sm font-bold text-red-600">
                      <Trash2 className="h-4 w-4" strokeWidth={1.75} /> {t("Delete", "நீக்கு")}
                    </Button>
                  ) : (
                    <Button disabled={busy} onClick={doDelete}
                      className="h-10 gap-1.5 bg-red-600 text-sm font-bold text-white hover:bg-red-700">
                      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                      {t("Confirm delete?", "நீக்கவா?")}
                    </Button>
                  )}
                </div>
              </>
            ) : draft && (
              <div className="space-y-3">
                <div className="space-y-1">
                  <Label className="text-[0.65rem] font-bold uppercase text-slate-500">{t("Note (shown on calendar)", "குறிப்பு (நாட்காட்டியில்)")}</Label>
                  <Textarea value={draft.note} rows={2} className="text-sm"
                    onChange={(e) => set("note")(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label className="text-[0.65rem] font-bold uppercase text-slate-500">{t("Title", "தலைப்பு")}</Label>
                  <Input value={draft.title} className={inputCls}
                    onChange={(e) => set("title")(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label className="text-[0.65rem] font-bold uppercase text-slate-500">{t("Venue", "இடம்")}</Label>
                  <Input value={draft.venue} className={inputCls}
                    onChange={(e) => set("venue")(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label className="text-[0.65rem] font-bold uppercase text-slate-500">{t("Event type", "நிகழ்வு வகை")}</Label>
                  <select value={draft.event_type}
                    onChange={(e) => set("event_type")(e.target.value)}
                    className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm">
                    <option value="">{t("— none —", "— இல்லை —")}</option>
                    {EVENT_TYPE_META.map((m) => (
                      <option key={m.value} value={m.value}>{t(m.en, m.ta)}</option>
                    ))}
                  </select>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div className="col-span-3 space-y-1 sm:col-span-1">
                    <Label className="text-[0.65rem] font-bold uppercase text-slate-500">{t("Date", "தேதி")}</Label>
                    <Input type="date" value={draft.event_date} className={cn(inputCls, "font-mono tabular-nums")}
                      onChange={(e) => set("event_date")(e.target.value)} />
                  </div>
                  <div className="space-y-1 max-sm:col-span-2 sm:col-span-1">
                    <Label className="text-[0.65rem] font-bold uppercase text-slate-500">{t("Start", "தொடக்கம்")}</Label>
                    <Input type="time" value={draft.start_time} className={cn(inputCls, "font-mono tabular-nums")}
                      onChange={(e) => set("start_time")(e.target.value)} />
                  </div>
                  <div className="space-y-1 max-sm:col-span-1 sm:col-span-1">
                    <Label className="text-[0.65rem] font-bold uppercase text-slate-500">{t("End", "முடிவு")}</Label>
                    <Input type="time" value={draft.end_time} className={cn(inputCls, "font-mono tabular-nums")}
                      onChange={(e) => set("end_time")(e.target.value)} />
                  </div>
                </div>

                <div className="flex gap-2 pt-1">
                  <Button disabled={busy} onClick={save}
                    className="h-10 flex-1 gap-1.5 bg-[#2F6FED] text-sm font-bold text-white hover:bg-[#2558C4]">
                    {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                    {t("Save", "சேமி")}
                  </Button>
                  <Button variant="outline" disabled={busy}
                    onClick={() => { setEditing(false); setDraft(toDraft(event)); }}
                    className="h-10 text-sm font-bold">
                    {t("Cancel", "ரத்து")}
                  </Button>
                </div>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
