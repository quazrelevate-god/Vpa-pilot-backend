"use client";
import { useEffect, useState } from 'react'
import { useLang, useT } from '../i18n.jsx'
import { IMG, SLIDES, CATEGORIES } from '../data.jsx'
import { Logo } from './logo.jsx'
import { useBrandFile } from '../brand.jsx'

const scrollToDesks = () => document.getElementById('desks')?.scrollIntoView({ behavior: 'smooth', block: 'start' })

/** Uses public/brand/logo.* when present; falls back to the drawn wordmark. */
function BrandLogo() {
  const file = useBrandFile('logo')
  if (file) return <img src={file} alt="Nam Kural · நம் குரல்" className="h-12 sm:h-[62px] w-auto shrink-0 object-contain" />
  return <Logo className="h-10 sm:h-12 w-auto shrink-0" />
}

/** Cursor that drifts in, clicks the CTA once, ripples, then leaves. Never loops. */
function ClickHint() {
  return (
    <span className="click-hint" aria-hidden="true">
      <span className="click-ring" />
      <span className="click-ring" style={{ animationDelay: '2.52s' }} />
      <svg viewBox="0 0 24 24" className="w-[26px] h-[26px] drop-shadow-[0_2px_6px_rgba(0,0,0,.5)]">
        <path d="M5 2.4 5 19.1 9.3 15.2 11.9 21.3 15 20 12.4 13.9 18.1 13.5Z"
              fill="#F3E7D3" stroke="#081831" strokeWidth="1.3" strokeLinejoin="round" />
      </svg>
    </span>
  )
}

/* ================= NAV ================= */
export function Nav() {
  const { lang, setLang } = useLang()
  const t = useT()
  const [scrolled, setScrolled] = useState(false)
  useEffect(() => {
    const fn = () => setScrolled(window.scrollY > 40)
    addEventListener('scroll', fn); return () => removeEventListener('scroll', fn)
  }, [])
  return (
    <nav className={`fixed top-0 inset-x-0 z-40 flex items-center justify-between px-6 lg:px-10 py-3.5 transition-all duration-300 ${scrolled ? 'bg-ink-950/95 backdrop-blur-md shadow-[0_1px_0_rgba(255,255,255,0.15)]' : ''}`}>
      <a href="#top" className="flex items-center gap-3 sm:gap-4 text-white min-w-0">
        <BrandLogo />
        <span className="hidden sm:block h-8 w-px bg-white/20 shrink-0" />
        <span className="text-[9px] sm:text-[10px] uppercase tracking-[0.16em] text-haze-300/90 hidden sm:block leading-relaxed max-w-[16ch]">
          {t({ en: 'Proposal Management System', ta: 'யோசனை மேலாண்மை அமைப்பு' })}
        </span>
      </a>
      <div className="flex items-center shrink-0">
        <div className="flex rounded-full border border-white/30 p-0.5">
          {['en', 'ta'].map((l) => (
            <button key={l} onClick={() => setLang(l)}
              className={`rounded-full px-3.5 sm:px-3.5 py-2 sm:py-1.5 text-[12px] sm:text-[13px] font-semibold transition-colors ${lang === l ? 'bg-gold-500 text-ink-950' : 'text-white/70 hover:text-white'}`}>
              {l === 'en' ? 'EN' : 'தமிழ்'}
            </button>
          ))}
        </div>
      </div>
    </nav>
  )
}

