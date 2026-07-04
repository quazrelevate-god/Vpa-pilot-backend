"use client";

import { Button } from "@/components/ui/button";
import { useT } from "../_lib/i18n";
import { WifiOff } from "../_lib/icons";

export default function OfflineScreen({ onRetry }: { onRetry: () => void }) {
  const { t } = useT();
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-8 text-center">
      <div className="mb-4 grid h-20 w-20 place-items-center rounded-full bg-red-50 text-red-500">
        <WifiOff className="h-10 w-10" />
      </div>
      <h2 className="text-xl font-black text-slate-900">{t("You are offline", "இணைப்பு இல்லை")}</h2>
      <p className="mt-1.5 max-w-[300px] text-sm text-slate-500">
        {t(
          "Showing last synced data. Some features are limited. Connect to the internet to update and register visitors.",
          "பழைய தரவு காட்டப்படுகிறது. சில செயல்பாடுகள் வரம்பிடப்பட்டுள்ளன. புதுப்பிக்க இணையத்துடன் இணையவும்.",
        )}
      </p>
      <Button onClick={onRetry} className="mt-5 h-11 rounded-xl bg-blue-600 px-8 font-bold hover:bg-blue-700">{t("Retry", "மீண்டும்")}</Button>
    </div>
  );
}
