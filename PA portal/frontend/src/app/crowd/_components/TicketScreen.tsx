"use client";

import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useT } from "../_lib/i18n";
import { fmtLongDate } from "../_lib/api";
import { Check, Calendar, Clock, Printer } from "../_lib/icons";
import type { IntakeResult } from "../_lib/types";

export default function TicketScreen({ data, onDone }: { data: IntakeResult | null; onDone: () => void }) {
  const { t } = useT();
  const d = data || {};
  const status = d.status || "AWAITING_REVIEW";

  const heading =
    status === "SCHEDULED" ? t("Scheduled Successfully!", "பதிவு வெற்றி!")
    : status === "WAITING" ? t("Added to Waiting Queue", "காத்திருப்பில் சேர்க்கப்பட்டது")
    : t("Petition Submitted", "மனு சமர்ப்பிக்கப்பட்டது");

  const pill =
    status === "SCHEDULED" ? { label: t("Scheduled", "பதிவானது"), cls: "bg-emerald-100 text-emerald-700" }
    : status === "WAITING" ? { label: t("Waiting queue", "காத்திருப்பு"), cls: "bg-amber-100 text-amber-700" }
    : { label: t("Petition submitted", "மனு சமர்ப்பிக்கப்பட்டது"), cls: "bg-blue-100 text-blue-700" };

  const tokenNum = (d.token_display || "").replace(/^TKN/, "");

  function share() {
    const text = "Token: " + (d.token_display || "")
      + (d.scheduled_date ? `\n${fmtLongDate(d.scheduled_date)} ${d.scheduled_time || ""}` : "");
    if (navigator.share) navigator.share({ title: "Crowd Management", text }).catch(() => {});
    else if (navigator.clipboard) navigator.clipboard.writeText(text).then(() => toast.success(t("Copied", "நகலெடுக்கப்பட்டது"))).catch(() => {});
    else toast(d.token_display || "");
  }

  return (
    <div className="flex min-h-screen flex-col px-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] pt-6">
      <div className="relative mx-auto mt-3 mb-3.5">
        {/* confetti */}
        <span className="absolute -left-6 -top-1 h-2 w-2 rounded-sm bg-amber-400" />
        <span className="absolute -right-5 top-2 h-2 w-2 rounded-sm bg-blue-500" />
        <span className="absolute -right-8 top-9 h-1.5 w-1.5 rounded-full bg-emerald-500" />
        <span className="absolute -left-8 top-8 h-1.5 w-1.5 rounded-full bg-red-400" />
        <div className="grid h-[76px] w-[76px] place-items-center rounded-full bg-emerald-100 text-emerald-600">
          <Check className="h-10 w-10" strokeWidth={2.5} />
        </div>
      </div>

      <h2 className="text-center text-[1.35rem] font-black text-slate-900">{heading}</h2>
      <div className="mt-1 mb-5 text-center text-[0.86rem] text-slate-500">{t("Please share this token with the citizen", "இந்த டோக்கனை குடிமகனிடம் தெரிவிக்கவும்")}</div>

      <div className="rounded-[22px] border-[1.5px] border-dashed border-slate-300 bg-white p-6 text-center shadow-sm">
        <div className="text-[2.5rem] font-black tracking-tight text-slate-900">
          <span className="align-middle text-lg font-extrabold text-slate-400">TKN</span> {tokenNum}
        </div>
        {d.scheduled_date && (
          <div className="mt-3 flex items-center justify-center gap-2 font-bold text-slate-700">
            <Calendar className="h-[18px] w-[18px] text-emerald-600" />{fmtLongDate(d.scheduled_date)}
          </div>
        )}
        {d.scheduled_time && (
          <div className="mt-2 flex items-center justify-center gap-2 font-bold text-slate-700">
            <Clock className="h-[18px] w-[18px] text-emerald-600" />{d.scheduled_time}
          </div>
        )}
        <div className="my-4 border-t border-dashed border-slate-200" />
        <span className={cn("inline-flex rounded-full px-3.5 py-1.5 text-[0.82rem] font-bold", pill.cls)}>{pill.label}</span>
      </div>

      <div className="mt-auto flex gap-2.5 pt-6">
        <Button variant="outline" onClick={share} className="h-12 flex-1 rounded-xl font-bold">
          <Printer className="h-[18px] w-[18px]" />{t("Share / Print", "பகிர் / அச்சு")}
        </Button>
        <Button onClick={onDone} className="h-12 flex-1 rounded-xl bg-blue-600 font-bold hover:bg-blue-700">{t("Close", "மூடு")}</Button>
      </div>
    </div>
  );
}
