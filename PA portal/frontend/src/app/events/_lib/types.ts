// Wire types for the /events invitation-calendar PWA (see backend event_service.serialize).

export type EventStatus = "QUEUED" | "PROCESSING" | "READY" | "FAILED";

/** Post-event outcome, set manually by the PA. Null = not marked yet. */
export type Attendance = "attended" | "not_attended" | null;

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
  /** HH:MM 24h, or null (all-day). */
  start_time: string | null;
  end_time: string | null;
  status: EventStatus;
  attendance: Attendance;
  error_message: string | null;
  /** null for manually-created events with no photo uploaded. */
  image_url: string | null;
  /** false for manually-created events with no photo uploaded. */
  has_photo: boolean;
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

export type OverviewData = {
  totals: { tickets: number; appointments: number; meetings: number; petitions_received: number; petitions_awaiting: number; petitions_reviewed: number };
  today: { tickets: number; appointments: number; petitions_received: number; petitions_awaiting: number; petitions_reviewed: number };
  departments: { name: string; count: number }[];
};

/** Canonical event types (mirror backend EVENT_TYPES) with labels + chip colors. */
export const EVENT_TYPE_META: {
  value: string; en: string; ta: string; color: string;
}[] = [
  { value: "wedding",           en: "Wedding",           ta: "திருமணம்",          color: "#B2372D" },
  { value: "opening_ceremony",  en: "Opening ceremony",  ta: "திறப்பு விழா",      color: "#2F6FED" },
  { value: "temple_festival",   en: "Temple festival",   ta: "கோவில் திருவிழா",   color: "#CC6A1F" },
  { value: "political_meeting", en: "Political meeting", ta: "அரசியல் கூட்டம்",   color: "#21395B" },
  { value: "housewarming",      en: "Housewarming",      ta: "புதுமனை புகுவிழா", color: "#4F8A5B" },
  { value: "memorial",          en: "Memorial",          ta: "நினைவு நிகழ்வு",    color: "#5A6472" },
  { value: "school_function",   en: "School function",   ta: "பள்ளி விழா",        color: "#0E7490" },
  { value: "other",             en: "Other",             ta: "மற்றவை",            color: "#7C3AED" },
];

export function typeMeta(value: string | null) {
  return EVENT_TYPE_META.find((m) => m.value === value)
    ?? EVENT_TYPE_META[EVENT_TYPE_META.length - 1];
}
