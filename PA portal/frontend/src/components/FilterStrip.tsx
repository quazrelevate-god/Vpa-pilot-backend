"use client";

import { SlidersHorizontal, X } from "lucide-react";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

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

const ALL = "__all__";

/** Pill-style filter group strip used on both /tickets and /appointments. */
export default function FilterStrip({ groups, onClearAll }: {
  groups: FilterGroup[];
  onClearAll?: () => void;
}) {
  const anyActive = groups.some((g) => g.value !== "");
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card p-3 shadow-card">
      <div className="flex items-center gap-1.5 pl-1 pr-1 text-xs font-semibold text-muted-foreground">
        <SlidersHorizontal className="h-3.5 w-3.5" />
        Filters
      </div>
      {groups.map((g) => (
        <div key={g.key} className="flex flex-col gap-1">
          <Select
            value={g.value === "" ? ALL : g.value}
            onValueChange={(v) => g.onChange(v === ALL ? "" : v)}
          >
            <SelectTrigger
              className={cn(
                "h-9 w-[170px] text-xs",
                g.value && "border-brand/40 bg-brand/5 font-semibold text-brand"
              )}
            >
              <SelectValue placeholder={g.label} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All {g.label.toLowerCase()}</SelectItem>
              {g.options.map((o) => (
                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ))}
      {anyActive && onClearAll && (
        <button
          onClick={onClearAll}
          className="ml-auto flex items-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-red-600"
        >
          <X className="h-3.5 w-3.5" /> Clear filters
        </button>
      )}
    </div>
  );
}
