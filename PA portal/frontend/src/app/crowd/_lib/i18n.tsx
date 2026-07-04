"use client";

// Self-contained EN / தமிழ் i18n for the crowd app. Keeps its own localStorage
// key so it never touches the PA portal's translation bundle. Renders only the
// active language (no dual-language DOM) via the t(en, ta) helper.

import { createContext, useCallback, useContext, useEffect, useState } from "react";

export type Lang = "en" | "ta";
const KEY = "cb_lang";

type Ctx = {
  lang: Lang;
  setLang: (l: Lang) => void;
  toggle: () => void;
  /** Pick the string for the active language. */
  t: (en: string, ta: string) => string;
};

const I18nContext = createContext<Ctx | null>(null);

export function CrowdI18nProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>("en");

  // Hydrate from localStorage after mount (avoids SSR mismatch).
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
  if (!ctx) throw new Error("useT must be used within CrowdI18nProvider");
  return ctx;
}
