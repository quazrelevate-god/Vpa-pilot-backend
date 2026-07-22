"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { motion, type Variants } from "framer-motion";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useT } from "../_lib/i18n";
import { Handshake, Loader2 } from "../_lib/icons";

const container: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.085, delayChildren: 0.04 } },
};
const item: Variants = {
  hidden: { opacity: 0, y: 14 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.22, 1, 0.36, 1] } },
};

export default function EventsLoginPage() {
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
      const r = await fetch("/events/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
        credentials: "include",
      });
      if (r.ok) {
        router.push("/events");
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

  const inputCls =
    "h-12 rounded-xl text-base transition-shadow focus-visible:border-[#2F6FED] focus-visible:ring-2 focus-visible:ring-[#2F6FED]/30";

  return (
    <div className="relative flex min-h-screen flex-col justify-center overflow-hidden px-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] pt-[calc(2rem+env(safe-area-inset-top))]">
      {/* ambient drifting glows */}
      <motion.span aria-hidden
        className="pointer-events-none absolute -left-20 -top-8 h-64 w-64 rounded-full bg-[#94CCEE]/35 blur-3xl"
        animate={{ y: [0, 22, 0], x: [0, 12, 0], scale: [1, 1.1, 1] }}
        transition={{ duration: 10, repeat: Infinity, ease: "easeInOut" }} />
      <motion.span aria-hidden
        className="pointer-events-none absolute -right-24 bottom-4 h-72 w-72 rounded-full bg-[#CBB8F2]/35 blur-3xl"
        animate={{ y: [0, -20, 0], x: [0, -10, 0], scale: [1, 1.12, 1] }}
        transition={{ duration: 12, repeat: Infinity, ease: "easeInOut", delay: 1 }} />

      <motion.div variants={container} initial="hidden" animate="show"
        className="relative mx-auto w-full max-w-[400px]">
        {/* Brand */}
        <motion.div variants={item} className="flex items-center gap-3">
          <motion.span
            className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-[#21395B] text-white shadow-lg shadow-[#21395B]/25"
            initial={{ scale: 0.6, rotate: -8, opacity: 0 }}
            animate={{ scale: 1, rotate: 0, opacity: 1 }}
            transition={{ type: "spring", stiffness: 320, damping: 18, delay: 0.1 }}>
            <Handshake className="h-6 w-6" />
          </motion.span>
          <div className="leading-tight">
            <div className="text-[1.45rem] font-black tracking-tight text-slate-900">{t("NamKural", "நம்குரல்")}</div>
            <div className="text-[0.95rem] font-bold text-slate-500">{t("Events Calendar", "நிகழ்வு நாட்காட்டி")}</div>
          </div>
        </motion.div>

        {/* Login card */}
        <motion.div variants={item}
          className="mt-8 rounded-3xl border border-white/70 bg-white/80 p-6 shadow-[0_18px_46px_-24px_rgba(28,30,41,0.35)] backdrop-blur-xl">
          <h1 className="text-lg font-extrabold text-slate-900">{t("Events Desk", "நிகழ்வு மேசை")}</h1>
          <p className="mt-1 text-sm leading-relaxed text-slate-500">
            {t(
              "Sign in to manage invitations and the shared calendar.",
              "அழைப்பிதழ்களையும் பொது நாட்காட்டியையும் நிர்வகிக்க உள்நுழையவும்.",
            )}
          </p>

          {/* Language toggle */}
          <div className="mt-4 inline-flex items-center rounded-lg border border-[#E1E5EB] bg-[#EAEEF3] p-0.5">
            {(["en", "ta"] as const).map((l) => (
              <button key={l} type="button" onClick={() => setLang(l)} aria-pressed={lang === l}
                className={cn("rounded-md px-3 py-1 text-xs font-bold transition-colors",
                  lang === l ? "bg-white text-[#21395B] shadow-sm" : "text-[#5A6472]")}>
                {l === "en" ? "EN" : "தமிழ்"}
              </button>
            ))}
          </div>

          <form onSubmit={submit} className="mt-4 space-y-4">
            {error && (
              <motion.div
                initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}
                className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm font-semibold text-red-700">
                {error}
              </motion.div>
            )}
            <div className="space-y-1.5">
              <Label className="text-xs font-bold uppercase tracking-wide text-slate-500">{t("Username", "பயனர்பெயர்")}</Label>
              <Input value={username} autoFocus autoComplete="username" onChange={(e) => setUsername(e.target.value)}
                className={inputCls} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-bold uppercase tracking-wide text-slate-500">{t("Password", "கடவுச்சொல்")}</Label>
              <Input type="password" value={password} autoComplete="current-password" onChange={(e) => setPassword(e.target.value)}
                className={inputCls} />
            </div>
            <Button type="submit" disabled={busy || !username || !password}
              className="h-12 w-full rounded-xl bg-[#2F6FED] text-base font-bold text-white transition-transform hover:bg-[#2558C4] active:scale-[0.99] disabled:opacity-60">
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              {busy ? t("Signing in…", "உள்நுழைகிறது…") : t("Sign In", "உள்நுழை")}
            </Button>
          </form>
        </motion.div>

        <motion.div variants={item} className="pt-5 text-center text-xs text-slate-400">
          {t("Authorised PA office staff only.", "அங்கீகரிக்கப்பட்ட அலுவலக ஊழியர்களுக்கு மட்டும்.")}
        </motion.div>
      </motion.div>
    </div>
  );
}
