"use client";

// Floating capture button on the Calendar tab. Tap → choose "Take photo"
// (native camera) or "Choose from files"; after a photo is picked, a bottom
// sheet shows the preview + optional note + Send. The photo is downscaled
// client-side (≤1600px JPEG) before upload so mobile networks aren't pushing
// 8 MB originals.

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { api } from "../_lib/api";
import { useT } from "../_lib/i18n";
import { Camera, FolderOpen, Loader2, RefreshCw, Send, X } from "../_lib/icons";

const MAX_DIM = 1600;
const JPEG_QUALITY = 0.8;

/** Downscale to ≤MAX_DIM px JPEG; falls back to the original on any failure
 *  (e.g. HEIC the browser can't decode — the backend accepts it anyway). */
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
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY));
    return blob ?? file;
  } catch {
    return file;
  }
}

export default function CaptureFab({ onSent }: { onSent: () => void }) {
  const { t } = useT();
  const cameraRef = useRef<HTMLInputElement>(null);
  const filesRef = useRef<HTMLInputElement>(null);
  const [chooserOpen, setChooserOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!file) { setPreview(null); return; }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (f) { setFile(f); setChooserOpen(false); }
    e.target.value = ""; // same file can be re-picked after clearing
  }

  function close() {
    if (busy) return;
    setFile(null); setNote(""); setChooserOpen(false);
  }

  async function sendIt() {
    if (!file || busy) return;
    if (!navigator.onLine) {
      toast.error(t("No connection — photo not sent. Try again.", "இணைப்பு இல்லை — படம் அனுப்பப்படவில்லை."));
      return;
    }
    setBusy(true);
    try {
      const blob = await downscale(file);
      const fd = new FormData();
      const isJpeg = blob.type === "image/jpeg";
      fd.append("file", blob, isJpeg ? "invitation.jpg" : file.name);
      fd.append("note", note.trim());
      await api.create(fd);
      toast.success(t("Sent — extracting details…", "அனுப்பப்பட்டது — விவரங்கள் எடுக்கப்படுகிறது…"));
      setFile(null); setNote("");
      onSent();
    } catch (err) {
      toast.error((err as Error).message || t("Upload failed. Try again.", "பதிவேற்றம் தோல்வி. மீண்டும் முயற்சிக்கவும்."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <input ref={cameraRef} type="file" accept="image/*" capture="environment"
        onChange={pick} className="hidden" />
      <input ref={filesRef} type="file" accept="image/*"
        onChange={pick} className="hidden" />

      {/* FAB */}
      <button onClick={() => setChooserOpen(true)}
        aria-label={t("Add invitation", "அழைப்பிதழ் சேர்")}
        className="fixed bottom-[calc(var(--nav-h)+env(safe-area-inset-bottom)+16px)] right-4 z-40 grid h-16 w-16 place-items-center rounded-full bg-[#2F6FED] text-white shadow-xl shadow-[#2F6FED]/35 transition-transform active:scale-95">
        <Camera className="h-8 w-8" strokeWidth={1.75} />
      </button>

      {/* Source chooser */}
      <Sheet open={chooserOpen && !file} onOpenChange={(o) => { if (!o) setChooserOpen(false); }}>
        <SheetContent side="bottom" className="mx-auto max-w-[560px] rounded-t-2xl pb-[calc(1.25rem+env(safe-area-inset-bottom))]">
          <SheetTitle className="text-left text-lg font-extrabold">
            {t("Add an invitation", "அழைப்பிதழ் சேர்க்கவும்")}
          </SheetTitle>
          <p className="mt-1 text-base leading-relaxed text-slate-500">
            {t("Date, time, venue and event type are read automatically.",
               "தேதி, நேரம், இடம், நிகழ்வு வகை தானாக படிக்கப்படும்.")}
          </p>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <button onClick={() => cameraRef.current?.click()}
              className="flex flex-col items-center gap-3 rounded-2xl border-2 border-[#2F6FED]/30 bg-[#2F6FED]/5 p-6 active:bg-[#2F6FED]/10">
              <span className="grid h-16 w-16 place-items-center rounded-full bg-[#2F6FED] text-white">
                <Camera className="h-8 w-8" strokeWidth={1.75} />
              </span>
              <span className="text-base font-bold text-slate-900">{t("Take photo", "படம் எடு")}</span>
            </button>
            <button onClick={() => filesRef.current?.click()}
              className="flex flex-col items-center gap-3 rounded-2xl border-2 border-slate-200 bg-white p-6 active:bg-slate-50">
              <span className="grid h-16 w-16 place-items-center rounded-full bg-[#21395B] text-white">
                <FolderOpen className="h-8 w-8" strokeWidth={1.75} />
              </span>
              <span className="text-base font-bold text-slate-900">{t("From files", "கோப்பிலிருந்து")}</span>
            </button>
          </div>
        </SheetContent>
      </Sheet>

      {/* Preview + note + send */}
      <Sheet open={!!file} onOpenChange={(o) => { if (!o) close(); }}>
        <SheetContent side="bottom" className="mx-auto max-h-[92vh] max-w-[560px] overflow-y-auto rounded-t-2xl pb-[calc(1.25rem+env(safe-area-inset-bottom))]">
          <SheetTitle className="text-left text-lg font-extrabold">
            {t("Send invitation", "அழைப்பிதழ் அனுப்பு")}
          </SheetTitle>

          <div className="relative mt-3 overflow-hidden rounded-2xl border border-slate-200 bg-black/5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {preview && <img src={preview} alt="" className="max-h-[42vh] w-full object-contain" />}
            <div className="absolute right-2 top-2 flex gap-2">
              <button onClick={() => cameraRef.current?.click()}
                aria-label={t("Retake", "மீண்டும் எடு")}
                className="grid h-11 w-11 place-items-center rounded-full bg-black/55 text-white backdrop-blur">
                <RefreshCw className="h-5 w-5" strokeWidth={1.75} />
              </button>
              <button onClick={close}
                aria-label={t("Discard", "நிராகரி")}
                className="grid h-11 w-11 place-items-center rounded-full bg-black/55 text-white backdrop-blur">
                <X className="h-5 w-5" strokeWidth={1.75} />
              </button>
            </div>
          </div>

          <div className="mt-4 space-y-2">
            <label className="text-sm font-bold uppercase tracking-wide text-slate-500">
              {t("Note — optional, shown on the calendar", "குறிப்பு — விருப்பம், நாட்காட்டியில் காட்டப்படும்")}
            </label>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2}
              placeholder={t("e.g. Minister confirmed attendance", "எ.கா. அமைச்சர் வருகை உறுதி")}
              className="rounded-xl bg-white text-base" />
          </div>

          <Button onClick={sendIt} disabled={busy}
            className="mt-4 h-14 w-full gap-2 rounded-xl bg-[#2F6FED] text-lg font-bold text-white hover:bg-[#2558C4] active:scale-[0.99] disabled:opacity-60">
            {busy ? <Loader2 className="h-6 w-6 animate-spin" /> : <Send className="h-6 w-6" strokeWidth={1.75} />}
            {busy ? t("Sending…", "அனுப்புகிறது…") : t("Send", "அனுப்பு")}
          </Button>
        </SheetContent>
      </Sheet>
    </>
  );
}
