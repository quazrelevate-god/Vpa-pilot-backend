import type { Urgency } from "@/lib/types";
import { cn } from "@/lib/utils";

const PRIORITY: Record<string, { wrap: string; dot: string; label: string }> = {
  critical: { wrap: "bg-red-600 text-white",          dot: "bg-white",        label: "Critical" },
  high:     { wrap: "bg-red-100 text-red-700",        dot: "bg-red-500",      label: "High" },
  medium:   { wrap: "bg-amber-100 text-amber-700",    dot: "bg-amber-500",    label: "Medium" },
  major:    { wrap: "bg-amber-100 text-amber-700",    dot: "bg-amber-500",    label: "Major" },
  low:      { wrap: "bg-emerald-100 text-emerald-700", dot: "bg-emerald-500", label: "Low" },
  minor:    { wrap: "bg-emerald-100 text-emerald-700", dot: "bg-emerald-500", label: "Minor" },
  normal:   { wrap: "bg-emerald-100 text-emerald-700", dot: "bg-emerald-500", label: "Normal" },
};

export default function PriorityBadge({ urgency }: { urgency?: Urgency | string | null }) {
  if (!urgency) return <span className="text-sm text-muted-foreground/40">—</span>;
  const k = String(urgency).toLowerCase();
  const s = PRIORITY[k] ?? { wrap: "bg-slate-100 text-slate-600", dot: "bg-slate-400", label: String(urgency) };
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide", s.wrap)}>
      <span className={cn("h-1.5 w-1.5 rounded-full", s.dot)} />
      {s.label}
    </span>
  );
}
