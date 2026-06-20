import { LucideIcon } from "lucide-react";

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
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 transition hover:-translate-y-0.5 hover:shadow-lg">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{label}</span>
        <div className={`w-8 h-8 rounded-lg ${bg} flex items-center justify-center`}>
          <Icon className={`w-4 h-4 ${color}`} />
        </div>
      </div>
      <div className={`text-3xl font-extrabold ${color}`}>{value.toLocaleString()}</div>
      {footnote && <div className="text-xs text-slate-400 mt-1">{footnote}</div>}
    </div>
  );
}
