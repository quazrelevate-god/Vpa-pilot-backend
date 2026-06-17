import { useCallback, useEffect, useState } from "react";
import { api } from "../api/client";
import type { Slot } from "../shared/types";

interface UseSlotsResult {
  slots: Slot[];
  loading: boolean;
  error: string | null;
  reload: () => void;
}

export function useSlots(date: string): UseSlotsResult {
  const [slots, setSlots] = useState<Slot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.getSlots(date);
      // Show the day in chronological order.
      data.sort((a, b) => a.startTime.localeCompare(b.startTime));
      setSlots(data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load slots.");
    } finally {
      setLoading(false);
    }
  }, [date]);

  useEffect(() => {
    load();
  }, [load]);

  return { slots, loading, error, reload: load };
}
