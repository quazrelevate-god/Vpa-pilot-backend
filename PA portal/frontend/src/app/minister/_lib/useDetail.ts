"use client";

import { useEffect, useState } from "react";
import { Unauthorized } from "./api";

/**
 * Row-click detail state for the read-only drawers. Selecting an id fetches the
 * full record; a 401 bounces to the login; closing clears it. Mirrors the
 * pattern the staff dashboards use (proposal-dashboard / association-dashboard).
 */
export function useDetail<T>(fetcher: (id: number, signal?: AbortSignal) => Promise<T>) {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (selectedId == null) { setDetail(null); return; }
    const ac = new AbortController();
    let alive = true;
    setLoading(true);
    fetcher(selectedId, ac.signal)
      .then((d) => { if (alive) setDetail(d); })
      .catch((e) => {
        if (ac.signal.aborted) return;
        if (e instanceof Unauthorized) { window.location.href = "/minister/login"; return; }
        if (alive) setDetail(null);
      })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; ac.abort(); };
  }, [selectedId, fetcher]);

  return { selectedId, setSelectedId, detail, loading, close: () => setSelectedId(null) };
}
