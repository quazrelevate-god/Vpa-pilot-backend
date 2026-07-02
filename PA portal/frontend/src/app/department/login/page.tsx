"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Building2, Loader2 } from "lucide-react";

export default function DepartmentLoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError("");
    try {
      const body = new URLSearchParams();
      body.set("username", username.trim());
      body.set("password", password);
      const r = await fetch("/department/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
        credentials: "include",
      });
      if (r.ok) {
        router.push("/department");
        router.refresh();
      } else {
        const d = await r.json().catch(() => ({}));
        setError(d.error || "Invalid username or password.");
      }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-screen place-items-center bg-slate-50 p-4">
      <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <div className="mb-6 flex flex-col items-center text-center">
          <span className="grid h-12 w-12 place-items-center rounded-xl bg-indigo-100 text-indigo-600">
            <Building2 className="h-6 w-6" />
          </span>
          <h1 className="mt-3 text-lg font-bold text-slate-900">Department Workspace</h1>
          <p className="mt-1 text-sm text-slate-500">Sign in to manage tickets assigned to your department.</p>
        </div>
        <form onSubmit={submit} className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Department username</label>
            <input value={username} onChange={(e) => setUsername(e.target.value)} autoFocus
              placeholder="e.g. scert"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Password</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter your password"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500" />
          </div>
          {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
          <button type="submit" disabled={busy || !username || !password}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-indigo-700 disabled:opacity-50">
            {busy && <Loader2 className="h-4 w-4 animate-spin" />} Sign In
          </button>
        </form>
        <p className="mt-4 text-center text-[11px] text-slate-400">School Education — authorised department staff only</p>
      </div>
    </div>
  );
}
