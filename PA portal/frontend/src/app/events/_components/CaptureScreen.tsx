"use client";

// WhatsApp-style capture: native camera via <input capture="environment">
// (file picker on desktop), preview, optional note, Send. The photo is
// downscaled client-side (≤1600px JPEG) before upload so mobile networks
// aren't pushing 8 MB originals.

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { api } from "../_lib/api";
import { useT } from "../_lib/i18n";
import { Camera, Loader2, RefreshCw, Send, X } from "../_lib/icons";

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

export default function CaptureScreen({ onSent }: { onSent: () => void }) {
  const { t } = useT();
  const inputRef = useRef<HTMLInputElement>(null);
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
    if (f) setFile(f);
    e.target.value = ""; // same file can be re-picked after clearing
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
    <div className="flex flex-col gap-4 px-4 pt-4">
      <input ref={inputRef} type="file" accept="image/*" capture="environment"
        onChange={pick} className="hidden" />

      {!file ? (
        // ── Shutter card ──
        <button onClick={() => inputRef.current?.click()}
          className="group flex min-h-[46vh] flex-col items-center justify-center gap-4 rounded-2xl border-2 border-dashed border-slate-300 bg-white/70 p-8 transition-colors active:border-[#2F6FED] active:bg-[#2F6FED]/5">
          <span className="grid h-20 w-20 place-items-center rounded-full bg-[#21395B] text-white shadow-lg shadow-[#21395B]/25 transition-transform group-active:scale-95">
            <Camera className="h-9 w-9" strokeWidth={1.75} />
          </span>
          <div className="text-center">
            <div className="text-base font-extrabold text-slate-900">
              {t("Photograph an invitation", "அழைப்பிதழை படமெடுக்கவும்")}
            </div>
            <div className="mt-1 max-w-[260px] text-xs leading-relaxed text-slate-500">
              {t(
                "Take a clear photo of the card. Date, time, venue and event type are read automatically.",
                "அட்டையின் தெளிவான படம் எடுக்கவும். தேதி, நேரம், இடம் தானாக படிக்கப்படும்.",
              )}
            </div>
          </div>
        </button>
      ) : (
        // ── Preview + note + send ──
        <>
          <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-black/5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {preview && <img src={preview} alt="" className="max-h-[46vh] w-full object-contain" />}
            <div className="absolute right-2 top-2 flex gap-1.5">
              <button onClick={() => inputRef.current?.click()}
                aria-label={t("Retake", "மீண்டும் எடு")}
                className="grid h-9 w-9 place-items-center rounded-full bg-black/55 text-white backdrop-blur">
                <RefreshCw className="h-4 w-4" strokeWidth={1.75} />
              </button>
              <button onClick={() => { setFile(null); setNote(""); }}
                aria-label={t("Discard", "நிராகரி")}
                className="grid h-9 w-9 place-items-center rounded-full bg-black/55 text-white backdrop-blur">
                <X className="h-4 w-4" strokeWidth={1.75} />
              </button>
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-bold uppercase tracking-wide text-slate-500">
              {t("Note — optional, shown on the calendar", "குறிப்பு — விருப்பம், நாட்காட்டியில் காட்டப்படும்")}
            </label>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2}
              placeholder={t("e.g. Minister confirmed attendance", "எ.கா. அமைச்சர் வருகை உறுதி")}
              className="rounded-xl bg-white text-sm" />
          </div>

          <Button onClick={sendIt} disabled={busy}
            className="h-12 w-full gap-2 rounded-xl bg-[#2F6FED] text-base font-bold text-white hover:bg-[#2558C4] active:scale-[0.99] disabled:opacity-60">
            {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" strokeWidth={1.75} />}
            {busy ? t("Sending…", "அனுப்புகிறது…") : t("Send", "அனுப்பு")}
          </Button>
        </>
      )}
    </div>
  );
}
