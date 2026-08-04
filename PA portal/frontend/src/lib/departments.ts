/**
 * Departments registry client — DB is the source of truth.
 *
 * Any surface that lets a user pick or display a department (ticket assignment,
 * review drawer, tickets filter, dept-account creation) pulls from here instead
 * of the hardcoded SCHOOL_DEPARTMENTS list, so the two extra departments the
 * super-admin adds under Settings > Dept Accounts flow through everywhere.
 *
 * Cached at module scope for the tab's lifetime, but the cache is a small
 * pub-sub store: invalidateDepartments() (called after a Settings add/remove)
 * clears it, re-fetches, and NOTIFIES every mounted useDepartments() hook, so
 * open dropdowns (e.g. the ticket "assign to department" field) update live
 * without a page reload. On error the fetch keeps the last-known list (never
 * blanks the dropdown).
 */
"use client";

import { useEffect, useState } from "react";

export interface Department {
  key: string;
  display_en: string;
  display_ta: string | null;
}

let cache: Department[] | null = null;
let inflight: Promise<Department[]> | null = null;
const listeners = new Set<(rows: Department[]) => void>();

async function fetchDepartments(force = false): Promise<Department[]> {
  if (!force && cache) return cache;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const r = await fetch("/api/v1/departments", { credentials: "include", cache: "no-store" });
      if (!r.ok) throw new Error(`departments ${r.status}`);
      const data: Department[] = await r.json();
      cache = data;
      return data;
    } catch {
      // Keep the last-known list rather than blanking the dropdown on a blip.
      return cache ?? [];
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/**
 * Force a refresh — call after Settings edits. Clears the cache, re-fetches
 * once, and pushes the fresh list to every mounted useDepartments() so already
 * open dropdowns reflect the change immediately (no reload).
 */
export function invalidateDepartments(): void {
  cache = null;
  fetchDepartments(true).then((rows) => {
    listeners.forEach((notify) => notify(rows));
  });
}

/**
 * React hook returning [rows, loaded]. `loaded` flips true once the first fetch
 * settles (success OR failure) so callers can gate skeletons without waiting on
 * a non-empty list — a fresh install legitimately has zero rows. Subscribes to
 * invalidations so the list stays live for the component's lifetime.
 */
export function useDepartments(): { rows: Department[]; loaded: boolean } {
  const [rows, setRows] = useState<Department[]>(cache ?? []);
  const [loaded, setLoaded] = useState<boolean>(cache != null);
  useEffect(() => {
    let alive = true;
    const onChange = (next: Department[]) => {
      if (alive) setRows(next);
    };
    listeners.add(onChange);
    fetchDepartments().then((data) => {
      if (!alive) return;
      setRows(data);
      setLoaded(true);
    });
    return () => { alive = false; listeners.delete(onChange); };
  }, []);
  return { rows, loaded };
}

/** Localised label for a department key, with the fallback the API returns. */
export function departmentText(
  key: string | null | undefined,
  rows: Department[],
  lang?: string,
  fallback?: string | null,
): string {
  if (!key) return fallback ?? "—";
  const d = rows.find((x) => x.key === key);
  if (!d) return fallback ?? key.replace(/_/g, " ");
  return (lang === "ta" ? d.display_ta : d.display_en) ?? d.display_en ?? fallback ?? key;
}
