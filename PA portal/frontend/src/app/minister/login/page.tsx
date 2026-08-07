"use client";

import { useState } from "react";
import { AlertCircle, Eye, EyeOff, Loader2 } from "lucide-react";

// Login uses the brand pairing: NAVY field + GOLD accent. Navy is the ministry
// register; gold is the sign-in action. Everything inside the app uses the
// standard Aurora tokens.
const NAVY_BG =
  "radial-gradient(120% 90% at 50% -10%, #1B2946 0%, #0F1B32 55%, #050B18 100%)";
const GOLD_BTN =
  "linear-gradient(140deg,#F6E3B4 0%,#E9B84C 42%,#C9902B 100%)";

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
    <div
      className="flex min-h-screen w-full flex-col items-center justify-center px-6 py-12"
      style={{ background: NAVY_BG }}
    >
      {/* Faint gold rule at the top — the only decorative touch. */}
      <div className="absolute inset-x-0 top-0 h-[3px]" style={{ background: GOLD_BTN }} />

      <div className="w-full max-w-sm">
        {/* Card sits on navy — white so the gold wordmark reads. */}
        <div className="rounded-2xl border border-white/10 bg-white/97 p-7 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.6)] backdrop-blur">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/minister/namkural-wordmark.svg"
            alt="நம் குரல் — Nam Kural"
            className="mx-auto mb-5 h-14 w-auto"
          />

          <div className="mb-6 text-center">
            <h1 className="font-serif text-[22px] font-semibold leading-tight text-[#1B2946]">
              Minister&apos;s Desk
            </h1>
            <p className="mt-0.5 text-[13px] font-medium text-[#5A6472]">
              அமைச்சர் மேசை · Sign in
            </p>
          </div>

          {error && (
            <div className="mb-5 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-[13px] text-red-700">
              <AlertCircle className="h-4 w-4 flex-shrink-0" />
              {error}
            </div>
          )}

          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold uppercase tracking-wider text-[#5A6472]">
                Username
              </label>
              <input
                name="username" required autoFocus autoComplete="username"
                placeholder="Enter your username"
                onChange={() => setError(null)}
                className="h-11 w-full rounded-lg border border-[#E1E5EB] bg-white px-3 text-[15px] text-[#131720] outline-none transition-colors focus:border-[#1B2946] focus:ring-2 focus:ring-[#1B2946]/25"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold uppercase tracking-wider text-[#5A6472]">
                Password
              </label>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"} name="password" required
                  autoComplete="current-password" placeholder="Enter your password"
                  onChange={() => setError(null)}
                  className="h-11 w-full rounded-lg border border-[#E1E5EB] bg-white px-3 pr-11 text-[15px] text-[#131720] outline-none transition-colors focus:border-[#1B2946] focus:ring-2 focus:ring-[#1B2946]/25"
                />
                <button
                  type="button" onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  className="absolute right-1.5 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-md text-[#5A6472] transition-colors hover:text-[#131720]"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {/* GOLD action — the one primary CTA. */}
            <button
              type="submit" disabled={submitting}
              className="mt-2 inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg border border-[#C9902B]/40 text-[15px] font-bold text-[#2A2205] shadow-[0_10px_24px_-8px_rgba(201,144,43,0.55)] transition-transform active:scale-[0.99] disabled:opacity-70"
              style={{ background: GOLD_BTN }}
            >
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {submitting ? "Signing in…" : "Sign In"}
            </button>
          </form>
        </div>

        <p className="mt-6 text-center text-[12px] font-medium text-white/70">
          For the Minister&apos;s office · Read-only
        </p>
      </div>
    </div>
  );
}
