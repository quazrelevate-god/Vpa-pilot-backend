// Wire types for the /events invitation-calendar PWA (see backend event_service.serialize).

export type EventStatus = "QUEUED" | "PROCESSING" | "READY" | "FAILED";

export type EventItem = {
  id: number;
  /** note ?? title ?? "Untitled" — what the calendar shows. */
  display_title: string;
  title: string | null;
  note: string | null;
  venue: string | null;
  event_type: string | null;
  /** YYYY-MM-DD, or null when no date was detected (needs review). */
  date: string | null;
  /** HH:MM 24h, or null (all-day). */
  start_time: string | null;
  end_time: string | null;
  status: EventStatus;
  error_message: string | null;
  image_url: string;
  created_by: string;
  created_at: string | null;
};

export type EventsFeed = { items: EventItem[] };
export type NeedsReviewFeed = { items: EventItem[]; count: number };

export type OverviewData = {
  totals: { tickets: number; appointments: number; meetings: number };
  today: { tickets: number; appointments: number; petitions: number };
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
