"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import Link from "next/link";
import {
  Sparkles, UploadCloud, Loader2, ArrowRight, ClipboardCheck, FolderUp, Files,
  Check, X, Clock, AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";

import TopBar from "@/components/TopBar";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface Row {
  id: number; batch_id: string; filename: string; status: string;
  name: string | null; created_at: string | null; forced_category: string | null;
}

const CATEGORIES = ["action_required","proposals","transfer_requests","pension_requests","school_admission","job_requests","rti","associations_unions","school_upgradation","invitation","greetings","general","other"];
const ACCEPT = /\.(pdf|jpe?g|png|webp|heic|heif|gif|bmp)$/i;

export default function AiUploadsPage() {
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [category, setCategory] = useState("");          // "" = Auto
  const [rows, setRows] = useState<Row[]>([]);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const folderRef = useRef<HTMLInputElement | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/ai-uploads", { credentials: "include" });
      const d = await r.json();
      if (Array.isArray(d)) setRows(d);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const active = rows.some(u => u.status === "QUEUED" || u.status === "PROCESSING");
    if (!active) return;
    const id = setInterval(load, 3000);
    return () => clearInterval(id);
  }, [rows, load]);

  // make the folder input pick directories
  useEffect(() => {
    if (folderRef.current) {
      folderRef.current.setAttribute("webkitdirectory", "");
      folderRef.current.setAttribute("directory", "");
    }
  }, []);

  async function handleFiles(fileList: FileList | File[]) {
    const arr = Array.from(fileList).filter(f => ACCEPT.test(f.name));
    if (!arr.length) { toast.error("No PDF/image files found"); return; }
    setUploading(true);
    try {
      const fd = new FormData();
      arr.forEach(f => fd.append("files", f));
      if (category) fd.append("category", category);
      const r = await fetch("/api/ai-uploads/upload", { method: "POST", body: fd, credentials: "include" });
      const d = await r.json();
      if (r.ok) {
        toast.success(`${d.count} file(s) queued`, { description: "Processing one by one — watch the batch below." });
        load();
      } else toast.error(d.detail || d.error || "Upload failed");
    } catch { toast.error("Network error"); }
    finally { setUploading(false); if (fileRef.current) fileRef.current.value = ""; if (folderRef.current) folderRef.current.value = ""; }
  }

  // group rows into batches, newest first
  const batches = useMemo(() => {
    const map = new Map<string, Row[]>();
    rows.forEach(u => { (map.get(u.batch_id) ?? map.set(u.batch_id, []).get(u.batch_id)!).push(u); });
    return [...map.values()]
      .map(items => ({ items, created: items[0]?.created_at ?? "" }))
      .sort((a, b) => (b.created || "").localeCompare(a.created || ""))
      .slice(0, 8);
  }, [rows]);

  const totalAwaiting = rows.filter(u => u.status === "AWAITING_REVIEW").length;

  return (
    <>
      <TopBar />
      <main className="flex-1 overflow-y-auto bg-background">
        <div className="mx-auto max-w-[860px] space-y-6 p-6 animate-in-up">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-extrabold tracking-tight">
              <Sparkles className="h-6 w-6 text-violet-600" /> AI Uploads
            </h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Drop a batch (or a whole folder) of scanned petitions — Gemini reads each one and queues it for review.
            </p>
          </div>

          {/* Category override */}
          <div className="flex flex-wrap items-center gap-3">
            <label className="text-sm font-semibold">Category for this batch</label>
            <select value={category} onChange={e => setCategory(e.target.value)}
              className="rounded-lg border border-input bg-card px-3 py-2 text-sm focus:border-violet-500 focus:outline-none">
              <option value="">Auto — let AI decide</option>
              {CATEGORIES.map(c => <option key={c} value={c}>{c.replace(/_/g, " ")}</option>)}
            </select>
            <span className="text-xs text-muted-foreground">
              {category ? "Overrides the AI category for every file in this upload." : "AI detects the category per file."}
            </span>
          </div>

          {/* Dropzone */}
          <Card
            onDragOver={e => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={e => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files); }}
            className={cn(
              "flex flex-col items-center justify-center gap-3 border-2 border-dashed p-10 text-center transition-colors",
              dragOver ? "border-violet-500 bg-violet-50" : "border-border"
            )}
          >
            <input ref={fileRef} type="file" multiple accept=".pdf,image/*" className="hidden"
              onChange={e => e.target.files && handleFiles(e.target.files)} />
            <input ref={folderRef} type="file" multiple className="hidden"
              onChange={e => e.target.files && handleFiles(e.target.files)} />
            <div className="grid h-14 w-14 place-items-center rounded-2xl bg-violet-100">
              {uploading ? <Loader2 className="h-7 w-7 animate-spin text-violet-600" /> : <UploadCloud className="h-7 w-7 text-violet-600" />}
            </div>
            <div className="text-base font-semibold">{uploading ? "Uploading…" : "Drag files here, or choose below"}</div>
            <div className="flex flex-wrap justify-center gap-2">
              <Button variant="outline" onClick={() => fileRef.current?.click()} disabled={uploading}>
                <Files className="mr-1.5 h-4 w-4" /> Select files
              </Button>
              <Button variant="outline" onClick={() => folderRef.current?.click()} disabled={uploading}>
                <FolderUp className="mr-1.5 h-4 w-4" /> Select folder
              </Button>
            </div>
            <div className="text-xs text-muted-foreground">PDF, JPG, PNG, HEIC · processed one by one</div>
          </Card>

          {/* Live batch cards */}
          {batches.length > 0 && (
            <div className="space-y-3">
              <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Recent batches</div>
              {batches.map((b, i) => <BatchCard key={i} items={b.items} />)}
            </div>
          )}

          {/* Review CTA */}
          <Link href="/ai-review">
            <Card className="flex items-center gap-4 p-5 transition-colors hover:border-violet-300 hover:bg-violet-50/40 cursor-pointer">
              <div className="grid h-11 w-11 place-items-center rounded-xl bg-amber-100">
                <ClipboardCheck className="h-5 w-5 text-amber-700" />
              </div>
              <div className="flex-1">
                <div className="font-semibold">Review extracted petitions</div>
                <div className="text-sm text-muted-foreground">
                  {totalAwaiting > 0 ? `${totalAwaiting} petition(s) awaiting your review` : "Open the review queue to verify & approve into tickets"}
                </div>
              </div>
              {totalAwaiting > 0 && <span className="grid h-7 min-w-7 place-items-center rounded-full bg-amber-500 px-2 text-sm font-bold text-white">{totalAwaiting}</span>}
              <ArrowRight className="h-5 w-5 text-muted-foreground" />
            </Card>
          </Link>
        </div>
      </main>
    </>
  );
}

