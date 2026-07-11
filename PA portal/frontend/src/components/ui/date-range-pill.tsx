"use client";

import { useRef } from "react";
import { CalendarDays } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface DateRangePillProps {
  from: string;
  to: string;
  onFrom: (v: string) => void;
  onTo: (v: string) => void;
  fromLabel?: string;
  toLabel?: string;
  ariaFromLabel?: string;
  ariaToLabel?: string;
  className?: string;
}

/**
 * Filter-style "From → To" date range pill.
 *
 * Why not just <input type="date">: the browser default click target is
 * the tiny built-in calendar glyph on the right — hard to hit, easy to
 * miss on trackpads. This wraps the whole cell in a button that calls
 * showPicker() so clicking anywhere pops the native picker. The <input>
 * is kept in the DOM (offscreen) so the browser still owns validation
 * and the value round-trip.
 *
 * Used from every filter panel: appointments, tickets, AI Review. Kept
 * as one component so future date-picker polish (min/max, keyboard nav,
 * range validation, etc.) can land in one place.
 */
export function DateRangePill({
  from, to, onFrom, onTo,
  fromLabel = "From", toLabel = "To",
  ariaFromLabel, ariaToLabel,
  className,
}: DateRangePillProps) {
  const fromRef = useRef<HTMLInputElement>(null);
  const toRef   = useRef<HTMLInputElement>(null);

  const openPicker = (el: HTMLInputElement | null) => {
    if (!el) return;
    el.focus();
    // showPicker throws in some contexts (autofocus, permission, etc.);
    // focus alone is a safe fallback.
    try { (el as HTMLInputElement & { showPicker?: () => void }).showPicker?.(); } catch { /* ignore */ }
  };

  return (
    <div className={cn(
      "grid h-11 w-full grid-cols-[1fr_auto_1fr] items-stretch overflow-hidden rounded-xl border border-border bg-card",
      className,
    )}>
      <button
        type="button"
        onClick={() => openPicker(fromRef.current)}
        className="group flex items-center gap-2 px-3 text-left transition-colors hover:bg-muted/50 focus:bg-muted/60 focus:outline-none"
        aria-label={ariaFromLabel ?? fromLabel}
      >
        <CalendarDays className="h-4 w-4 shrink-0 text-muted-foreground group-hover:text-brand" />
        <span className={cn("truncate text-sm", from ? "font-mono text-foreground" : "text-muted-foreground")}>
          {from || fromLabel}
        </span>
        <Input
          ref={fromRef}
          type="date"
          value={from}
          onChange={(e) => onFrom(e.target.value)}
          className="pointer-events-none absolute h-0 w-0 border-0 p-0 opacity-0"
          tabIndex={-1}
          aria-hidden="true"
        />
      </button>
      <span className="grid place-items-center px-1 text-sm text-muted-foreground">→</span>
      <button
        type="button"
        onClick={() => openPicker(toRef.current)}
        className="group flex items-center gap-2 px-3 text-left transition-colors hover:bg-muted/50 focus:bg-muted/60 focus:outline-none"
        aria-label={ariaToLabel ?? toLabel}
      >
        <CalendarDays className="h-4 w-4 shrink-0 text-muted-foreground group-hover:text-brand" />
        <span className={cn("truncate text-sm", to ? "font-mono text-foreground" : "text-muted-foreground")}>
          {to || toLabel}
        </span>
        <Input
          ref={toRef}
          type="date"
          value={to}
          onChange={(e) => onTo(e.target.value)}
          className="pointer-events-none absolute h-0 w-0 border-0 p-0 opacity-0"
          tabIndex={-1}
          aria-hidden="true"
        />
      </button>
    </div>
  );
}

interface SingleDatePillProps {
  value: string;
  onChange: (v: string) => void;
  min?: string;
  max?: string;
  placeholder?: string;
  ariaLabel?: string;
  className?: string;
}

/**
 * Single-date variant used on Scheduling / Referrals "open a date" cards.
 * Same click-anywhere behavior as DateRangePill but a single cell.
 */
export function SingleDatePill({
  value, onChange, min, max,
  placeholder = "Pick a date",
  ariaLabel,
  className,
}: SingleDatePillProps) {
  const ref = useRef<HTMLInputElement>(null);
  const openPicker = () => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    try { (el as HTMLInputElement & { showPicker?: () => void }).showPicker?.(); } catch { /* ignore */ }
  };
  return (
    <button
      type="button"
      onClick={openPicker}
      aria-label={ariaLabel ?? placeholder}
      className={cn(
        "group flex h-11 w-full items-center gap-2 rounded-xl border border-border bg-card px-3 text-left transition-colors hover:bg-muted/50 focus:bg-muted/60 focus:outline-none",
        className,
      )}
    >
      <CalendarDays className="h-4 w-4 shrink-0 text-muted-foreground group-hover:text-brand" />
      <span className={cn("truncate text-sm", value ? "font-mono text-foreground" : "text-muted-foreground")}>
        {value || placeholder}
      </span>
      <Input
        ref={ref}
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        min={min}
        max={max}
        className="pointer-events-none absolute h-0 w-0 border-0 p-0 opacity-0"
        tabIndex={-1}
        aria-hidden="true"
      />
    </button>
  );
}
