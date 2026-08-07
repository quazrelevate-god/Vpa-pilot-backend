"use client";

import { useEffect, useState } from "react";
import {
  X, MapPin, CalendarDays, Clock, CheckCircle2, FileText, Volume2, ImageOff, CircleDot,
} from "lucide-react";
import { useT } from "../_lib/i18n";
import {
  type EventItem, displayTitle, pickVenue, pickRawSummary, typeMeta,
} from "../_lib/types";

function fmtDate(iso: string | null, lang: "en" | "ta"): string {
  if (!iso) return lang === "ta" ? "தேதி இல்லை" : "No date";
  try {
    return new Date(iso + "T00:00:00").toLocaleDateString(lang === "ta" ? "ta-IN" : "en-IN",
      { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  } catch { return iso; }
}

/** One labelled fact in the detail grid. */
function Fact({ icon: Icon, label, value, accent }: {
  icon: React.ElementType; label: string; value: React.ReactNode; accent?: boolean;
}) {
  return (
    <div className="flex items-start gap-2.5 rounded-xl border border-border bg-card px-3.5 py-3">
      <span className={
        "mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg " +
        (accent ? "bg-emerald-50 text-emerald-600" : "bg-brand/10 text-brand")
      }>
        <Icon className="h-3.5 w-3.5" />
      </span>
      <div className="min-w-0">
        <div className="text-[10.5px] font-semibold uppercase tracking-[0.09em] text-muted-foreground">{label}</div>
        <div className="mt-0.5 text-[14px] font-medium leading-snug text-foreground">{value}</div>
      </div>
    </div>
  );
}

/** Read-only event detail — the Minister looks; there are no actions. Centred
 *  dialog on the tablet, with a graceful image state (a missing or broken photo
 *  shows a labelled placeholder, never a broken-image icon). */
export default function EventDetail({ e, onClose }: { e: EventItem; onClose: () => void }) {
  const { t, lang } = useT();
  const tm = typeMeta(e.event_type);
  const title = displayTitle(e, lang);
  const venue = pickVenue(e, lang);
  const summary = pickRawSummary(e, lang);
  const transcript = lang === "ta" ? (e.transcript_ta || e.transcript_en) : (e.transcript_en || e.transcript_ta);
  const timeLabel = e.start_time ? `${e.start_time}${e.end_time ? ` – ${e.end_time}` : ""}` : null;

  // Image state: "load" → "ok" | "fail". A 404 (file pruned, or not synced to
  // this environment) must degrade to a placeholder, not a broken icon.
  const [imgOk, setImgOk] = useState<boolean | null>(e.image_url ? null : false);

  // Esc closes — expected of a dialog.
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => { if (ev.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="mn-modal-backdrop fixed inset-0 z-50 grid place-items-center bg-slate-950/50 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="mn-modal-card flex max-h-[90vh] w-full max-w-[680px] flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-2xl"
        onClick={(ev) => ev.stopPropagation()}
      >
        {/* Hero — the photo, or a labelled placeholder when there isn't one. */}
        <div className="relative h-[190px] shrink-0 overflow-hidden bg-gradient-to-br from-brand/12 via-muted to-brand/5">
          {e.image_url && imgOk !== false && (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={e.image_url}
              alt={title}
              onLoad={() => setImgOk(true)}
              onError={() => setImgOk(false)}
              className="h-full w-full object-cover"
            />
          )}

          {imgOk === false && (
            <div className="flex h-full flex-col items-center justify-center gap-1.5 text-muted-foreground">
              <ImageOff className="h-7 w-7 opacity-40" />
              <span className="text-[12px] font-medium">
                {e.image_url
                  ? t("Photo unavailable", "படம் கிடைக்கவில்லை")
                  : t("No photo attached", "படம் இணைக்கப்படவில்லை")}
              </span>
            </div>
          )}

          {/* Scrim so the badge + close button stay readable over any photo. */}
          <div className="pointer-events-none absolute inset-x-0 top-0 h-20 bg-gradient-to-b from-black/45 to-transparent" />

          <span
            className="absolute left-4 top-4 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] font-semibold text-white shadow-sm"
            style={{ background: tm.color }}
          >
            <CircleDot className="h-3 w-3" />
            {lang === "ta" ? tm.ta : tm.en}
          </span>

          <button
            onClick={onClose}
            aria-label={t("Close", "மூடு")}
            className="absolute right-3 top-3 grid h-9 w-9 place-items-center rounded-full bg-black/35 text-white backdrop-blur-sm transition-colors hover:bg-black/55"
          >
            <X className="h-4.5 w-4.5" />
          </button>
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6">
          <h2 className="font-serif text-[24px] font-semibold leading-tight text-foreground">{title}</h2>

          <div className="mt-4 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            <Fact icon={CalendarDays} label={t("Date", "தேதி")} value={<span className="num">{fmtDate(e.date, lang)}</span>} />
            {timeLabel && (
              <Fact icon={Clock} label={t("Time", "நேரம்")} value={<span className="num">{timeLabel}</span>} />
            )}
            {venue && (
              <Fact icon={MapPin} label={t("Venue", "இடம்")} value={venue} />
            )}
            <Fact
              icon={CheckCircle2}
              label={t("Attendance", "வருகை")}
              accent={!!e.is_approved}
              value={e.is_approved
                ? t("Minister attending", "அமைச்சர் கலந்துகொள்கிறார்")
                : t("Not marked attending", "குறிக்கப்படவில்லை")}
            />
          </div>

          {summary && (
            <div className="mt-4 rounded-xl border border-border bg-card p-4">
              <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.09em] text-muted-foreground">
                <FileText className="h-3.5 w-3.5" /> {t("Details", "விவரங்கள்")}
              </div>
              <p className="whitespace-pre-line text-[14.5px] leading-relaxed text-foreground/90">{summary}</p>
            </div>
          )}

          {e.has_audio && transcript && (
            <div className="mt-3 rounded-xl border border-border bg-card p-4">
              <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.09em] text-muted-foreground">
                <Volume2 className="h-3.5 w-3.5" /> {t("Voice note", "குரல் குறிப்பு")}
              </div>
              <p className="whitespace-pre-line text-[14.5px] leading-relaxed text-foreground/90">{transcript}</p>
              {e.audio_url && <audio controls preload="none" src={e.audio_url} className="mt-3 w-full" />}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
