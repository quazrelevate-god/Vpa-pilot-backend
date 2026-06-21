import { LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export default function KPICard({
  label, value, icon: Icon, color, bg, footnote,
}: {
  label: string;
  value: number;
  icon: LucideIcon;
  color: string;       // tailwind text-* class for the number + icon
  bg: string;          // tailwind bg-* class for the icon chip
  footnote?: string;
}) {
  return (
    <Card className="group relative overflow-hidden p-5 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-card-lg">
      {/* faint corner flourish */}
      <div
        className={cn(
          "pointer-events-none absolute -right-6 -top-6 h-20 w-20 rounded-full opacity-[0.07] blur-xl transition-opacity group-hover:opacity-[0.12]",
          bg
        )}
      />
      <div className="relative flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
        <div className={cn("grid h-9 w-9 place-items-center rounded-lg ring-1 ring-inset ring-black/5", bg)}>
          <Icon className={cn("h-[18px] w-[18px]", color)} />
        </div>
      </div>
      <div className={cn("relative mt-3 text-3xl font-extrabold tracking-tight tabular-nums", color)}>
        {value.toLocaleString()}
      </div>
      {footnote && (
        <div className="relative mt-1 text-xs font-medium text-muted-foreground">{footnote}</div>
      )}
    </Card>
  );
}
