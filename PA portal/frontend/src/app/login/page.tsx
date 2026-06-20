"use client";

import { useState } from "react";
import { AlertCircle } from "lucide-react";

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
      // fetch DOESN'T chase FastAPI's Location header (which points at the
      // old Jinja /dashboard/appointments route that doesn't exist here).
      // The browser still captures the cookie regardless of redirect mode;
      // we just self-navigate to our own /overview after.
      const resp = await fetch("/auth/login", {
        method: "POST",
        body: form,
        credentials: "include",
        redirect: "manual",
      });
      // Opaque-redirect (type === 'opaqueredirect', status === 0) means
      // FastAPI sent a 3xx → successful login. A real 200 also counts.
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
    <div className="min-h-screen bg-slate-100 flex items-center justify-center font-sans">
      <div className="w-full max-w-md">
        <div className="bg-white rounded-2xl shadow-xl overflow-hidden">
          <div className="bg-sidebar px-8 py-6 text-white text-center">
            <div className="text-xs font-semibold tracking-widest uppercase opacity-70 mb-1">
              Government of Tamil Nadu
            </div>
            <div className="text-xl font-bold">Petition Management System</div>
            <div className="text-sm opacity-60 mt-1">Staff Portal</div>
          </div>
          <div className="px-8 py-8">
            {error && (
              <div className="mb-5 flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-lg">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                {error}
              </div>
            )}
            <form onSubmit={onSubmit} className="space-y-5">
              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                  Username
                </label>
                <input
                  type="text"
                  name="username"
                  required
                  autoFocus
                  placeholder="Enter your username"
                  className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm text-slate-800 focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 transition"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                  Password
                </label>
                <input
                  type="password"
                  name="password"
                  required
                  placeholder="Enter your password"
                  className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm text-slate-800 focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 transition"
                />
              </div>
              <button
                type="submit"
                disabled={submitting}
                className="w-full bg-brand text-white font-semibold text-sm py-2.5 rounded-lg hover:bg-blue-700 transition-colors shadow-sm mt-2 disabled:opacity-60"
              >
                {submitting ? "Signing in…" : "Sign In"}
              </button>
            </form>
          </div>
        </div>
        <p className="text-center text-xs text-slate-400 mt-4">
          © 2026 Government of Tamil Nadu. Authorised personnel only.
        </p>
      </div>
    </div>
  );
}
