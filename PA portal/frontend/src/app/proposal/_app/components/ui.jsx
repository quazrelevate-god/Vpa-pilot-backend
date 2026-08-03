"use client";
// Reusable premium primitives for the /proposal experience. cva-driven variants,
// Motion micro-interactions, all sharing the motion tokens in ../lib/motion.
// Colours + copy are supplied by callers — nothing here hard-codes brand hues
// beyond the gradient classes defined in proposal.css.
import { forwardRef } from "react";
import { motion } from "framer-motion";
import { cva } from "class-variance-authority";
import { cn } from "@/lib/utils";
import { fadeUp, fadeUpSm, stagger, inView, spring } from "../lib/motion";

/* ── Button ────────────────────────────────────────────────────────────────
   Motion-driven press/lift. `gold` and `ghost` reference the elevated gradient
   classes in proposal.css so the brand gold lives in exactly one place. */
const buttonVariants = cva(
  "relative inline-flex items-center justify-center gap-2.5 font-disp font-semibold " +
    "select-none cursor-pointer transition-colors outline-none " +
    "focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-transparent " +
    "focus-visible:ring-gold-400 disabled:opacity-60 disabled:pointer-events-none",
  {
    variants: {
      variant: {
        gold: "btn-gold-v2 text-ink-950",
        ghost: "btn-ghost-v2 text-white",
        pill: "pill-v2 text-white",
      },
      size: {
        sm: "text-[13px] px-5 py-2.5 rounded-xl",
        md: "text-[14px] sm:text-[15px] px-6 sm:px-7 py-3.5 rounded-xl",
        lg: "text-[15px] sm:text-[16px] px-7 sm:px-8 py-4 rounded-2xl",
      },
    },
    defaultVariants: { variant: "gold", size: "md" },
  }
);

export const Button = forwardRef(function Button(
  { className, variant, size, children, ...props },
  ref
) {
  return (
    <motion.button
      ref={ref}
      className={cn(buttonVariants({ variant, size }), className)}
      whileHover={{ y: -2, transition: spring }}
      whileTap={{ y: 0, scale: 0.97, transition: spring }}
      {...props}
    >
      {children}
    </motion.button>
  );
});

/* ── Reveal ────────────────────────────────────────────────────────────────
   A staggering container: children marked with <RevealItem> (or any element
   given the `fadeUp` variant) cascade in as the block scrolls into view. Use
   `as="section"` etc. to keep semantic tags. */
export function Reveal({ as = "div", className, children, gap = 0.08, delay = 0, ...props }) {
  const M = motion[as] || motion.div;
  return (
    <M
      className={className}
      variants={stagger(gap, delay)}
      initial="hidden"
      whileInView="show"
      viewport={inView}
      {...props}
    >
      {children}
    </M>
  );
}

/** A single cascading child. `sm` uses the tighter rise for dense rows. */
export function RevealItem({ as = "div", className, sm = false, children, ...props }) {
  const M = motion[as] || motion.div;
  return (
    <M className={className} variants={sm ? fadeUpSm : fadeUp} {...props}>
      {children}
    </M>
  );
}

/* ── Eyebrow ───────────────────────────────────────────────────────────────
   The gold section label with a leading rule. */
export function Eyebrow({ className, children }) {
  return (
    <span className={cn("eyebrow text-gold-400 inline-flex items-center gap-3", className)}>
      <span className="h-px w-8 bg-gold-500/70" />
      {children}
    </span>
  );
}

/* ── Chip ──────────────────────────────────────────────────────────────────
   Frosted pill used in the "who can submit" rail. */
export function Chip({ className, children }) {
  return (
    <span
      className={cn(
        "rounded-full border border-white/15 bg-white/[0.05] px-3.5 py-1.5 " +
          "text-[12.5px] text-white/85 backdrop-blur-sm transition-colors " +
          "hover:border-gold-400/40 hover:bg-white/[0.09]",
        className
      )}
    >
      {children}
    </span>
  );
}

/* ── GlassCard ─────────────────────────────────────────────────────────────
   Layered surface: subtle top-highlight, soft shadow, frosted fill. The base
   depth primitive for premium cards over the dark indigo ground. */
export function GlassCard({ className, children, ...props }) {
  return (
    <div
      className={cn(
        "relative rounded-2xl border border-white/10 bg-white/[0.04] " +
          "shadow-[0_1px_0_rgba(255,255,255,0.06)_inset,0_24px_60px_-30px_rgba(0,0,0,0.7)] " +
          "backdrop-blur-md",
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}
