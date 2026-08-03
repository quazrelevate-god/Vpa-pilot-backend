"use client";
import { useRef, useState } from 'react'
import { motion, useMotionValueEvent, useScroll } from 'framer-motion'
import { useLang, useT } from '../i18n.jsx'
import { IMG, SLIDES, CATEGORIES } from '../data.jsx'
import { Logo } from './logo.jsx'
import { useBrandFile } from '../brand.jsx'
import { Button, Reveal, RevealItem, Eyebrow, Chip } from './ui.jsx'
import { MagneticButton, SpotlightCard, Parallax, Aurora } from './fx.jsx'
import { scrollToId } from '../lib/useLenis.js'
import { tween, spring } from '../lib/motion.js'

// Fixed-nav height compensation for anchor scrolls.
const NAV_OFFSET = -84

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

/* ================= NAV =================
   Frosted, sticky, elevation-on-scroll. Brand + system tagline + EN/TA toggle. */
export function Nav() {
  const { lang, setLang } = useLang()
  const t = useT()
  const [scrolled, setScrolled] = useState(false)
  const [hidden, setHidden] = useState(false)
  const { scrollY } = useScroll()
  const lastY = useRef(0)
  // Hide the bar when scrolling DOWN past the hero, reveal on scroll UP — the
  // familiar "reading mode" nav from Linear / Vercel. Never hides near the top.
  useMotionValueEvent(scrollY, 'change', (y) => {
    setScrolled(y > 40)
    const goingDown = y > lastY.current
    if (y > 220 && goingDown && Math.abs(y - lastY.current) > 6) setHidden(true)
    else if (!goingDown) setHidden(false)
    lastY.current = y
  })
  return (
    <motion.nav
      initial={{ y: -24, opacity: 0 }}
      animate={{ y: hidden ? -96 : 0, opacity: 1 }}
      transition={{ ...tween(0.5), delay: hidden ? 0 : 0 }}
      className={`fixed top-0 inset-x-0 z-40 flex items-center justify-between px-5 sm:px-6 lg:px-10 py-3 transition-[background,border,box-shadow] duration-500
        ${scrolled
          ? 'bg-ink-950/80 backdrop-blur-xl border-b border-white/10 shadow-[0_10px_40px_-24px_rgba(0,0,0,0.9)]'
          : 'bg-transparent border-b border-transparent'}`}
    >
      <a href="#top" onClick={(e) => { e.preventDefault(); scrollToId('top') }} className="flex items-center gap-3 sm:gap-4 text-white min-w-0 group">
        <BrandLogo />
        <span className="hidden sm:block h-8 w-px bg-white/20 shrink-0" />
        <span className="text-[9px] sm:text-[10px] uppercase tracking-[0.16em] text-haze-300/90 hidden sm:block leading-relaxed max-w-[16ch] transition-colors group-hover:text-haze-300">
          {t({ en: 'Proposal Management System', ta: 'முன்மொழிவு மேலாண்மை அமைப்பு' })}
        </span>
      </a>
      <div className="flex items-center shrink-0">
        <div className="relative flex rounded-full border border-white/20 bg-white/[0.04] p-0.5 backdrop-blur-md">
          {['en', 'ta'].map((l) => (
            <button key={l} onClick={() => setLang(l)}
              className="relative rounded-full px-3.5 py-2 sm:py-1.5 text-[12px] sm:text-[13px] font-semibold transition-colors">
              {lang === l && (
                <motion.span layoutId="nk-lang-pill" transition={spring}
                  className="absolute inset-0 rounded-full bg-gradient-to-b from-gold-400 to-gold-500 shadow-[0_4px_14px_-4px_rgba(227,170,61,0.6)]" />
              )}
              <span className={`relative z-10 ${lang === l ? 'text-ink-950' : 'text-white/70 hover:text-white'}`}>
                {l === 'en' ? 'EN' : 'தமிழ்'}
              </span>
            </button>
          ))}
        </div>
      </div>
    </motion.nav>
  )
}

