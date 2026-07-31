"use client";

// Bottom-sheet flow for creating an event by SPEAKING it into the phone.
//
// UX contract:
//   1. Tap the big blue button → asks for mic permission → starts recording.
//   2. Timer + waveform-ish pulse show it's live. Tap again → stops.
//   3. A preview playback + optional PA note appears; tap Send.
//   4. Sheet closes IMMEDIATELY on Send tap. A sonner toast.promise tracks
//      the upload — loading → success (row lands in Needs Review) or error.
//      No blocking "Reading…" button state; the user is free to keep working
//      while Gemini transcribes + extracts in the background.
//   5. onSaved() refreshes the parent when the toast turns green so the
//      new row appears in Needs Review right away.
//
// Constraints:
//   * MediaRecorder mimeType is browser-dependent; we prefer webm+opus and
//     fall back to whatever the browser will actually record.
//   * Hard-cap at 90s so nobody sends a 5-min ramble to Gemini.
//   * Fully self-contained: cleans up the stream + object URL on close so
//     the mic light doesn't stay on after the sheet is dismissed.

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { useT } from "../_lib/i18n";
import { Mic, RefreshCw, Send, Square, X } from "../_lib/icons";

const MAX_SECONDS = 90;

/** Pick a mimeType the browser can actually record. Order = preference. */
function pickMimeType(): string {
  const cands = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/mp4",
    "audio/mp4;codecs=mp4a.40.2",
  ];
  for (const c of cands) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(c)) {
      return c;
    }
  }
  return "";
}

