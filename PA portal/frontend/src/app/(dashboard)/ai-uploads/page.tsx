"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import Link from "next/link";
import {
  Sparkles, UploadCloud, Loader2, FolderUp, Files, Check, CheckCircle2,
  AlertTriangle, MoreVertical, Layers, Tag, ClipboardCheck, FileText,
  FileCheck2, Flag, ArrowRight, RefreshCw, Mail, Landmark, ScanLine, Trash2,
} from "lucide-react";
import { toast } from "sonner";

import TopBar from "@/components/TopBar";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { useLang } from "@/lib/lang-context";
import { cn } from "@/lib/utils";

type StatusKey = "QUEUED" | "PROCESSING" | "AWAITING_REVIEW" | "REVIEWED" | "FAILED" | "DISMISSED";

interface Batch {
  id: string;
  name: string;
  earliest_created_at: string | null;
  counts: Record<StatusKey, number>;
  failed_ids: number[];
}

interface BatchesPayload {
  batches: Batch[];
  totals: {
    batches: number;
    files: number;
    extracted: number;
    flagged: number;
    awaiting_review: number;
  };
}

const EMPTY_TOTALS: BatchesPayload["totals"] = {
  batches: 0, files: 0, extracted: 0, flagged: 0, awaiting_review: 0,
};

const ACCEPT = /\.(pdf|jpe?g|png|webp|heic|heif|gif|bmp)$/i;

const FEATURES = [
  { icon: Sparkles,       tTitle: "uploads.feat1Title", tDesc: "uploads.feat1Desc" },
  { icon: Layers,         tTitle: "uploads.feat2Title", tDesc: "uploads.feat2Desc" },
  { icon: Tag,            tTitle: "uploads.feat3Title", tDesc: "uploads.feat3Desc" },
  { icon: ClipboardCheck, tTitle: "uploads.feat4Title", tDesc: "uploads.feat4Desc" },
];

const GUIDES = ["uploads.guide1", "uploads.guide2", "uploads.guide3", "uploads.guide4"];

