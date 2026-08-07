"use client";

import { X, MapPin, CalendarDays, Clock, CheckCircle2, FileText, Volume2 } from "lucide-react";
import { useT } from "../_lib/i18n";
import {
  type EventItem, displayTitle, pickVenue, pickRawSummary, typeMeta,
} from "../_lib/types";

function fmtDate(iso: string | null, lang: "en" | "ta"): string {
  if (!iso) return lang === "ta" ? "தேதி இல்லை" : "No date";
  try {
    return new Date(iso + "T00:00:00").toLocaleDateString(lang === "ta" ? "ta-IN" : "en-IN",
      { weekday: "short", day: "numeric", month: "short", year: "numeric" });
  } catch { return iso; }
}

/** Read-only event detail overlay — the Minister looks; there are no actions. */
export default function EventDetail({ e, onClose }: { e: EventItem; onClose: () => void }) {
  const { t, lang } = useT();
  const tm = typeMeta(e.event_type);
  const title = displayTitle(e, lang);
  const venue = pickVenue(e, lang);
  const summary = pickRawSummary(e, lang);
  const transcript = lang === "ta" ? (e.transcript_ta || e.transcript_en) : (e.transcript_en || e.transcript_ta);
  const timeLabel = e.start_time ? `${e.start_time}${e.end_time ? ` – ${e.end_time}` : ""}` : null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/40" onClick={onClose}>
      <div
        className="mx-auto mt-auto flex max-h-[92vh] w-full max-w-[560px] flex-col overflow-hidden rounded-t-2xl bg-background pb-[env(safe-area-inset-bottom)] shadow-2xl"
        onClick={(ev) => ev.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
          <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-semibold text-white" style={{ background: tm.color }}>
            {lang === "ta" ? tm.ta : tm.en}
          </span>
          <button onClick={onClose} aria-label="Close" className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground">
            <X className="h-4.5 w-4.5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          {e.image_url && (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={e.image_url} alt={title}
              className="mb-4 max-h-[42vh] w-full rounded-xl border border-border object-contain bg-muted/30" />
          )}

          <h2 className="font-serif text-[21px] font-semibold leading-tight text-foreground">{title}</h2>

          <div className="mt-3 space-y-2 text-[14px] text-foreground/85">
            <div className="flex items-center gap-2">
              <CalendarDays className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="num">{fmtDate(e.date, lang)}</span>
            </div>
            {timeLabel && (
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="num">{timeLabel}</span>
              </div>
            )}
            {venue && (
              <div className="flex items-start gap-2">
                <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <span>{venue}</span>
              </div>
            )}
            <div className="flex items-center gap-2">
              <CheckCircle2 className={"h-4 w-4 shrink-0 " + (e.is_approved ? "text-[#0F8B4C]" : "text-muted-foreground/50")} />
              <span>{e.is_approved ? t("Minister attending", "அமைச்சர் கலந்துகொள்கிறார்") : t("Not marked attending", "குறிக்கப்படவில்லை")}</span>
            </div>
          </div>

          {summary && (
            <div className="mt-4 rounded-xl border border-border bg-card p-3.5">
              <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                <FileText className="h-3.5 w-3.5" /> {t("Details", "விவரங்கள்")}
              </div>
              <p className="whitespace-pre-line text-[14px] leading-relaxed text-foreground/90">{summary}</p>
            </div>
          )}

          {e.has_audio && transcript && (
            <div className="mt-3 rounded-xl border border-border bg-card p-3.5">
              <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                <Volume2 className="h-3.5 w-3.5" /> {t("Voice note", "குரல் குறிப்பு")}
              </div>
              <p className="whitespace-pre-line text-[14px] leading-relaxed text-foreground/90">{transcript}</p>
              {e.audio_url && (
                <audio controls preload="none" src={e.audio_url} className="mt-2 w-full" />
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
