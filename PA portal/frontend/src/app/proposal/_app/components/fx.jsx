"use client";
// Premium SaaS interaction primitives for the /proposal experience.
// Everything here is GPU-only (transform / opacity) and reduced-motion-safe:
// each effect no-ops (renders a plain element) when the visitor asks their OS
// to reduce motion, so the page stays fully usable and calm.
import { useRef, useState, useCallback } from "react";
import {
  motion,
  useScroll,
  useSpring,
  useTransform,
  useMotionValue,
  useReducedMotion,
} from "framer-motion";
import { cn } from "@/lib/utils";

/* ── ScrollProgress ─────────────────────────────────────────────────────────
   Thin gold bar pinned to the top edge that fills as the page scrolls. The
   quintessential SaaS "you are here" cue. */
export function ScrollProgress() {
  const reduce = useReducedMotion();
  const { scrollYProgress } = useScroll();
  const scaleX = useSpring(scrollYProgress, { stiffness: 120, damping: 26, mass: 0.4 });
  if (reduce) return null;
  return (
    <motion.div
      aria-hidden="true"
      style={{ scaleX }}
      className="fixed top-0 inset-x-0 z-[60] h-[3px] origin-left
                 bg-gradient-to-r from-gold-400 via-gold-500 to-gold-600
                 shadow-[0_0_14px_rgba(227,170,61,0.6)]"
    />
  );
}

/* ── MagneticButton ─────────────────────────────────────────────────────────
   Wraps any child (typically a Button) and lets it drift toward the cursor
   inside its own bounds, springing back on leave. `strength` = px of pull.
   Reduced-motion: renders the child untouched. */
export function MagneticButton({ children, strength = 18, className }) {
  const reduce = useReducedMotion();
  const ref = useRef(null);
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const sx = useSpring(x, { stiffness: 260, damping: 18, mass: 0.5 });
  const sy = useSpring(y, { stiffness: 260, damping: 18, mass: 0.5 });

  const onMove = useCallback(
    (e) => {
      const el = ref.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const relX = (e.clientX - (r.left + r.width / 2)) / (r.width / 2);
      const relY = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
      x.set(relX * strength);
      y.set(relY * strength);
    },
    [strength, x, y]
  );
  const reset = useCallback(() => { x.set(0); y.set(0); }, [x, y]);

  if (reduce) return <span className={className}>{children}</span>;
  return (
    <motion.span
      ref={ref}
      onMouseMove={onMove}
      onMouseLeave={reset}
      style={{ x: sx, y: sy }}
      className={cn("relative inline-block", className)}
    >
      {children}
    </motion.span>
  );
}

/* ── SpotlightCard ──────────────────────────────────────────────────────────
   A surface that carries a soft radial highlight tracking the cursor. Optional
   3D tilt (pointer-driven rotateX/rotateY) for a tactile, layered feel. Pass
   `as` to keep semantics. Reduced-motion: renders a static element. */
export function SpotlightCard({
  as = "div",
  className,
  children,
  tilt = false,
  tiltMax = 6,
  spotlight = "rgba(227,170,61,0.18)",
  ...props
}) {
  const reduce = useReducedMotion();
  const ref = useRef(null);
  const px = useMotionValue(50);
  const py = useMotionValue(50);
  const rx = useMotionValue(0);
  const ry = useMotionValue(0);
  const srx = useSpring(rx, { stiffness: 200, damping: 18 });
  const sry = useSpring(ry, { stiffness: 200, damping: 18 });
  const [hover, setHover] = useState(false);

  const onMove = useCallback(
    (e) => {
      const el = ref.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const mx = e.clientX - r.left;
      const my = e.clientY - r.top;
      px.set((mx / r.width) * 100);
      py.set((my / r.height) * 100);
      if (tilt) {
        ry.set(((mx / r.width) - 0.5) * (tiltMax * 2));
        rx.set(-((my / r.height) - 0.5) * (tiltMax * 2));
      }
    },
    [px, py, rx, ry, tilt, tiltMax]
  );
  const onLeave = useCallback(() => { setHover(false); rx.set(0); ry.set(0); }, [rx, ry]);

  const Comp = motion[as] || motion.div;
  const glow = useTransform(
    [px, py],
    ([x, y]) => `radial-gradient(240px circle at ${x}% ${y}%, ${spotlight}, transparent 65%)`
  );

  if (reduce) {
    const Plain = as;
    return <Plain className={className} {...props}>{children}</Plain>;
  }
  return (
    <Comp
      ref={ref}
      onMouseMove={onMove}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={onLeave}
      style={tilt ? { rotateX: srx, rotateY: sry, transformPerspective: 900 } : undefined}
      className={cn("relative", className)}
      {...props}
    >
      {/* pointer-tracked glow layer */}
      <motion.span
        aria-hidden="true"
        style={{ background: glow, opacity: hover ? 1 : 0 }}
        className="pointer-events-none absolute inset-0 rounded-[inherit] transition-opacity duration-300"
      />
      {children}
    </Comp>
  );
}

/* ── Parallax ───────────────────────────────────────────────────────────────
   Translates children on the Y axis as the element travels through the
   viewport. `speed` > 0 drifts up (foreground feel), < 0 drifts down.
   Reduced-motion: renders children with no transform. */
export function Parallax({ children, speed = 40, className, as = "div" }) {
  const reduce = useReducedMotion();
  const ref = useRef(null);
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start end", "end start"],
  });
  const y = useTransform(scrollYProgress, [0, 1], [speed, -speed]);
  const sy = useSpring(y, { stiffness: 120, damping: 30, mass: 0.6 });
  const Comp = motion[as] || motion.div;
  if (reduce) {
    const Plain = as;
    return <Plain className={className}>{children}</Plain>;
  }
  return (
    <Comp ref={ref} style={{ y: sy }} className={className}>
      {children}
    </Comp>
  );
}

/* ── Aurora ─────────────────────────────────────────────────────────────────
   Slow, drifting gradient blobs for a living background behind the closing
   band. Pure CSS-animation via Motion keyframes; sits behind content.
   Reduced-motion: static (no drift). Colours are passed in so the caller
   controls the palette (kept to brand gold/haze). */
export function Aurora({ className }) {
  const reduce = useReducedMotion();
  const blobs = [
    { c: "rgba(227,170,61,0.20)", d: 26, from: { x: "-10%", y: "-15%" }, to: { x: "12%", y: "8%" }, s: 60 },
    { c: "rgba(142,201,255,0.14)", d: 32, from: { x: "60%", y: "10%" }, to: { x: "40%", y: "-8%" }, s: 66 },
    { c: "rgba(59,130,196,0.16)", d: 30, from: { x: "20%", y: "60%" }, to: { x: "34%", y: "44%" }, s: 58 },
  ];
  return (
    <div aria-hidden="true" className={cn("absolute inset-0 overflow-hidden pointer-events-none", className)}>
      {blobs.map((b, i) => (
        <motion.span
          key={i}
          className="absolute rounded-full blur-3xl"
          style={{ width: `${b.s}vmax`, height: `${b.s}vmax`, background: b.c, left: b.from.x, top: b.from.y }}
          animate={reduce ? undefined : { x: [0, 40, 0], y: [0, -30, 0] }}
          transition={reduce ? undefined : { duration: b.d, repeat: Infinity, ease: "easeInOut", delay: i * 2 }}
        />
      ))}
    </div>
  );
}
