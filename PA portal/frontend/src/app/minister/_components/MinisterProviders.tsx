"use client";

import { useEffect } from "react";
import { LangProvider, useLang } from "@/lib/lang-context";
import { MinisterI18nProvider, useT } from "../_lib/i18n";

/** Mirror the global lang-context (used by shared components like TamilNaduMap)
 *  onto the Minister app's own language toggle, so the map legend and any other
 *  useLang()-based copy stay in the same language as the rest of the UI. */
function LangBridge() {
  const { lang } = useT();          // Minister app language (the source of truth here)
  const { setLang } = useLang();    // Global lang-context consumed by shared widgets
  useEffect(() => { setLang(lang); }, [lang, setLang]);
  return null;
}

/** Composed providers for the Minister PWA. LangProvider wraps the tree so
 *  shared portal widgets that call useLang() resolve their translation keys;
 *  MinisterI18nProvider drives the app's own bilingual copy. */
export default function MinisterProviders({ children }: { children: React.ReactNode }) {
  return (
    <LangProvider>
      <MinisterI18nProvider>
        <LangBridge />
        {children}
      </MinisterI18nProvider>
    </LangProvider>
  );
}
