"use client";
import { useState } from 'react'
import { MotionConfig } from 'framer-motion'
import { LangProvider } from './i18n.jsx'
import { Nav, Hero, About, CtaBand, Footer } from './components/sections.jsx'
import { CategoryStack } from './components/categories.jsx'
import { ProposalForm } from './components/form.jsx'
import { ScrollProgress } from './components/fx.jsx'
import { useLenis, scrollToId } from './lib/useLenis.js'

export default function App() {
  // Lenis smooth scroll for the whole page (auto-disabled under reduced motion).
  useLenis()
  const [desk, setDesk] = useState(null)

  const close = () => setDesk(null)
  const changeDesk = () => { setDesk(null); scrollToId('desks', -84) }
  // closing a *filed* proposal lands on the நம் குரல் watermark band
  const onFiled = () => { setDesk(null); scrollToId('voice') }

  return (
    // reducedMotion="user" makes every Motion element honour the visitor's OS
    // "reduce motion" preference — transforms/layout are dropped, opacity kept.
    <MotionConfig reducedMotion="user">
      <LangProvider>
        <div className="nk-root min-h-screen">
          <ScrollProgress />
          <Nav />
          <Hero />
          <About />
          <CategoryStack onPick={setDesk} />
          <CtaBand />
          <Footer />
          <ProposalForm open={!!desk} category={desk} onClose={close} onChangeDesk={changeDesk} onFiled={onFiled} />
        </div>
      </LangProvider>
    </MotionConfig>
  )
}
