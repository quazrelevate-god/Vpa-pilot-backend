"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Building2, Loader2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function DepartmentLoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
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
        return;
      }
      const d = await r.json().catch(() => ({}));
      setError(d.error ?? "Invalid username or password.");
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-screen place-items-center bg-background px-6 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-2xl border border-[#CFE0FB] bg-gradient-to-br from-white to-[#EAF1FE] text-[#1E40AF] shadow-[0_2px_8px_rgba(47,111,237,0.12)]">
            <Building2 className="h-5 w-5" />
          </div>
          <div className="leading-tight">
            <div className="text-sm font-bold text-foreground">Department Workspace</div>
            <div className="text-[11px] font-medium text-muted-foreground">
              Petition Management · Staff portal
            </div>
          </div>
        </div>

        <div className="mb-7">
          <h1 className="type-page-title text-foreground">Welcome</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Sign in with your shared department credentials.
          </p>
        </div>

        {error && (
          <div className="mb-5 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            <AlertCircle className="h-4 w-4 flex-shrink-0" /> {error}
          </div>
        )}

        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Username</Label>
            <Input
              value={username} onChange={(e) => { setUsername(e.target.value); setError(null); }}
              autoFocus placeholder="e.g. scert_team"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Password</Label>
            <Input
              type="password"
              value={password} onChange={(e) => { setPassword(e.target.value); setError(null); }}
              placeholder="••••••••"
            />
          </div>
          <Button
            type="submit" disabled={busy || !username || !password}
            className="aurora-primary mt-2 w-full text-white"
          >
            {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            Sign in
          </Button>
        </form>

        <div className="mt-8 flex items-center gap-2 text-[11px] text-muted-foreground">
          <ShieldCheck className="h-3 w-3" />
          Authorised department personnel only
        </div>
      </div>
    </div>
  );
}
