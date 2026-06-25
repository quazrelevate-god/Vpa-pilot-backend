import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Merge Tailwind class names, de-duplicating conflicts. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const defaultDateTimeOptions: Intl.DateTimeFormatOptions = {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: true,
};

const defaultDateOptions: Intl.DateTimeFormatOptions = {
  day: "2-digit",
  month: "short",
  year: "numeric",
};

const defaultTimeOptions: Intl.DateTimeFormatOptions = {
  hour: "2-digit",
  minute: "2-digit",
  hour12: true,
};

/** Format a UTC ISO string as the user's local date + time. */
export function formatDateTime(
  iso: string | null | undefined,
  options: Intl.DateTimeFormatOptions = defaultDateTimeOptions
): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, options);
}

/** Format a UTC ISO string as the user's local date. */
export function formatDate(
  iso: string | null | undefined,
  options: Intl.DateTimeFormatOptions = defaultDateOptions
): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, options);
}

/** Format a UTC ISO string or time value as the user's local time. */
export function formatTime(
  iso: string | null | undefined,
  options: Intl.DateTimeFormatOptions = defaultTimeOptions
): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleTimeString(undefined, options);
}

/** Convert a UTC ISO string to a value suitable for a datetime-local input. */
export function toLocalDateTimeInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Convert a datetime-local input value back to UTC ISO string. */
export function fromLocalDateTimeInput(value: string): string | null {
  if (!value) return null;
  return new Date(value).toISOString();
}
