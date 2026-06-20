import type { Urgency } from "@/lib/types";

const ORDER: { key: Urgency; label: string; color: string }[] = [
  { key: "critical", label: "Critical", color: "bg-red-600" },
  { key: "high",     label: "High",     color: "bg-red-400" },
  { key: "medium",   label: "Medium",   color: "bg-orange-400" },
  { key: "low",      label: "Low",      color: "bg-green-400" },
];

export default function UrgencyBars({ urgency }: { urgency: Partial<Record<Urgency, number>> }) {
  const total = Object.values(urgency).reduce((a, b) => (a as number) + (b as number), 0) || 1;
  return (
    <div className="space-y-2.5">
      {ORDER.map((u) => {
        const count = urgency[u.key] ?? 0;
        const pct = Math.round((count / (total as number)) * 100);
        return (
          <div key={u.key}>
            <div className="flex justify-between text-xs text-slate-600 mb-1">
              <span className="font-medium">{u.label}</span>
              <span className="text-slate-400">
                {count} <span className="text-slate-300">({pct}%)</span>
              </span>
            </div>
            <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
              <div
                className={`h-full ${u.color} rounded-full transition-all duration-700`}
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