/* ================= HERO ================= */
export function Hero() {
  const t = useT()
  return (
    <header id="top" className="relative h-screen min-h-[600px] sm:min-h-[700px] bg-ink-950 overflow-hidden flex items-end">
      <div className="absolute inset-0" aria-hidden="true">
        {SLIDES.map((s, i) => (
          <div key={i} className="slide" style={{ backgroundImage: `url('${IMG[s.img]}')`, backgroundPosition: s.pos, animationDelay: `${i * 7}s` }}>
            <span className="absolute bottom-5 right-6 z-[3] text-[12px] text-white/85 whitespace-nowrap hidden lg:block font-medium tracking-wide2">
              {t(s.cap)}
            </span>
          </div>
        ))}
      </div>
      <div className="relative z-10 w-full px-5 sm:px-6 lg:px-12 pb-[9vh] sm:pb-[11vh] pt-28">
        <h1 className="h-display text-white text-[clamp(33px,5.8vw,86px)] max-w-[15ch]">
          {t({ en: 'Your proposal.', ta: 'உங்கள் யோசனை.' })}<br />
          <em className="not-italic text-haze-300">{t({ en: 'Before the Minister.', ta: 'அமைச்சரின் முன்.' })}</em>
        </h1>
        <p className="text-white/90 text-[clamp(14.5px,1.4vw,19px)] leading-relaxed max-w-[58ch] mt-5 sm:mt-6 mb-7 sm:mb-9">
          {t({
            en: 'Nam Kural is the formal channel through which corporates, institutions, associations and unions place proposals before the Hon\'ble Minister for Education, Government of Tamil Nadu. No queues, no intermediaries. Every submission is recorded, routed to the right desk, and answered on record.',
            ta: 'நம் குரல்: நிறுவனங்கள், கல்வி நிலையங்கள், சங்கங்கள், தொழிற்சங்கங்கள் தங்கள் யோசனைகளை தமிழ்நாடு அரசின் மாண்புமிகு கல்வி அமைச்சரின் முன் வைக்கும் அதிகாரப்பூர்வ வழி. வரிசை இல்லை, இடைத்தரகர் இல்லை. ஒவ்வொரு சமர்ப்பிப்பும் பதிவு செய்யப்பட்டு, சரியான மேசைக்கு அனுப்பப்பட்டு, பதிவுடன் பதிலளிக்கப்படும்.',
          })}
        </p>
        <span className="relative inline-block">
          <button onClick={scrollToDesks} className="btn-gold">
            {t({ en: 'Give your idea for the betterment of tomorrow →', ta: 'நாளைய நலனுக்காக உங்கள் யோசனையை வழங்குங்கள் →' })}
          </button>
          <ClickHint />
        </span>
        <div className="mt-9 sm:mt-11 pt-5 border-t border-white/25 max-w-2xl hidden md:block">
          <p className="font-disp text-haze-100 text-[15px] leading-loose">
            "எப்பொருள் யார்யார்வாய்க் கேட்பினும் அப்பொருள்<br />மெய்ப்பொருள் காண்பது அறிவு" · திருக்குறள் 423
          </p>
          <p className="text-white/65 text-[12.5px] italic mt-1.5">
            {t({ en: 'To discern the truth in everything, by whomsoever spoken. That is wisdom. Tirukkural 423', ta: 'யார் சொன்னாலும் அதில் உள்ள உண்மையை காண்பதே அறிவு.' })}
          </p>
        </div>
      </div>
      <button onClick={scrollToDesks} aria-label="Scroll to categories"
        className="absolute bottom-6 left-1/2 -translate-x-1/2 z-10 hidden lg:grid place-items-center w-10 h-10 text-white/50 hover:text-white transition-colors scroll-nudge">
        ↓
      </button>
    </header>
  )
}

/* ================= CLOSING BAND =================
   Also the landing spot after a proposal is filed — see App.onFiled. */
