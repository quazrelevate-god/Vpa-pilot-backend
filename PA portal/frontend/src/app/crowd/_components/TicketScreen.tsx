"use client";

import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useT } from "../_lib/i18n";
import { fmtLongDate } from "../_lib/api";
import { Check, Calendar, Clock, Printer, ClipboardList } from "../_lib/icons";
import type { IntakeResult } from "../_lib/types";

export default function TicketScreen({ data, onDone }: { data: IntakeResult | null; onDone: () => void }) {
  const { t } = useT();
  const d = data || {};
  const status = d.status || "AWAITING_REVIEW";

  const heading =
    status === "SCHEDULED" ? t("Scheduled Successfully!", "பதிவு வெற்றி!")
    : status === "WAITING" ? t("Added to Waiting Queue", "காத்திருப்பில் சேர்க்கப்பட்டது")
    : t("Petition Submitted", "மனு சமர்ப்பிக்கப்பட்டது");

  // Status-driven accent — emerald (scheduled), amber (waiting), brand blue (petition).
  const tone =
    status === "SCHEDULED"
      ? { soft: "bg-emerald-100", fg: "text-emerald-600", accent: "#2E7D5B", pill: "bg-emerald-100 text-emerald-700", label: t("Scheduled", "பதிவானது") }
    : status === "WAITING"
      ? { soft: "bg-amber-100", fg: "text-amber-600", accent: "#CC6A1F", pill: "bg-amber-100 text-amber-700", label: t("Waiting queue", "காத்திருப்பு") }
      : { soft: "bg-[#1E40AF]/10", fg: "text-[#1E40AF]", accent: "#1E40AF", pill: "bg-[#1E40AF]/10 text-[#1E40AF]", label: t("Petition submitted", "மனு சமர்ப்பிக்கப்பட்டது") };

  const tokenNum = (d.token_display || "").replace(/^TKN/, "");
  const timeLabel = d.slot_window || d.scheduled_time || "";
  const hasMeta = Boolean(d.scheduled_date || timeLabel);

  function copyToken() {
    const tok = d.token_display || "";
    if (!tok) return;
    if (navigator.clipboard) {
      navigator.clipboard.writeText(tok)
        .then(() => toast.success(t("Token copied", "டோக்கன் நகலெடுக்கப்பட்டது")))
        .catch(() => toast(tok));
    } else toast(tok);
  }

  function share() {
    const text = "Token: " + (d.token_display || "")
      + (d.scheduled_date ? `\n${fmtLongDate(d.scheduled_date)} ${timeLabel}` : "");
    if (navigator.share) navigator.share({ title: "Crowd Management", text }).catch(() => {});
    else if (navigator.clipboard) navigator.clipboard.writeText(text).then(() => toast.success(t("Copied", "நகலெடுக்கப்பட்டது"))).catch(() => {});
    else toast(d.token_display || "");
  }

  return (
    <div className="flex min-h-screen flex-col px-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] pt-[calc(1.5rem+env(safe-area-inset-top))]">
      <div className="flex flex-1 flex-col items-center justify-center">
        {/* success mark + calm halo + celebratory pops */}
        <div className="relative mb-5 grid place-items-center">
          <span className="absolute h-[112px] w-[112px] rounded-full opacity-[0.14] blur-md" style={{ backgroundColor: tone.accent }} />
          <span className="absolute h-[96px] w-[96px] rounded-full opacity-[0.10]" style={{ backgroundColor: tone.accent }} />
          {/* confetti — small pops scattered around the mark */}
          <span className="absolute -left-7 top-2 h-2 w-2 rounded-full bg-amber-400" />
          <span className="absolute left-1/2 -top-2.5 h-1.5 w-1.5 -translate-x-1/2 rounded-full bg-[#1E40AF]" />
          <span className="absolute -right-6 -top-0.5 h-2 w-2 rounded-full bg-emerald-500" />
          <span className="absolute -right-8 top-11 h-1.5 w-1.5 rounded-full bg-rose-400" />
          <span className="absolute -left-9 top-10 h-1.5 w-1.5 rounded-full bg-violet-400" />
          <span className="absolute -left-4 -top-2 h-1.5 w-1.5 rotate-45 rounded-[1px] bg-amber-300" />
          <span className="absolute -right-3 bottom-1 h-1.5 w-1.5 rotate-45 rounded-[1px] bg-[#1E40AF]/70" />
          <div className={cn("relative grid h-[84px] w-[84px] place-items-center rounded-full", tone.soft, tone.fg)}>
            <Check className="h-11 w-11" strokeWidth={2.5} />
          </div>
        </div>

        <h2 className="text-center text-[1.4rem] font-black tracking-tight text-slate-900">{heading}</h2>
        <p className="mt-1.5 max-w-[280px] text-center text-[0.88rem] leading-snug text-slate-500">
          {t("Please share this token with the citizen", "இந்த டோக்கனை குடிமகனிடம் தெரிவிக்கவும்")}
        </p>

        {/* ticket stub */}
        <div className="mt-6 w-full max-w-[360px] overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-[0_10px_28px_-14px_rgba(28,30,41,0.22)]">
          <div className="h-1.5 w-full" style={{ backgroundColor: tone.accent }} />

          <div className="px-6 pt-5 pb-4 text-center">
            <div className="text-[0.66rem] font-bold uppercase tracking-[0.16em] text-slate-400">{t("Token", "டோக்கன்")}</div>
            <div className="mt-2 break-all font-mono text-[1.7rem] font-bold leading-none tracking-tight tabular-nums text-slate-900">
              {tokenNum}
            </div>
            <button onClick={copyToken}
              className="mx-auto mt-3 inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1 text-[0.72rem] font-bold text-slate-500 transition-colors active:scale-95 hover:bg-slate-50">
              <ClipboardList className="h-3.5 w-3.5" />{t("Copy token", "நகலெடு")}
            </button>
          </div>

          {/* perforation */}
          <div className="mx-6 border-t border-dashed border-slate-200" />

          <div className="px-6 pt-4 pb-5">
            {hasMeta && (
              <div className="mb-4 space-y-2.5">
                {d.scheduled_date && (
                  <div className="flex items-center justify-center gap-2 text-[0.92rem] font-bold text-slate-700">
                    <Calendar className="h-[18px] w-[18px]" style={{ color: tone.accent }} />
                    {fmtLongDate(d.scheduled_date)}
                  </div>
                )}
                {timeLabel && (
                  <div className="flex items-center justify-center gap-2 text-[0.92rem] font-bold tabular-nums text-slate-700">
                    <Clock className="h-[18px] w-[18px]" style={{ color: tone.accent }} />
                    {timeLabel}
                  </div>
                )}
              </div>
            )}
            <div className="flex justify-center">
              <span className={cn("inline-flex rounded-full px-3.5 py-1.5 text-[0.8rem] font-bold", tone.pill)}>{tone.label}</span>
            </div>
          </div>
        </div>
      </div>

      {/* actions */}
      <div className="flex gap-2.5 pt-6">
        <Button variant="outline" onClick={share} className="h-12 flex-1 rounded-xl font-bold">
          <Printer className="h-[18px] w-[18px]" />{t("Share / Print", "பகிர் / அச்சு")}
        </Button>
        <Button onClick={onDone} className="h-12 flex-1 rounded-xl bg-[#1E40AF] font-bold text-white hover:bg-[#1A3796]">{t("Close", "மூடு")}</Button>
      </div>
    </div>
  );
}
