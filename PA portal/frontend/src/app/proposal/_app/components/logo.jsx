/* Brand marks, drawn rather than bitmapped so they stay crisp at any size and
   recolour with the theme. The wordmark mirrors the supplied logo: cream Tamil
   set on two lines, a gold puḷḷi over ம், and three gold arcs carrying the voice. */

const CREAM = '#F3E7D3'
const GOLD = '#D6A44C'

/** Three arcs radiating up and to the right, as on the logo. */
function Arcs({ x = 0, y = 0, scale = 1, stroke = GOLD, width = 4 }) {
  // centre of the arc family, in local units before the group transform
  const cx = 0, cy = 0
  const pt = (r, deg) => {
    const a = (deg * Math.PI) / 180
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)]
  }
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`} fill="none" stroke={stroke}
       strokeWidth={width} strokeLinecap="round">
      {[42, 64, 86].map((r) => {
        const [sx, sy] = pt(r, -82)
        const [ex, ey] = pt(r, -18)
        return <path key={r} d={`M${sx.toFixed(1)} ${sy.toFixed(1)} A${r} ${r} 0 0 1 ${ex.toFixed(1)} ${ey.toFixed(1)}`} />
      })}
    </g>
  )
}

/**
 * The Nam Kural wordmark.
 * `rule` draws the gold divider and diamond beneath (used on large lockups only).
 */
export function Logo({ className = '', rule = false, title = 'Nam Kural · நம் குரல்' }) {
  return (
    <svg viewBox={`0 0 250 ${rule ? 168 : 140}`} className={className} role="img" aria-label={title}>
      <title>{title}</title>
      <text x="4" y="58" fill={CREAM} fontFamily="'Anek Tamil','Noto Sans Tamil',sans-serif"
            fontWeight="700" fontSize="54" letterSpacing="0">நம்</text>
      {/* the puḷḷi, lifted out in gold */}
      <circle cx="118" cy="20" r="10.5" fill={GOLD} />
      <text x="4" y="124" fill={CREAM} fontFamily="'Anek Tamil','Noto Sans Tamil',sans-serif"
            fontWeight="700" fontSize="58" letterSpacing="0">குரல்</text>
      <Arcs x={150} y={122} scale={0.92} />
      {rule && (
        <g stroke={GOLD} strokeWidth="1.6" opacity="0.85">
          <line x1="18" y1="152" x2="108" y2="152" />
          <line x1="142" y1="152" x2="232" y2="152" />
          <path d="M125 145.5 131.5 152 125 158.5 118.5 152Z" fill={GOLD} stroke="none" />
        </g>
      )}
    </svg>
  )
}

/** Compact square badge — the arcs alone, for tight spots like a favicon slot. */
export function LogoBadge({ className = '' }) {
  return (
    <svg viewBox="0 0 100 100" className={className} role="img" aria-label="Nam Kural">
      <rect x="1" y="1" width="98" height="98" rx="22" fill="none" stroke={GOLD} strokeWidth="2.5" />
      <Arcs x={28} y={76} scale={0.62} width={6} />
      <circle cx="30" cy="72" r="7" fill={CREAM} />
    </svg>
  )
}

/** Thiruvalluvar, as a monoline bust. Marks the couplet rail. */
export function Valluvar({ className = '' }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor"
         strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {/* topknot and hairline */}
      <path d="M12 2.3c.9 0 1.5.6 1.5 1.4 0 .5-.2.8-.5 1.1" />
      <path d="M8.3 8.1C8.3 5.6 9.9 4 12 4s3.7 1.6 3.7 4.1" />
      {/* brow and face */}
      <path d="M8.9 8.4v1.7c0 .9.4 1.7 1.1 2.2" />
      <path d="M15.1 8.4v1.7c0 .9-.4 1.7-1.1 2.2" />
      {/* the beard */}
      <path d="M9 10.6c-.6 2.4-.3 4.7 1 6.5.6.8 1.2 1.3 2 1.3s1.4-.5 2-1.3c1.3-1.8 1.6-4.1 1-6.5" />
      {/* shoulders and robe */}
      <path d="M4.6 21.4c.5-2.7 2.4-4.4 4.7-4.9" />
      <path d="M19.4 21.4c-.5-2.7-2.4-4.4-4.7-4.9" />
      <path d="M12 18.4v3" />
    </svg>
  )
}
