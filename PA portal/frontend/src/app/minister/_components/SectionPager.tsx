"use client";

import { useRef, useState, type ReactNode } from "react";
import { type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export interface PagerSection {
  key: string;
  label: string;
  icon: LucideIcon;
  /** Optional count shown as a pill beside the label. */
  count?: number;
  content: ReactNode;
}

/**
 * Two-section dashboard shell — "Dashboard" (the numbers + charts) and
 * "Records" (the table). The switcher sits in normal flow at the top of the
 * content (NOT sticky) so it can never overlap the cards beneath it; switching
 * smooth-scrolls back to the top and cross-fades the pane. Swipe works on touch.
 */
export function SectionPager({
  filterBar, sections,
}: { filterBar?: ReactNode; sections: PagerSection[] }) {
  const [active, setActive] = useState(0);
  const [dir, setDir] = useState<1 | -1>(1);
  const touchX = useRef<number | null>(null);

  const rootRef = useRef<HTMLDivElement>(null);
  const clamp = (i: number) => Math.max(0, Math.min(sections.length - 1, i));
  const goto = (i: number) => {
    const next = clamp(i);
    if (next === active) return;
    setDir(next > active ? 1 : -1);
    setActive(next);
    // Only <main> scrolls in this app shell (the window never does), so send the
    // scroll there; fall back to the window if the shell ever changes.
    const scroller = rootRef.current?.closest<HTMLElement>("[data-minister-scroll]");
    if (scroller) scroller.scrollTo({ top: 0, behavior: "smooth" });
    else window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const onTouchStart = (e: React.TouchEvent) => { touchX.current = e.touches[0].clientX; };
  const onTouchEnd = (e: React.TouchEvent) => {
    if (touchX.current == null) return;
    const dx = e.changedTouches[0].clientX - touchX.current;
    if (Math.abs(dx) > 60) goto(active + (dx < 0 ? 1 : -1));
    touchX.current = null;
  };

  const n = sections.length;

  return (
    <div ref={rootRef} className="space-y-4">
      {/* Section switcher — normal flow, full-width segmented control with a
          sliding brand indicator. Never overlaps content. */}
      <div className="mn-seg relative flex w-full p-1.5">
        <div
          className="mn-seg-indicator absolute bottom-1.5 top-1.5 transition-transform duration-300 ease-out"
          style={{ left: 6, width: `calc((100% - 12px) / ${n})`, transform: `translateX(${active * 100}%)` }}
        />
        {sections.map((s, i) => {
          const on = i === active;
          const Icon = s.icon;
          return (
            <button
              key={s.key}
              onClick={() => goto(i)}
              aria-current={on ? "true" : undefined}
              className="mn-seg-btn relative z-10 flex flex-1 items-center justify-center gap-2 px-4 py-3 text-[14.5px] font-semibold"
            >
              <Icon className="h-[18px] w-[18px] shrink-0" strokeWidth={on ? 2.2 : 1.75} />
              <span className="truncate">{s.label}</span>
              {s.count != null && (
                <span
                  className="rounded-full px-2 py-0.5 text-[11.5px] font-bold tabular-nums"
                  style={on
                    ? { background: "rgba(255,255,255,0.18)", color: "#FFFFFF" }
                    : { background: "rgba(16,24,40,0.06)", color: "var(--mn-ink-3)" }}
                >
                  {s.count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {filterBar}

      {/* Active pane — directional slide + fade; swipe between panes on touch. */}
      <div
        key={active}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
        className={dir === 1 ? "mn-pane-right" : "mn-pane-left"}
      >
        {sections[active].content}
      </div>
    </div>
  );
}
