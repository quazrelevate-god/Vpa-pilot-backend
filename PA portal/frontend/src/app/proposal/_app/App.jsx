"use client";
import { useState } from 'react'
import { LangProvider } from './i18n.jsx'
import { Nav, Hero, CtaBand, Footer } from './components/sections.jsx'
import { CategoryStack } from './components/categories.jsx'
import { ProposalForm } from './components/form.jsx'

const goTo = (id) =>
  requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }))

export default function App() {
  const [desk, setDesk] = useState(null)

  const close = () => setDesk(null)
  const changeDesk = () => { setDesk(null); goTo('desks') }
  // closing a *filed* proposal lands on the நம் குரல் watermark band
  const onFiled = () => { setDesk(null); goTo('voice') }

  return (
    <LangProvider>
      <div className="nk-root min-h-screen">
      <Nav />
      <Hero />
      <CategoryStack onPick={setDesk} />
      <CtaBand />
      <Footer />
      <ProposalForm open={!!desk} category={desk} onClose={close} onChangeDesk={changeDesk} onFiled={onFiled} />
      </div>
    </LangProvider>
  )
}
