"use client";

// Prev / next arrow pair for a list-view detail drawer. Sits just left of the
// drawer's close (X) button, separated by a divider + padding. Each arrow
// disables at its boundary (no prev / no next) and while `loading` (a neighbor
// or a crossed-to page is being fetched). Pair with useDrawerNav for the logic.

import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export function DrawerNav({
  onPrev,
  onNext,
  hasPrev,
  hasNext,
  loading = false,
  className,
}: {
  onPrev?: () => void;
  onNext?: () => void;
  hasPrev: boolean;
  hasNext: boolean;
  loading?: boolean;
  className?: string;
}) {
  const btn =
    "grid h-8 w-8 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors " +
    "enabled:hover:bg-muted enabled:hover:text-foreground " +
    "disabled:cursor-not-allowed disabled:opacity-30 " +
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
  return (
    <div
      className={cn(
        "flex min-w-[4.25rem] items-center justify-center gap-0.5 border-r border-border pr-2",
        className,
      )}
    >
      {loading ? (
        // Same footprint as the two buttons so nothing shifts when it swaps.
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-label="Loading" />
      ) : (
        <>
          <button
            type="button"
            aria-label="Previous item"
            title="Previous (←)"
            onClick={onPrev}
            disabled={!hasPrev}
            className={btn}
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <button
            type="button"
            aria-label="Next item"
            title="Next (→)"
            onClick={onNext}
            disabled={!hasNext}
            className={btn}
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        </>
      )}
    </div>
  );
}