export default function AiUploadsPage() {
  const { t, lang } = useLang();
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [source, setSource] = useState("ai_scan");
  // DISABLED — see the commented duplicate filter in handleFiles() and the
  // hidden "Duplicate Handling" Select in the upload panel.
  // const [dupMode, setDupMode] = useState<"skip" | "allow">("skip");
  const [batches, setBatches] = useState<Batch[]>([]);
  const [totals, setTotals] = useState<BatchesPayload["totals"]>(EMPTY_TOTALS);
  const [showAll, setShowAll] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const folderRef = useRef<HTMLInputElement | null>(null);

  // Pulls pre-aggregated batches from the server. Old code fetched the full
  // /api/ai-uploads list (all 3k+ rows every load) and derived batches on the
  // client — that endpoint is now paginated and this page only ever cared
  // about the batch view, so it goes straight to /batches.
  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/ai-uploads/batches", { credentials: "include" });
      const d: BatchesPayload = await r.json();
      if (Array.isArray(d.batches)) setBatches(d.batches);
      if (d.totals) setTotals(d.totals);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const active = batches.some(b => (b.counts.QUEUED || 0) > 0 || (b.counts.PROCESSING || 0) > 0);
    if (!active) return;
    const id = setInterval(load, 3000);
    return () => clearInterval(id);
  }, [batches, load]);

  // make the folder input pick directories
  useEffect(() => {
    if (folderRef.current) {
      folderRef.current.setAttribute("webkitdirectory", "");
      folderRef.current.setAttribute("directory", "");
    }
  }, []);

  const retry = useCallback(async (ids: number[]) => {
    if (!ids.length) return;
    try {
      const r = await fetch("/api/ai-uploads/retry", {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify({ ids }),
      });
      if (r.ok) { toast.success(`${ids.length} re-queued`); load(); }
      else toast.error("Retry failed");
    } catch { toast.error("Network error"); }
  }, [load]);

  // Batch delete — soft-guarded by a confirm dialog so accidental clicks
  // on the dropdown don't nuke a folder. The backend refuses if any row
  // is REVIEWED (would 404 the appointment's attachments); surface that
  // message directly in a toast.
  const [pendingDelete, setPendingDelete] = useState<{ id: string; name: string; count: number } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const confirmDelete = useCallback(async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      const r = await fetch(`/api/ai-uploads/batch/${encodeURIComponent(pendingDelete.id)}`, {
        method: "DELETE", credentials: "include",
      });
      const body = await r.json().catch(() => ({}));
      if (r.ok) {
        toast.success(`${pendingDelete.name} deleted`, {
          description: `${body.deleted ?? 0} file(s) removed from storage.`,
        });
        setPendingDelete(null);
        load();
      } else {
        toast.error(body.error || "Delete failed");
      }
    } catch { toast.error("Network error"); }
    finally { setDeleting(false); }
  }, [pendingDelete, load]);

  // Upload in small chunks (concurrency-limited) under one shared batch id, so a
  // folder of hundreds of files streams in as many small requests instead of one
  // huge body that would blow memory / time out.
  async function handleFiles(fileList: FileList | File[]) {
    let arr = Array.from(fileList).filter(f => ACCEPT.test(f.name));
    if (!arr.length) { toast.error("No PDF/image files found"); return; }

    // DISABLED — client-side duplicate handling.
    // Matched on filename only, which blocked legitimate re-uploads: scanner
    // output reuses names (scan001.pdf), and a file that failed processing
    // could never be sent again. The backend has no dedup, so nothing filters
    // duplicates now — every selected file is uploaded.
    // To re-enable, restore this block plus the dupMode state and the
    // "Duplicate Handling" Select below. Prefer hashing the bytes over
    // comparing names if it comes back.
    // if (dupMode === "skip") {
    //   const existing = new Set(rows.map(r => r.filename.toLowerCase()));
    //   const seen = new Set<string>();
    //   const before = arr.length;
    //   arr = arr.filter(f => {
    //     const k = f.name.toLowerCase();
    //     if (existing.has(k) || seen.has(k)) return false;
    //     seen.add(k); return true;
    //   });
    //   const skipped = before - arr.length;
    //   if (skipped) toast.info(`${skipped} duplicate file(s) skipped`);
    //   if (!arr.length) { toast.error("All files were duplicates — nothing to upload"); return; }
    // }

    const batchId = (crypto.randomUUID?.() ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`);
    const CHUNK = 6, CONCURRENCY = 2;
    const chunks: File[][] = [];
    for (let i = 0; i < arr.length; i += CHUNK) chunks.push(arr.slice(i, i + CHUNK));

    setUploading(true);
    setProgress({ done: 0, total: arr.length });
    let ok = 0, bad = 0, idx = 0;

    const sendChunk = async (chunk: File[]) => {
      const fd = new FormData();
      chunk.forEach(f => fd.append("files", f));
      fd.append("batch_id", batchId);
      fd.append("source", source);
      try {
        const r = await fetch("/api/ai-uploads/upload", { method: "POST", body: fd, credentials: "include" });
        if (!r.ok) throw new Error();
        ok += chunk.length;
      } catch { bad += chunk.length; }
      setProgress({ done: ok + bad, total: arr.length });
      load();
    };
    const worker = async () => { while (idx < chunks.length) await sendChunk(chunks[idx++]); };

    try {
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, chunks.length) }, worker));
      if (bad) toast.error(`${bad} file(s) failed to upload`, { description: ok ? `${ok} queued.` : undefined });
      else toast.success(`${ok} file(s) queued`, { description: "Processing one by one — watch the batches below." });
    } finally {
      setUploading(false); setProgress(null);
      if (fileRef.current) fileRef.current.value = "";
      if (folderRef.current) folderRef.current.value = "";
      load();
    }
  }

  // Batches + totals now arrive pre-aggregated from the server. The old
  // useMemo on the full row list has moved into ai_upload_service.list_batches.
  const stats = useMemo(() => ({
    totalBatches: totals.batches,
    totalFiles:   totals.files,
    extracted:    totals.extracted,
    flagged:      totals.flagged,
  }), [totals]);

  const totalAwaiting = totals.awaiting_review;
  const shownBatches = showAll ? batches : batches.slice(0, 4);

  return (
    <>
      <TopBar
        title={t("uploads.title")}
        subtitle={t("uploads.topSubtitle")}
        icon={<Sparkles className="h-5 w-5" />}
      />
      <main className="flex-1 overflow-y-auto bg-background">
        <div className="grid gap-4 px-4 py-6 animate-in-up lg:grid-cols-[minmax(0,1fr)_360px]">
          {/* Left — features · dropzone · batches */}
          <div className="flex min-w-0 flex-col gap-4">
            <p className="text-sm text-muted-foreground">{t("uploads.subtitle")}</p>

            {/* Feature strip */}
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              {FEATURES.map((f) => (
                <Card key={f.tTitle} className="flex flex-col gap-2 p-4 shadow-card">
                  <span className="grid h-9 w-9 place-items-center rounded-xl bg-accent text-brand">
                    <f.icon className="h-4 w-4" />
                  </span>
                  <div className="text-sm font-semibold text-foreground">{t(f.tTitle)}</div>
                  <div className="text-[13px] leading-snug text-muted-foreground">{t(f.tDesc)}</div>
                </Card>
              ))}
            </div>

            {/* Dropzone */}
            <Card
              onDragOver={e => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={e => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files); }}
              className={cn(
                "flex flex-col items-center justify-center gap-3 border-2 border-dashed p-10 text-center transition-colors",
                dragOver ? "border-brand bg-accent/60" : "border-[#D9D2F0]",
              )}
            >
              <input ref={fileRef} type="file" multiple accept=".pdf,image/*" className="hidden"
                onChange={e => e.target.files && handleFiles(e.target.files)} />
              <input ref={folderRef} type="file" multiple className="hidden"
                onChange={e => e.target.files && handleFiles(e.target.files)} />
              <div className="grid h-16 w-16 place-items-center rounded-2xl bg-accent">
                {uploading ? <Loader2 className="h-7 w-7 animate-spin text-brand" /> : <UploadCloud className="h-7 w-7 text-brand" />}
              </div>
              <div className="text-lg font-semibold text-foreground">
                {uploading
                  ? (progress ? `${t("uploads.uploading")} ${progress.done}/${progress.total}…` : `${t("uploads.uploading")}…`)
                  : t("uploads.dropHere")}
              </div>
              {!uploading && <div className="text-sm text-muted-foreground">{t("uploads.or")}</div>}
              <div className="flex flex-wrap justify-center gap-2">
                <Button variant="outline" className="rounded-xl" onClick={() => fileRef.current?.click()} disabled={uploading}>
                  <Files className="mr-1.5 h-4 w-4 text-brand" /> {t("uploads.selectFiles")}
                </Button>
                <Button variant="outline" className="rounded-xl" onClick={() => folderRef.current?.click()} disabled={uploading}>
                  <FolderUp className="mr-1.5 h-4 w-4 text-brand" /> {t("uploads.selectFolder")}
                </Button>
              </div>
              <div className="text-xs text-muted-foreground">{t("uploads.formats")}</div>
            </Card>

            {/* Recent batches */}
            <Card className="p-5 shadow-card-md">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="type-card-heading text-foreground">{t("uploads.recentBatches")}</h3>
                <Link href="/ai-review" className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-brand hover:underline">
                  {t("uploads.reviewQueue")}
                  {totalAwaiting > 0 && (
                    <span className="grid h-5 min-w-[20px] place-items-center rounded-full bg-brand px-1 text-[11px] font-bold text-brand-foreground">{totalAwaiting}</span>
                  )}
                </Link>
              </div>

              {batches.length === 0 ? (
                <div className="grid place-items-center gap-2 py-10 text-center text-sm text-muted-foreground">
                  <UploadCloud className="h-9 w-9 text-muted-foreground/30" />
                  {t("uploads.noBatches")}
                </div>
              ) : (
                <div className="flex flex-col divide-y divide-border">
                  {shownBatches.map((b) => (
                    <BatchRow key={b.id} batch={b} t={t} lang={lang} onRetry={retry}
                      onDelete={() => setPendingDelete({
                        id: b.id, name: b.name,
                        count: Object.values(b.counts).reduce((a, n) => a + n, 0),
                      })} />
                  ))}
                </div>
              )}

              {batches.length > 4 && (
                <button
                  onClick={() => setShowAll((s) => !s)}
                  className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg py-2 text-[13px] font-semibold text-brand transition-colors hover:bg-accent/60"
                >
                  {showAll ? t("uploads.showLess") : t("uploads.viewAll")}
                  <ArrowRight className={cn("h-3.5 w-3.5 transition-transform", showAll && "rotate-90")} />
                </button>
              )}
            </Card>
          </div>

          {/* Right rail — settings · summary · guidelines */}
          <aside className="flex flex-col gap-4">
            {/* Upload settings */}
            <Card className="p-5 shadow-card-md">
              <h3 className="type-card-heading mb-4 flex items-center gap-2 text-foreground">
                <Sparkles className="h-4 w-4 text-brand" /> {t("uploads.settings")}
              </h3>

              <label className="mb-1.5 block text-sm font-semibold text-foreground">{t("uploads.sourceLabel")}</label>
              <div className="grid grid-cols-1 gap-1.5">
                {[
                  { key: "ai_scan",   Icon: ScanLine, label: t("petition.sourceScanned") },
                  { key: "postal",    Icon: Mail,     label: t("petition.sourcePostal") },
                  { key: "cm_office", Icon: Landmark, label: t("petition.sourceCmOffice") },
                ].map(({ key, Icon, label }) => (
                  <button
                    key={key}
                    onClick={() => setSource(key)}
                    className={cn(
                      "flex items-center gap-2.5 rounded-xl border px-3 py-2 text-[13px] font-medium transition-colors text-left",
                      source === key
                        ? "border-brand/40 bg-brand/5 text-brand"
                        : "border-border bg-card text-foreground hover:bg-muted",
                    )}
                  >
                    <Icon className="h-3.5 w-3.5 shrink-0" />
                    {label}
                    {source === key && <Check className="ml-auto h-3.5 w-3.5" />}
                  </button>
                ))}
              </div>
              <p className="mt-1.5 text-[13px] text-muted-foreground">{t("uploads.sourceHelp")}</p>

              {/* Category selector removed — the AI's detected category is always
                  used. The batch override is no longer offered, so uploads send
                  no `category` and the backend classifies each file on its own. */}

              {/* DISABLED — "Duplicate Handling" control. Name-based skipping
                  blocked legitimate re-uploads, so the filter is commented out
                  in handleFiles() above and this option is hidden. Restore both
                  together (the uploads.dup* translation keys are still in place).
              <label className="mb-1.5 mt-5 block text-sm font-semibold text-foreground">{t("uploads.dupLabel")}</label>
              <Select value={dupMode} onValueChange={(v) => setDupMode(v as "skip" | "allow")}>
                <SelectTrigger className="h-11 rounded-xl text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="skip">{t("uploads.dupSkip")}</SelectItem>
                  <SelectItem value="allow">{t("uploads.dupAllow")}</SelectItem>
                </SelectContent>
              </Select>
              <p className="mt-1.5 text-[13px] text-muted-foreground">
                {dupMode === "skip" ? t("uploads.dupHelp") : t("uploads.dupHelpAllow")}
              </p>
              */}

              <div className="mt-4 flex items-start gap-2 rounded-xl bg-accent/60 p-3 text-[13px] text-brand">
                <Sparkles className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{t("uploads.tip")}</span>
              </div>
            </Card>

            {/* Batch summary */}
            <Card className="p-5 shadow-card-md">
              <h3 className="type-card-heading mb-4 flex items-center gap-2 text-foreground">
                <Layers className="h-4 w-4 text-brand" /> {t("uploads.summary")}
              </h3>
              <div className="flex flex-col gap-2.5">
                <SummaryRow icon={Layers}     tint="bg-accent text-brand"          label={t("uploads.totalBatches")}   value={stats.totalBatches} />
                <SummaryRow icon={FileText}   tint="bg-sky-100 text-sky-700"       label={t("uploads.totalFiles")}     value={stats.totalFiles} />
                <SummaryRow icon={FileCheck2} tint="bg-emerald-100 text-emerald-700" label={t("uploads.totalExtracted")} value={stats.extracted} />
                <SummaryRow icon={Flag}       tint="bg-amber-100 text-amber-700"   label={t("uploads.totalFlagged")}   value={stats.flagged} />
              </div>
            </Card>

            {/* Processing guidelines */}
            <Card className="p-5 shadow-card-md">
              <h3 className="type-card-heading mb-4 text-foreground">{t("uploads.guidelines")}</h3>
              <ul className="flex flex-col gap-2.5">
                {GUIDES.map((g) => (
                  <li key={g} className="flex items-start gap-2.5 text-sm text-foreground/85">
                    <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-emerald-100 text-emerald-600">
                      <Check className="h-3 w-3" />
                    </span>
                    {t(g)}
                  </li>
                ))}
              </ul>
            </Card>
          </aside>
        </div>
      </main>

      {/* Batch delete confirmation. The backend refuses if any row in the
          batch is already REVIEWED (would break the appointment's
          attachments), so the dialog copy makes the destructive intent
          explicit — this purges the DB rows AND the underlying files. */}
      <Dialog open={pendingDelete !== null} onOpenChange={(o) => { if (!o) setPendingDelete(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <Trash2 className="h-4 w-4" />
              {t("uploads.deleteConfirmTitle")}
            </DialogTitle>
            <DialogDescription>
              {t("uploads.deleteConfirmBody")
                .replace("{name}", pendingDelete?.name ?? "")
                .replace("{count}", String(pendingDelete?.count ?? 0))}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="ghost" onClick={() => setPendingDelete(null)} disabled={deleting}>
              {t("uploads.no")}
            </Button>
            <Button
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90 !bg-none"
              onClick={confirmDelete}
              disabled={deleting}
            >
              {deleting
                ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> {t("uploads.deleting")}</>
                : <><Trash2 className="mr-2 h-4 w-4" /> {t("uploads.yesDelete")}</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/* ── Local components ─────────────────────────────────────────────────── */

function BatchRow({ batch, t, lang, onRetry, onDelete }: {
  batch: Batch; t: (k: string) => string; lang: string;
  onRetry: (ids: number[]) => void;
  onDelete: () => void;
}) {
  const c = batch.counts;
  const total = Object.values(c).reduce((a, n) => a + n, 0);
  // DISMISSED counts as extracted: the file was processed and then reviewed
  // (courtesy audio, blank scan, duplicate). Omitting it left the batch stuck
  // at e.g. "3 / 5 processed" with nothing left running.
  const extracted = (c.AWAITING_REVIEW || 0) + (c.REVIEWED || 0) + (c.DISMISSED || 0);
  const flagged = c.FAILED || 0;
  const active = (c.QUEUED || 0) + (c.PROCESSING || 0);
  const processed = extracted + flagged;

  const state: "processing" | "issues" | "completed" =
    active > 0 ? "processing" : flagged > 0 ? "issues" : "completed";
  const when = batch.earliest_created_at
    ? new Date(batch.earliest_created_at).toLocaleString(lang === "ta" ? "ta-IN" : undefined, {
        day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
      })
    : "";
  const failedIds = batch.failed_ids;

  const badge = {
    processing: { label: t("uploads.stProcessing"), cls: "bg-blue-100 text-blue-700", Icon: Loader2,      iconTint: "bg-blue-100 text-blue-600" },
    issues:     { label: t("uploads.stIssues"),     cls: "bg-amber-100 text-amber-700", Icon: AlertTriangle, iconTint: "bg-amber-100 text-amber-600" },
    completed:  { label: t("uploads.stCompleted"),  cls: "bg-emerald-100 text-emerald-700", Icon: CheckCircle2, iconTint: "bg-emerald-100 text-emerald-600" },
  }[state];

  return (
    <div className="flex items-center gap-3 py-3.5">
      <span className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-xl", badge.iconTint)}>
        <badge.Icon className={cn("h-5 w-5", state === "processing" && "animate-spin")} />
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate font-mono text-sm font-semibold text-foreground">{batch.name}</span>
          <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", badge.cls)}>{badge.label}</span>
        </div>
        <div className="mt-0.5 text-[13px] text-muted-foreground">{t("uploads.uploadedOn")} {when}</div>
        {/* Segmented bar: green = successfully extracted, red = failed. A batch
            with one failure now reads "80% done, 20% failed" instead of the
            whole bar turning amber. The muted track behind is still-processing. */}
        <div className="mt-2 flex h-1.5 w-full overflow-hidden rounded-full bg-muted">
          {extracted > 0 && (
            <div className="h-full bg-emerald-500 transition-all" style={{ width: `${(extracted / total) * 100}%` }} />
          )}
          {flagged > 0 && (
            <div className="h-full bg-red-500 transition-all" style={{ width: `${(flagged / total) * 100}%` }} />
          )}
        </div>
        <div className="mt-1 text-[12px] tabular-nums text-muted-foreground">
          {processed} / {total} {t("uploads.filesProcessed")}
          {flagged > 0 && <span className="ml-1.5 font-semibold text-red-600">· {flagged} {t("uploads.flagged")}</span>}
        </div>
      </div>

      <div className="hidden shrink-0 items-center gap-5 sm:flex">
        <BatchStat icon={FileCheck2} value={extracted} label={t("uploads.extracted")} cls="text-emerald-600" />
        <BatchStat icon={Flag}       value={flagged}   label={t("uploads.flagged")}   cls={flagged ? "text-amber-600" : "text-muted-foreground"} />
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button aria-label={batch.name}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-muted-foreground/60 transition-colors hover:bg-muted hover:text-foreground">
            <MoreVertical className="h-4 w-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          {failedIds.length > 0 && (
            <DropdownMenuItem onSelect={() => onRetry(failedIds)}>
              <RefreshCw className="h-3.5 w-3.5" /> {t("uploads.retryFailed")} ({failedIds.length})
            </DropdownMenuItem>
          )}
          <DropdownMenuItem asChild>
            {/* Carry the batch so Review opens scoped to just these files —
                without it the queue opened unfiltered and looked "wrong". */}
            <Link href={`/ai-review?batch=${encodeURIComponent(batch.id)}`}>
              <ClipboardCheck className="h-3.5 w-3.5" /> {t("uploads.openReview")}
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={onDelete}
            className="text-destructive focus:bg-destructive/10 focus:text-destructive"
          >
            <Trash2 className="h-3.5 w-3.5" /> {t("uploads.deleteBatch")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function BatchStat({ icon: Icon, value, label, cls }: { icon: React.ElementType; value: number; label: string; cls: string }) {
  return (
    <div className="flex items-center gap-2">
      <Icon className={cn("h-4 w-4", cls)} />
      <div className="leading-tight">
        <div className={cn("text-sm font-bold tabular-nums", cls)}>{value}</div>
        <div className="text-[11px] text-muted-foreground">{label}</div>
      </div>
    </div>
  );
}

function SummaryRow({ icon: Icon, tint, label, value }: { icon: React.ElementType; tint: string; label: string; value: number }) {
  return (
    <div className="flex items-center gap-3">
      <span className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-xl", tint)}>
        <Icon className="h-4 w-4" />
      </span>
      <span className="flex-1 text-sm text-muted-foreground">{label}</span>
      <span className="font-mono text-lg font-bold tabular-nums text-foreground">{value.toLocaleString()}</span>
    </div>
  );
}
