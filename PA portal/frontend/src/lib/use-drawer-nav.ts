"use client";

// Prev/next navigation for a list-view detail drawer. Given the currently
// loaded page of rows and the open row's key, it computes hasPrev/hasNext and
// wires ← / → keyboard. At a page boundary it crosses pages: it flips the
// parent's `page` and, once the new page's rows arrive, selects the first (on
// next) or last (on prev) row — so the reviewer can walk the whole result set
// without closing the drawer.
//
// Volatile inputs (list, callbacks) are read through a ref so onPrev/onNext
// stay referentially stable — the keyboard listener isn't re-bound every
// render, and callers don't need to memoise anything.

import { useCallback, useEffect, useRef, useState } from "react";

export interface UseDrawerNavOptions<T> {
  /** The currently loaded page of rows (what the user sees). */
  list: T[];
  /** Stable key for a row — e.g. String(row.id), or `${kind}:${id}` when two
   *  tables are interleaved and ids can collide. */
  keyOf: (row: T) => string;
  /** Key of the open row, or null when the drawer is closed. */
  currentKey: string | null;
  /** Open a row (set the parent's selected id/row). */
  onSelect: (row: T) => void;
  /** 1-based current page + last page, for cross-page navigation. */
  page: number;
  lastPage: number;
  onPage: (p: number) => void;
  /** ← / → to navigate while the drawer is open. Default on. */
  enableKeyboard?: boolean;
}

export interface DrawerNavState {
  hasPrev: boolean;
  hasNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  /** True while waiting for a crossed-to page to load (feed into DrawerNav's
   *  `loading` so the arrows disable until the new row is ready). */
  navBusy: boolean;
}

export function useDrawerNav<T>(opts: UseDrawerNavOptions<T>): DrawerNavState {
  const { list, keyOf, currentKey, page, lastPage, enableKeyboard = true } = opts;
  const ref = useRef(opts);
  ref.current = opts;

  // "first" / "last" = which row to select once the crossed-to page loads.
  const [pending, setPending] = useState<null | "first" | "last">(null);

  const idx = currentKey == null ? -1 : list.findIndex((r) => keyOf(r) === currentKey);
  const hasPrev = currentKey != null && (idx > 0 || page > 1);
  const hasNext = currentKey != null && idx >= 0 && (idx < list.length - 1 || page < lastPage);

  const goPrev = useCallback(() => {
    const o = ref.current;
    const i = o.currentKey == null ? -1 : o.list.findIndex((r) => o.keyOf(r) === o.currentKey);
    if (i > 0) { o.onSelect(o.list[i - 1]); return; }
    if (o.page > 1) { setPending("last"); o.onPage(o.page - 1); }
  }, []);

  const goNext = useCallback(() => {
    const o = ref.current;
    const i = o.currentKey == null ? -1 : o.list.findIndex((r) => o.keyOf(r) === o.currentKey);
    if (i >= 0 && i < o.list.length - 1) { o.onSelect(o.list[i + 1]); return; }
    if (o.page < o.lastPage) { setPending("first"); o.onPage(o.page + 1); }
  }, []);

  // Apply the pending selection when the crossed-to page's rows arrive. The
  // `list` reference only changes when the parent replaces it with new data,
  // so this fires on the new page — not on intermediate renders.
  useEffect(() => {
    if (!pending) return;
    if (list.length === 0) return; // wait for the new page (or nothing to pick)
    ref.current.onSelect(pending === "first" ? list[0] : list[list.length - 1]);
    setPending(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list, pending]);

  // ← / → while the drawer is open. Ignore when typing in a field or when a
  // modifier is held, so it never fights the edit forms inside the drawers.
  useEffect(() => {
    if (!enableKeyboard || currentKey == null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA"
        || el.tagName === "SELECT" || el.isContentEditable)) return;
      if (e.key === "ArrowLeft") { e.preventDefault(); goPrev(); }
      else if (e.key === "ArrowRight") { e.preventDefault(); goNext(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enableKeyboard, currentKey, goPrev, goNext]);

  return { hasPrev, hasNext, onPrev: goPrev, onNext: goNext, navBusy: pending !== null };
}
