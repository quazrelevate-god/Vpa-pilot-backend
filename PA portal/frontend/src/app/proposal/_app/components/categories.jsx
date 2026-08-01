"use client";
import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronDown } from 'lucide-react'
import { useT } from '../i18n.jsx'
import { IMG, CATEGORIES } from '../data.jsx'
import { useBrandOverrides } from '../brand.jsx'
import { Button, Reveal, RevealItem } from './ui.jsx'
import { MagneticButton } from './fx.jsx'
import { tween } from '../lib/motion.js'

/** True on devices with a real pointer. Touch gets tap-to-expand instead. */
function useHoverCapable() {
  const [can, setCan] = useState(true)
  useEffect(() => {
    const mq = matchMedia('(hover: hover) and (pointer: fine)')
    const sync = () => setCan(mq.matches)
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])
  return can
}

/* The four desks, stacked inline. Hovering a desk expands it in place —
   its neighbours give up the space rather than being covered. */
export function CategoryStack({ onPick }) {
  const t = useT()
  const canHover = useHoverCapable()
  const [active, setActive] = useState(null)
  const cardRefs = useRef([])
  // files dropped into public/brand/ replace the shipped plates
  const overrides = useBrandOverrides(
    Object.fromEntries(CATEGORIES.filter((c) => c.plate).map((c) => [c.key, c.plate]))
  )

  const grow = (i) => (active === null ? 1 : active === i ? 2.9 : 0.7)

  // Opening a card only reveals it — entering the questionnaire is the
  // "Begin here" button's job alone. On the stacked (mobile/tablet) layout the
  // opened card grows downward, so scroll its top up under the nav to keep the
  // blurb + "Begin here" on screen without the user hunting for them.
  const reveal = (i) => {
    setActive(i)
    if (typeof window !== 'undefined' && !window.matchMedia('(min-width: 1024px)').matches) {
      const el = cardRefs.current[i]
      // Wait for the flex-grow expand to settle before framing it, otherwise
      // scrollIntoView chases a moving target and the card lands under the nav.
      if (el) setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'start' }), 720)
    }
  }

  return (
    <section id="desks" className="relative min-h-screen bg-ink-950 flex flex-col overflow-hidden">
      <Reveal className="shrink-0 px-5 sm:px-6 lg:px-12 pt-24 lg:pt-28 pb-6 sm:pb-7">
        <RevealItem as="h2" className="h-display text-white text-[clamp(23px,3.4vw,46px)] max-w-[20ch]">
          {t({ en: 'Choose your proposal category', ta: 'உங்கள் யோசனைப் பிரிவைத் தேர்வு செய்யுங்கள்' })}
        </RevealItem>
      </Reveal>

      <div
        className="flex-1 flex flex-col lg:flex-row border-t border-white/15 min-h-[740px] sm:min-h-[780px] lg:min-h-0"
        onMouseLeave={() => canHover && setActive(null)}
      >
        {CATEGORIES.map((c, i) => {
          const on = active === i
          return (
            <article
              key={c.key}
              ref={(el) => (cardRefs.current[i] = el)}
              role="button"
              tabIndex={0}
              aria-expanded={on}
              aria-label={`${t(c.title)} — ${t(c.tag)}`}
              style={{ flexGrow: grow(i), flexBasis: 0 }}
              onMouseEnter={() => canHover && setActive(i)}
              onFocus={() => reveal(i)}
              onClick={() => reveal(i)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); reveal(i) }
              }}
              className={`desk group relative cursor-pointer overflow-hidden min-h-[78px] lg:min-h-0 scroll-mt-[84px]
                outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-gold-500
                ${i > 0 ? 'border-t lg:border-t-0 lg:border-l border-white/15' : ''}`}
            >
              {/* plate */}
              <div
                aria-hidden="true"
                className={`absolute inset-0 bg-cover transition-transform duration-[1100ms] ease-[cubic-bezier(.22,.9,.24,1)] ${on ? 'scale-100' : 'scale-[1.14]'}`}
                style={{
                  backgroundImage: `url('${overrides[c.key] || IMG[c.img]}')`,
                  backgroundPosition: overrides[c.key] ? 'center' : c.pos,
                }}
              />
              <div
                aria-hidden="true"
                className={`absolute inset-0 transition-opacity duration-700 bg-gradient-to-t from-ink-950 via-ink-950/70 to-ink-950/45 ${on ? 'opacity-80' : 'opacity-100'}`}
              />
              {/* active accent: a hairline gold wash + top rule, premium focus cue */}
              <div
                aria-hidden="true"
                className={`absolute inset-0 transition-opacity duration-700 pointer-events-none
                  bg-[radial-gradient(120%_80%_at_0%_100%,rgba(227,170,61,0.16),transparent_60%)] ${on ? 'opacity-100' : 'opacity-0'}`}
              />
              <div
                aria-hidden="true"
                className={`absolute inset-x-0 top-0 h-px bg-gradient-to-r from-gold-400/0 via-gold-400/70 to-gold-400/0 transition-opacity duration-500 ${on ? 'opacity-100' : 'opacity-0'}`}
              />
              {/* only credit the stock plate — a dropped-in image is the user's own */}
              {on && !overrides[c.key] && (
                <span aria-hidden="true" className="absolute top-4 right-5 z-[3] text-[9.5px] text-white/45 tracking-wide2 hidden lg:block">{c.credit}</span>
              )}

              {/* collapsed label — horizontal at every width, wrapping in the
                  narrow column rather than turning on its side */}
              <div
                className={`absolute inset-x-0 bottom-0 z-[2] px-4 lg:px-5 pb-5 lg:pb-6 flex lg:block items-baseline justify-between gap-3
                  transition-all duration-500 ${on ? 'opacity-0 lg:-translate-y-1 pointer-events-none' : 'opacity-100'}`}
              >
                <h3 className="h-display text-white text-[17px] sm:text-[19px] lg:text-[17px] xl:text-[19px]
                               min-w-0 truncate lg:overflow-visible lg:whitespace-normal lg:text-balance lg:leading-[1.2]">
                  {t(c.short || c.title)}
                </h3>
                {/* Tap affordance (mobile/tablet only) — signals the card opens */}
                <span className="flex items-center gap-2 lg:hidden shrink-0 max-w-[58%]">
                  <span className="text-white/55 text-[11px] sm:text-[12px] truncate">{t(c.tag)}</span>
                  <span className="grid place-items-center w-6 h-6 shrink-0 rounded-full border border-gold-400/40 bg-white/[0.06]">
                    <ChevronDown className="w-3.5 h-3.5 text-gold-300" strokeWidth={2.2} />
                  </span>
                </span>
              </div>

              {/* expanded body */}
              <AnimatePresence>
                {on && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1, transition: { ...tween(0.5), delay: 0.12 } }}
                    exit={{ opacity: 0, transition: tween(0.25) }}
                    className="absolute inset-0 z-[3] flex flex-col justify-end px-5 lg:px-9 pb-6 lg:pb-9"
                  >
                    <div className="w-[min(100%,34rem)]">
                      <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ ...tween(0.5), delay: 0.16 }} className="eyebrow text-gold-400 mb-2">{t(c.tag)}</motion.div>
                      <motion.h3 initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ ...tween(0.5), delay: 0.22 }} className="h-display text-white text-[clamp(19px,2.1vw,30px)] mb-3">{t(c.title)}</motion.h3>
                      <motion.p initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ ...tween(0.5), delay: 0.28 }} className="text-white/80 text-[13px] sm:text-[14px] leading-relaxed mb-4 sm:mb-5 line-clamp-3 sm:line-clamp-none">{t(c.blurb)}</motion.p>
                      <motion.ul initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ ...tween(0.5), delay: 0.34 }} className="space-y-1.5 mb-7 hidden md:block">
                        {c.types.map((x, k) => (
                          <li key={k} className="text-[12.5px] text-white/65 leading-relaxed flex gap-2.5">
                            <span className="text-gold-500 shrink-0">—</span>{t(x)}
                          </li>
                        ))}
                      </motion.ul>
                      <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ ...tween(0.5), delay: 0.4 }}>
                        <MagneticButton strength={14}>
                          <Button
                            type="button"
                            variant="gold"
                            size="sm"
                            tabIndex={on ? 0 : -1}
                            onClick={(e) => { e.stopPropagation(); onPick(c) }}
                            className="group/cta"
                          >
                            {t({ en: 'Begin here', ta: 'இங்கே தொடங்கு' })}
                            <span className="transition-transform group-hover/cta:translate-x-1">→</span>
                          </Button>
                        </MagneticButton>
                        <p className="text-[10px] sm:text-[10.5px] uppercase tracking-wide2 text-white/40 mt-3.5 hidden sm:block">
                          {t({ en: 'Routes to', ta: 'செல்லும் இடம்' })} · {t(c.dept)}
                        </p>
                      </motion.div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </article>
          )
        })}
      </div>
    </section>
  )
}
