"use client";

import { useState, useEffect, useRef } from "react";
import { QrCode, Copy, Check, ExternalLink, Download, Smartphone, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import TopBar from "@/components/TopBar";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useLang } from "@/lib/lang-context";

export default function CrowdQrPage() {
  const { t } = useLang();
  const [url, setUrl] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const boxRef = useRef<HTMLDivElement | null>(null);

  // The crowd PWA is served by this same portal at /crowd, so the board URL is
  // always this origin — no backend round-trip, and it can never point at the
  // wrong host.
  useEffect(() => {
    setUrl(window.location.origin + "/crowd");
    setLoading(false);
  }, []);

  // Render the QR client-side (qrcodejs via CDN), same as the referral QR.
  useEffect(() => {
    if (!url || !boxRef.current) return;
    const box = boxRef.current;
    const QR = () => (window as unknown as { QRCode?: any }).QRCode;
    const render = () => {
      box.innerHTML = "";
      const Q = QR();
      if (Q) new Q(box, { text: url, width: 240, height: 240, correctLevel: Q.CorrectLevel.M });
    };
    if (QR()) { render(); return; }
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js";
    s.onload = render;
    document.body.appendChild(s);
  }, [url]);

  function copy() {
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true); toast.success(t("qr.linkCopied"));
      setTimeout(() => setCopied(false), 1800);
    }).catch(() => toast.error(t("qr.copyFailed")));
  }

  function download() {
    const box = boxRef.current;
    if (!box) return;
    const canvas = box.querySelector("canvas") as HTMLCanvasElement | null;
    const img = box.querySelector("img") as HTMLImageElement | null;
    const src = canvas ? canvas.toDataURL("image/png") : img?.src;
    if (!src) { toast.error(t("qr.qrNotReady")); return; }
    const a = document.createElement("a");
    a.href = src; a.download = "crowd-management-qr.png"; a.click();
  }

  return (
    <>
      <TopBar />
      <main className="flex-1 overflow-y-auto bg-background">
        <div className="mx-auto max-w-[900px] space-y-6 p-6 animate-in-up">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-extrabold tracking-tight">
              <QrCode className="h-6 w-6 text-indigo-600" /> {t("qr.title")}
            </h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {t("qr.subtitle")}
            </p>
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {/* QR */}
            <Card className="flex flex-col items-center gap-4 p-6">
              <div ref={boxRef} className="grid h-[240px] w-[240px] place-items-center rounded-xl border border-border bg-white p-2">
                {loading && <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />}
              </div>
              <div className="flex w-full flex-wrap justify-center gap-2">
                <Button variant="outline" onClick={download} disabled={!url}><Download className="mr-1.5 h-4 w-4" /> {t("qr.download")}</Button>
                <Button variant="outline" onClick={() => window.print()} disabled={!url}><QrCode className="mr-1.5 h-4 w-4" /> {t("qr.print")}</Button>
              </div>
            </Card>

            {/* Link + instructions */}
            <div className="space-y-4">
              <Card className="p-5">
                <div className="mb-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{t("qr.boardLink")}</div>
                <div className="flex items-center gap-2">
                  <code className="min-w-0 flex-1 truncate rounded-lg bg-muted px-3 py-2 text-sm">{url || "…"}</code>
                  <Button size="sm" variant="outline" onClick={copy} disabled={!url}>
                    {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
                  </Button>
                </div>
                {url && (
                  <a href={url} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-indigo-600 hover:underline">
                    <ExternalLink className="h-3.5 w-3.5" /> {t("qr.openBoard")}
                  </a>
                )}
                <p className="mt-3 text-xs text-muted-foreground">{t("qr.lostApp")}</p>
              </Card>

              <Card className="p-5">
                <div className="mb-3 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                  <Smartphone className="h-3.5 w-3.5" /> {t("qr.installTitle")}
                </div>
                <ol className="space-y-2 text-sm text-foreground/85">
                  {[t("qr.step1"), t("qr.step2"), t("qr.step3"), t("qr.step4")].map((s, i) => (
                    <li key={i} className="flex gap-2.5">
                      <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-indigo-100 text-[11px] font-bold text-indigo-700">{i + 1}</span>
                      <span>{s}</span>
                    </li>
                  ))}
                </ol>
              </Card>
            </div>
          </div>
        </div>
      </main>
    </>
  );
}
