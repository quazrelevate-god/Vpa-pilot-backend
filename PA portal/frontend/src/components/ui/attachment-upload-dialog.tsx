"use client";

// Shared "upload → preview + comment → Save" dialog for petition review and
// ticket detail. Stages files in memory (with revocable object URLs for
// image thumbnails) and hands the whole batch to the parent's onSave
// handler in one shot. The parent is responsible for the actual network
// calls — this component doesn't know about the backend, so the same
// dialog can drive appointments' /attachment + /comment endpoints and
// tickets' equivalents without change.
//
// Limits are duplicated from the backend intentionally so a rejection is
// caught client-side before the user waits for a round-trip. If the backend
// limits change (see dashboard_service._ATTACH_MAX_BYTES /
// _ATTACH_ALLOWED_MIMES), mirror them here too.

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Loader2, Upload, X, FileText } from "lucide-react";

import { cn } from "@/lib/utils";
import { useLang } from "@/lib/lang-context";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

const MAX_BYTES = 5 * 1024 * 1024;
const ACCEPT_MIMES = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
const ACCEPT_ATTR = ACCEPT_MIMES.join(",");

type Staged = {
  file: File;
  previewUrl: string | null; // object URL for images; null for PDFs
};

export default function AttachmentUploadDialog({
  open,
  onOpenChange,
  onSave,
  busy = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Parent handles the actual POSTs (attachment uploads + optional comment)
   * and closes the dialog on success. Files is guaranteed non-empty;
   * comment may be empty. Throw to keep the dialog open with the staged
   * files intact (retry path).
   */
  onSave: (files: File[], comment: string) => Promise<void> | void;
  /** Parent-controlled: disables all inputs + save while a POST is in flight. */
  busy?: boolean;
}) {
  const { t } = useLang();
  const [staged, setStaged] = useState<Staged[]>([]);
  const [comment, setComment] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Reset state whenever the dialog closes (revoke object URLs so we don't
  // leak them across dialog opens on the same page).
  useEffect(() => {
    if (open) return;
    setStaged((prev) => {
      prev.forEach((s) => {
        if (s.previewUrl) URL.revokeObjectURL(s.previewUrl);
      });
      return [];
    });
    setComment("");
    setDragOver(false);
  }, [open]);

  const addFiles = useCallback(
    (files: FileList | File[]) => {
      const accepted: Staged[] = [];
      for (const f of Array.from(files)) {
        if (!ACCEPT_MIMES.includes(f.type)) {
          toast.error(t("attach.badType"), { description: f.name });
          continue;
        }
        if (f.size > MAX_BYTES) {
          toast.error(t("attach.tooLarge"), { description: f.name });
          continue;
        }
        const previewUrl = f.type.startsWith("image/")
          ? URL.createObjectURL(f)
          : null;
        accepted.push({ file: f, previewUrl });
      }
      if (accepted.length) setStaged((prev) => [...prev, ...accepted]);
    },
    [t],
  );

  const removeStaged = (idx: number) => {
    setStaged((prev) => {
      const s = prev[idx];
      if (s?.previewUrl) URL.revokeObjectURL(s.previewUrl);
      return prev.filter((_, i) => i !== idx);
    });
  };

  const canSave = staged.length > 0 && !busy;

  async function handleSave() {
    if (!canSave) return;
    try {
      await onSave(staged.map((s) => s.file), comment.trim());
      // Parent closes on success — no local close so a thrown error keeps
      // the staged files visible for retry.
    } catch {
      // Parent already surfaced the error via toast; keep the dialog open.
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        // Don't let backdrop-click dismiss mid-upload.
        if (busy) return;
        onOpenChange(o);
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("attach.dialogTitle")}</DialogTitle>
        </DialogHeader>

        {/* Dropzone / click-to-browse */}
        <div
          role="button"
          tabIndex={0}
          className={cn(
            "flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-lg border-2 border-dashed p-6 text-center transition-colors",
            dragOver
              ? "border-brand bg-brand/5"
              : "border-border hover:border-brand/60 hover:bg-muted/40",
            busy && "pointer-events-none opacity-60",
          )}
          onClick={() => inputRef.current?.click()}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              inputRef.current?.click();
            }
          }}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
          }}
        >
          <Upload className="h-6 w-6 text-muted-foreground" />
          <div className="text-sm text-muted-foreground">
            {t("attach.dropzoneHint")}
          </div>
          <div className="text-[11px] text-muted-foreground/70">
            {t("attach.formatHint")}
          </div>
          <input
            ref={inputRef}
            type="file"
            className="hidden"
            multiple
            accept={ACCEPT_ATTR}
            onChange={(e) => {
              if (e.target.files) addFiles(e.target.files);
              e.target.value = ""; // let re-picking the same file trigger onChange again
            }}
          />
        </div>

        {/* Staged files */}
        {staged.length > 0 && (
          <div className="max-h-48 space-y-1.5 overflow-y-auto">
            {staged.map((s, i) => (
              <div
                key={i}
                className="flex items-center gap-3 rounded-md border border-border bg-muted/30 p-2"
              >
                <div className="grid h-10 w-10 flex-shrink-0 place-items-center overflow-hidden rounded bg-muted">
                  {s.previewUrl ? (
                    <img
                      src={s.previewUrl}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <FileText className="h-5 w-5 text-muted-foreground" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">
                    {s.file.name}
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    {(s.file.size / 1024).toFixed(1)} KB
                  </div>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-7 w-7 shrink-0 p-0 text-muted-foreground hover:text-destructive"
                  onClick={() => removeStaged(i)}
                  disabled={busy}
                  aria-label={t("attach.remove")}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        )}

        {/* Comment (optional) */}
        <div className="space-y-1.5">
          <label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
            {t("attach.commentLabel")}
          </label>
          <Textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder={t("attach.commentPlaceholder")}
            rows={3}
            disabled={busy}
            className="resize-none"
          />
        </div>

        {/* Footer — cancel style mirrors the review drawer's edit-mode cancel */}
        <div className="flex justify-end gap-2 pt-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={busy}
            className="border-dashed border-destructive/60 text-destructive transition-all hover:-translate-y-0.5 hover:border-destructive hover:bg-destructive/10 hover:text-destructive hover:shadow-sm"
          >
            <X className="mr-1.5 h-3.5 w-3.5" /> {t("attach.cancel")}
          </Button>
          <Button size="sm" onClick={handleSave} disabled={!canSave}>
            {busy ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : null}
            {t("attach.save")}
            {staged.length > 0 ? ` (${staged.length})` : ""}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
