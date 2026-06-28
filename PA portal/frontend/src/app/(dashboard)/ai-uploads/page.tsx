"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { Sparkles, UploadCloud, Loader2, ArrowRight, ClipboardCheck } from "lucide-react";
import { toast } from "sonner";

import TopBar from "@/components/TopBar";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface Counts { QUEUED?: number; PROCESSING?: number; AWAITING_REVIEW?: number; REVIEWED?: number; FAILED?: number; }

const STATUS_PILLS: { key: keyof Counts; label: string; cls: string }[] = [
  { key: "QUEUED",          label: "Queued",         cls: "bg-slate-100 text-slate-600" },
  { key: "PROCESSING",      label: "Processing",     cls: "bg-blue-100 text-blue-700" },
  { key: "AWAITING_REVIEW", label: "Awaiting Review", cls: "bg-amber-100 text-amber-700" },
  { key: "REVIEWED",        label: "Reviewed",       cls: "bg-emerald-100 text-emerald-700" },
  { key: "FAILED",          label: "Failed",         cls: "bg-red-100 text-red-700" },
];

export default function AiUploadsPage() {
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [counts, setCounts] = useState<Counts>({});
  const fileRef = useRef<HTMLInputElement | null>(null);

  const loadCounts = useCallback(async () => {
    try {
      const r = await fetch("/api/ai-uploads", { credentials: "include" });
      const d = await r.json();
      if (Array.isArray(d)) {
        const c: Counts = {};
        d.forEach((u: { status: keyof Counts }) => { c[u.status] = (c[u.status] || 0) + 1; });
        setCounts(c);
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { loadCounts(); }, [loadCounts]);
  // keep the live strip moving while files are still processing
  useEffect(() => {
    const active = (counts.QUEUED || 0) + (counts.PROCESSING || 0) > 0;
    if (!active) return;
    const id = setInterval(loadCounts, 4000);
    return () => clearInterval(id);
  }, [counts, loadCounts]);

  async function handleFiles(files: FileList | File[]) {
    const arr = Array.from(files);
    if (!arr.length) return;
    setUploading(true);
    try {
      const fd = new FormData();
      arr.forEach(f => fd.append("files", f));
      const r = await fetch("/api/ai-uploads/upload", { method: "POST", body: fd, credentials: "include" });
      const d = await r.json();
      if (r.ok) {
        toast.success(`${d.count} file(s) queued`, { description: "Processing one by one — track them in AI Review." });
        setCounts(c => ({ ...c, QUEUED: (c.QUEUED || 0) + d.count }));
        loadCounts();
      } else toast.error(d.detail || d.error || "Upload failed");
    } catch { toast.error("Network error"); }
    finally { setUploading(false); if (fileRef.current) fileRef.current.value = ""; }
  }

  const pending = (counts.AWAITING_REVIEW || 0);

  return (
    <>
      <TopBar />
      <main className="flex-1 overflow-y-auto bg-background">
        <div className="mx-auto max-w-[820px] space-y-6 p-6 animate-in-up">
          {/* Header */}
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-extrabold tracking-tight">
              <Sparkles className="h-6 w-6 text-violet-600" /> AI Uploads
            </h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Drop a batch of scanned petitions — Gemini reads each one, extracts the petitioner & grievance, and queues it for review.
            </p>
          </div>

          {/* Dropzone */}
          <Card
            onDragOver={e => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={e => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files); }}
            className={cn(
              "flex flex-col items-center justify-center gap-3 border-2 border-dashed p-12 text-center transition-colors cursor-pointer",
              dragOver ? "border-violet-500 bg-violet-50" : "border-border hover:border-violet-300"
            )}
            onClick={() => fileRef.current?.click()}
          >
            <input ref={fileRef} type="file" multiple accept=".pdf,image/*" className="hidden"
              onChange={e => e.target.files && handleFiles(e.target.files)} />
            <div className="grid h-14 w-14 place-items-center rounded-2xl bg-violet-100">
              {uploading ? <Loader2 className="h-7 w-7 animate-spin text-violet-600" /> : <UploadCloud className="h-7 w-7 text-violet-600" />}
            </div>
            <div className="text-base font-semibold">{uploading ? "Uploading…" : "Drop petition PDFs / images here"}</div>
            <div className="text-xs text-muted-foreground">or click to select · many files at once · PDF, JPG, PNG, HEIC</div>
          </Card>

          {/* Live status strip */}
          <div className="flex flex-wrap items-center gap-2">
            {STATUS_PILLS.map(p => (
              <span key={p.key} className={cn("rounded-full px-3 py-1 text-xs font-semibold", p.cls)}>
                {p.label}: {counts[p.key] || 0}
              </span>
            ))}
          </div>

          {/* CTA to review */}
          <Link href="/ai-review">
            <Card className="flex items-center gap-4 p-5 transition-colors hover:border-violet-300 hover:bg-violet-50/40 cursor-pointer">
              <div className="grid h-11 w-11 place-items-center rounded-xl bg-amber-100">
                <ClipboardCheck className="h-5 w-5 text-amber-700" />
              </div>
              <div className="flex-1">
                <div className="font-semibold">Review extracted petitions</div>
                <div className="text-sm text-muted-foreground">
                  {pending > 0 ? `${pending} petition(s) awaiting your review` : "Open the review queue to verify & approve into tickets"}
                </div>
              </div>
              {pending > 0 && (
                <span className="grid h-7 min-w-7 place-items-center rounded-full bg-amber-500 px-2 text-sm font-bold text-white">{pending}</span>
              )}
              <ArrowRight className="h-5 w-5 text-muted-foreground" />
            </Card>
          </Link>
        </div>
      </main>
    </>
  );
}
