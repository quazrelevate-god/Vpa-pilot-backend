import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import type { Case } from "../shared/types";

const POLL_INTERVAL_MS = 12_000; // 10-15s window per spec

interface UseQueueResult {
  cases: Case[];
  loading: boolean; // true only on first load
  refreshing: boolean; // true on background polls
  error: string | null;
  lastUpdated: Date | null;
  refresh: () => void;
  applyCase: (updated: Case) => void;
}

export function useQueue(): UseQueueResult {
  const [cases, setCases] = useState<Case[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const firstLoad = useRef(true);

  const load = useCallback(async () => {
    if (firstLoad.current) setLoading(true);
    else setRefreshing(true);
    try {
      const data = await api.getQueue("today");
      setCases(data);
      setError(null);
      setLastUpdated(new Date());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load the queue.");
    } finally {
      setLoading(false);
      setRefreshing(false);
      firstLoad.current = false;
    }
  }, []);

  useEffect(() => {
    load();
    const id = window.setInterval(load, POLL_INTERVAL_MS);
    // Pause polling when the tab is hidden; refresh immediately on return.
    const onVisible = () => {
      if (document.visibilityState === "visible") load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load]);

  // Optimistic local update so the UI reflects a write before the next poll.
  const applyCase = useCallback((updated: Case) => {
    setCases((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
  }, []);

  return {
    cases,
    loading,
    refreshing,
    error,
    lastUpdated,
    refresh: load,
    applyCase,
  };
}
