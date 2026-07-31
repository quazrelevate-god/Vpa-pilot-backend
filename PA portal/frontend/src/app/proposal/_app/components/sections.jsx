"use client";
import { useEffect, useRef, useState } from 'react'
import { useLang, useT } from '../i18n.jsx'
import { IMG, SLIDES, CATEGORIES } from '../data.jsx'
import { Logo } from './logo.jsx'
import { useBrandFile } from '../brand.jsx'

const scrollToDesks = () => document.getElementById('desks')?.scrollIntoView({ behavior: 'smooth', block: 'start' })

// A deliberately slow, eased scroll — used by the hero CTA so the page glides
// DOWN THROUGH the About section (its content reveals as it passes) before it
// arrives at the categories, instead of jumping. A timer (not rAF) drives it so
// it runs even in throttled/background contexts; CSS scroll-behavior is disabled
// for the duration so the per-tick scrollTo isn't double-animated, and any user
// wheel/touch hands control straight back.
let _glideTimer = null
function glideTo(id) {
  if (typeof document === 'undefined') return
  const el = document.getElementById(id)
  if (!el) return
  if (_glideTimer) { clearInterval(_glideTimer); _glideTimer = null }
  const html = document.documentElement
  const prevBehavior = html.style.scrollBehavior
  html.style.scrollBehavior = 'auto'
  const startY = window.scrollY
  const dist = el.getBoundingClientRect().top          // px from current view to target top
  if (Math.abs(dist) < 4) { html.style.scrollBehavior = prevBehavior; return }
  const duration = Math.min(2400, Math.max(1400, Math.abs(dist) * 0.85))  // slow, distance-aware
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2) // easeInOutCubic
  const t0 = performance.now()
  let lastY = startY
  const end = () => {
    if (_glideTimer) { clearInterval(_glideTimer); _glideTimer = null }
    html.style.scrollBehavior = prevBehavior
    window.removeEventListener('wheel', onUser)
    window.removeEventListener('touchmove', onUser)
  }
  const onUser = () => end()   // user grabbed the scroll — stop gliding
  window.addEventListener('wheel', onUser, { passive: true })
  window.addEventListener('touchmove', onUser, { passive: true })
  _glideTimer = setInterval(() => {
    const p = Math.min((performance.now() - t0) / duration, 1)
    lastY = Math.round(startY + dist * ease(p))
    window.scrollTo(0, lastY)
    if (p >= 1) end()
  }, 16)
}

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
        <span className="relative inline-block mt-7 sm:mt-9">
          <button onClick={() => glideTo('desks')} className="btn-gold">
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
      <button onClick={() => glideTo('desks')} aria-label="Scroll to categories"
        className="absolute bottom-6 left-1/2 -translate-x-1/2 z-10 hidden lg:grid place-items-center w-10 h-10 text-white/50 hover:text-white transition-colors scroll-nudge">
        ↓
      </button>
    </header>
  )
}

/* ================= ABOUT =================
   Sits between the hero and the desks: what Nam Kural is, who it is for, and
   how a submission travels. Content reveals as it scrolls into view. */
const SUBMITTERS = [
  { en: 'Corporates', ta: 'நிறுவனங்கள்' },
  { en: 'Educational institutions', ta: 'கல்வி நிலையங்கள்' },
  { en: 'Startups', ta: 'ஸ்டார்ட்அப்கள்' },
  { en: 'Research organisations', ta: 'ஆராய்ச்சி நிறுவனங்கள்' },
  { en: 'Technology companies', ta: 'தொழில்நுட்ப நிறுவனங்கள்' },
  { en: 'Industry associations', ta: 'தொழில் சங்கங்கள்' },
  { en: 'Professional bodies', ta: 'தொழில்முறை அமைப்புகள்' },
  { en: 'NGOs', ta: 'தொண்டு நிறுவனங்கள்' },
  { en: 'Subject experts', ta: 'துறை வல்லுநர்கள்' },
]
const FLOW = [
  { n: '01', title: { en: 'Recorded', ta: 'பதிவு' },
    desc: { en: 'Formally logged on the state’s record the moment you submit.', ta: 'சமர்ப்பித்த நொடியிலேயே அரசுப் பதிவில் முறையாக பதிவு.' } },
  { n: '02', title: { en: 'Acknowledged', ta: 'ஒப்புகை' },
    desc: { en: 'A written acknowledgement reaches you — no wondering where it went.', ta: 'எழுத்துப்பூர்வ ஒப்புகை உங்களை அடையும் — எங்கே சென்றது என்ற கேள்வி இல்லை.' } },
  { n: '03', title: { en: 'Forwarded', ta: 'அனுப்பப்பட்டது' },
    desc: { en: 'Routed to the right department for evaluation through the prescribed process.', ta: 'உரிய துறைக்கு நிர்ணயிக்கப்பட்ட நடைமுறையில் மதிப்பீட்டிற்காக அனுப்பப்படும்.' } },
]

