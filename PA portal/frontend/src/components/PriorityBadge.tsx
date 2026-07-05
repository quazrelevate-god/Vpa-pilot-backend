import type { Priority } from "@/lib/types";
import { cn } from "@/lib/utils";

// Aurora 2.3 "Lavender" — soft flat tints with a leading dot (per reference mock).
const PRIORITY: Record<string, { wrap: string; dot: string; label: string }> = {
  critical: { wrap: "bg-[#FDE8E8] text-[#D53B41]", dot: "bg-[#E5484D]", label: "Critical" },
  high:     { wrap: "bg-[#FDEEDD] text-[#C46A15]", dot: "bg-[#EE7327]", label: "High" },
  medium:   { wrap: "bg-[#FBF3DC] text-[#A8811C]", dot: "bg-[#D39412]", label: "Medium" },
  major:    { wrap: "bg-[#FBF3DC] text-[#A8811C]", dot: "bg-[#D39412]", label: "Major" },
  low:      { wrap: "bg-[#E3F5EB] text-[#2F9E68]", dot: "bg-[#34A26C]", label: "Low" },
  minor:    { wrap: "bg-[#E3F5EB] text-[#2F9E68]", dot: "bg-[#34A26C]", label: "Minor" },
  normal:   { wrap: "bg-[#E3F5EB] text-[#2F9E68]", dot: "bg-[#34A26C]", label: "Normal" },
};

export default function PriorityBadge({ priority }: { priority?: Priority | string | null }) {
  if (!priority) return <span className="text-sm text-muted-foreground/40">—</span>;
  const k = String(priority).toLowerCase();
  const s = PRIORITY[k] ?? { wrap: "bg-secondary text-muted-foreground", dot: "bg-muted-foreground/50", label: String(priority) };
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-semibold", s.wrap)}>
      <span className={cn("h-1.5 w-1.5 rounded-full", s.dot)} />
      {s.label}
    </span>
  );
}
