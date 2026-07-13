// Global in-flight API tracking → drives the top loading bar.
//
// We monkey-patch window.fetch ONCE so every API call across the whole app
// flips the bar on/off, with zero changes at the call sites. A short show-delay
// keeps fast requests (polls, cache hits) from flashing the bar; it hides as
// soon as the last in-flight request settles — success OR failure.

type Listener = () => void;

let active = 0;
let visible = false;
let showTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<Listener>();

function emit() {
  listeners.forEach((l) => l());
}

function setVisible(v: boolean) {
  if (visible === v) return;
  visible = v;
  emit();
}

function begin() {
  active += 1;
  // Only reveal the bar if a request is genuinely taking a moment — avoids a
  // flicker on the many fast background polls.
  if (active === 1 && !visible && showTimer === null) {
    showTimer = setTimeout(() => {
      showTimer = null;
      if (active > 0) setVisible(true);
    }, 120);
  }
}

function end() {
  active = Math.max(0, active - 1);
  if (active === 0) {
    if (showTimer !== null) {
      clearTimeout(showTimer);
      showTimer = null;
    }
    setVisible(false);
  }
}

export function subscribeLoading(l: Listener): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export function getLoadingSnapshot(): boolean {
  return visible;
}

/** Patch window.fetch once (client only). Safe to call repeatedly. */
export function installFetchLoader(): void {
  if (typeof window === "undefined") return;
  const w = window as unknown as { __apiLoadingPatched?: boolean; fetch: typeof fetch };
  if (w.__apiLoadingPatched) return;
  w.__apiLoadingPatched = true;

  const original = w.fetch.bind(window);
  w.fetch = ((...args: Parameters<typeof fetch>) => {
    begin();
    const p = original(...args);
    // Settle handler runs on both resolve and reject; it does NOT alter the
    // promise the caller awaits, so error handling everywhere is unaffected.
    p.then(end, end);
    return p;
  }) as typeof fetch;
}