export function About() {
  const t = useT()
  const ref = useRef(null)
  const [inView, setInView] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    // Reveal once, when the section scrolls into view.
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => { if (e.isIntersecting) { setInView(true); io.disconnect() } }),
      { threshold: 0.12, rootMargin: '0px 0px -8% 0px' }
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  return (
    <section id="about" ref={ref}
      className={`relative overflow-hidden bg-ink-950 py-24 sm:py-28 lg:py-36 ${inView ? 'about-in' : ''}`}>
      {/* ambient aura + faint Tamil watermark */}
      <div className="absolute inset-0 form-aura pointer-events-none" aria-hidden="true" />
      <div className="absolute inset-0 grid place-items-center pointer-events-none" aria-hidden="true">
        <span className="font-disp font-extrabold text-[27vw] leading-none text-haze-300/[0.04] select-none whitespace-nowrap">நம் குரல்</span>
      </div>

      <div className="wrap relative">
        {/* header */}
        <div className="max-w-[48rem]">
          <div className="reveal-up eyebrow text-gold-400 flex items-center gap-3" style={{ transitionDelay: '40ms' }}>
            <span className="h-px w-8 bg-gold-500/70" />
            {t({ en: 'About Nam Kural', ta: 'நம் குரல் பற்றி' })}
          </div>
          <h2 className="reveal-up h-display text-white text-[clamp(26px,4vw,52px)] mt-5 mb-2 leading-[1.12]" style={{ transitionDelay: '110ms' }}>
            {t({ en: 'One official channel — from your idea to the Minister’s desk.', ta: 'உங்கள் யோசனையிலிருந்து அமைச்சரின் மேசை வரை — ஒரே அதிகாரப்பூர்வ வழி.' })}
          </h2>
        </div>

        {/* lead + who-can-submit */}
        <div className="grid lg:grid-cols-[1.5fr_1fr] gap-x-14 gap-y-9 mt-8 sm:mt-10">
          <div>
            <p className="reveal-up text-white/85 text-[clamp(15px,1.5vw,18px)] leading-[1.78] max-w-[62ch]" style={{ transitionDelay: '170ms' }}>
              {t({
                en: 'Nam Kural is the official platform through which corporates, educational institutions, startups, research organisations, technology companies, industry associations, professional bodies, NGOs and subject experts submit innovative ideas, research findings, technology solutions, policy recommendations and project proposals directly to the Hon’ble Minister for School Education, Government of Tamil Nadu.',
                ta: 'நிறுவனங்கள், கல்வி நிலையங்கள், ஸ்டார்ட்அப்கள், ஆராய்ச்சி நிறுவனங்கள், தொழில்நுட்ப நிறுவனங்கள், தொழில் சங்கங்கள், தொழில்முறை அமைப்புகள், தொண்டு நிறுவனங்கள் மற்றும் துறை வல்லுநர்கள் — தங்கள் புதுமையான யோசனைகள், ஆராய்ச்சி முடிவுகள், தொழில்நுட்பத் தீர்வுகள், கொள்கை பரிந்துரைகள் மற்றும் திட்ட முன்மொழிவுகளை தமிழ்நாடு அரசின் மாண்புமிகு பள்ளிக் கல்வி அமைச்சரின் முன் நேரடியாக சமர்ப்பிக்கும் அதிகாரப்பூர்வ தளமே நம் குரல்.',
              })}
            </p>
            <p className="reveal-up text-white/70 text-[14.5px] sm:text-[15.5px] leading-[1.8] max-w-[62ch] mt-5" style={{ transitionDelay: '230ms' }}>
              {t({
                en: 'We welcome proposals that strengthen the education ecosystem — improving student learning outcomes, empowering teachers, enhancing school administration, and bringing proven innovation and best practice into the School Education Department.',
                ta: 'மாணவர் கற்றல் விளைவுகளை மேம்படுத்தும், ஆசிரியர்களை வலுப்படுத்தும், பள்ளி நிர்வாகத்தை மேம்படுத்தும், மற்றும் நிரூபிக்கப்பட்ட புதுமைகளையும் சிறந்த நடைமுறைகளையும் பள்ளிக் கல்வித் துறையில் கொண்டுவரும் யோசனைகளை நாங்கள் வரவேற்கிறோம்.',
              })}
            </p>
          </div>
          <div className="reveal-up" style={{ transitionDelay: '290ms' }}>
            <p className="text-[10.5px] uppercase tracking-wide2 text-gold-400/80 mb-3.5">{t({ en: 'Who can submit', ta: 'யார் சமர்ப்பிக்கலாம்' })}</p>
            <div className="flex flex-wrap gap-2">
              {SUBMITTERS.map((s, i) => (
                <span key={i} className="rounded-full border border-white/15 bg-white/[0.04] px-3.5 py-1.5 text-[12.5px] text-white/80">
                  {t(s)}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* pull quote */}
        <div className="reveal-up mt-16 sm:mt-20 flex items-stretch gap-5" style={{ transitionDelay: '120ms' }}>
          <span className="shrink-0 w-1 rounded bg-gradient-to-b from-gold-400 to-gold-600" />
          <p className="h-display text-white text-[clamp(21px,3vw,38px)] leading-[1.2]">
            {t({ en: 'No intermediaries. No unnecessary delays.', ta: 'இடைத்தரகர் இல்லை. தேவையற்ற தாமதம் இல்லை.' })}
          </p>
        </div>

        {/* how a submission travels */}
        <div className="mt-14 sm:mt-16 grid sm:grid-cols-3 gap-x-8 gap-y-9">
          {FLOW.map((st, i) => (
            <div key={i} className="reveal-up relative pt-6 border-t-2 border-white/12" style={{ transitionDelay: `${160 + i * 90}ms` }}>
              <span className="font-disp font-extrabold text-gold-400/90 text-[12.5px] tracking-wide2 tabular-nums">{st.n}</span>
              <h3 className="h-display text-white text-[19px] sm:text-[21px] mt-2 mb-2">{t(st.title)}</h3>
              <p className="text-white/60 text-[13px] leading-relaxed max-w-[30ch]">{t(st.desc)}</p>
            </div>
          ))}
        </div>

        {/* closing */}
        <div className="reveal-up mt-16 sm:mt-20 border-t border-white/10 pt-9 sm:pt-11 flex flex-col md:flex-row md:items-end md:justify-between gap-7" style={{ transitionDelay: '120ms' }}>
          <p className="font-disp text-haze-100 text-[clamp(17px,2.1vw,25px)] leading-[1.45] max-w-[26ch]">
            {t({ en: 'Your idea has the potential to shape the future of education in Tamil Nadu.', ta: 'உங்கள் யோசனை தமிழ்நாட்டின் கல்வியின் எதிர்காலத்தை வடிவமைக்கும் ஆற்றல் கொண்டது.' })}
          </p>
          <button onClick={scrollToDesks} className="btn-gold shrink-0 self-start md:self-auto">
            {t({ en: 'Share your innovation →', ta: 'உங்கள் புதுமையைப் பகிருங்கள் →' })}
          </button>
        </div>
      </div>
    </section>
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
