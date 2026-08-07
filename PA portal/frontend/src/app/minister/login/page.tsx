"use client";

import { useState } from "react";
import { AlertCircle, Eye, EyeOff, Loader2, ShieldCheck, ArrowRight } from "lucide-react";

/**
 * Minister's Desk sign-in.
 *
 * The brand pairing is NAVY field + GOLD accent. Everything is set with explicit
 * colours (not theme tokens) so the contrast is guaranteed here regardless of
 * the app's light/dark tokens — this screen is deliberately its own world, and
 * the rest of the app then uses the standard Aurora tokens.
 */
export default function MinisterLoginPage() {
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const form = new FormData(e.currentTarget);
    try {
      const body = new URLSearchParams();
      body.set("username", String(form.get("username") ?? "").trim());
      body.set("password", String(form.get("password") ?? ""));
      const resp = await fetch("/minister/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
        credentials: "include",
      });
      if (resp.ok) {
        window.location.href = "/minister";
      } else {
        const d = await resp.json().catch(() => ({}));
        setError((d as { error?: string }).error || "Invalid username or password.");
      }
    } catch {
      setError("Could not reach the server.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mn-login relative flex min-h-screen w-full items-center justify-center overflow-hidden px-6 py-12">
      {/* Slow aurora light behind the card. */}
      <div className="mn-orb mn-orb-a" style={{ width: 420, height: 420, top: "-8%", left: "12%", background: "rgba(233,184,76,0.16)" }} />
      <div className="mn-orb mn-orb-b" style={{ width: 480, height: 480, bottom: "-14%", right: "8%", background: "rgba(47,111,237,0.20)" }} />

      {/* Gold hairline along the top edge. */}
      <div
        className="absolute inset-x-0 top-0 h-[3px]"
        style={{ background: "linear-gradient(90deg,transparent,#E9B84C 25%,#F6E3B4 50%,#E9B84C 75%,transparent)" }}
      />

      <div className="mn-login-card relative w-full max-w-[420px]">
        <div
          className="rounded-3xl border px-8 py-9 backdrop-blur-xl"
          style={{
            background: "rgba(255,255,255,0.055)",
            borderColor: "rgba(233,184,76,0.22)",
            boxShadow: "0 40px 90px -30px rgba(0,0,0,0.85), inset 0 1px 0 rgba(255,255,255,0.08)",
          }}
        >
          <div className="mn-login-stagger">
            {/* Wordmark */}
            <div className="mb-7 flex flex-col items-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/minister/namkural-wordmark.svg"
                alt="நம் குரல் — Nam Kural"
                className="h-14 w-auto"
              />
            </div>

            {/* Title — white on navy glass, so it always reads. */}
            <div className="mb-7 text-center">
              <h1
                className="font-serif text-[27px] font-semibold leading-tight"
                style={{ color: "#FFFFFF", letterSpacing: "-0.01em" }}
              >
                Minister&apos;s Desk
              </h1>
              <p className="mt-1.5 text-[13.5px] font-medium" style={{ color: "rgba(244,247,252,0.62)" }}>
                அமைச்சர் மேசை
              </p>
              <div className="mx-auto mt-4 h-px w-16" style={{ background: "linear-gradient(90deg,transparent,rgba(233,184,76,0.75),transparent)" }} />
            </div>

            {/* Error */}
            {error && (
              <div
                className="mb-5 flex items-start gap-2 rounded-xl px-3.5 py-2.5 text-[13px]"
                style={{ background: "rgba(220,38,38,0.14)", border: "1px solid rgba(248,113,113,0.35)", color: "#FCA5A5" }}
              >
                <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {/* Form */}
            <form onSubmit={onSubmit} className="space-y-5">
              <div className="space-y-2">
                <label
                  htmlFor="mn-username"
                  className="block text-[10.5px] font-bold uppercase tracking-[0.14em]"
                  style={{ color: "rgba(233,184,76,0.85)" }}
                >
                  Username
                </label>
                <input
                  id="mn-username"
                  name="username" required autoFocus autoComplete="username"
                  placeholder="Enter your username"
                  onChange={() => setError(null)}
                  className="mn-field h-12 w-full rounded-xl px-4 text-[15px]"
                />
              </div>

              <div className="space-y-2">
                <label
                  htmlFor="mn-password"
                  className="block text-[10.5px] font-bold uppercase tracking-[0.14em]"
                  style={{ color: "rgba(233,184,76,0.85)" }}
                >
                  Password
                </label>
                <div className="relative">
                  <input
                    id="mn-password"
                    type={showPassword ? "text" : "password"} name="password" required
                    autoComplete="current-password" placeholder="Enter your password"
                    onChange={() => setError(null)}
                    className="mn-field h-12 w-full rounded-xl px-4 pr-12 text-[15px]"
                  />
                  <button
                    type="button" onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    className="absolute right-2 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-lg transition-colors"
                    style={{ color: "rgba(244,247,252,0.55)" }}
                  >
                    {showPassword ? <EyeOff className="h-[18px] w-[18px]" /> : <Eye className="h-[18px] w-[18px]" />}
                  </button>
                </div>
              </div>

              {/* GOLD action — the one primary CTA. */}
              <button
                type="submit" disabled={submitting}
                className="mn-gold-btn mt-1 inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl text-[15.5px] font-bold disabled:cursor-not-allowed disabled:opacity-70"
                style={{ color: "#2A2205", boxShadow: "0 10px 26px -10px rgba(233,184,76,0.55)" }}
              >
                {submitting ? (
                  <>
                    <Loader2 className="h-[18px] w-[18px] animate-spin" />
                    Signing in…
                  </>
                ) : (
                  <>
                    Sign In
                    <ArrowRight className="h-[18px] w-[18px]" />
                  </>
                )}
              </button>
            </form>
          </div>
        </div>

        {/* Footer note */}
        <p
          className="mt-6 flex items-center justify-center gap-1.5 text-center text-[12px] font-medium"
          style={{ color: "rgba(244,247,252,0.45)" }}
        >
          <ShieldCheck className="h-3.5 w-3.5" />
          For the Minister&apos;s office · Read-only
        </p>
      </div>
    </div>
  );
}