export default function VoiceCaptureSheet({
  open, onClose, onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useT();
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [note, setNote] = useState("");

  // Refs — MediaRecorder / stream / timer live outside React state so a
  // stop-mid-tick can flush the final chunk before we tear down the stream.
  const mediaRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const timerRef = useRef<number | null>(null);
  const mimeRef = useRef<string>("");
  // Guards a double-tap on Send. A ref (not state) because we don't want a
  // re-render — the sheet is about to unmount anyway. Reset would only ever
  // matter if send throws synchronously before the sheet closes; the
  // fetch runs inside an IIFE so the ref is set true, sheet closes, done.
  const sendingRef = useRef(false);

  // Preview URL lifecycle
  useEffect(() => {
    if (!blob) { setPreviewUrl(null); return; }
    const url = URL.createObjectURL(blob);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [blob]);

  const stopStream = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((tr) => tr.stop());
      streamRef.current = null;
    }
    mediaRef.current = null;
  }, []);

  // Guaranteed teardown on unmount / sheet close.
  useEffect(() => () => stopStream(), [stopStream]);

  const reset = useCallback(() => {
    setBlob(null); setSeconds(0); setNote(""); setRecording(false);
  }, []);

  const closeSheet = useCallback(() => {
    stopStream();
    reset();
    onClose();
  }, [stopStream, reset, onClose]);

  const startRecording = useCallback(async () => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      toast.error(t("Voice capture not supported on this device.",
        "இந்த சாதனத்தில் குரல் பதிவு ஆதரிக்கப்படவில்லை."));
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      mimeRef.current = pickMimeType();
      const mr = mimeRef.current
        ? new MediaRecorder(stream, { mimeType: mimeRef.current })
        : new MediaRecorder(stream);
      // The actual chosen mime may differ from the requested one on some
      // browsers; take what MR picked so the blob type matches.
      mimeRef.current = mr.mimeType || mimeRef.current;
      chunksRef.current = [];
      mr.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) chunksRef.current.push(ev.data);
      };
      mr.onstop = () => {
        const b = new Blob(chunksRef.current, { type: mimeRef.current || "audio/webm" });
        setBlob(b);
        setRecording(false);
        stopStream();
      };
      mediaRef.current = mr;
      mr.start(1000);  // 1s chunks — smooth timer + partial safety
      setRecording(true);
      setSeconds(0);
      // Timer + hard-stop guard
      timerRef.current = window.setInterval(() => {
        setSeconds((s) => {
          const next = s + 1;
          if (next >= MAX_SECONDS && mediaRef.current?.state === "recording") {
            mediaRef.current.stop();
            toast.info(t(`Recording capped at ${MAX_SECONDS}s`,
              `${MAX_SECONDS} விநாடிகளுக்கு மேல் பதிவு செய்ய முடியாது`));
          }
          return next;
        });
      }, 1000);
    } catch (err) {
      // Most commonly: permission denied. Give the user a clear cue.
      stopStream();
      const msg = (err as Error).name === "NotAllowedError"
        ? t("Microphone permission blocked. Unblock it in browser settings.",
            "மைக்ரோஃபோன் அனுமதி தடுக்கப்பட்டது. உலாவி அமைப்பில் அனுமதிக்கவும்.")
        : (err as Error).message || t("Could not start recording.", "பதிவு தொடங்க முடியவில்லை.");
      toast.error(msg);
    }
  }, [t, stopStream]);

  const stopRecording = useCallback(() => {
    if (mediaRef.current?.state === "recording") {
      mediaRef.current.stop();  // onstop handler assembles the Blob + tears down
    } else {
      stopStream();
    }
  }, [stopStream]);

  const retake = useCallback(() => {
    reset();
  }, [reset]);

  const send = useCallback(() => {
    if (!blob || sendingRef.current) return;
    sendingRef.current = true;
    // OPTIMISTIC UX — close the sheet on click. Do NOT await the request.
    // Was previously a blocking await: user tapped Send, the button flipped
    // to "Reading…" with a spinner for the 3–5s Gemini took to transcribe +
    // extract, and only then did the sheet close. Felt broken (especially
    // with the earlier 502s). Now the sheet dismisses immediately, a sonner
    // toast tracks progress, and success/failure lands on the toast — the
    // user is free to keep working. If it fails, the toast carries the
    // error message so they can retry (recording is lost, but voice memos
    // are short enough to re-do — same trade-off as any optimistic form).
    const fd = new FormData();
    const ext = (mimeRef.current || "audio/webm").split("/")[1]?.split(";")[0] || "webm";
    fd.append("file", blob, `voice.${ext}`);
    fd.append("note", note.trim());

    const sending = (async () => {
      const res = await fetch("/events/api/events/voice", {
        method: "POST",
        body: fd,
        credentials: "include",
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.detail || d.error || `http ${res.status}`);
      }
      // Refresh the parent so the new row appears in Needs Review the
      // moment the toast turns green. onSaved is safe to call twice
      // (parent just re-fetches) so no need to guard.
      onSaved();
    })();

    toast.promise(sending, {
      loading: t("Sending voice memo…", "குரல் அனுப்பப்படுகிறது…"),
      success: t("Event captured — check Needs Review.",
                 "நிகழ்வு உருவாக்கப்பட்டது — சரிபார்க்க தாவலைத் திறக்கவும்."),
      error: (err: unknown) =>
        (err as Error)?.message ||
        t("Send failed. Try again.", "அனுப்ப முடியவில்லை. மீண்டும் முயற்சிக்கவும்."),
    });

    // Close the sheet right now — no busy gate anywhere in the flow so
    // closeSheet unmounts immediately and the toast becomes the only UI
    // for this action.
    closeSheet();
  }, [blob, note, onSaved, closeSheet, t]);

  const mmss = `${String(Math.floor(seconds / 60)).padStart(1, "0")}:${String(seconds % 60).padStart(2, "0")}`;

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) closeSheet(); }}>
      <SheetContent
        side="bottom"
        className="mx-auto max-h-[92vh] max-w-[560px] overflow-y-auto rounded-t-2xl px-5 pt-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))]"
      >
        <SheetTitle className="pr-10 text-left text-lg font-extrabold">
          {t("Speak the event", "நிகழ்வை பேசவும்")}
        </SheetTitle>
        <p className="mt-1 text-[13px] leading-relaxed text-slate-500">
          {t(
            "Say the event name, host, date, time and venue. We'll read it back and create the event for review.",
            "நிகழ்வின் பெயர், நடத்துபவர், தேதி, நேரம், இடம் சொல்லுங்கள். எடுத்துக்கொண்டு மதிப்பாய்வுக்கு உருவாக்குகிறோம்.",
          )}
        </p>

        {/* ── Big record / stop button ─────────────────────────────────── */}
        {!blob && (
          <div className="mt-6 flex flex-col items-center gap-3">
            <button
              type="button"
              onClick={recording ? stopRecording : startRecording}
              aria-label={recording ? t("Stop", "நிறுத்து") : t("Record", "பதிவு செய்")}
              className={cn(
                "relative grid h-28 w-28 place-items-center rounded-full text-white shadow-xl transition-transform active:scale-95",
                recording
                  ? "bg-red-500 shadow-red-500/35"
                  : "bg-[#2F6FED] shadow-[#2F6FED]/35",
              )}
            >
              {recording && (
                <span className="absolute inset-0 animate-ping rounded-full bg-red-500/40" aria-hidden />
              )}
              {recording
                ? <Square className="relative h-10 w-10" strokeWidth={2} />
                : <Mic    className="relative h-11 w-11" strokeWidth={1.75} />}
            </button>

            <div className="font-mono text-2xl font-bold tabular-nums text-slate-800">
              {mmss}
              <span className="ml-1 text-xs font-normal text-slate-400">
                / {String(Math.floor(MAX_SECONDS / 60))}:{String(MAX_SECONDS % 60).padStart(2, "0")}
              </span>
            </div>

            <div className="text-[13px] text-slate-500">
              {recording
                ? t("Recording… tap the square to finish.", "பதிவு செய்யப்படுகிறது… நிறுத்த சதுரத்தை தட்டவும்.")
                : t("Tap the mic to start.", "தொடங்க மைக் தட்டவும்.")}
            </div>
          </div>
        )}

        {/* ── Preview + note + send ────────────────────────────────────── */}
        {blob && previewUrl && (
          <div className="mt-4 space-y-4">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
              <audio controls src={previewUrl} className="w-full" />
              <div className="mt-2 flex items-center justify-between text-[12px] text-slate-500">
                <span className="font-mono tabular-nums">{mmss}</span>
                <button
                  onClick={retake}
                  className="inline-flex items-center gap-1 rounded-md px-2 py-1 font-semibold text-[#2F6FED] hover:bg-white"
                >
                  <RefreshCw className="h-3.5 w-3.5" strokeWidth={2} />
                  {t("Retake", "மீண்டும் பேசு")}
                </button>
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-[0.78rem] font-bold uppercase tracking-wide text-slate-500">
                {t("Note — optional, shown on the calendar",
                  "குறிப்பு — விருப்பம், நாட்காட்டியில் காட்டப்படும்")}
              </label>
              <Textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
                placeholder={t("e.g. Minister confirmed attendance",
                  "எ.கா. அமைச்சர் வருகை உறுதி")}
                className="rounded-xl bg-white text-base"
              />
            </div>

            {/* Send is optimistic — click closes the sheet immediately and a
                sonner toast tracks the upload. No "Reading…" state on the
                button because it's gone the instant it's tapped. */}
            <Button
              onClick={send}
              className="h-14 w-full gap-2 rounded-xl bg-[#2F6FED] text-lg font-bold text-white hover:bg-[#2558C4] active:scale-[0.99]"
            >
              <Send className="h-6 w-6" strokeWidth={1.75} />
              {t("Send", "அனுப்பு")}
            </Button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
