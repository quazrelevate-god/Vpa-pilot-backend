import type { Priority } from "@/lib/types";
import { cn } from "@/lib/utils";

const ORDER: { key: Priority; label: string; bar: string; chip: string }[] = [
  { key: "critical", label: "Critical", bar: "bg-gradient-to-r from-red-500 to-red-600",       chip: "bg-red-100 text-red-700" },
  { key: "high",     label: "High",     bar: "bg-gradient-to-r from-orange-400 to-orange-500",  chip: "bg-orange-100 text-orange-700" },
  { key: "medium",   label: "Medium",   bar: "bg-gradient-to-r from-amber-300 to-amber-400",    chip: "bg-amber-100 text-amber-700" },
  { key: "low",      label: "Low",      bar: "bg-gradient-to-r from-emerald-400 to-emerald-500", chip: "bg-emerald-100 text-emerald-700" },
];

export default function PriorityBars({ priority }: { priority: Partial<Record<Priority, number>> }) {
  const total = Object.values(priority).reduce((a, b) => (a as number) + (b as number), 0) || 1;
  return (
    <div className="space-y-3.5">
      {ORDER.map((u) => {
        const count = priority[u.key] ?? 0;
        const pct = Math.round((count / (total as number)) * 100);
        return (
          <div key={u.key}>
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-xs font-semibold text-foreground">{u.label}</span>
              <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-bold tabular-nums", u.chip)}>
                {count} · {pct}%
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <div
                className={cn("h-full rounded-full transition-all duration-700", u.bar)}
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
