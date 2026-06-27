"use client";

import { useState } from "react";
import { AlertCircle, Landmark } from "lucide-react";
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
    <div className="flex min-h-screen items-center justify-center bg-background px-6 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-3">
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
              <Input name="username" required autoFocus placeholder="Enter your username"
                onChange={() => setError(null)} />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Password
              </label>
              <Input type="password" name="password" required placeholder="Enter your password"
                onChange={() => setError(null)} />
            </div>
            <Button type="submit" disabled={submitting} size="lg" className="mt-2 w-full">
              {submitting ? "Signing in…" : "Sign In"}
            </Button>
          </form>

          <p className="mt-8 text-center text-xs text-muted-foreground">
            Authorised personnel only
          </p>
        </div>
    </div>
  );
}
