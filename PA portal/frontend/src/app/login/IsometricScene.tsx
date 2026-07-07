"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";

/**
 * Isometric product-flow showcase for the staff login. Reveals the petition
 * lifecycle ONE stage at a time — each an isometric mini-scene (with people
 * where it helps) plus a title + description. Auto-advances and loops; the
 * stepper doubles as manual navigation. Pure inline SVG, Aurora palette.
 */

/* ── shared iso primitives ─────────────────────────────────────────────── */

function Platform() {
  return (
    <g>
      <ellipse cx="160" cy="206" rx="134" ry="30" fill="#21395B" opacity="0.08" />
      <polygon points="160,150 286,190 160,230 34,190" fill="#EEF2F9" />
      <polygon points="286,190 160,230 160,242 286,202" fill="#D3DAE8" />
      <polygon points="34,190 160,230 160,242 34,202" fill="#C7D0E0" />
    </g>
  );
}

function Person({
  x, y, s = 1, cloth, cloth2, skin = "#E8B48C", hair = "#2B2320",
}: {
  x: number; y: number; s?: number; cloth: string; cloth2: string; skin?: string; hair?: string;
}) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <path d="M-24 0 c0-22 12-36 24-36 s24 14 24 36 z" fill={cloth} />
      <path d="M-16 0 c0-16 8-26 16-26 s16 10 16 26 z" fill={cloth2} />
      <circle cx="0" cy="-44" r="15" fill={skin} />
      <path d="M-15 -46 c0-11 7-18 15-18 s15 7 15 17 c-4-3-8-5-15-5 -5 0-9 3-12 8z" fill={hair} />
    </g>
  );
}

function MiniBuilding({ x, y, color }: { x: number; y: number; color: string }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <polygon points="0,-14 22,-2 0,10 -22,-2" fill="#FFFFFF" />
      <polygon points="22,-2 0,10 0,34 22,22" fill={color} />
      <polygon points="-22,-2 0,10 0,34 -22,22" fill="#21395B" />
      <polygon points="-10,16 -2,20 -2,30 -10,26" fill="#FFFFFF" opacity="0.55" />
    </g>
  );
}

/* ── per-stage scenes ──────────────────────────────────────────────────── */

function SceneIntake({ color }: { color: string }) {
  return (
    <g>
      <Platform />
      <ellipse cx="204" cy="196" rx="48" ry="16" fill={color} opacity="0.14" />
      <Person x={120} y={198} cloth="#E08E4E" cloth2="#F0A96A" />
      {/* phone in hand */}
      <g transform="rotate(-12 148 152)">
        <rect x="140" y="150" width="16" height="25" rx="3" fill="#21395B" />
        <rect x="143" y="154" width="10" height="15" rx="1" fill="#8AB4FF" />
      </g>
      {/* kiosk with QR */}
      <rect x="200" y="150" width="8" height="46" fill="#C7D0E0" />
      <g transform="translate(181 106)">
        <rect x="0" y="0" width="46" height="42" rx="6" fill="#FFFFFF" stroke="#E1E5EB" strokeWidth="1.5" />
        <g fill={color}>
          <rect x="8" y="8" width="9" height="9" rx="1" />
          <rect x="29" y="8" width="9" height="9" rx="1" />
          <rect x="8" y="25" width="9" height="9" rx="1" />
          <rect x="22" y="18" width="5" height="5" />
          <rect x="30" y="26" width="4" height="4" />
          <rect x="34" y="31" width="4" height="4" />
        </g>
      </g>
    </g>
  );
}

function SceneAI({ color }: { color: string }) {
  return (
    <g>
      <Platform />
      <ellipse cx="160" cy="196" rx="62" ry="16" fill={color} opacity="0.14" />
      {/* iso document */}
      <polygon points="160,84 226,118 160,152 94,118" fill="#FFFFFF" />
      <polygon points="226,118 160,152 160,196 226,162" fill="#EEF2F9" />
      <polygon points="94,118 160,152 160,196 94,162" fill="#FFFFFF" />
      <polygon points="120,116 168,140 160,144 112,120" fill="#C7D0E0" />
      <polygon points="132,110 180,134 172,138 124,114" fill="#DCE3EE" />
      <polygon points="112,150 150,169 150,177 112,158" fill={color} opacity="0.55" />
      {/* AI sparkle */}
      <g transform="translate(208 92)">
        <path d="M0 -15 L4 -4 L15 0 L4 4 L0 15 L-4 4 L-15 0 L-4 -4 Z" fill={color} />
        <circle cx="17" cy="-13" r="3" fill={color} opacity="0.7" />
        <circle cx="-15" cy="13" r="2.5" fill={color} opacity="0.5" />
      </g>
    </g>
  );
}

function SceneReview({ color }: { color: string }) {
  return (
    <g>
      <Platform />
      <ellipse cx="160" cy="198" rx="62" ry="16" fill={color} opacity="0.14" />
      <Person x={150} y={190} cloth="#1E40AF" cloth2="#3B5BD6" />
      {/* desk in front of the seated operator */}
      <polygon points="108,186 212,186 230,204 90,204" fill="#CBB89A" />
      <polygon points="90,204 230,204 230,212 90,212" fill="#B79E7E" />
      {/* monitor with checklist */}
      <g transform="translate(176 150)">
        <rect x="0" y="0" width="42" height="31" rx="3" fill="#21395B" />
        <rect x="4" y="4" width="34" height="23" rx="1.5" fill="#EAF1FF" />
        <path d="M8 11 l3 3 5-6" stroke={color} strokeWidth="2.2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M8 20 l3 3 5-6" stroke={color} strokeWidth="2.2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        <line x1="20" y1="12" x2="33" y2="12" stroke="#C7D0E0" strokeWidth="2.4" strokeLinecap="round" />
        <line x1="20" y1="21" x2="33" y2="21" stroke="#C7D0E0" strokeWidth="2.4" strokeLinecap="round" />
      </g>
    </g>
  );
}

