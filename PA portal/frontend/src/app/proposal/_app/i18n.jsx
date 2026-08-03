"use client";
import { createContext, useContext, useEffect, useState } from 'react'
import { refreshScroll } from './lib/useLenis.js'

const LangCtx = createContext({ lang: 'en', setLang: () => {} })

export function LangProvider({ children }) {
  const [lang, setLang] = useState('en')
  // drives the html[lang="ta"] typography rules in proposal.css
  useEffect(() => {
    document.documentElement.lang = lang
    // Tamil copy is noticeably taller than the English source, which pushes the
    // document height up. Lenis caches the scrollable extent on mount, so
    // without this refresh the page silently clamps at the old (shorter)
    // English max, and the footer becomes unreachable in Tamil. Two rAF ticks
    // give layout time to settle after fonts + text reflow.
    requestAnimationFrame(() => requestAnimationFrame(refreshScroll))
  }, [lang])
  // Next.js is an SPA: restore the document's original lang when this route
  // unmounts so a Tamil toggle here doesn't leak into the rest of the portal.
  useEffect(() => {
    const original = document.documentElement.lang
    return () => { document.documentElement.lang = original }
  }, [])
  return <LangCtx.Provider value={{ lang, setLang }}>{children}</LangCtx.Provider>
}

export const useLang = () => useContext(LangCtx)

/** t({en,ta}) -> string for current language */
export function useT() {
  const { lang } = useLang()
  return (obj) => (obj && (obj[lang] ?? obj.en)) || ''
}
