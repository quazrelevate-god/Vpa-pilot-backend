"use client";

import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { useT } from "../_lib/i18n";
import { Clock, Check, X, UserRound } from "../_lib/icons";
import type { ApptItem, RefItem } from "../_lib/types";

type PillKind = "came" | "notcame" | "resch" | "expected" | "pending" | "courtesy_done";

const COURTESY_CATS = new Set(["invitation", "greetings"]);

function StatusPill({ kind }: { kind: PillKind }) {
  const { t } = useT();
  const map: Record<PillKind, { label: string; cls: string }> = {
    came: { label: t("Came", "வந்தார்"), cls: "bg-emerald-100 text-emerald-700" },
    notcame: { label: t("Not Came", "வரவில்லை"), cls: "bg-red-100 text-red-700" },
    resch: { label: t("Rescheduled", "மறுதிட்டம்"), cls: "bg-violet-100 text-violet-700" },
    expected: { label: t("Expected", "எதிர்பார்ப்பு"), cls: "bg-blue-100 text-blue-700" },
    pending: { label: t("Pending", "நிலுவை"), cls: "bg-slate-100 text-slate-500" },
    courtesy_done: { label: t("Received", "பெறப்பட்டது"), cls: "bg-cyan-100 text-cyan-700" },
  };
  const { label, cls } = map[kind];
  return <Badge className={cn("shrink-0", cls)}>{label}</Badge>;
}

function TokenTag({ token }: { token: string }) {
  return <span className="rounded-md bg-blue-50 px-1.5 py-0.5 text-[0.66rem] font-bold text-blue-600">{token}</span>;
}

function AttendanceButtons({ came, no, courtesy, onMark }: {
  came: boolean; no: boolean; courtesy?: boolean; onMark: (wantCame: boolean) => void;
}) {
  const { t } = useT();
  // Courtesy visitors handed over an invitation / greeting card. "Came" is
  // more accurately "Received", so we relabel — the backend already routes
  // the click to COURTESY_DONE (not AWAITING_REVIEW).
  const yesText = courtesy
    ? (came ? t("Received ↺", "பெறப்பட்டது ↺") : t("Received", "பெறப்பட்டது"))
    : (came ? t("Came ↺", "வந்தார் ↺") : t("Came", "வந்தார்"));
  const noText = courtesy
    ? (no ? t("Not Received ↺", "பெறப்படவில்லை ↺") : t("Not Received", "பெறப்படவில்லை"))
    : (no ? t("Not Came ↺", "வரவில்லை ↺") : t("Not Came", "வரவில்லை"));
  return (
    <div className="mt-3 flex gap-2.5">
      <button onClick={() => onMark(true)}
        className={cn("flex flex-1 items-center justify-center gap-1.5 rounded-xl border py-2.5 text-[0.86rem] font-bold transition-colors active:scale-[0.98]",
          came ? "border-emerald-500 bg-emerald-500 text-white" : "border-emerald-200 bg-white text-emerald-600")}>
        <Check className="h-4 w-4" />{yesText}
      </button>
      <button onClick={() => onMark(false)}
        className={cn("flex flex-1 items-center justify-center gap-1.5 rounded-xl border py-2.5 text-[0.86rem] font-bold transition-colors active:scale-[0.98]",
          no ? "border-red-500 bg-red-500 text-white" : "border-red-200 bg-white text-red-600")}>
        <X className="h-4 w-4" />{noText}
      </button>
    </div>
  );
}

export function ApptCard({ it, onMark }: { it: ApptItem; onMark: (id: number, wantCame: boolean) => void }) {
  const st = it.status_db;
  const courtesy = COURTESY_CATS.has((it.category_key || "").toLowerCase());
  // Courtesy: "came" is the terminal COURTESY_DONE. Regular: AWAITING_REVIEW / CAME.
  const came = courtesy ? st === "COURTESY_DONE" : (st === "AWAITING_REVIEW" || st === "CAME");
  const no = st === "NOT_CAME";
  const kind: PillKind = came
    ? (courtesy ? "courtesy_done" : "came")
    : no ? "notcame" : st === "RESCHEDULED" ? "resch" : "expected";

  return (
    <div className="mb-3 rounded-2xl border border-slate-200/70 bg-white p-3.5 shadow-sm">
      <div className="flex items-start gap-2">
        <TokenTag token={it.token} />
        <span className="flex-1 text-base font-bold text-slate-900">{it.name}</span>
        <StatusPill kind={kind} />
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-3.5 text-sm font-semibold text-slate-500">
        <span className="inline-flex items-center gap-1"><UserRound className="h-3.5 w-3.5" /><b className="text-slate-700">{it.num_persons || 1}</b></span>
        {it.time && <span className="inline-flex items-center gap-1"><Clock className="h-3.5 w-3.5" />{it.time}</span>}
      </div>
      {it.reason && <div className="mt-0.5 text-[0.86rem] text-slate-600">{it.reason}</div>}
      <AttendanceButtons came={came} no={no} courtesy={courtesy} onMark={(w) => onMark(it.id, w)} />
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
