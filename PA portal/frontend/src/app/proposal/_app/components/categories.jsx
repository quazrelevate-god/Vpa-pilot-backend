"use client";
import { useEffect, useRef, useState } from 'react'
import { useT } from '../i18n.jsx'
import { IMG, CATEGORIES } from '../data.jsx'
import { useBrandOverrides } from '../brand.jsx'

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
      // Wait for the .7s flex-grow expand to settle before framing it, otherwise
      // scrollIntoView chases a moving target and the card lands under the nav.
      // scroll-mt-[84px] on the card leaves room for the fixed nav. It reads as
      // "tap → card opens → gently settles into view."
      if (el) setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'start' }), 720)
    }
  }

  return (
    <section id="desks" className="relative min-h-screen bg-ink-950 flex flex-col overflow-hidden">
      <div className="shrink-0 px-5 sm:px-6 lg:px-12 pt-24 lg:pt-28 pb-6 sm:pb-7">
        <h2 className="h-display text-white text-[clamp(23px,3.4vw,46px)] max-w-[20ch]">
          {t({ en: 'Choose your proposal category', ta: 'உங்கள் யோசனைப் பிரிவைத் தேர்வு செய்யுங்கள்' })}
        </h2>
      </div>

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
                    <ChevronDown className="w-3.5 h-3.5 text-gold-300" />
                  </span>
                </span>
              </div>

              {/* expanded body */}
              <div
                className={`absolute inset-0 z-[3] flex flex-col justify-end px-5 lg:px-9 pb-6 lg:pb-9
                  transition-all duration-500 ${on ? 'opacity-100 delay-[120ms]' : 'opacity-0 translate-y-3 pointer-events-none'}`}
              >
                <div className="w-[min(100%,34rem)]">
                  <div className="eyebrow text-gold-400 mb-2">{t(c.tag)}</div>
                  <h3 className="h-display text-white text-[clamp(19px,2.1vw,30px)] mb-3">{t(c.title)}</h3>
                  <p className="text-white/80 text-[13px] sm:text-[14px] leading-relaxed mb-4 sm:mb-5 line-clamp-3 sm:line-clamp-none">{t(c.blurb)}</p>
                  <ul className="space-y-1.5 mb-7 hidden md:block">
                    {c.types.map((x, k) => (
                      <li key={k} className="text-[12.5px] text-white/65 leading-relaxed flex gap-2.5">
                        <span className="text-gold-500 shrink-0">—</span>{t(x)}
                      </li>
                    ))}
                  </ul>
                  <button
                    type="button"
                    tabIndex={on ? 0 : -1}
                    onClick={(e) => { e.stopPropagation(); onPick(c) }}
                    className="btn-gold !px-5 !py-2.5 !text-[13px] group/cta">
                    {t({ en: 'Begin here', ta: 'இங்கே தொடங்கு' })}
                    <span className="transition-transform group-hover/cta:translate-x-1">→</span>
                  </button>
                  <p className="text-[10px] sm:text-[10.5px] uppercase tracking-wide2 text-white/40 mt-3.5 hidden sm:block">
                    {t({ en: 'Routes to', ta: 'செல்லும் இடம்' })} · {t(c.dept)}
                  </p>
                </div>
              </div>
            </article>
          )
        })}
      </div>
    </section>
  )
}

/* Down-chevron — the "tap to open" affordance on collapsed cards (mobile). */
function ChevronDown({ className = '' }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor"
      strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 9l6 6 6-6" />
    </svg>
  )
}
