"use client";

import { Button } from "@/components/ui/button";
import { useT } from "../_lib/i18n";

// iOS install instructions (Safari has no beforeinstallprompt), shown as a
// bottom sheet.
export default function InstallSheet({ onClose }: { onClose: () => void }) {
  const { t } = useT();
  return (
    <div className="fixed inset-0 z-[70] flex items-end bg-slate-900/50" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="mx-auto w-full max-w-[560px] rounded-t-[22px] bg-white px-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] pt-3.5">
        <div className="mx-auto mb-3 h-1 w-10 rounded bg-slate-200" />
        <h3 className="text-[1.05rem] font-black text-slate-900">{t("Install on your phone", "தொலைபேசியில் நிறுவவும்")}</h3>
        <ol className="my-3 list-decimal space-y-1.5 pl-5 text-slate-600">
          <li>{t("Tap the Share button in Safari", "Safari-ல் Share பொத்தானை அழுத்தவும்")}</li>
          <li>{t("Choose Add to Home Screen", "Add to Home Screen தேர்ந்தெடுக்கவும்")}</li>
          <li>{t("Tap Add", "Add அழுத்தவும்")}</li>
        </ol>
        <Button onClick={onClose} className="h-12 w-full rounded-xl bg-blue-600 font-bold hover:bg-blue-700">{t("Got it", "சரி")}</Button>
      </div>
    </div>
  );
}
