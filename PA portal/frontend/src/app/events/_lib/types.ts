// Wire types for the /events invitation-calendar PWA (see backend event_service.serialize).

export type EventStatus = "QUEUED" | "PROCESSING" | "READY" | "FAILED";

export type EventItem = {
  id: number;
  /** note ?? title_en ?? title_ta ?? "Untitled" — plain fallback string.
   *  Prefer displayTitle(item, lang) so the toggle actually switches scripts. */
  display_title: string;
  /** Legacy single-language mirror. `title_en` / `title_ta` are authoritative;
   *  this stays so old consumers still see a value. */
  title: string | null;
  /** Title in Latin script. Set for both EN- and TA-source cards
   *  (translation for TA-source). Empty string when card is unreadable. */
  title_en: string | null;
  /** Title in Tamil script. Same rule as title_en but for தமிழ். */
  title_ta: string | null;
  note: string | null;
  /** Legacy single-language mirror; use pickVenue(item, lang) to render. */
  venue: string | null;
  venue_en: string | null;
  venue_ta: string | null;
  /** Extra context — hosts, RSVP, multi-day schedule. Both scripts populated. */
  raw_summary_en: string | null;
  raw_summary_ta: string | null;
  event_type: string | null;
  /** YYYY-MM-DD, or null when no date was detected (needs review). */
  date: string | null;
  /** HH:MM 24h. Both times are required on create/edit and to approve;
   *  null on a live row means legacy data or an OCR extraction gap and
   *  the row will surface in Needs Review until the reviewer fixes it. */
  start_time: string | null;
  end_time: string | null;
  status: EventStatus;
  /** Approval gate — false until a reviewer clicks Approve after Minister
   *  confirmation. Only approved events appear on the calendar; unapproved
   *  rows sit in Needs Review. */
  /** Doubles as the ATTENDED marker under the new semantics: true means the
   *  reviewer marked the Minister as attending (or already having attended).
   *  Approve is only possible on today/future events. */
  is_approved: boolean;
  approved_by: string | null;
  approved_at: string | null;
  error_message: string | null;
  /** null for manually-created events with no photo uploaded. */
  image_url: string | null;
  /** false for manually-created events with no photo uploaded. */
  has_photo: boolean;
  /** True on voice-captured events (has audio_url + transcripts). */
  has_audio: boolean;
  audio_url: string | null;
  /** Sarvam STT source-language transcript (usually Tamil). "" when
   *  the event wasn't voice-captured. */
  transcript_ta: string;
  /** Sarvam STT English translation. */
  transcript_en: string;
  created_by: string;
  created_at: string | null;
  /** Who last edited this row + when. Null on rows never edited. */
  updated_by: string | null;
  updated_at: string | null;
};

/** Pick the title for the active language, falling back to the OTHER script
 *  when the requested side is empty — so a Tamil-only edit still renders on
 *  the English tab and vice versa. */
export function pickTitle(e: Pick<EventItem, "title_en" | "title_ta" | "title" | "note">, lang: "en" | "ta"): string {
  if (lang === "ta") return e.title_ta || e.title_en || e.title || "";
  return e.title_en || e.title_ta || e.title || "";
}

export function pickVenue(e: Pick<EventItem, "venue_en" | "venue_ta" | "venue">, lang: "en" | "ta"): string {
  if (lang === "ta") return e.venue_ta || e.venue_en || e.venue || "";
  return e.venue_en || e.venue_ta || e.venue || "";
}

/** The heading shown on cards/lists — note (PA's own annotation) still wins
 *  over the extracted title, matching the pre-bilingual behaviour. */
export function displayTitle(e: Pick<EventItem, "note" | "title_en" | "title_ta" | "title">, lang: "en" | "ta"): string {
  if (e.note) return e.note;
  return pickTitle(e, lang) || "Untitled";
}

export function pickRawSummary(e: Pick<EventItem, "raw_summary_en" | "raw_summary_ta">, lang: "en" | "ta"): string {
  if (lang === "ta") return e.raw_summary_ta || e.raw_summary_en || "";
  return e.raw_summary_en || e.raw_summary_ta || "";
}

export type EventsFeed = { items: EventItem[] };
export type NeedsReviewFeed = { items: EventItem[]; count: number };

/** Event-centric KPIs — the primary content of the Overview screen. Powered
 *  by `event_service.overview_events` on the backend; every field is a live
 *  aggregation over invitation_events, no client-side derivation. */
export type EventsOverview = {
  today: number;
  this_week: number;
  /** Subset of `this_week` — how many are already approved / confirmed. */
  this_week_confirmed: number;
  /** Split of the calendar month. Replaces the old ambiguous `this_month`
   *  (which overlapped with `upcoming`). Disjoint: past + upcoming = total. */
  past_this_month: number;
  upcoming_this_month: number;
  upcoming: number;
  awaiting_approval: number;
  needs_attention: number;
  week_range: { start: string; end: string };
  next_events: EventItem[];
  by_type_this_week: { type: string; count: number }[];
  attendance_this_month: { attended: number; not_attended: number };
  /** Rolling 30-day attendance. `rate` null when denominator is zero — UI
   *  should show a dash rather than dividing. */
  attendance_last_30d: { attended: number; total: number; rate: number | null };
  volume_last_8_weeks: { week_start: string; count: number }[];
};

export type OverviewData = {
  /** Event-centric KPIs — the primary section of the Overview screen. */
  events: EventsOverview;
  /** Office-wide totals kept alongside so the same screen still doubles as a
   *  quick office snapshot for advisors who want it. */
  totals: { tickets: number; appointments: number; meetings: number; petitions_received: number; petitions_awaiting: number; petitions_reviewed: number };
  today: { tickets: number; appointments: number; petitions_received: number; petitions_awaiting: number; petitions_reviewed: number };
  departments: { name: string; count: number }[];
};

/** Canonical event types (mirror backend EVENT_TYPES) with labels + chip colors. */
export const EVENT_TYPE_META: {
  value: string; en: string; ta: string; color: string;
}[] = [
  { value: "wedding",           en: "Wedding",           ta: "திருமணம்",              color: "#B2372D" },
  { value: "opening_ceremony",  en: "Opening ceremony",  ta: "திறப்பு விழா",          color: "#2F6FED" },
  { value: "temple_festival",   en: "Temple festival",   ta: "கோவில் திருவிழா",       color: "#CC6A1F" },
  { value: "political_meeting", en: "Political meeting", ta: "அரசியல் கூட்டம்",       color: "#21395B" },
  { value: "housewarming",      en: "Housewarming",      ta: "புதுமனை புகுவிழா",     color: "#4F8A5B" },
  { value: "memorial",          en: "Memorial",          ta: "நினைவு நிகழ்வு",        color: "#5A6472" },
  { value: "school_function",   en: "School function",   ta: "பள்ளி விழா",            color: "#0E7490" },
  // v2 additions (2026-08). Kept adjacent to "other" so any list ordering
  // by array index still keeps school_function grouped with school-adjacent.
  { value: "press_meet",        en: "Press meet",        ta: "செய்தியாளர் சந்திப்பு", color: "#B45309" },
  { value: "public_speaking",   en: "Public speaking",   ta: "பொதுச் சொற்பொழிவு",    color: "#4338CA" },
  { value: "other",             en: "Other",             ta: "மற்றவை",                color: "#7C3AED" },
];

export function typeMeta(value: string | null) {
  return EVENT_TYPE_META.find((m) => m.value === value)
    ?? EVENT_TYPE_META[EVENT_TYPE_META.length - 1];
}
