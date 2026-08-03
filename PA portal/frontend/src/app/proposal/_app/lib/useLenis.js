"use client";
import { useEffect, useRef } from "react";
import Lenis from "lenis";

// Lenis smooth-scroll for the /proposal page. Inertial, buttery, GPU-cheap.
//
// Disabled entirely when the visitor prefers reduced motion — we fall back to
// the browser's native (instant/OS-eased) scrolling instead of driving scroll
// position on rAF. The instance is exposed via a module ref so the anchor
// helpers below can drive programmatic scrolls through the SAME instance
// (mixing native scrollIntoView with an active Lenis fights for control).

let _lenis = null;

export function useLenis() {
  const raf = useRef(0);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return; // native scrolling; scrollToId() falls back to instant

    const lenis = new Lenis({
      duration: 1.05,
      // easeOutExpo — long, confident glide that never feels sluggish.
      easing: (t) => (t === 1 ? 1 : 1 - Math.pow(2, -10 * t)),
      smoothWheel: true,
      touchMultiplier: 1.4,
    });
    _lenis = lenis;

    const loop = (time) => {
      lenis.raf(time);
      raf.current = requestAnimationFrame(loop);
    };
    raf.current = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf.current);
      lenis.destroy();
      _lenis = null;
    };
  }, []);
}

/** Scroll to an element id. Uses the live Lenis instance when present (so the
 *  inertial feel is consistent), else falls back to native smooth/instant
 *  scrolling — which is also the reduced-motion path. `offset` accounts for
 *  the fixed nav where needed. */
export function scrollToId(id, offset = 0) {
  if (typeof document === "undefined") return;
  const el = document.getElementById(id);
  if (!el) return;
  if (_lenis) {
    _lenis.scrollTo(el, { offset, duration: 1.15 });
    return;
  }
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const top = el.getBoundingClientRect().top + window.scrollY + offset;
  window.scrollTo({ top, behavior: reduce ? "auto" : "smooth" });
}
