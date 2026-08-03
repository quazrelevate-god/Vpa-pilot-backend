/**
 * Departments registry client — DB is the source of truth.
 *
 * Any surface that lets a user pick or display a department (ticket assignment,
 * review drawer, tickets filter, dept-account creation) pulls from here instead
 * of the hardcoded SCHOOL_DEPARTMENTS list, so the two extra departments the
 * super-admin adds under Settings > Dept Accounts flow through everywhere.
 *
 * Cached at module scope for the tab's lifetime — a session-level cache is
 * enough: the list changes only when an admin edits Settings, and a page
 * reload picks up the change. On error the fetch resolves to an empty list
 * (never throws), so a bad response never wedges the dropdown.
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

async function fetchDepartments(): Promise<Department[]> {
  if (cache) return cache;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const r = await fetch("/api/v1/departments", { credentials: "include", cache: "no-store" });
      if (!r.ok) throw new Error(`departments ${r.status}`);
      const data: Department[] = await r.json();
      cache = data;
      return data;
    } catch {
      return [];
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/** Force a refresh — call after Settings edits so open drawers see the new list. */
export function invalidateDepartments(): void {
  cache = null;
}

/**
 * React hook returning [rows, loaded]. `loaded` flips true once the first fetch
 * settles (success OR failure) so callers can gate skeletons without waiting on
 * a non-empty list — a fresh install legitimately has zero rows.
 */
export function useDepartments(): { rows: Department[]; loaded: boolean } {
  const [rows, setRows] = useState<Department[]>(cache ?? []);
  const [loaded, setLoaded] = useState<boolean>(cache != null);
  useEffect(() => {
    let alive = true;
    fetchDepartments().then((data) => {
      if (!alive) return;
      setRows(data);
      setLoaded(true);
    });
    return () => { alive = false; };
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