function BatchCard({ items }: { items: Row[] }) {
  const total = items.length;
  const c = items.reduce((a, u) => { a[u.status] = (a[u.status] || 0) + 1; return a; }, {} as Record<string, number>);
  const done = (c.AWAITING_REVIEW || 0) + (c.REVIEWED || 0);
  const failed = c.FAILED || 0;
  const active = (c.QUEUED || 0) + (c.PROCESSING || 0);
  const pct = Math.round(((done + failed) / total) * 100);
  const when = items[0]?.created_at ? new Date(items[0].created_at).toLocaleString("en-IN", { hour: "2-digit", minute: "2-digit", day: "numeric", month: "short" }) : "";
  const forced = items[0]?.forced_category;

  return (
    <Card className="p-4">
      <div className="mb-2 flex items-center justify-between text-sm">
        <div className="flex items-center gap-2 font-semibold">
          {active > 0 ? <Loader2 className="h-4 w-4 animate-spin text-blue-600" /> : <Check className="h-4 w-4 text-emerald-600" />}
          {total} file{total > 1 ? "s" : ""}
          {forced && <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-semibold text-violet-700">{forced.replace(/_/g, " ")}</span>}
        </div>
        <span className="text-xs text-muted-foreground">{when}</span>
      </div>
      <div className="mb-2 h-2 w-full overflow-hidden rounded-full bg-muted">
        <div className={cn("h-full rounded-full transition-all", failed && !active ? "bg-amber-500" : "bg-emerald-500")} style={{ width: `${pct}%` }} />
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] font-medium">
        <Stat icon={Clock}        n={c.QUEUED || 0}          label="Queued"   cls="text-slate-500" />
        <Stat icon={Loader2}      n={c.PROCESSING || 0}      label="Processing" cls="text-blue-600" spin />
        <Stat icon={AlertTriangle} n={c.AWAITING_REVIEW || 0} label="Ready"    cls="text-amber-600" />
        <Stat icon={Check}        n={c.REVIEWED || 0}        label="Reviewed" cls="text-emerald-600" />
        <Stat icon={X}            n={failed}                 label="Failed"   cls="text-red-600" />
      </div>
    </Card>
  );
}

function Stat({ icon: Icon, n, label, cls, spin }: { icon: React.ElementType; n: number; label: string; cls: string; spin?: boolean }) {
  if (!n) return null;
  return (
    <span className={cn("inline-flex items-center gap-1", cls)}>
      <Icon className={cn("h-3 w-3", spin && "animate-spin")} /> {n} {label}
    </span>
  );
}
