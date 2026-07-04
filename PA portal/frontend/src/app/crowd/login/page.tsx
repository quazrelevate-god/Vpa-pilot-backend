"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useT } from "../_lib/i18n";
import HeroIllustration from "../_components/HeroIllustration";
import { Users, Loader2 } from "../_lib/icons";

export default function CrowdLoginPage() {
  const router = useRouter();
  const { t, lang, setLang } = useT();
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
      const r = await fetch("/crowd/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
        credentials: "include",
      });
      if (r.ok) {
        router.push("/crowd");
        router.refresh();
      } else {
        const d = await r.json().catch(() => ({}));
        setError(d.error || t("Invalid username or password.", "தவறான பயனர்பெயர் அல்லது கடவுச்சொல்."));
      }
    } catch {
      setError(t("Network error. Please try again.", "பிணைய பிழை. மீண்டும் முயற்சிக்கவும்."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-white px-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] pt-[calc(2rem+env(safe-area-inset-top))]">
      {/* Brand */}
      <div className="flex items-start gap-3">
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-[#0f2a5b] text-white shadow-lg shadow-blue-900/20">
          <Users className="h-6 w-6" />
        </span>
        <div className="leading-tight">
          <div className="text-[1.35rem] font-black tracking-tight text-slate-900">{t("Crowd", "கூட்ட")}</div>
          <div className="-mt-1 text-[1.35rem] font-black tracking-tight text-slate-900">{t("Management", "மேலாண்மை")}</div>
        </div>
        <span className="ml-auto rounded-md bg-slate-900 px-1.5 py-0.5 text-[10px] font-black tracking-widest text-white">PWA</span>
      </div>

      <h1 className="mt-5 text-lg font-extrabold text-slate-900">{t("Floor Operator App", "தள ஆபரேட்டர் செயலி")}</h1>
      <p className="mt-1.5 text-sm leading-relaxed text-slate-500">
        {t(
          "Manage today's visitors, appointments and walk-ins with real-time slot availability.",
          "இன்றைய வருகையாளர்கள், சந்திப்புகள் மற்றும் நேரடி பதிவுகளை நேரலை இட நிலையுடன் நிர்வகிக்கவும்.",
        )}
      </p>

      {/* Language */}
      <div className="mt-4 inline-flex w-fit rounded-full border border-slate-200 bg-slate-50 p-1">
        {(["en", "ta"] as const).map((l) => (
          <button
            key={l}
            type="button"
            onClick={() => setLang(l)}
            className={cn(
              "rounded-full px-3.5 py-1 text-xs font-bold transition-colors",
              lang === l ? "bg-blue-600 text-white shadow" : "text-slate-500",
            )}
          >
            {l === "en" ? "EN" : "தமிழ்"}
          </button>
        ))}
      </div>

      {/* Illustration */}
      <HeroIllustration className="mt-6 w-full" />

      {/* Form */}
      <form onSubmit={submit} className="mt-6 space-y-4">
        {error && (
          <div className="rounded-xl bg-red-50 px-3.5 py-2.5 text-sm font-semibold text-red-700">{error}</div>
        )}
        <div className="space-y-1.5">
          <Label className="text-xs font-bold uppercase tracking-wide text-slate-500">{t("Username", "பயனர்பெயர்")}</Label>
          <Input value={username} autoFocus autoComplete="username" onChange={(e) => setUsername(e.target.value)}
            className="h-12 rounded-xl text-base" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs font-bold uppercase tracking-wide text-slate-500">{t("Password", "கடவுச்சொல்")}</Label>
          <Input type="password" value={password} autoComplete="current-password" onChange={(e) => setPassword(e.target.value)}
            className="h-12 rounded-xl text-base" />
        </div>
        <Button type="submit" disabled={busy || !username || !password}
          className="h-12 w-full rounded-xl bg-blue-600 text-base font-bold hover:bg-blue-700">
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          {t("Sign In", "உள்நுழை")}
        </Button>
      </form>

      <div className="mt-auto pt-6 text-center text-xs text-slate-400">
        {t("Authorised floor staff only.", "அங்கீகரிக்கப்பட்ட ஊழியர்களுக்கு மட்டும்.")}
      </div>
    </div>
  );
}
