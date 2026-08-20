// Turn any caught error into a message that's safe + sensible to show a user.
//
// Two kinds of error reach the UI:
//   • Intentional business messages — clean 4xx text the backend wrote FOR the
//     user ("Slot full, kindly select another slot", "Only failed events can
//     be retried", 422 field validation). These we PRESERVE.
//   • Technical failures — 5xx bodies (HTML / stack / SQLAlchemy text),
//     network TypeErrors ("Failed to fetch"), JSON-parse errors, runtime bugs.
//     These we REPLACE with a friendly generic so we never leak internals.
//
// The api layers attach `.status` to thrown errors; this uses it to classify.
// Errors without a status fall back to a keyword guard so technical strings
// still never reach the user.

export interface AppError extends Error {
  status?: number;
}

const GENERIC = "Something went wrong. Please try again.";
const NETWORK = "Network error — check your connection and try again.";
const EXPIRED = "Your session has expired. Please sign in again.";
const FORBIDDEN = "You don't have access to that.";
const NOT_FOUND = "That item couldn't be found.";

// Fragments that mark a message as technical/internal — never show these.
const TECHNICAL =
  /failed to fetch|load failed|networkerror|network request failed|\bhttp \d{3}\b|\bstatus \d{3}\b|internal server error|bad gateway|service unavailable|gateway timeout|<!?html|<!doctype|traceback|sqlalchemy|psycopg|integrityerror|programmingerror|unexpected token|is not a function|cannot read propert|is not defined|undefined is not|null is not/i;

function isNetwork(err: unknown, raw: string): boolean {
  // fetch() rejects with a TypeError whose message is browser-specific.
  if (err instanceof TypeError && /fetch|load failed|network/i.test(raw)) return true;
  return /failed to fetch|load failed|networkerror|network request failed/i.test(raw);
}

/**
 * Safe, user-facing message for a caught error.
 * @param fallback shown when the real cause is technical or unknown.
 */
export function toUserMessage(err: unknown, fallback: string = GENERIC): string {
  if (err == null) return fallback;
  const raw = (err instanceof Error ? err.message : String(err))?.trim() || "";

  if (isNetwork(err, raw)) return NETWORK;

  const status = (err as AppError)?.status;
  if (typeof status === "number") {
    if (status === 0) return NETWORK;
    if (status === 401) return EXPIRED;
    if (status === 403) return FORBIDDEN;
    if (status === 404) return NOT_FOUND;
    if (status >= 500) return GENERIC;
    // 4xx (400 / 409 / 422 / …): backend business message — keep it unless it
    // still smells technical.
    if (raw && !TECHNICAL.test(raw)) return raw;
    return fallback;
  }

  // No status: catch the common auth phrasing, then preserve a clean message
  // and genericize anything technical.
  if (/\bunauthori[sz]ed\b|not authenticated/i.test(raw)) return EXPIRED;
  if (raw && !TECHNICAL.test(raw)) return raw;
  return fallback;
}

/**
 * The backend's business message if it's safe to show, else "" so a caller
 * can fall back to its OWN (often localized) generic — e.g.
 *   toast.error(businessMessage(err) || t("Couldn't save", "சேமிக்க முடியவில்லை"))
 * Preserves clean 4xx detail while never surfacing 5xx/network/technical text.
 */
export function businessMessage(err: unknown): string {
  if (err == null) return "";
  const raw = (err instanceof Error ? err.message : String(err))?.trim() || "";
  if (!raw) return "";
  if (isNetwork(err, raw)) return "";
  const status = (err as AppError)?.status;
  if (typeof status === "number" && status >= 500) return "";
  if (TECHNICAL.test(raw)) return "";
  return raw;
}

/**
 * Convenience for `toast.error(...)` — returns `{ description }` only when the
 * message adds detail beyond the title, so we don't repeat the same line.
 */
export function errorToast(err: unknown, title = "Something went wrong"): { description?: string } {
  const msg = toUserMessage(err, "");
  return msg && msg !== title ? { description: msg } : {};
}
