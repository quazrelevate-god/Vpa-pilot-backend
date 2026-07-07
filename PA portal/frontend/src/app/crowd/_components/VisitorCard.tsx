"use client";

import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { useT } from "../_lib/i18n";
import { Clock, Check, X, UserRound } from "../_lib/icons";
import type { ApptItem, RefItem } from "../_lib/types";

type PillKind = "came" | "notcame" | "resch" | "expected" | "pending";

function StatusPill({ kind }: { kind: PillKind }) {
  const { t } = useT();
  const map: Record<PillKind, { label: string; cls: string }> = {
    came: { label: t("Came", "வந்தார்"), cls: "bg-emerald-100 text-emerald-700" },
    notcame: { label: t("Not Came", "வரவில்லை"), cls: "bg-red-100 text-red-700" },
    resch: { label: t("Rescheduled", "மறுதிட்டம்"), cls: "bg-violet-100 text-violet-700" },
    expected: { label: t("Expected", "எதிர்பார்ப்பு"), cls: "bg-[#1E40AF]/10 text-[#1E40AF]" },
    pending: { label: t("Pending", "நிலுவை"), cls: "bg-slate-100 text-slate-500" },
  };
  const { label, cls } = map[kind];
  return <Badge className={cn("shrink-0", cls)}>{label}</Badge>;
}

function TokenTag({ token }: { token: string }) {
  return <span className="rounded-md bg-[#1E40AF]/10 px-1.5 py-0.5 text-[0.66rem] font-bold text-[#1E40AF]">{token}</span>;
}

function AttendanceButtons({ came, no, onMark }: {
  came: boolean; no: boolean; onMark: (wantCame: boolean) => void;
}) {
  const { t } = useT();
  return (
    <div className="mt-3 flex gap-2.5">
      <button onClick={() => onMark(true)}
        className={cn("flex flex-1 items-center justify-center gap-1.5 rounded-xl border py-2.5 text-[0.86rem] font-bold transition-colors active:scale-[0.98]",
          came ? "border-emerald-500 bg-emerald-500 text-white" : "border-emerald-200 bg-white text-emerald-600")}>
        <Check className="h-4 w-4" />{came ? t("Came ↺", "வந்தார் ↺") : t("Came", "வந்தார்")}
      </button>
      <button onClick={() => onMark(false)}
        className={cn("flex flex-1 items-center justify-center gap-1.5 rounded-xl border py-2.5 text-[0.86rem] font-bold transition-colors active:scale-[0.98]",
          no ? "border-red-500 bg-red-500 text-white" : "border-red-200 bg-white text-red-600")}>
        <X className="h-4 w-4" />{no ? t("Not Came ↺", "வரவில்லை ↺") : t("Not Came", "வரவில்லை")}
      </button>
    </div>
  );
}

export function ApptCard({ it, onMark }: { it: ApptItem; onMark: (id: number, wantCame: boolean) => void }) {
  const st = it.status_db;
  // Any of the terminal "the visitor arrived" statuses render as Came,
  // including COURTESY_DONE for invitation/greetings — the floor only cares
  // about presence, not the workflow branch behind it.
  const came = st === "AWAITING_REVIEW" || st === "CAME" || st === "COURTESY_DONE";
  const no = st === "NOT_CAME";
  const kind: PillKind = came ? "came" : no ? "notcame" : st === "RESCHEDULED" ? "resch" : "expected";

  return (
    <div className="mb-3 rounded-2xl border border-slate-200/70 bg-white p-3.5 shadow-sm">
      <div className="flex items-start gap-2">
        <span className="flex-1 text-base font-bold text-slate-900">{it.name}</span>
        <StatusPill kind={kind} />
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-3 text-sm font-semibold text-slate-500">
        <TokenTag token={it.token} />
        <span className="inline-flex items-center gap-1"><UserRound className="h-3.5 w-3.5" /><b className="text-slate-700">{it.num_persons || 1}</b></span>
        {it.time && <span className="inline-flex items-center gap-1 tabular-nums"><Clock className="h-3.5 w-3.5" />{it.time}</span>}
      </div>
      {it.reason && <div className="mt-1 text-[0.86rem] text-slate-600">{it.reason}</div>}
      <AttendanceButtons came={came} no={no} onMark={(w) => onMark(it.id, w)} />
    </div>
  );
}

export function RefCard({ it, onMark }: { it: RefItem; onMark: (id: number, wantCame: boolean) => void }) {
  const { t } = useT();
  const st = (it.status || "PENDING").toUpperCase();
  const came = st === "CAME";
  const no = st === "NOT_CAME";
  const kind: PillKind = came ? "came" : no ? "notcame" : "pending";

  return (
    <div className="mb-3 rounded-2xl border border-slate-200/70 bg-white p-3.5 shadow-sm">
      <div className="flex items-start gap-2">
        <TokenTag token={it.token} />
        <span className="flex-1 text-base font-bold text-slate-900">{it.name}</span>
        <StatusPill kind={kind} />
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-3.5 text-sm font-semibold text-slate-500">
        {it.referred_by && <span>{t("By", "மூலம்")} <b className="text-slate-700">{it.referred_by}</b></span>}
        {it.slot && <span className="inline-flex items-center gap-1"><Clock className="h-3.5 w-3.5" />{it.slot}</span>}
      </div>
      {it.reason && <div className="mt-0.5 text-[0.86rem] text-slate-600">{it.reason}</div>}
      <AttendanceButtons came={came} no={no} onMark={(w) => onMark(it.id, w)} />
    </div>
  );
}
