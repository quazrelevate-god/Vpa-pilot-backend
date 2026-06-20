import type { Urgency } from "@/lib/types";

const PRIORITY: Record<string, { bg: string; text: string; label: string }> = {
  critical: { bg: "bg-red-600",    text: "text-white",      label: "Critical" },
  high:     { bg: "bg-red-100",    text: "text-red-700",    label: "High" },
  medium:   { bg: "bg-orange-100", text: "text-orange-700", label: "Medium" },
  major:    { bg: "bg-orange-100", text: "text-orange-700", label: "Major" },
  low:      { bg: "bg-green-100",  text: "text-green-700",  label: "Low" },
  minor:    { bg: "bg-green-100",  text: "text-green-700",  label: "Minor" },
  normal:   { bg: "bg-green-100",  text: "text-green-700",  label: "Normal" },
};

export default function PriorityBadge({ urgency }: { urgency?: Urgency | string | null }) {
  if (!urgency) return <span className="text-slate-300 text-xs">—</span>;
  const k = String(urgency).toLowerCase();
  const s = PRIORITY[k] ?? { bg: "bg-slate-100", text: "text-slate-600", label: String(urgency) };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold ${s.bg} ${s.text} uppercase tracking-wide`}>
      {s.label}
    </span>
  );
}
