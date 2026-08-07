"use client";

// Self-contained EN / தமிழ் i18n for the Minister PWA. Own localStorage key so
// it never touches the portal / crowd / events bundles. Renders only the active
// language via the t(en, ta) helper. (Clone of the events app's provider.)

import { createContext, useCallback, useContext, useEffect, useState } from "react";

export type Lang = "en" | "ta";
const KEY = "min_lang";

type Ctx = {
  lang: Lang;
  setLang: (l: Lang) => void;
  toggle: () => void;
  /** Pick the string for the active language. */
  t: (en: string, ta: string) => string;
};

const I18nContext = createContext<Ctx | null>(null);

export function MinisterI18nProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>("en");

  useEffect(() => {
    try {
      const saved = localStorage.getItem(KEY) as Lang | null;
      if (saved === "en" || saved === "ta") setLangState(saved);
    } catch {}
  }, []);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try { localStorage.setItem(KEY, l); } catch {}
  }, []);

  const toggle = useCallback(() => setLang(lang === "ta" ? "en" : "ta"), [lang, setLang]);
  const t = useCallback((en: string, ta: string) => (lang === "ta" ? ta : en), [lang]);

  return (
    <I18nContext.Provider value={{ lang, setLang, toggle, t }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useT(): Ctx {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useT must be used within MinisterI18nProvider");
  return ctx;
}
