"use client";

// "Install this app" helper. On Android/Chrome the browser fires
// beforeinstallprompt — we stash it and offer a real one-tap Install button.
// Everywhere else (and always for iPhone) we show large, numbered
// add-to-home-screen steps per platform.

import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { useT } from "../_lib/i18n";
import {
  CheckCircle2, Download, EllipsisVertical, Share, Smartphone, SquarePlus,
} from "../_lib/icons";

// Chrome's install event isn't in TypeScript's DOM lib.
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

// Module-level stash: the event fires once, early — often before the dialog
// (or even React) has mounted, so a component-local listener would miss it.
let deferredPrompt: BeforeInstallPromptEvent | null = null;
if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e as BeforeInstallPromptEvent;
  });
}

function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent)
    // iPadOS 13+ reports as Mac but has touch.
    || (navigator.userAgent.includes("Mac") && navigator.maxTouchPoints > 1);
}

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(display-mode: standalone)").matches
    || (navigator as unknown as { standalone?: boolean }).standalone === true;
}

function Step({ n, icon, children }: {
  n: number; icon?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <li className="flex items-start gap-3 py-2.5">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#21395B] font-mono text-base font-bold text-white">
        {n}
      </span>
      <span className="flex-1 text-base leading-relaxed text-slate-700 [&_svg]:mx-0.5 [&_svg]:inline [&_svg]:h-5 [&_svg]:w-5 [&_svg]:align-text-bottom [&_svg]:text-[#21395B]">
        {children}
      </span>
      {icon}
    </li>
  );
}

export default function InstallDialog({ open, onClose }: {
  open: boolean; onClose: () => void;
}) {
  const { t } = useT();
  const [installed, setInstalled] = useState(false);
  const [canPrompt, setCanPrompt] = useState(false);

  useEffect(() => {
    if (!open) return;
    setInstalled(isStandalone());
    setCanPrompt(!!deferredPrompt);
  }, [open]);

  async function nativeInstall() {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const choice = await deferredPrompt.userChoice;
    if (choice.outcome === "accepted") {
      deferredPrompt = null;
      setCanPrompt(false);
      onClose();
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[88vh] w-[calc(100vw-2rem)] max-w-[440px] overflow-y-auto rounded-2xl p-5">
        <div className="flex items-center gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[#21395B] text-white">
            <Smartphone className="h-6 w-6" strokeWidth={1.75} />
          </span>
          <div>
            <DialogTitle className="text-lg font-extrabold text-slate-900">
              {t("Install this app", "இந்த செயலியை நிறுவவும்")}
            </DialogTitle>
            <p className="text-sm text-slate-500">
              {t("Add it to your phone's home screen.", "உங்கள் போன் முகப்புத் திரையில் சேர்க்கவும்.")}
            </p>
          </div>
        </div>

        {installed ? (
          <div className="mt-4 flex items-center gap-3 rounded-xl border border-[#4F8A5B]/30 bg-[#4F8A5B]/10 p-4">
            <CheckCircle2 className="h-6 w-6 shrink-0 text-[#4F8A5B]" strokeWidth={1.75} />
            <p className="text-base font-semibold text-slate-700">
              {t("Already installed — you're using the app now.",
                 "ஏற்கனவே நிறுவப்பட்டுள்ளது — நீங்கள் செயலியில் உள்ளீர்கள்.")}
            </p>
          </div>
        ) : (
          <>
            {canPrompt && (
              <Button onClick={nativeInstall}
                className="mt-4 h-14 w-full gap-2 rounded-xl text-lg font-bold">
                <Download className="h-6 w-6" strokeWidth={1.75} />
                {t("Install now", "இப்போது நிறுவு")}
              </Button>
            )}

            <Tabs defaultValue={isIOS() ? "iphone" : "android"} className="mt-4">
              <TabsList className="grid h-12 w-full grid-cols-2">
                <TabsTrigger value="android" className="text-base font-bold">Android</TabsTrigger>
                <TabsTrigger value="iphone" className="text-base font-bold">iPhone</TabsTrigger>
              </TabsList>

              <TabsContent value="android" className="mt-2">
                <ol className="divide-y divide-slate-100">
                  <Step n={1}>
                    {t("Open this page in the Chrome browser.",
                       "இந்தப் பக்கத்தை Chrome உலாவியில் திறக்கவும்.")}
                  </Step>
                  <Step n={2}>
                    {t("Tap the ", "மேல் வலதுபுறம் உள்ள ")}
                    <EllipsisVertical strokeWidth={1.75} />
                    {t(" menu at the top right.", " மெனுவை தட்டவும்.")}
                  </Step>
                  <Step n={3}>
                    {t('Tap "Add to Home screen" (or "Install app").',
                       '"முகப்புத் திரையில் சேர்" ("Install app") என்பதை தட்டவும்.')}
                  </Step>
                  <Step n={4}>
                    {t('Tap "Install" to confirm. The app icon appears on your home screen.',
                       '"நிறுவு" என்பதை தட்டவும். செயலி ஐகான் முகப்புத் திரையில் தோன்றும்.')}
                  </Step>
                </ol>
              </TabsContent>

              <TabsContent value="iphone" className="mt-2">
                <ol className="divide-y divide-slate-100">
                  <Step n={1}>
                    {t("Open this page in the Safari browser (it does not work from other browsers).",
                       "இந்தப் பக்கத்தை Safari உலாவியில் திறக்கவும் (மற்ற உலாவிகளில் வேலை செய்யாது).")}
                  </Step>
                  <Step n={2}>
                    {t("Tap the Share button ", "கீழே நடுவில் உள்ள பகிர் ")}
                    <Share strokeWidth={1.75} />
                    {t(" at the bottom of the screen.", " பொத்தானை தட்டவும்.")}
                  </Step>
                  <Step n={3}>
                    {t('Scroll down and tap "Add to Home Screen" ',
                       'கீழே உருட்டி "முகப்புத் திரையில் சேர்" ')}
                    <SquarePlus strokeWidth={1.75} />
                    {t(".", " என்பதை தட்டவும்.")}
                  </Step>
                  <Step n={4}>
                    {t('Tap "Add" at the top right. The app icon appears on your home screen.',
                       'மேல் வலதுபுறம் "சேர்" என்பதை தட்டவும். செயலி ஐகான் முகப்புத் திரையில் தோன்றும்.')}
                  </Step>
                </ol>
              </TabsContent>
            </Tabs>
          </>
        )}

        <Button variant="outline" onClick={onClose}
          className="mt-3 h-12 w-full text-base font-bold">
          {t("Close", "மூடு")}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
