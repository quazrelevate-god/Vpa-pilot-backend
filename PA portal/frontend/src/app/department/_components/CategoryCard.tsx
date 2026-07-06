"use client";

import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { useDeptLang } from "../_lib/i18n";
import type { DeptTicket } from "../_lib/api";

interface Props {
  allTickets: DeptTicket[];
}

export default function CategoryCard({ allTickets }: Props) {
  const { t } = useDeptLang();

  const { rows, total, max } = useMemo(() => {
    const counts = new Map<string, number>();
    for (const x of allTickets) {
      const key = (x.category_label ?? x.category ?? "").trim() || t("category.other");
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const list = [...counts.entries()]
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value);
    return {
      rows: list,
      total: allTickets.length,
      max: Math.max(1, ...list.map((r) => r.value)),
    };
  }, [allTickets, t]);

  return (
    <div className="rounded-lg border border-border bg-card p-4 shadow-card">
      <div className="flex items-center justify-between">
        <div className="text-[11px] font-bold uppercase tracking-wider text-foreground/60">
          {t("category.title")}
        </div>
        <span className="rounded-md border border-border bg-muted/40 px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
          {t("trend.thisWeek")}
        </span>
      </div>

      {total === 0 ? (
        <div className="py-6 text-center text-sm text-muted-foreground/70">
          {t("category.empty")}
        </div>
      ) : (
        <div className="mt-3 space-y-2">
          {rows.map((r) => {
            const barPct = Math.round((r.value / max) * 100);
            const sharePct = Math.round((r.value / total) * 100);
            return (
              <div key={r.label}>
                <div className="mb-1 flex items-center justify-between text-[12px]">
                  <span className="truncate pr-2 font-medium text-foreground/90">{r.label}</span>
                  <span className="shrink-0 font-bold tabular-nums text-foreground">
                    {r.value}
                    <span className="ml-1 text-[10px] font-medium text-muted-foreground">{sharePct}%</span>
                  </span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div className={cn("h-full rounded-full bg-brand")} style={{ width: `${barPct}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
