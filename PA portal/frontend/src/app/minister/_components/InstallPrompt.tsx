"use client";

import { useEffect, useState } from "react";
import { Download, X } from "lucide-react";
import { useT } from "../_lib/i18n";

// Minimal "Add to Home Screen" nudge. Captures the Android/Chrome
// beforeinstallprompt so the PA can install the app to their phone with one
// tap. On iOS (no such event) it stays hidden — the OS Share → Add flow is the
// path there, and we don't nag about it.
interface BIPEvent extends Event { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> }

export default function InstallPrompt() {
  const { t } = useT();
  const [evt, setEvt] = useState<BIPEvent | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const onBip = (e: Event) => { e.preventDefault(); setEvt(e as BIPEvent); };
    window.addEventListener("beforeinstallprompt", onBip);
    return () => window.removeEventListener("beforeinstallprompt", onBip);
  }, []);

  if (!evt || dismissed) return null;

  return (
    <div className="flex items-center gap-3 rounded-xl border border-brand/30 bg-brand/5 px-3.5 py-2.5">
      <Download className="h-4 w-4 shrink-0 text-brand" />
      <span className="flex-1 text-[13px] font-medium text-foreground">
        {t("Install this app on your phone", "இந்த செயலியை உங்கள் தொலைபேசியில் நிறுவவும்")}
      </span>
      <button
        onClick={async () => { await evt.prompt(); await evt.userChoice.catch(() => {}); setEvt(null); }}
        className="rounded-lg bg-brand px-3 py-1.5 text-[12.5px] font-semibold text-white"
      >
        {t("Install", "நிறுவு")}
      </button>
      <button onClick={() => setDismissed(true)} aria-label="Dismiss" className="text-muted-foreground">
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
