"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

import { useT } from "../_lib/i18n";
import { api } from "../_lib/api";
import type { OpenDate, Slot, IntakeResult } from "../_lib/types";
import { X, Check } from "../_lib/icons";
import WizardDetails from "./WizardDetails";
import WizardSlots from "./WizardSlots";
import WizardReview from "./WizardReview";

export type Photo = { file: File; url: string };

export default function RegisterWizard({
  onClose, onDone,
}: {
  onClose: () => void;
  onDone: (ticket: IntakeResult) => void;
}) {
  const { t } = useT();

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [name, setName] = useState("");
  const [mobile, setMobile] = useState("");
  const [category, setCategory] = useState("");
  const [desc, setDesc] = useState("");
  const [photos, setPhotos] = useState<Photo[]>([]);

  const [dates, setDates] = useState<OpenDate[] | null>(null);
  const [date, setDate] = useState<string | null>(null);
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [slot, setSlot] = useState<number | null>(null);
  const [persons, setPersons] = useState(1);
  const [busy, setBusy] = useState(false);

  const slotTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const photosRef = useRef(photos);
  photosRef.current = photos;

  const addFiles = useCallback((files: FileList | null) => {
    if (!files) return;
    const next: Photo[] = [];
    for (let i = 0; i < files.length; i++) next.push({ file: files[i], url: URL.createObjectURL(files[i]) });
    setPhotos((p) => [...p, ...next]);
  }, []);
  const removeFile = useCallback((idx: number) => {
    setPhotos((p) => {
      const target = p[idx];
      if (target) URL.revokeObjectURL(target.url);
      return p.filter((_, i) => i !== idx);
    });
  }, []);

  const loadSlots = useCallback((d: string) => {
    api.slots(d).then((r) => setSlots(r.slots || [])).catch(() => setSlots([]));
  }, []);
  const pickDate = useCallback((d: string) => {
    setDate(d); setSlot(null); setSlots(null); loadSlots(d);
  }, [loadSlots]);

  useEffect(() => {
    let alive = true;
    api.openDates().then((ds) => {
      if (!alive) return;
      setDates(ds || []);
      if (ds && ds.length) {
        pickDate(ds[0].date);
        ds.forEach((d) => {
          api.slots(d.date).then((r) => {
            const open = (r.slots || []).filter((s) => s.available && s.remaining > 0).length;
            if (alive) setDates((prev) => prev ? prev.map((x) => x.date === d.date ? { ...x, open } : x) : prev);
          }).catch(() => {});
        });
      }
    }).catch(() => { if (alive) setDates([]); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (slotTimer.current) clearInterval(slotTimer.current);
    if (step === 2 && date) {
      slotTimer.current = setInterval(() => {
        api.slots(date).then((r) => setSlots(r.slots || [])).catch(() => {});
      }, 5000);
    }
    return () => { if (slotTimer.current) clearInterval(slotTimer.current); };
  }, [step, date]);

  useEffect(() => () => { photosRef.current.forEach((p) => URL.revokeObjectURL(p.url)); }, []);

  function next() {
    if (step === 1) {
      if (!name.trim()) return toast.error(t("Name is required", "பெயர் தேவை"));
      if (!category) return toast.error(t("Select a category", "வகை தேர்வு"));
      setStep(2);
      return;
    }
    if (step === 2) setStep(3);
  }

  function submit() {
    if (!name.trim()) { setStep(1); return toast.error(t("Name is required", "பெயர் தேவை")); }
    if (!category) { setStep(1); return toast.error(t("Select a category", "வகை தேர்வு")); }
    if (!slot && !desc.trim() && !photos.length) {
      return toast.error(t("Add a grievance, photo, or slot", "குறை/படம்/நேரம் தேவை"));
    }
    setBusy(true);
    if (slotTimer.current) clearInterval(slotTimer.current);

    const fd = new FormData();
    fd.append("name", name.trim());
    fd.append("mobile", mobile.trim());
    fd.append("category", category);
    fd.append("description", desc.trim());
    fd.append("schedule_meeting", slot ? "true" : "false");
    if (slot) { fd.append("slot_id", String(slot)); fd.append("num_persons", String(persons)); }
    photos.forEach((p) => fd.append("files", p.file));

    api.intake(fd)
      .then((d) => onDone(d))
      .catch((e) => { setBusy(false); toast.error(e?.message || t("Failed — try again", "தோல்வி — மீண்டும்")); });
  }

  const canBook = !!slot;

  return (
    <div className="flex min-h-screen flex-col bg-slate-50">
      <header className="flex items-center gap-2 border-b border-slate-200 bg-white px-4 pb-3 pt-[calc(0.75rem+env(safe-area-inset-top))]">
        <button onClick={onClose} className="grid h-9 w-9 place-items-center rounded-lg text-slate-600 active:bg-slate-100" aria-label={t("Close", "மூடு")}>
          <X className="h-5 w-5" />
        </button>
        <h1 className="flex-1 text-center text-lg font-extrabold text-slate-900">{t("Register Walk-in", "நேரடி பதிவு")}</h1>
        <span className="h-9 w-9" />
      </header>

      <Steps step={step} />

      <div className="flex-1 px-4 py-4">
        {step === 1 && (
          <WizardDetails
            name={name} mobile={mobile} category={category} desc={desc} photos={photos}
            onName={setName} onMobile={setMobile} onCategory={setCategory} onDesc={setDesc}
            onAddFiles={addFiles} onRemoveFile={removeFile}
          />
        )}
        {step === 2 && (
          <WizardSlots
            dates={dates} date={date} slots={slots} slot={slot} persons={persons}
            onPickDate={pickDate} onPickSlot={(id) => setSlot((cur) => (cur === id ? null : id))} onPersons={setPersons}
          />
        )}
        {step === 3 && (
          <WizardReview
            name={name} mobile={mobile} category={category} desc={desc}
            photoCount={photos.length} date={date} slot={slot} slots={slots} persons={persons}
          />
        )}
      </div>

      <div className="sticky bottom-0 flex gap-2.5 bg-gradient-to-t from-slate-50 to-transparent px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-3">
        {step > 1 && (
          <Button variant="outline" onClick={() => setStep((s) => (s - 1) as 1 | 2 | 3)}
            className="h-12 rounded-xl px-6 font-bold">{t("Back", "பின்")}</Button>
        )}
        {step < 3 ? (
          <Button onClick={next} className="h-12 flex-1 rounded-xl bg-blue-600 text-base font-bold hover:bg-blue-700">{t("Continue", "தொடரவும்")}</Button>
        ) : (
          <Button onClick={submit} disabled={busy}
            className={cn("h-12 flex-1 rounded-xl text-base font-bold", canBook ? "bg-emerald-600 hover:bg-emerald-700" : "bg-blue-600 hover:bg-blue-700")}>
            {canBook ? t("Book Appointment", "சந்திப்பு பதிவு") : t("Submit Petition", "மனு சமர்ப்பி")}
          </Button>
        )}
      </div>
    </div>
  );
}

function Steps({ step }: { step: number }) {
  const { t } = useT();
  const items = [
    [1, t("Details", "விவரம்")],
    [2, t("Slot (Optional)", "நேரம்")],
    [3, t("Review", "சரிபார்")],
  ] as const;
  return (
    <div className="flex items-center gap-1.5 border-b border-slate-200 bg-white px-4 py-3.5">
      {items.map(([n, label], i) => {
        const active = step === n;
        const done = step > n;
        return (
          <div key={n} className="flex items-center gap-1.5">
            <div className={cn("flex items-center gap-1.5 text-[0.74rem] font-bold",
              active ? "text-blue-600" : done ? "text-emerald-600" : "text-slate-400")}>
              <span className={cn("grid h-[22px] w-[22px] place-items-center rounded-full text-[0.72rem] text-white",
                active ? "bg-blue-600" : done ? "bg-emerald-500" : "bg-slate-300")}>
                {done ? <Check className="h-3 w-3" /> : n}
              </span>
              {label}
            </div>
            {i < items.length - 1 && <span className="h-0.5 w-4 rounded bg-slate-200" />}
          </div>
        );
      })}
    </div>
  );
}
