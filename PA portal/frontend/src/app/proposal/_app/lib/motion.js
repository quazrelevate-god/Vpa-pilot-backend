// Shared Motion (framer-motion) tokens for the Nam Kural /proposal experience.
//
// One source of truth for spring physics, entrance variants, and stagger
// timing so every section on the page moves with the same character —
// confident, eased, never bouncy-toy. Reduced-motion is handled globally by
// <MotionConfig reducedMotion="user"> in App.jsx (Motion then drops transforms
// and keeps opacity for users who ask for less motion), so the variants here
// can describe the full designed motion without per-component guards.

/** Primary spring — used for hover elevation, layout expansion, CTA press.
 *  Tuned firm + slightly damped so it settles fast without wobble. */
export const spring = { type: "spring", stiffness: 380, damping: 32, mass: 0.9 };

/** Softer spring for larger travel (section entrances, shared-layout desks). */
export const springSoft = { type: "spring", stiffness: 210, damping: 30, mass: 1 };

/** Eased tween mirroring the CSS cubic-bezier(.22,.9,.24,1) used elsewhere,
 *  so Motion-driven and CSS-driven elements share the same feel. */
export const ease = [0.22, 0.9, 0.24, 1];
export const tween = (duration = 0.7) => ({ duration, ease });

// ── Entrance variants ──────────────────────────────────────────────────────

/** Fade + rise. The workhorse entrance for headings, copy, buttons. */
export const fadeUp = {
  hidden: { opacity: 0, y: 22 },
  show: { opacity: 1, y: 0, transition: tween(0.7) },
};

/** Smaller rise for dense/inline items (chips, list rows, flow steps). */
export const fadeUpSm = {
  hidden: { opacity: 0, y: 14 },
  show: { opacity: 1, y: 0, transition: tween(0.55) },
};

/** Plain fade — for backgrounds / ambient layers that shouldn't translate. */
export const fade = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: tween(0.9) },
};

/** Container that staggers its children's entrances. Pair a `stagger()`
 *  parent with `fadeUp`/`fadeUpSm` children for a cascade. */
export const stagger = (staggerChildren = 0.08, delayChildren = 0) => ({
  hidden: {},
  show: { transition: { staggerChildren, delayChildren } },
});

/** Standard viewport trigger — animate once, a little before fully in view. */
export const inView = { once: true, amount: 0.25, margin: "0px 0px -8% 0px" };

// ── Interaction presets ──────────────────────────────────────────────────────

/** Subtle hover lift + press, GPU-friendly (transform only). Spread onto a
 *  motion element: `<motion.div {...hoverLift}>`. */
export const hoverLift = {
  whileHover: { y: -4, transition: spring },
  whileTap: { scale: 0.985, transition: spring },
};

/** Card-scale hover for image plates / interactive tiles. */
export const hoverScale = {
  whileHover: { scale: 1.02, transition: spring },
  whileTap: { scale: 0.99, transition: spring },
};
