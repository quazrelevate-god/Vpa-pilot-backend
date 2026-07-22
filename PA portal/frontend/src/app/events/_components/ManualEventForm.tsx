"use client";

// Bottom-sheet form for manually creating a calendar event (no OCR).
// All fields are typed by the user; photo is optional.

import { useRef, useState } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { api } from "../_lib/api";
import { EVENT_TYPE_META } from "../_lib/types";
import { useT } from "../_lib/i18n";
import { Camera, FolderOpen, Loader2, Send, X } from "../_lib/icons";

const MAX_DIM = 1600;
const JPEG_QUALITY = 0.8;

async function downscale(file: File): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_DIM / Math.max(bitmap.width, bitmap.height));
    const w = Math.round(bitmap.width * scale);
    const h = Math.round(bitmap.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close();
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", JPEG_QUALITY));
    return blob ?? file;
  } catch {
    return file;
  }
}

type Fields = {
  title: string; venue: string; event_type: string;
  event_date: string; start_time: string; end_time: string; note: string;
};

const EMPTY: Fields = {
  title: "", venue: "", event_type: "", event_date: "",
  start_time: "", end_time: "", note: "",
};

export default function ManualEventForm({
  open, onClose, onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useT();
  const cameraRef = useRef<HTMLInputElement>(null);
  const filesRef = useRef<HTMLInputElement>(null);
  const [fields, setFields] = useState<Fields>(EMPTY);
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [errors, setErrors] = useState<Partial<Fields>>({});
  const [busy, setBusy] = useState(false);

  const set = (k: keyof Fields) => (v: string) => {
    setFields((f) => ({ ...f, [k]: v }));
    setErrors((e) => ({ ...e, [k]: "" }));
  };

  function pickPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setPhoto(f);
    const url = URL.createObjectURL(f);
    setPhotoPreview(url);
    e.target.value = "";
  }

  function removePhoto() {
    if (photoPreview) URL.revokeObjectURL(photoPreview);
    setPhoto(null); setPhotoPreview(null);
  }

  function validate(): boolean {
    const e: Partial<Fields> = {};
    if (!fields.title.trim())      e.title      = t("Required", "தேவை");
    if (!fields.venue.trim())      e.venue      = t("Required", "தேவை");
    if (!fields.event_type)        e.event_type = t("Required", "தேவை");
    if (!fields.event_date)        e.event_date = t("Required", "தேவை");
    if (!fields.start_time)        e.start_time = t("Required", "தேவை");
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  function handleClose() {
    if (busy) return;
    setFields(EMPTY); setErrors({}); removePhoto(); onClose();
  }

  async function save() {
    if (!validate() || busy) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("title",      fields.title.trim());
      fd.append("venue",      fields.venue.trim());
      fd.append("event_type", fields.event_type);
      fd.append("event_date", fields.event_date);
      fd.append("start_time", fields.start_time);
      fd.append("end_time",   fields.end_time);
      fd.append("note",       fields.note.trim());
      if (photo) {
        const blob = await downscale(photo);
        fd.append("file", blob, blob.type === "image/jpeg" ? "photo.jpg" : photo.name);
      }
      await api.createManual(fd);
      toast.success(t("Event saved!", "நிகழ்வு சேமிக்கப்பட்டது!"));
      setFields(EMPTY); setErrors({}); removePhoto();
      onSaved();
    } catch (err) {
      toast.error((err as Error).message || t("Could not save. Try again.", "சேமிக்க முடியவில்லை."));
    } finally {
      setBusy(false);
    }
  }

  const inputCls = "h-12 text-base";
  const errCls = "mt-0.5 text-xs text-red-500 font-semibold";

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
      <SheetContent
        side="bottom"
        className="mx-auto max-h-[92vh] max-w-[560px] overflow-y-auto rounded-t-2xl px-5 pt-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))]"
      >
        <SheetTitle className="pr-10 text-left text-lg font-extrabold">
          {t("New Event", "புதிய நிகழ்வு")}
        </SheetTitle>

        <div className="mt-4 space-y-3">
          {/* Note — shown as calendar heading */}
          <div className="space-y-1">
            <Label className="text-[0.78rem] font-bold uppercase tracking-wide text-slate-500">
              {t("Note — shown as calendar heading", "குறிப்பு — நாட்காட்டி தலைப்பு")}
            </Label>
            <Textarea value={fields.note} rows={2} className="text-base"
              placeholder={t("e.g. Minister confirmed attendance", "எ.கா. அமைச்சர் வருகை உறுதி")}
              onChange={(e) => set("note")(e.target.value)} />
          </div>

          {/* Title */}
          <div className="space-y-1">
            <Label className="text-[0.78rem] font-bold uppercase tracking-wide text-slate-500">
              {t("Title", "தலைப்பு")} <span className="text-red-500">*</span>
            </Label>
            <Input value={fields.title} className={cn(inputCls, errors.title && "border-red-400")}
              placeholder={t("e.g. Karthik & Priya Wedding", "எ.கா. கார்த்திக் திருமண விழா")}
              onChange={(e) => set("title")(e.target.value)} />
            {errors.title && <p className={errCls}>{errors.title}</p>}
          </div>

          {/* Venue */}
          <div className="space-y-1">
            <Label className="text-[0.78rem] font-bold uppercase tracking-wide text-slate-500">
              {t("Venue", "இடம்")} <span className="text-red-500">*</span>
            </Label>
            <Input value={fields.venue} className={cn(inputCls, errors.venue && "border-red-400")}
              placeholder={t("e.g. SRM Mahal, Chennai", "எ.கா. SRM மகால், சென்னை")}
              onChange={(e) => set("venue")(e.target.value)} />
            {errors.venue && <p className={errCls}>{errors.venue}</p>}
          </div>

          {/* Event Type */}
          <div className="space-y-1">
            <Label className="text-[0.78rem] font-bold uppercase tracking-wide text-slate-500">
              {t("Event Type", "நிகழ்வு வகை")} <span className="text-red-500">*</span>
            </Label>
            <select value={fields.event_type}
              onChange={(e) => set("event_type")(e.target.value)}
              className={cn(
                "h-12 w-full rounded-md border bg-white px-3 text-base",
                errors.event_type ? "border-red-400" : "border-slate-200"
              )}>
              <option value="">{t("— select —", "— தேர்ந்தெடு —")}</option>
              {EVENT_TYPE_META.map((m) => (
                <option key={m.value} value={m.value}>{t(m.en, m.ta)}</option>
              ))}
            </select>
            {errors.event_type && <p className={errCls}>{errors.event_type}</p>}
          </div>

          {/* Date / Start / End */}
          <div className="grid grid-cols-3 gap-2">
            <div className="col-span-3 space-y-1 sm:col-span-1">
              <Label className="text-[0.78rem] font-bold uppercase tracking-wide text-slate-500">
                {t("Date", "தேதி")} <span className="text-red-500">*</span>
              </Label>
              <Input type="date" value={fields.event_date}
                className={cn(inputCls, "font-mono tabular-nums", errors.event_date && "border-red-400")}
                onChange={(e) => set("event_date")(e.target.value)} />
              {errors.event_date && <p className={errCls}>{errors.event_date}</p>}
            </div>
            <div className="space-y-1 max-sm:col-span-2 sm:col-span-1">
              <Label className="text-[0.78rem] font-bold uppercase tracking-wide text-slate-500">
                {t("Start", "தொடக்கம்")} <span className="text-red-500">*</span>
              </Label>
              <Input type="time" value={fields.start_time}
                className={cn(inputCls, "font-mono tabular-nums", errors.start_time && "border-red-400")}
                onChange={(e) => set("start_time")(e.target.value)} />
              {errors.start_time && <p className={errCls}>{errors.start_time}</p>}
            </div>
            <div className="space-y-1 max-sm:col-span-1 sm:col-span-1">
              <Label className="text-[0.78rem] font-bold uppercase tracking-wide text-slate-500">
                {t("End", "முடிவு")}
              </Label>
              <Input type="time" value={fields.end_time}
                className={cn(inputCls, "font-mono tabular-nums")}
                onChange={(e) => set("end_time")(e.target.value)} />
            </div>
          </div>

          {/* Optional photo */}
          <div className="space-y-1">
            <Label className="text-[0.78rem] font-bold uppercase tracking-wide text-slate-500">
              {t("Photo — optional", "படம் — விருப்பம்")}
            </Label>
            {photoPreview ? (
              <div className="relative overflow-hidden rounded-xl border border-slate-200 bg-black/5">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={photoPreview} alt="" className="max-h-[28vh] w-full object-contain" />
                <button onClick={removePhoto}
                  className="absolute right-2 top-2 grid h-9 w-9 place-items-center rounded-full bg-black/55 text-white backdrop-blur">
                  <X className="h-4 w-4" strokeWidth={1.75} />
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                <button onClick={() => cameraRef.current?.click()}
                  className="flex items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-200 py-3 text-sm font-bold text-slate-500 active:bg-slate-50">
                  <Camera className="h-5 w-5" strokeWidth={1.75} />
                  {t("Take photo", "படம் எடு")}
                </button>
                <button onClick={() => filesRef.current?.click()}
                  className="flex items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-200 py-3 text-sm font-bold text-slate-500 active:bg-slate-50">
                  <FolderOpen className="h-5 w-5" strokeWidth={1.75} />
                  {t("From files", "கோப்பிலிருந்து")}
                </button>
              </div>
            )}
            <input ref={cameraRef} type="file" accept="image/*" capture="environment"
              onChange={pickPhoto} className="hidden" />
            <input ref={filesRef} type="file" accept="image/*"
              onChange={pickPhoto} className="hidden" />
          </div>
        </div>

        {/* Save */}
        <Button onClick={save} disabled={busy}
          className="mt-5 h-14 w-full gap-2 rounded-xl bg-[#2F6FED] text-lg font-bold text-white hover:bg-[#2558C4] active:scale-[0.99] disabled:opacity-60">
          {busy ? <Loader2 className="h-6 w-6 animate-spin" /> : <Send className="h-6 w-6" strokeWidth={1.75} />}
          {busy ? t("Saving…", "சேமிக்கிறது…") : t("Save Event", "நிகழ்வு சேமி")}
        </Button>
      </SheetContent>
    </Sheet>
  );
}