export function CtaBand() {
  const t = useT()
  return (
    <section id="voice" className="relative overflow-hidden text-center text-white py-24 sm:py-28 lg:py-36 bg-gradient-to-br from-ink-800 via-ink-700 to-ink-600">
      <div className="absolute inset-0 grid place-items-center pointer-events-none" aria-hidden="true">
        <span className="font-disp font-extrabold text-[19vw] sm:text-[17vw] leading-none text-haze-300/10 select-none whitespace-nowrap">நம் குரல்</span>
      </div>
      <div className="relative px-5 sm:px-6">
        <h2 className="h-display text-[clamp(26px,4.4vw,62px)] max-w-[20ch] mx-auto mb-5">
          {t({ en: 'Give your idea for the betterment of tomorrow.', ta: 'நாளைய நலனுக்காக உங்கள் யோசனையை வழங்குங்கள்.' })}
        </h2>
        <p className="max-w-[54ch] mx-auto text-white/85 text-[15px] sm:text-[16.5px] leading-relaxed">
          {t({ en: 'Ten minutes of your thought can outlast a generation. The Ministry is listening: formally, transparently, in your language.', ta: 'உங்கள் பத்து நிமிட சிந்தனை ஒரு தலைமுறையைத் தாண்டி நிலைக்கும். அமைச்சகம் கேட்கிறது: முறையாக, வெளிப்படையாக, உங்கள் மொழியில்.' })}
        </p>
      </div>
    </section>
  )
}

/* ================= FOOTER ================= */
export function Footer() {
  const t = useT()
  return (
    <footer className="bg-ink-950 text-white/75 pt-16 pb-10 border-t border-white/15">
      <div className="wrap grid gap-10 sm:gap-12 sm:grid-cols-2 md:grid-cols-[2fr_1fr_1fr]">
        <div className="sm:col-span-2 md:col-span-1">
          <h5 className="font-disp text-white text-[14px] uppercase tracking-wide2 mb-4">Nam Kural · நம் குரல்</h5>
          <p className="text-[13px] leading-relaxed">
            {t({
              en: 'The digital proposal channel of the Office of the Hon\'ble Minister for Education, Government of Tamil Nadu. This system records and routes institutional proposals for review. Submission does not guarantee approval; every submission receives a reasoned response.',
              ta: 'தமிழ்நாடு அரசின் மாண்புமிகு கல்வி அமைச்சர் அலுவலகத்தின் டிஜிட்டல் யோசனை வழி. சமர்ப்பிப்பு ஒப்புதலுக்கு உத்தரவாதம் அல்ல; ஒவ்வொரு சமர்ப்பிப்பும் காரணத்துடன் பதில் பெறும்.',
            })}
          </p>
        </div>
        <div>
          <h5 className="font-disp text-white text-[14px] uppercase tracking-wide2 mb-4">{t({ en: 'Portfolios', ta: 'துறைகள்' })}</h5>
          <ul className="space-y-2 text-[13px]">
            {CATEGORIES.map((c) => (
              <li key={c.key}>
                <button className="hover:text-gold-400 transition-colors text-left" onClick={scrollToDesks}>{t(c.short || c.title)}</button>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h5 className="font-disp text-white text-[14px] uppercase tracking-wide2 mb-4">{t({ en: 'Trust', ta: 'நம்பிக்கை' })}</h5>
          <ul className="space-y-2 text-[13px]">
            <li>{t({ en: 'Data under government privacy standards', ta: 'அரசு தனியுரிமை தரங்களின் கீழ் தரவு' })}</li>
            <li>{t({ en: 'Every action logged and auditable', ta: 'ஒவ்வொரு செயலும் பதிவு & தணிக்கை' })}</li>
            <li>{t({ en: 'Human officers decide, AI assists', ta: 'அதிகாரிகள் முடிவு; AI உதவி மட்டுமே' })}</li>
          </ul>
        </div>
      </div>
      <div className="wrap mt-12 pt-6 border-t border-white/15 text-[10.5px] leading-relaxed text-white/40">
        <b>Prototype. Data and image sources:</b> IBEF Tamil Nadu state profile (FY25 to FY26); The News Minute, "CM Vijay launches 436 schemes" (2026); TVK Governing Mandate, Ten Guarantees (vijay.com, 2026); 2026 election outcome per Wikipedia. Photography: Wikimedia Commons under Creative Commons licenses; selected images AI-enhanced via Higgsfield 4K upscale. Replace with official Government of Tamil Nadu photography and DIPR-verified figures before public deployment. This page is a design prototype, not a government publication.
      </div>
    </footer>
  )
}