/* ================= HERO ================= */
export function Hero() {
  const t = useT()
  return (
    <header id="top" className="relative h-screen min-h-[600px] sm:min-h-[700px] bg-ink-950 overflow-hidden flex items-end">
      <div className="absolute inset-0" aria-hidden="true">
        {SLIDES.map((s, i) => (
          // Stagger derived from slide count so any N plates spread evenly over
          // the 35s heroFade cycle (fixed 7s spacing overlapped once slides > 5).
          <div key={i} className="slide" style={{ backgroundImage: `url('${IMG[s.img]}')`, backgroundPosition: s.pos, animationDelay: `${((i * 35) / SLIDES.length).toFixed(2)}s` }}>
            <span className="absolute bottom-5 right-6 z-[3] text-[12px] text-white/85 whitespace-nowrap hidden lg:block font-medium tracking-wide2">
              {t(s.cap)}
            </span>
          </div>
        ))}
      </div>

      <Reveal className="relative z-10 w-full px-5 sm:px-6 lg:px-12 pb-[9vh] sm:pb-[11vh] pt-28" gap={0.12} delay={0.25}>
        <RevealItem as="h1" className="h-display text-white text-[clamp(33px,5.8vw,86px)] max-w-[15ch]">
          {t({ en: 'Your proposal.', ta: 'உங்கள் முன்மொழிவு.' })}<br />
          <em className="not-italic text-haze-300">{t({ en: 'Before the Hon’ble Minister.', ta: 'மாண்புமிகு அமைச்சரின் முன்.' })}</em>
        </RevealItem>

        <RevealItem className="relative inline-block mt-7 sm:mt-9">
          <MagneticButton strength={22}>
            <Button variant="gold" size="md" onClick={() => scrollToId('desks', NAV_OFFSET)}>
              {t({ en: 'Give your idea for the betterment of tomorrow →', ta: 'நாளைய நலனுக்காக உங்கள் முன்மொழிவை வழங்குங்கள் →' })}
            </Button>
          </MagneticButton>
          <ClickHint />
        </RevealItem>

        <RevealItem className="mt-7 sm:mt-11 pt-4 sm:pt-5 border-t border-white/25 max-w-2xl">
          <p className="font-disp text-haze-100 text-[12.5px] sm:text-[15px] leading-loose">
            "எப்பொருள் யார்யார்வாய்க் கேட்பினும் அப்பொருள்<br className="hidden sm:block" /> மெய்ப்பொருள் காண்பது அறிவு" · திருக்குறள் 423
          </p>
          <p className="text-white/65 text-[11.5px] sm:text-[12.5px] italic mt-1.5">
            {t({ en: 'To discern the truth in everything, by whomsoever spoken. That is wisdom. Tirukkural 423', ta: 'யார் சொன்னாலும் அதில் உள்ள உண்மையை காண்பதே அறிவு.' })}
          </p>
        </RevealItem>
      </Reveal>

      <motion.button
        onClick={() => scrollToId('desks', NAV_OFFSET)} aria-label="Scroll to categories"
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.1, duration: 0.6 }}
        className="absolute bottom-6 left-1/2 -translate-x-1/2 z-10 hidden lg:grid place-items-center w-10 h-10 text-white/50 hover:text-white transition-colors scroll-nudge">
        ↓
      </motion.button>
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

  return (
    <section id="about" className="relative overflow-hidden bg-ink-950 py-24 sm:py-28 lg:py-36">
      {/* ambient aura + faint Tamil watermark (drifts on scroll for depth) */}
      <div className="absolute inset-0 form-aura pointer-events-none" aria-hidden="true" />
      <Parallax speed={60} className="absolute inset-0 grid place-items-center pointer-events-none">
        <span className="font-disp font-extrabold text-[27vw] leading-none text-haze-300/[0.04] select-none whitespace-nowrap">நம் குரல்</span>
      </Parallax>

      <div className="wrap relative">
        {/* header */}
        <Reveal className="max-w-[48rem]" gap={0.09}>
          <RevealItem>
            <Eyebrow>{t({ en: 'About Nam Kural', ta: 'நம் குரல் பற்றி' })}</Eyebrow>
          </RevealItem>
          <RevealItem as="h2" className="h-display text-white text-[clamp(26px,4vw,52px)] mt-5 mb-2 leading-[1.12]">
            {t({ en: 'One official channel — from your idea to the Hon’ble Minister’s desk.', ta: 'உங்கள் முன்மொழிவிலிருந்து மாண்புமிகு அமைச்சரின் மேசை வரை — ஒரே அதிகாரப்பூர்வ வழி.' })}
          </RevealItem>
        </Reveal>

        {/* lead + who-can-submit */}
        <Reveal className="grid lg:grid-cols-[1.5fr_1fr] gap-x-14 gap-y-9 mt-8 sm:mt-10" gap={0.09}>
          <div>
            <RevealItem as="p" className="text-white/85 text-[clamp(15px,1.5vw,18px)] leading-[1.78] max-w-[62ch]">
              {t({
                en: 'Nam Kural is the official platform through which corporates, educational institutions, startups, research organisations, technology companies, industry associations, professional bodies, NGOs and subject experts submit innovative ideas, research findings, technology solutions, policy recommendations and project proposals directly to the Hon’ble Minister for School Education, Government of Tamil Nadu.',
                ta: 'நிறுவனங்கள், கல்வி நிலையங்கள், ஸ்டார்ட்அப்கள், ஆராய்ச்சி நிறுவனங்கள், தொழில்நுட்ப நிறுவனங்கள், தொழில் சங்கங்கள், தொழில்முறை அமைப்புகள், தொண்டு நிறுவனங்கள் மற்றும் துறை வல்லுநர்கள் — தங்கள் புதுமையான யோசனைகள், ஆராய்ச்சி முடிவுகள், தொழில்நுட்பத் தீர்வுகள், கொள்கை பரிந்துரைகள் மற்றும் திட்ட முன்மொழிவுகளை தமிழ்நாடு அரசின் மாண்புமிகு பள்ளிக் கல்வி அமைச்சரின் முன் நேரடியாக சமர்ப்பிக்கும் அதிகாரப்பூர்வ தளமே நம் குரல்.',
              })}
            </RevealItem>
            <RevealItem as="p" className="text-white/70 text-[14.5px] sm:text-[15.5px] leading-[1.8] max-w-[62ch] mt-5">
              {t({
                en: 'We welcome proposals that strengthen the education ecosystem — improving student learning outcomes, empowering teachers, enhancing school administration, and bringing proven innovation and best practice into the School Education Department.',
                ta: 'மாணவர் கற்றல் விளைவுகளை மேம்படுத்தும், ஆசிரியர்களை வலுப்படுத்தும், பள்ளி நிர்வாகத்தை மேம்படுத்தும், மற்றும் நிரூபிக்கப்பட்ட புதுமைகளையும் சிறந்த நடைமுறைகளையும் பள்ளிக் கல்வித் துறையில் கொண்டுவரும் முன்மொழிவுகளை நாங்கள் வரவேற்கிறோம்.',
              })}
            </RevealItem>
          </div>
          <RevealItem>
            <SpotlightCard tilt tiltMax={5}
              className="relative rounded-2xl border border-white/10 bg-white/[0.04] p-5 sm:p-6 backdrop-blur-md
                         shadow-[0_1px_0_rgba(255,255,255,0.06)_inset,0_24px_60px_-30px_rgba(0,0,0,0.7)]">
              <p className="text-[10.5px] uppercase tracking-wide2 text-gold-400/80 mb-3.5">{t({ en: 'Who can submit', ta: 'யார் சமர்ப்பிக்கலாம்' })}</p>
              <div className="flex flex-wrap gap-2">
                {SUBMITTERS.map((s, i) => (
                  <Chip key={i}>{t(s)}</Chip>
                ))}
              </div>
            </SpotlightCard>
          </RevealItem>
        </Reveal>

        {/* pull quote */}
        <Reveal className="mt-16 sm:mt-20 flex items-stretch gap-5">
          <RevealItem className="shrink-0 w-1 rounded bg-gradient-to-b from-gold-400 to-gold-600" />
          <RevealItem as="p" className="h-display text-white text-[clamp(21px,3vw,38px)] leading-[1.2]">
            {t({ en: 'No intermediaries. No unnecessary delays.', ta: 'இடைத்தரகர் இல்லை. தேவையற்ற தாமதம் இல்லை.' })}
          </RevealItem>
        </Reveal>

        {/* how a submission travels */}
        <Reveal className="mt-14 sm:mt-16 grid sm:grid-cols-3 gap-x-8 gap-y-9" gap={0.1}>
          {FLOW.map((st, i) => (
            <RevealItem key={i}>
              <SpotlightCard tilt tiltMax={7}
                className="group relative h-full rounded-2xl border border-white/10 bg-white/[0.03] p-6 pt-5 backdrop-blur-sm
                           transition-colors hover:border-gold-400/25 hover:bg-white/[0.05]">
                <span className="absolute left-0 top-0 h-[3px] w-14 rounded-full bg-gradient-to-r from-gold-400 to-gold-600 transition-all duration-500 group-hover:w-24" />
                <span className="font-disp font-extrabold text-gold-400/90 text-[12.5px] tracking-wide2 tabular-nums">{st.n}</span>
                <h3 className="h-display text-white text-[19px] sm:text-[21px] mt-2 mb-2">{t(st.title)}</h3>
                <p className="text-white/60 text-[13px] leading-relaxed max-w-[30ch]">{t(st.desc)}</p>
              </SpotlightCard>
            </RevealItem>
          ))}
        </Reveal>

        {/* closing */}
        <Reveal className="mt-16 sm:mt-20 border-t border-white/10 pt-9 sm:pt-11 flex flex-col md:flex-row md:items-end md:justify-between gap-7">
          <RevealItem as="p" className="font-disp text-haze-100 text-[clamp(17px,2.1vw,25px)] leading-[1.45] max-w-[26ch]">
            {t({ en: 'Your idea has the potential to shape the future of education in Tamil Nadu.', ta: 'உங்கள் முன்மொழிவு தமிழ்நாட்டின் கல்வியின் எதிர்காலத்தை வடிவமைக்கும் ஆற்றல் கொண்டது.' })}
          </RevealItem>
          <RevealItem className="shrink-0 self-start md:self-auto">
            <MagneticButton strength={18}>
              <Button variant="gold" size="md" onClick={() => scrollToId('desks', NAV_OFFSET)}>
                {t({ en: 'Share your innovation →', ta: 'உங்கள் புதுமையைப் பகிருங்கள் →' })}
              </Button>
            </MagneticButton>
          </RevealItem>
        </Reveal>
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
      {/* living aurora — slow drifting brand-gold / haze blobs behind the copy */}
      <Aurora />
      <Parallax speed={50} className="absolute inset-0 grid place-items-center pointer-events-none">
        <span className="font-disp font-extrabold text-[19vw] sm:text-[17vw] leading-none text-haze-300/10 select-none whitespace-nowrap">நம் குரல்</span>
      </Parallax>
      {/* soft top vignette for depth over the gradient band */}
      <div className="absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-ink-950/40 to-transparent pointer-events-none" aria-hidden="true" />
      <Reveal className="relative px-5 sm:px-6" gap={0.1}>
        <RevealItem as="h2" className="h-display text-[clamp(26px,4.4vw,62px)] max-w-[20ch] mx-auto mb-5">
          {t({ en: 'Give your idea for the betterment of tomorrow.', ta: 'நாளைய நலனுக்காக உங்கள் முன்மொழிவை வழங்குங்கள்.' })}
        </RevealItem>
        <RevealItem as="p" className="max-w-[54ch] mx-auto text-white/85 text-[15px] sm:text-[16.5px] leading-relaxed">
          {t({ en: 'Ten minutes of your thought can outlast a generation. The Ministry is listening: formally, transparently, in your language.', ta: 'உங்கள் பத்து நிமிட சிந்தனை ஒரு தலைமுறையைத் தாண்டி நிலைக்கும். அமைச்சகம் கேட்கிறது: முறையாக, வெளிப்படையாக, உங்கள் மொழியில்.' })}
        </RevealItem>
      </Reveal>
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
              ta: 'தமிழ்நாடு அரசின் மாண்புமிகு கல்வி அமைச்சர் அலுவலகத்தின் டிஜிட்டல் முன்மொழிவு வழி. சமர்ப்பிப்பு ஒப்புதலுக்கு உத்தரவாதம் அல்ல; ஒவ்வொரு சமர்ப்பிப்பும் காரணத்துடன் பதில் பெறும்.',
            })}
          </p>
        </div>
        <div>
          <h5 className="font-disp text-white text-[14px] uppercase tracking-wide2 mb-4">{t({ en: 'Portfolios', ta: 'துறைகள்' })}</h5>
          <ul className="space-y-2 text-[13px]">
            {CATEGORIES.map((c) => (
              <li key={c.key}>
                <button className="group inline-flex items-center gap-1.5 hover:text-gold-400 transition-colors text-left" onClick={() => scrollToId('desks', NAV_OFFSET)}>
                  <span className="h-px w-0 bg-gold-400 transition-all duration-300 group-hover:w-3" />
                  {t(c.short || c.title)}
                </button>
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
