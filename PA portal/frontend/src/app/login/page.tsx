"use client";

import { useState } from "react";
import { AlertCircle, Landmark, ShieldCheck, Lock, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function LoginPage() {
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const form = new FormData(e.currentTarget);
    try {
      // /auth/login is proxied by next.config.mjs → FastAPI's /dashboard/login.
      // FastAPI responds with 302 + Set-Cookie. We use redirect:"manual" so
      // fetch DOESN'T chase FastAPI's Location header (old Jinja route).
      const resp = await fetch("/auth/login", {
        method: "POST",
        body: form,
        credentials: "include",
        redirect: "manual",
      });
      const success = resp.type === "opaqueredirect" || resp.ok;
      if (success) {
        window.location.href = "/overview";
      } else {
        setError("Invalid username or password.");
      }
    } catch {
      setError("Could not reach the server.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      {/* Left — brand panel */}
      <div className="relative hidden overflow-hidden bg-sidebar lg:flex lg:flex-col lg:justify-between">
        <div className="pointer-events-none absolute inset-0 bg-grid opacity-40" />
        <div className="pointer-events-none absolute -left-24 -top-24 h-80 w-80 rounded-full bg-brand/20 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-32 -right-16 h-96 w-96 rounded-full bg-brand/10 blur-3xl" />

        <div className="relative z-10 flex items-center gap-3 p-10">
          <div className="grid h-11 w-11 place-items-center rounded-xl bg-brand text-white shadow-card-md ring-1 ring-white/10">
            <Landmark className="h-6 w-6" />
          </div>
          <div className="leading-tight text-white">
            <div className="text-sm font-bold">Petition Management</div>
            <div className="text-xs text-white/55">Grievance &amp; appointment workflow</div>
          </div>
        </div>

        <div className="relative z-10 px-10 pb-6">
          <h2 className="max-w-md text-balance text-3xl font-extrabold leading-tight text-white">
            One place to triage, schedule, and resolve every citizen petition.
          </h2>
          <p className="mt-3 max-w-md text-sm leading-relaxed text-white/60">
            AI-assisted summaries, appointment scheduling, and live case tracking —
            built for the Minister's PA office.
          </p>

          <div className="mt-8 grid max-w-md grid-cols-1 gap-3 sm:grid-cols-3">
            {[
              { icon: ShieldCheck, label: "Secure access" },
              { icon: Users, label: "Case tracking" },
              { icon: Lock, label: "Audited actions" },
            ].map(({ icon: Icon, label }) => (
              <div key={label} className="flex items-center gap-2 rounded-lg bg-white/5 px-3 py-2.5 ring-1 ring-white/10">
                <Icon className="h-4 w-4 text-brand" />
                <span className="text-xs font-medium text-white/80">{label}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="relative z-10 p-10 text-xs text-white/40">
          © 2026 Petition Management · Authorised personnel only
        </div>
      </div>

      {/* Right — form */}
      <div className="flex items-center justify-center bg-background px-6 py-12">
        <div className="w-full max-w-sm">
          {/* mobile brand */}
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-brand text-white shadow-card-md">
              <Landmark className="h-5 w-5" />
            </div>
            <div className="leading-tight">
              <div className="text-sm font-bold text-foreground">Petition Management</div>
              <div className="text-xs text-muted-foreground">Staff portal</div>
            </div>
          </div>

          <div className="mb-7">
            <h1 className="text-2xl font-extrabold tracking-tight text-foreground">Welcome back</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Sign in to the staff portal to continue.
            </p>
          </div>

          {error && (
            <div className="mb-5 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              <AlertCircle className="h-4 w-4 flex-shrink-0" />
              {error}
            </div>
          )}

          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Username
              </label>
              <Input name="username" required autoFocus placeholder="Enter your username" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Password
              </label>
              <Input type="password" name="password" required placeholder="Enter your password" />
            </div>
            <Button type="submit" disabled={submitting} size="lg" className="mt-2 w-full">
              {submitting ? "Signing in…" : "Sign In"}
            </Button>
          </form>

          <p className="mt-8 text-center text-xs text-muted-foreground lg:hidden">
            © 2026 Petition Management · Authorised personnel only
          </p>
        </div>
      </div>
    </div>
  );
}
