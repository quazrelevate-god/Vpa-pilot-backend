// Flat-vector office scene for the login splash: a floor operator (with a
// tablet) helping a citizen across a desk, window + plant behind. Pure inline
// SVG — crisp at any size, no external asset, themes with the light hero.
export default function HeroIllustration({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 360 260" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Floor operator assisting a citizen">
      {/* backdrop */}
      <rect x="0" y="0" width="360" height="260" rx="24" fill="#eaf1ff" />
      <circle cx="300" cy="52" r="40" fill="#dbe7ff" />
      <circle cx="54" cy="196" r="30" fill="#dbe7ff" />
      <path d="M20 150h320" stroke="#cfe0ff" strokeWidth="2" strokeDasharray="4 8" strokeLinecap="round" />

      {/* window with blinds */}
      <rect x="44" y="34" width="96" height="74" rx="8" fill="#ffffff" />
      <rect x="44" y="34" width="96" height="74" rx="8" stroke="#c7d7f5" strokeWidth="2" />
      <path d="M44 52h96M44 70h96M44 88h96" stroke="#dbe7ff" strokeWidth="3" />
      <rect x="120" y="34" width="20" height="74" rx="6" fill="#eaf1ff" />

      {/* plant */}
      <path d="M296 150c-8-18-4-34 6-44-2 14 4 22 10 30" fill="#86efac" />
      <path d="M300 150c10-14 24-16 34-14-10 6-14 16-16 26" fill="#4ade80" />
      <path d="M290 150h30l-4 26a4 4 0 0 1-4 4h-14a4 4 0 0 1-4-4z" fill="#f59e0b" />

      {/* desk */}
      <rect x="36" y="196" width="288" height="16" rx="6" fill="#c9d8f2" />
      <rect x="150" y="180" width="60" height="18" rx="4" fill="#ffffff" stroke="#c7d7f5" strokeWidth="2" />

      {/* operator (left, blue) */}
      <g>
        <path d="M84 196c0-22 12-36 26-36s26 14 26 36z" fill="#2563eb" />
        <path d="M92 196c0-16 8-26 18-26s18 10 18 26z" fill="#3b82f6" />
        <circle cx="110" cy="140" r="17" fill="#f4c9a6" />
        <path d="M93 138c0-12 8-20 17-20s17 8 17 19c-4-3-8-6-17-6-6 0-10 4-13 9-2-1-4-1-4-2z" fill="#3b2f2a" />
        {/* tablet in hand */}
        <rect x="120" y="170" width="30" height="20" rx="3" fill="#0f2a5b" transform="rotate(-10 120 170)" />
        <rect x="124" y="174" width="22" height="12" rx="1.5" fill="#8ab4ff" transform="rotate(-10 124 174)" />
      </g>

      {/* citizen (right, warm) */}
      <g>
        <path d="M224 196c0-20 11-33 24-33s24 13 24 33z" fill="#d9b18c" />
        <path d="M231 196c0-15 8-24 17-24s17 9 17 24z" fill="#e7c6a6" />
        <circle cx="248" cy="146" r="16" fill="#e8b48c" />
        <path d="M233 145c0-11 7-18 15-18s15 7 15 17c-3-4-7-7-15-7-5 0-9 3-12 8z" fill="#2b2320" />
      </g>

      {/* live/token check bubble */}
      <circle cx="300" cy="120" r="16" fill="#22c55e" />
      <path d="M293 120l5 5 9-9" stroke="#ffffff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