function SceneAssign({ color }: { color: string }) {
  return (
    <g>
      <Platform />
      <ellipse cx="160" cy="200" rx="46" ry="14" fill={color} opacity="0.14" />
      <Person x={160} y={200} s={0.82} cloth="#1E40AF" cloth2="#3B5BD6" />
      <MiniBuilding x={68} y={150} color="#6E4BE6" />
      <MiniBuilding x={252} y={150} color="#35839B" />
      {/* flow arrows to each desk */}
      <path d="M138 156 C116 156 104 158 92 162" stroke={color} strokeWidth="2.5" strokeDasharray="2 6" fill="none" strokeLinecap="round" />
      <path d="M182 156 C204 156 216 158 228 162" stroke={color} strokeWidth="2.5" strokeDasharray="2 6" fill="none" strokeLinecap="round" />
      <circle cx="90" cy="162" r="3.2" fill={color} />
      <circle cx="230" cy="162" r="3.2" fill={color} />
    </g>
  );
}

function SceneResolved({ color }: { color: string }) {
  return (
    <g>
      <Platform />
      <ellipse cx="118" cy="198" rx="46" ry="15" fill={color} opacity="0.14" />
      <Person x={118} y={200} cloth="#E08E4E" cloth2="#F0A96A" />
      {/* check badge */}
      <g transform="translate(220 122)">
        <circle r="34" fill="#FFFFFF" stroke="#E1E5EB" strokeWidth="1.5" />
        <circle r="24" fill={color} opacity="0.14" />
        <path d="M-11 0 l7 7 15 -16" stroke={color} strokeWidth="4.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </g>
      {/* SMS bubble */}
      <g transform="translate(150 116)">
        <rect x="0" y="0" width="46" height="30" rx="8" fill={color} />
        <path d="M12 30 l0 8 8 -8 z" fill={color} />
        <line x1="10" y1="11" x2="36" y2="11" stroke="#FFFFFF" strokeWidth="2.5" strokeLinecap="round" />
        <line x1="10" y1="19" x2="28" y2="19" stroke="#FFFFFF" strokeWidth="2.5" strokeLinecap="round" opacity="0.8" />
      </g>
      {/* confetti */}
      <circle cx="88" cy="98" r="3" fill="#E7A33C" />
      <circle cx="256" cy="82" r="3" fill="#6E4BE6" />
      <circle cx="72" cy="132" r="2.5" fill="#2F6FED" />
    </g>
  );
}

/* ── stages ────────────────────────────────────────────────────────────── */

const STAGES = [
  { key: "intake",   color: "#2F6FED", title: "Citizens check in",   desc: "QR self check-in or an assisted screen captures every visitor in seconds.", Scene: SceneIntake },
  { key: "ai",       color: "#6E4BE6", title: "AI drafts the summary", desc: "Every grievance gets a clear, structured summary — assistive, never deciding.", Scene: SceneAI },
  { key: "review",   color: "#E7A33C", title: "Staff review & triage", desc: "PA staff confirm category and priority with the whole desk in view.", Scene: SceneReview },
  { key: "assign",   color: "#35839B", title: "Route to the right desk", desc: "Forward each case to the correct ministry or department in one tap.", Scene: SceneAssign },
  { key: "resolved", color: "#2E7D5B", title: "Resolved & notified",  desc: "Citizens get SMS updates at every step, right through to closure.", Scene: SceneResolved },
] as const;

export default function IsometricScene({ className }: { className?: string }) {
  const [i, setI] = useState(0);

  // Re-arms on every change, so manual taps also get the full dwell time.
  useEffect(() => {
    const id = setTimeout(() => setI((v) => (v + 1) % STAGES.length), 3800);
    return () => clearTimeout(id);
  }, [i]);

  const stage = STAGES[i];
  const Scene = stage.Scene;

  return (
    <div className={className}>
      {/* stage illustration */}
      <div className="relative h-[248px] w-full">
        <AnimatePresence mode="wait">
          <motion.div key={stage.key}
            initial={{ opacity: 0, x: 26, scale: 0.97 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: -26, scale: 0.97 }}
            transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
            className="absolute inset-0">
            <motion.svg viewBox="0 0 320 260" className="h-full w-full" xmlns="http://www.w3.org/2000/svg"
              animate={{ y: [0, -6, 0] }} transition={{ duration: 4.5, repeat: Infinity, ease: "easeInOut" }}>
              <Scene color={stage.color} />
            </motion.svg>
          </motion.div>
        </AnimatePresence>
      </div>

      {/* stepper */}
      <div className="mt-3 flex items-center gap-2">
        {STAGES.map((s, idx) => (
          <button key={s.key} type="button" onClick={() => setI(idx)} aria-label={s.title} className="py-1.5">
            <span className="block h-1.5 rounded-full transition-all duration-300"
              style={{ width: idx === i ? 28 : 8, backgroundColor: idx === i ? s.color : "#CBD3E1" }} />
          </button>
        ))}
      </div>

      {/* stage copy */}
      <div className="relative mt-3 min-h-[92px]">
        <AnimatePresence mode="wait">
          <motion.div key={stage.key}
            initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}>
            <div className="flex items-center gap-2.5">
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-[11px] font-black text-white"
                style={{ backgroundColor: stage.color }}>
                {i + 1}
              </span>
              <h2 className="font-serif text-[1.5rem] font-semibold leading-tight text-foreground">{stage.title}</h2>
            </div>
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{stage.desc}</p>
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
