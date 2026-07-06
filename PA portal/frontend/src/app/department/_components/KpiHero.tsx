"use client";

import { AlertTriangle, CheckCircle2, Clock, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { useDeptLang } from "../_lib/i18n";
import { slaFor, type DeptTicket } from "../_lib/api";

interface Props {
  counts: Record<string, number>;
  allTickets: DeptTicket[];  // used to derive SLA-breached count + resolved this week
  onJump: (segment: string) => void;
  activeSeg: string;
}

const CARD_TONES: Record<string, string> = {
  amber:  "from-amber-50 to-white text-amber-800 [--icon-bg:#FCE9C7] [--icon-fg:#B45309]",
  blue:   "from-blue-50 to-white text-blue-800 [--icon-bg:#DBEAFE] [--icon-fg:#1E40AF]",
  emerald:"from-emerald-50 to-white text-emerald-800 [--icon-bg:#D1FADF] [--icon-fg:#047857]",
  red:    "from-red-50 to-white text-red-800 [--icon-bg:#FEE2E2] [--icon-fg:#B91C1C]",
};

export default function KpiHero({ counts, allTickets, onJump, activeSeg }: Props) {
  const { t } = useDeptLang();

  const toAccept   = counts.assigned ?? counts.awaiting_department ?? 0;
  const inProgress = counts.in_progress ?? 0;

  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const resolvedThisWeek = allTickets.filter(
    (x) => x.status === "resolved" && x.resolved_at && new Date(x.resolved_at).getTime() >= weekAgo,
  ).length;
  const breached = allTickets.filter((x) => {
    if (["resolved", "closed"].includes(x.status)) return false;
    const s = slaFor(x.created_at, x.priority);
    return s?.breached ?? false;
  }).length;

  const items = [
    { key: "assigned",            label: t("kpi.toAccept"),     value: toAccept,        tone: "amber",   icon: Clock },
    { key: "in_progress",         label: t("kpi.inProgress"),   value: inProgress,      tone: "blue",    icon: RefreshCw },
    { key: "resolved",            label: t("kpi.resolvedWeek"), value: resolvedThisWeek, tone: "emerald", icon: CheckCircle2 },
    { key: "__breached",          label: t("kpi.overdue"),      value: breached,        tone: "red",     icon: AlertTriangle },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {items.map((it) => {
        const active = activeSeg === it.key;
        return (
          <button
            key={it.key}
            onClick={() => onJump(it.key)}
            className={cn(
              "group relative overflow-hidden rounded-2xl border p-4 text-left shadow-card transition-all",
              "bg-gradient-to-br", CARD_TONES[it.tone],
              active
                ? "border-brand ring-2 ring-brand/25"
                : "border-border hover:-translate-y-0.5 hover:shadow-card-md",
            )}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="text-[11px] font-bold uppercase tracking-wider text-foreground/60">
                  {it.label}
                </div>
                <div className="mt-1.5 font-mono text-3xl font-black leading-none tracking-tight text-foreground">
                  {it.value}
                </div>
              </div>
              <div className="grid h-8 w-8 flex-shrink-0 place-items-center rounded-lg" style={{ background: "var(--icon-bg)", color: "var(--icon-fg)" }}>
                <it.icon className="h-4 w-4" />
              </div>
            </div>
            {it.tone === "red" && it.value > 0 && (
              <div className="absolute inset-x-0 bottom-0 h-1 bg-red-500 opacity-80" />
            )}
          </button>
        );
      })}
    </div>
  );
}
