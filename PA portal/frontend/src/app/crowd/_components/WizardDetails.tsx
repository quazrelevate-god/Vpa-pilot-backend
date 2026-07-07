"use client";

import { useRef } from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { useT } from "../_lib/i18n";
import { Camera, FileText, X } from "../_lib/icons";
import type { Photo } from "./RegisterWizard";

// 13 grievance categories (value = backend key, label = display).
export const CATS: [string, string][] = [
  ["action_required", "Action Required"],
  ["proposals", "Proposals"],
  ["transfer_requests", "Transfer Request"],
  ["pension_requests", "Pension Request"],
  ["school_admission", "School Admission"],
  ["job_requests", "Job Request"],
  ["rti", "RTI"],
  ["associations_unions", "Associations / Unions"],
  ["school_upgradation", "School Upgradation"],
  ["invitation", "Invitation"],
  ["greetings", "Greetings"],
  ["general", "General"],
  ["other", "Other"],
];

function FieldLabel({ children, required, optional }: { children: React.ReactNode; required?: boolean; optional?: boolean }) {
  const { t } = useT();
  return (
    <Label className="mb-1.5 block text-[0.8rem] font-bold normal-case tracking-normal text-slate-700">
      {children}
      {required && <span className="text-red-500"> *</span>}
      {optional && <span className="font-medium text-slate-400"> ({t("optional", "விருப்பம்")})</span>}
    </Label>
  );
}

export default function WizardDetails({
  name, mobile, category, desc, photos,
  onName, onMobile, onCategory, onDesc, onAddFiles, onRemoveFile,
}: {
  name: string;
  mobile: string;
  category: string;
  desc: string;
  photos: Photo[];
  onName: (v: string) => void;
  onMobile: (v: string) => void;
  onCategory: (v: string) => void;
  onDesc: (v: string) => void;
  onAddFiles: (files: FileList | null) => void;
  onRemoveFile: (idx: number) => void;
}) {
  const { t } = useT();
  const fileRef = useRef<HTMLInputElement | null>(null);

  return (
    <div className="space-y-4">
      <div>
        <FieldLabel required>{t("Full Name", "முழு பெயர்")}</FieldLabel>
        <Input value={name} autoComplete="off" onChange={(e) => onName(e.target.value)} className="h-11 rounded-xl" />
      </div>

      <div>
        <FieldLabel optional>{t("Mobile", "கைபேசி")}</FieldLabel>
        <Input value={mobile} inputMode="numeric" autoComplete="off" onChange={(e) => onMobile(e.target.value)} className="h-11 rounded-xl" />
      </div>

      <div>
        <FieldLabel required>{t("Category", "வகை")}</FieldLabel>
        <Select value={category} onValueChange={onCategory}>
          <SelectTrigger className="h-11 rounded-xl">
            <SelectValue placeholder={t("— Select —", "— தேர்வு —")} />
          </SelectTrigger>
          <SelectContent>
            {CATS.map(([val, label]) => <SelectItem key={val} value={val}>{label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <div>
        <FieldLabel optional>{t("Grievance / Description", "குறை / விவரம்")}</FieldLabel>
        <Textarea value={desc} maxLength={500} onChange={(e) => onDesc(e.target.value)}
          placeholder={t("Write the issue…", "பிரச்சினையை எழுதவும்…")} className="min-h-[80px] rounded-xl" />
        <div className="mt-1 text-right text-[0.68rem] text-slate-400">{desc.length}/500</div>
      </div>

      <div>
        <FieldLabel optional>{t("Attach Photo(s)", "புகைப்படம்")}</FieldLabel>
        <div className="flex flex-wrap gap-2.5">
          <button type="button" onClick={() => fileRef.current?.click()}
            className="grid h-[62px] w-[62px] place-items-center rounded-xl border-[1.5px] border-dashed border-slate-300 bg-slate-50 text-slate-500 active:scale-[0.98]">
            <Camera className="h-6 w-6" />
          </button>
          {photos.map((p, i) => {
            const isImg = /^image\//.test(p.file.type);
            return (
              <div key={i} className="relative h-[62px] w-[62px] overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
                {isImg
                  ? <img src={p.url} alt="" className="h-full w-full object-cover" />
                  : <div className="grid h-full place-items-center text-slate-400"><FileText className="h-5 w-5" /></div>}
                <button type="button" onClick={() => onRemoveFile(i)}
                  className="absolute right-1 top-1 grid h-[18px] w-[18px] place-items-center rounded-full bg-slate-900/75 text-white">
                  <X className="h-3 w-3" />
                </button>
              </div>
            );
          })}
        </div>
        <input ref={fileRef} type="file" accept="image/*,application/pdf" capture="environment" multiple hidden
          onChange={(e) => { onAddFiles(e.target.files); e.target.value = ""; }} />
      </div>
    </div>
  );
}
