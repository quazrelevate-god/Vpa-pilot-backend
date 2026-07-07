"use client";

import { useState } from "react";
import { AlertCircle, Landmark } from "lucide-react";
import { motion, type Variants } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import IsometricScene from "./IsometricScene";

const container: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.08, delayChildren: 0.05 } },
};
const item: Variants = {
  hidden: { opacity: 0, y: 14 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.22, 1, 0.36, 1] } },
};

export default function LoginPage() {
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const form = new FormData(e.currentTarget);
    try {
      // Unified sign-in: the backend resolves the role (PA staff vs department)
      // from the credentials, sets the matching session cookie, and returns
      // where to land. /api/login is proxied → FastAPI /dashboard/api/login.
      const body = new URLSearchParams();
      body.set("username", String(form.get("username") ?? "").trim());
      body.set("password", String(form.get("password") ?? ""));
      const resp = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
        credentials: "include",
      });
      if (resp.ok) {
        const data = await resp.json().catch(() => ({ redirect: "/appointments" }));
        window.location.href = data.redirect || "/appointments";
      } else {
        const d = await resp.json().catch(() => ({}));
        setError(d.error || "Invalid username or password.");
      }
    } catch {
      setError("Could not reach the server.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen w-full lg:grid lg:grid-cols-[1.05fr_1fr]">
      {/* ── Brand / flow-showcase panel ── */}
      <div className="aurora-sidebar relative hidden overflow-hidden lg:flex lg:flex-col lg:p-12">
        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}
          className="flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-brand text-white shadow-card-md">
            <Landmark className="h-5 w-5" />
          </div>
          <div className="leading-tight">
            <div className="text-sm font-bold text-foreground">Petition Management</div>
            <div className="text-xs text-muted-foreground">Staff portal</div>
          </div>
        </motion.div>

        <motion.div initial={{ opacity: 0, scale: 0.94 }} animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1], delay: 0.1 }}
          className="flex flex-1 flex-col justify-center">
          <IsometricScene className="mx-auto w-full max-w-[440px]" />
        </motion.div>
      </div>

      {/* ── Form ── */}
      <div className="flex min-h-screen items-center justify-center bg-background px-6 py-12">
        <motion.div variants={container} initial="hidden" animate="show" className="w-full max-w-sm">
          {/* Mobile brand (panel is hidden below lg) */}
          <motion.div variants={item} className="mb-8 flex items-center gap-3 lg:hidden">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-brand text-white shadow-card-md">
              <Landmark className="h-5 w-5" />
            </div>
            <div className="leading-tight">
              <div className="text-sm font-bold text-foreground">Petition Management</div>
              <div className="text-xs text-muted-foreground">Staff portal</div>
            </div>
          </motion.div>

          <motion.div variants={item} className="mb-7">
            <h1 className="text-2xl font-extrabold tracking-tight text-foreground">Welcome back</h1>
            <p className="mt-1 text-sm text-muted-foreground">Sign in to the staff portal to continue.</p>
          </motion.div>

          {error && (
            <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}
              className="mb-5 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              <AlertCircle className="h-4 w-4 flex-shrink-0" />
              {error}
            </motion.div>
          )}

          <motion.form variants={item} onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Username</label>
              <Input name="username" required autoFocus placeholder="Enter your username"
                onChange={() => setError(null)} className="h-11" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Password</label>
              <Input type="password" name="password" required placeholder="Enter your password"
                onChange={() => setError(null)} className="h-11" />
            </div>
            <Button type="submit" disabled={submitting} size="lg"
              className="aurora-primary mt-2 w-full transition-transform active:scale-[0.99]">
              {submitting ? "Signing in…" : "Sign In"}
            </Button>
          </motion.form>

          <motion.p variants={item} className="mt-8 text-center text-xs text-muted-foreground">
            Authorised personnel only
          </motion.p>
        </motion.div>
      </div>
    </div>
  );
}
