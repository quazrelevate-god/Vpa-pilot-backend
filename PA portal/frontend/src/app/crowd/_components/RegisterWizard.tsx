"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

import { useT } from "../_lib/i18n";
import { api } from "../_lib/api";
import type { OpenDate, Slot, IntakeResult } from "../_lib/types";
import { Check } from "../_lib/icons";
import WizardDetails from "./WizardDetails";
import WizardSlots from "./WizardSlots";
import WizardReview from "./WizardReview";

export type Photo = { file: File; url: string };

export default function RegisterWizard({
  onDone,
  onDirtyChange,
}: {
  onDone: (ticket: IntakeResult) => void;
  onDirtyChange?: (dirty: boolean) => void;
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

  // Report whether the citizen has entered anything, so the shell (CrowdApp
  // goList) can confirm before a section switch discards it.
  const dirty = !!(name.trim() || mobile.trim() || category || desc.trim() || photos.length || slot);
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => () => { onDirtyChange?.(false); }, [onDirtyChange]);

  const addFiles = useCallback((files: FileList | null) => {
    if (!files) return;
    const MAX_TOTAL = 5 * 1024 * 1024;   // 5 MB total across ALL attachments
    let used = photosRef.current.reduce((sum, p) => sum + p.file.size, 0);
    const next: Photo[] = [];
    let rejected = 0;
    for (let i = 0; i < files.length; i++) {
      if (used + files[i].size > MAX_TOTAL) { rejected++; continue; }
      used += files[i].size;
      next.push({ file: files[i], url: URL.createObjectURL(files[i]) });
    }
    if (rejected) toast.error(t("Total attachments must be under 5 MB", "மொத்த இணைப்புகள் 5 MB க்குள் இருக்க வேண்டும்"));
    if (next.length) setPhotos((p) => [...p, ...next]);
  }, [t]);
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

  // Optional, but a supplied number must be a real Indian mobile — same rule as
  // the QR form (/^[6-9][0-9]{9}$/). It is the Citizen blind-index dedup key, so
  // a typo silently creates a duplicate citizen and sends updates nowhere.
  const MOBILE_RE = /^[6-9][0-9]{9}$/;
  const mobileInvalid = mobile.trim().length > 0 && !MOBILE_RE.test(mobile.trim());

  function validateStep1(): boolean {
    if (!name.trim()) { toast.error(t("Name is required", "பெயர் தேவை")); return false; }
    if (!category) { toast.error(t("Select a category", "வகை தேர்வு")); return false; }
    // Grievance description AND at least one photo are mandatory — for both a
    // petition and a booked appointment.
    if (!desc.trim()) { toast.error(t("Grievance description is required", "குறை விவரம் அவசியம்")); return false; }
    if (!photos.length) { toast.error(t("Attach at least one photo", "குறைந்தது ஒரு படம் இணைக்கவும்")); return false; }
    if (mobileInvalid) {
      toast.error(t("Enter a valid 10-digit mobile number", "சரியான 10 இலக்க கைபேசி எண்ணை உள்ளிடவும்"));
      return false;
    }
    return true;
  }

  function next() {
    if (step === 1) {
      if (!validateStep1()) return;
      setStep(2);
      return;
    }
    if (step === 2) setStep(3);
  }

  /**
   * `asMeeting` picks the outcome, mirroring the QR form's two-choice ending:
   *   false            -> petition only, lands in Petition Review
   *   true  + slot     -> booked appointment (SCHEDULED)
   */
  function submit(asMeeting: boolean) {
    if (!name.trim()) { setStep(1); return toast.error(t("Name is required", "பெயர் தேவை")); }
    if (!category) { setStep(1); return toast.error(t("Select a category", "வகை தேர்வு")); }
    if (mobileInvalid) {
      setStep(1);
      return toast.error(t("Enter a valid 10-digit mobile number", "சரியான 10 இலக்க கைபேசி எண்ணை உள்ளிடவும்"));
    }
    // Grievance description AND a photo are mandatory for BOTH a petition and a
    // booked appointment (send the citizen back to step 1 if either is missing).
    if (!desc.trim()) { setStep(1); return toast.error(t("Grievance description is required", "குறை விவரம் அவசியம்")); }
    if (!photos.length) { setStep(1); return toast.error(t("Attach at least one photo", "குறைந்தது ஒரு படம் இணைக்கவும்")); }
    setBusy(true);
    if (slotTimer.current) clearInterval(slotTimer.current);

    const fd = new FormData();
    fd.append("name", name.trim());
    fd.append("mobile", mobile.trim());
    fd.append("category", category);
    fd.append("description", desc.trim());
    fd.append("schedule_meeting", asMeeting ? "true" : "false");
    if (asMeeting && slot) { fd.append("slot_id", String(slot)); fd.append("num_persons", String(persons)); }
    photos.forEach((p) => fd.append("files", p.file));

    api.intake(fd)
      .then((d) => onDone(d))
      .catch((e) => { setBusy(false); toast.error(e?.message || t("Failed — try again", "தோல்வி — மீண்டும்")); });
  }

  const canBook = !!slot;
  // Any capacity left today or on an upcoming open date? Drives the "all full"
  // notice on the review step.
  const anySlotOpen =
    (slots ?? []).some((s) => s.available && s.remaining > 0) ||
    (dates ?? []).some((d) => (d.open ?? 0) > 0);

  return (
    <div className="flex flex-col">
      {/* sub-header — sits under the shared top bar */}
      <div className="px-4 pt-4">
        <h1 className="text-lg font-extrabold text-slate-900">{t("Register Walk-in", "நேரடி பதிவு")}</h1>
      </div>

      <Steps step={step} />

      <div className="px-4 pt-1 pb-[calc(var(--nav-h)+6.5rem+env(safe-area-inset-bottom))]">
        {step === 1 && (
          <div className="rounded-2xl border border-slate-200/70 bg-white p-4 shadow-sm">
            <WizardDetails
              name={name} mobile={mobile} category={category} desc={desc} photos={photos}
              onName={setName} onMobile={setMobile} onCategory={setCategory} onDesc={setDesc}
              onAddFiles={addFiles} onRemoveFile={removeFile}
            />
          </div>
        )}
        {step === 2 && (
          <div className="rounded-2xl border border-slate-200/70 bg-white p-4 shadow-sm">
            <WizardSlots
              dates={dates} date={date} slots={slots} slot={slot} persons={persons}
              onPickDate={pickDate} onPickSlot={(id) => setSlot((cur) => (cur === id ? null : id))} onPersons={setPersons}
            />
          </div>
        )}
        {step === 3 && (
          <>
            {/* Mirrors the QR form's "all slots full" notice — the floor team
                can explain the citizen has to try later or submit petition-only. */}
            {!canBook && !anySlotOpen && (
              <div className="mb-3 flex gap-2.5 rounded-2xl border border-amber-200 bg-amber-50 p-3.5 text-[13px] leading-relaxed text-amber-900">
                <span aria-hidden className="text-base leading-none">⌛</span>
                <div>
                  <strong className="font-bold">
                    {t("All meeting slots are currently full.", "தற்போது அனைத்து சந்திப்பு நேரங்களும் நிரம்பிவிட்டன.")}
                  </strong>{" "}
                  {t(
                    "Please try again later — if a slot opens, you can book an appointment for the meeting. For now, submit a petition only.",
                    "பிறகு மீண்டும் முயற்சிக்கவும் — இடம் கிடைத்தால் சந்திப்பு பதிவு செய்யலாம். இப்போது மனுவை மட்டும் சமர்ப்பிக்கவும்.",
                  )}
                </div>
              </div>
            )}
            <WizardReview
              name={name} mobile={mobile} category={category} desc={desc}
              photoCount={photos.length} date={date} slot={slot} slots={slots} persons={persons}
            />
          </>
        )}
      </div>

      {/* action bar — floats above the bottom nav */}
      <div className="fixed inset-x-0 bottom-[calc(var(--nav-h)+env(safe-area-inset-bottom))] z-30 mx-auto flex max-w-[560px] gap-2.5 border-t border-[#E1E5EB] bg-white/95 px-4 py-3 backdrop-blur">
        {step > 1 && (
          <Button variant="outline" onClick={() => setStep((s) => (s - 1) as 1 | 2 | 3)}
            className={cn("h-12 shrink-0 rounded-xl font-bold", step === 3 ? "px-3" : "px-6")}>
            {t("Back", "பின்")}
          </Button>
        )}
        {step < 3 ? (
          <Button onClick={next} className="h-12 flex-1 rounded-xl bg-[#1E40AF] text-base font-bold text-white hover:bg-[#1A3796]">{t("Continue", "தொடரவும்")}</Button>
        ) : (
          <>
            {/* Petition — always available, never needs a slot. */}
            <Button onClick={() => submit(false)} disabled={busy}
              className="h-12 flex-1 rounded-xl bg-[#1E40AF] px-2 text-[13px] font-bold leading-tight text-white hover:bg-[#1A3796]">
              {t("Submit Petition", "மனு சமர்ப்பி")}
            </Button>
            {/* Meeting — only shown when there's a picked slot to book. */}
            {canBook && (
              <Button onClick={() => submit(true)} disabled={busy}
                className="h-12 flex-1 rounded-xl bg-emerald-600 px-2 text-[13px] font-bold leading-tight text-white hover:bg-emerald-700">
                {t("Book Appointment", "சந்திப்பு பதிவு")}
              </Button>
            )}
          </>
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
    <div className="flex items-center gap-1.5 px-4 py-3">
      {items.map(([n, label], i) => {
        const active = step === n;
        const done = step > n;
        return (
          <div key={n} className="flex items-center gap-1.5">
            <div className={cn("flex items-center gap-1.5 text-[0.74rem] font-bold",
              active ? "text-[#1E40AF]" : done ? "text-emerald-600" : "text-slate-400")}>
              <span className={cn("grid h-[22px] w-[22px] place-items-center rounded-full text-[0.72rem] text-white",
                active ? "bg-[#1E40AF]" : done ? "bg-emerald-500" : "bg-slate-300")}>
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
