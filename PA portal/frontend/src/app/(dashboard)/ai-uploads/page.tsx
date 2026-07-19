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
import { CATEGORY_DISPLAY_EN, CATEGORY_DISPLAY_TA } from "@/lib/enums";

interface Row {
  id: number; batch_id: string; filename: string; status: string;
  name: string | null; created_at: string | null; forced_category: string | null;
}

interface Batch { id: string; items: Row[]; created: string; name: string }

const CATEGORIES = ["action_required","proposals","transfer_requests","pension_requests","school_admission","job_requests","rti","associations_unions","school_upgradation","invitation","greetings","general","other"];
const ACCEPT = /\.(pdf|jpe?g|png|webp|heic|heif|gif|bmp)$/i;
const AUTO = "__auto__";

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
  const [category, setCategory] = useState("");            // "" = Auto
  const [source, setSource] = useState("ai_scan");
  // DISABLED — see the commented duplicate filter in handleFiles() and the
  // hidden "Duplicate Handling" Select in the upload panel.
  // const [dupMode, setDupMode] = useState<"skip" | "allow">("skip");
  const [rows, setRows] = useState<Row[]>([]);
  const [showAll, setShowAll] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const folderRef = useRef<HTMLInputElement | null>(null);

  const catLabel = useCallback(
    (c: string) => (lang === "ta" ? CATEGORY_DISPLAY_TA : CATEGORY_DISPLAY_EN)[c] ?? c.replace(/_/g, " "),
    [lang],
  );

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
      if (category) fd.append("category", category);
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

  // Group rows into batches with a friendly per-day sequential name.
  const batches = useMemo<Batch[]>(() => {
    const map = new Map<string, Row[]>();
    for (const u of rows) {
      if (!map.has(u.batch_id)) map.set(u.batch_id, []);
      map.get(u.batch_id)!.push(u);
    }
    const list = [...map.entries()].map(([id, items]) => ({
      id, items,
      created: items.reduce<string>((min, r) => (r.created_at && (!min || r.created_at < min) ? r.created_at : min), ""),
    }));
    const asc = [...list].sort((a, b) => (a.created || "").localeCompare(b.created || ""));
    const perDay: Record<string, number> = {};
    const nameById: Record<string, string> = {};
    for (const b of asc) {
      const day = (b.created || "").slice(0, 10) || "batch";
      perDay[day] = (perDay[day] ?? 0) + 1;
      nameById[b.id] = `Batch_${day.replace(/-/g, "_")}_${String(perDay[day]).padStart(3, "0")}`;
    }
    return list
      .map(b => ({ ...b, name: nameById[b.id] }))
      .sort((a, b) => (b.created || "").localeCompare(a.created || ""));
  }, [rows]);

  const stats = useMemo(() => ({
    totalBatches: new Set(rows.map(r => r.batch_id)).size,
    totalFiles: rows.length,
    extracted: rows.filter(r => r.status === "AWAITING_REVIEW" || r.status === "REVIEWED").length,
    flagged: rows.filter(r => r.status === "FAILED").length,
  }), [rows]);

  const totalAwaiting = rows.filter(u => u.status === "AWAITING_REVIEW").length;
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
                      onDelete={() => setPendingDelete({ id: b.id, name: b.name, count: b.items.length })} />
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

              <label className="mb-1.5 mt-5 block text-sm font-semibold text-foreground">{t("uploads.categoryLabel")}</label>
              <Select value={category === "" ? AUTO : category} onValueChange={(v) => setCategory(v === AUTO ? "" : v)}>
                <SelectTrigger className={cn("h-11 rounded-xl text-sm", category && "border-brand/40 bg-brand/5 font-semibold text-brand")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={AUTO}>{t("uploads.categoryAuto")}</SelectItem>
                  {CATEGORIES.map((c) => <SelectItem key={c} value={c}>{catLabel(c)}</SelectItem>)}
                </SelectContent>
              </Select>
              <p className="mt-1.5 text-[13px] text-muted-foreground">
                {category ? t("uploads.categoryHelpForced") : t("uploads.categoryHelp")}
              </p>

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
  const items = batch.items;
  const total = items.length;
  const c = items.reduce((a, u) => { a[u.status] = (a[u.status] || 0) + 1; return a; }, {} as Record<string, number>);
  const extracted = (c.AWAITING_REVIEW || 0) + (c.REVIEWED || 0);
  const flagged = c.FAILED || 0;
  const active = (c.QUEUED || 0) + (c.PROCESSING || 0);
  const processed = extracted + flagged;
  const pct = total ? Math.round((processed / total) * 100) : 0;

  const state: "processing" | "issues" | "completed" =
    active > 0 ? "processing" : flagged > 0 ? "issues" : "completed";
  const when = batch.created
    ? new Date(batch.created).toLocaleString(lang === "ta" ? "ta-IN" : undefined, {
        day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
      })
    : "";
  const failedIds = items.filter(u => u.status === "FAILED").map(u => u.id);

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
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div className={cn("h-full rounded-full transition-all",
            state === "processing" ? "bg-blue-500" : state === "issues" ? "bg-amber-500" : "bg-emerald-500")}
            style={{ width: `${pct}%` }} />
        </div>
        <div className="mt-1 text-[12px] tabular-nums text-muted-foreground">
          {processed} / {total} {t("uploads.filesProcessed")}
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
            <Link href="/ai-review"><ClipboardCheck className="h-3.5 w-3.5" /> {t("uploads.openReview")}</Link>
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
