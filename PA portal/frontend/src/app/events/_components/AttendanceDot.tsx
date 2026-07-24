// Tiny post-event attendance chip shown on calendar tiles + list rows.
// Green ✓ for attended, gray × for not-attended, nothing for unmarked.
// Kept purely visual (no tooltip) so it never eats a tap target on the
// event tile — the popup is where the state can actually be changed.

import { cn } from "@/lib/utils";
import type { Attendance } from "../_lib/types";

export function AttendanceDot({ value, className }: {
  value: Attendance;
  className?: string;
}) {
  if (!value) return null;
  return (
    <span
      aria-label={value === "attended" ? "attended" : "not attended"}
      className={cn(
        "inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full text-[9px] font-black leading-none text-white",
        value === "attended" ? "bg-emerald-500" : "bg-slate-400",
        className,
      )}>
      {value === "attended" ? "✓" : "×"}
    </span>
  );
}
