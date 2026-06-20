"use client";

import { X } from "lucide-react";

export interface FilterOption {
  value: string;
  label: string;
}

export interface FilterGroup {
  key: string;
  label: string;
  options: FilterOption[];
  value: string;
  onChange: (value: string) => void;
}

/** Pill-style filter group strip used on both /tickets and /appointments. */
export default function FilterStrip({ groups, onClearAll }: {
  groups: FilterGroup[];
  onClearAll?: () => void;
}) {
  const anyActive = groups.some(g => g.value !== "");
  return (
    <div className="flex flex-wrap items-end gap-3 bg-white rounded-xl border border-slate-200 p-3">
      {groups.map((g) => (
        <div key={g.key} className="flex flex-col gap-1">
          <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
            {g.label}
          </label>
          <select
            value={g.value}
            onChange={(e) => g.onChange(e.target.value)}
            className={[
              "border rounded-md text-xs px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-brand/30",
              g.value
                ? "border-brand text-brand font-semibold"
                : "border-slate-300 text-slate-700",
            ].join(" ")}
          >
            <option value="">All</option>
            {g.options.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
      ))}
      {anyActive && onClearAll && (
        <button
          onClick={onClearAll}
          className="ml-auto flex items-center gap-1 text-xs text-slate-500 hover:text-red-600 px-2 py-1.5"
        >
          <X className="w-3 h-3" /> Clear filters
        </button>
      )}
    </div>
  );
}
