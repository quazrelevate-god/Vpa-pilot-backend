// Minimal date math for the calendar (Monday-start weeks, Asia/Kolkata naive
// dates throughout — the backend stores naive local dates, so plain local Date
// objects are correct and no timezone conversion happens anywhere).

export function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function toISO(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function fromISO(iso: string): Date {
  return new Date(iso + "T00:00:00");
}

export function addDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + n);
  return out;
}

export function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
}

/** Monday of the week containing d. */
export function startOfWeek(d: Date): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  const dow = (out.getDay() + 6) % 7; // Mon=0 … Sun=6
  return addDays(out, -dow);
}

/** The 7 days (Mon–Sun) of the week containing anchor. */
export function weekDays(anchor: Date): Date[] {
  const mon = startOfWeek(anchor);
  return Array.from({ length: 7 }, (_, i) => addDays(mon, i));
}

/** 42 cells (6 rows × 7 days, Monday start) covering the month of anchor. */
export function monthCells(anchor: Date): Date[] {
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const start = startOfWeek(first);
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

/** "HH:MM" → minutes since midnight, or null. */
export function toMinutes(t: string | null): number | null {
  if (!t) return null;
  const [h, m] = t.split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
}

/** "14:30" → "2:30 PM" (12-hour, what the office reads). */
export function fmtTime(t: string | null): string {
  const mins = toMinutes(t);
  if (mins === null) return "";
  const h = Math.floor(mins / 60), m = mins % 60;
  const ampm = h < 12 ? "AM" : "PM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${pad2(m)} ${ampm}`;
}

const MONTHS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_TA = ["ஜன", "பிப்", "மார்", "ஏப்", "மே", "ஜூன்", "ஜூலை", "ஆக", "செப்", "அக்", "நவ", "டிச"];
const DAYS_EN = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const DAYS_TA = ["திங்", "செவ்", "புத", "வியா", "வெள்", "சனி", "ஞாயி"];

export function monthLabel(d: Date, lang: "en" | "ta"): string {
  const months = lang === "ta" ? MONTHS_TA : MONTHS_EN;
  return `${months[d.getMonth()]} ${d.getFullYear()}`;
}

export function weekRangeLabel(anchor: Date, lang: "en" | "ta"): string {
  const days = weekDays(anchor);
  const a = days[0], b = days[6];
  const months = lang === "ta" ? MONTHS_TA : MONTHS_EN;
  if (a.getMonth() === b.getMonth()) {
    return `${a.getDate()}–${b.getDate()} ${months[a.getMonth()]} ${b.getFullYear()}`;
  }
  return `${a.getDate()} ${months[a.getMonth()]} – ${b.getDate()} ${months[b.getMonth()]} ${b.getFullYear()}`;
}

/** Mon/Tue… header label. Index is Monday-based (0–6). */
export function dayName(i: number, lang: "en" | "ta"): string {
  return (lang === "ta" ? DAYS_TA : DAYS_EN)[i];
}

export function fmtLongDate(iso: string, lang: "en" | "ta"): string {
  const d = fromISO(iso);
  const dow = (d.getDay() + 6) % 7;
  const months = lang === "ta" ? MONTHS_TA : MONTHS_EN;
  return `${dayName(dow, lang)}, ${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
}
