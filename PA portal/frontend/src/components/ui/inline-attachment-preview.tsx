"use client";

import { useEffect, useState } from "react";
import { FileText, Film, Mic, Paperclip, ImageIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { GalleryAttachment } from "@/components/ui/attachment-gallery";

interface InlineAttachmentPreviewProps {
  attachments: GalleryAttachment[];
  audioTranscript?: string | null;
  className?: string;
}

const TYPE_ICON = {
  IMAGE:    ImageIcon,
  DOCUMENT: FileText,
  VIDEO:    Film,
  AUDIO:    Mic,
} as const;

/**
 * Inline preview gallery:
 * - Horizontal scrollable thumbnail row at the top.
 * - Click a thumb → renders the full preview *inline below*, no popup, no new tab.
 * - Download disabled everywhere we can:
 *     · IMAGE: right-click + drag blocked.
 *     · AUDIO/VIDEO: controlsList="nodownload" + no PiP.
 *     · DOCUMENT: PDF viewer instructed to hide its toolbar (`#toolbar=0`)
 *       and rendered inside a sandboxed iframe so the page can't be saved
 *       through embedded controls. Non-PDF docs fall back to a static icon
 *       card (download routes are not exposed).
 *
 * Note: a determined user can always bypass with devtools — these guards
 * exist to make accidental / casual download out of reach for PA staff
 * looking at sensitive citizen attachments.
 */
export function InlineAttachmentPreview({ attachments, audioTranscript, className }: InlineAttachmentPreviewProps) {
  const [activeIdx, setActiveIdx] = useState<number>(0);

  // Reset selection when the attachment set changes (drawer row swap).
  useEffect(() => { setActiveIdx(0); }, [attachments]);

  if (attachments.length === 0) {
    return (
      <div className={cn("flex h-24 items-center justify-center rounded-xl border border-dashed border-border bg-card text-sm text-muted-foreground", className)}>
        <Paperclip className="mr-2 h-4 w-4" /> No files attached
      </div>
    );
  }

  const active = attachments[Math.min(activeIdx, attachments.length - 1)];

  return (
    <div className={cn("flex h-full flex-col gap-3", className)}>
      {/* Thumb strip */}
      <div className="flex flex-shrink-0 gap-2 overflow-x-auto pb-1">
        {attachments.map((a, i) => {
          const Icon = TYPE_ICON[a.type] ?? Paperclip;
          const isActive = i === activeIdx;
          return (
            <button
              key={a.url + i}
              onClick={() => setActiveIdx(i)}
              title={a.name}
              className={cn(
                "group relative flex h-20 w-20 flex-shrink-0 overflow-hidden rounded-lg border-2 bg-card transition",
                isActive
                  ? "border-brand shadow-card-md ring-2 ring-brand/30"
                  : "border-border hover:border-brand/40"
              )}
            >
              {a.type === "IMAGE" ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={a.url}
                  alt={a.name}
                  className="h-full w-full object-cover"
                  draggable={false}
                  onContextMenu={(e) => e.preventDefault()}
                />
              ) : (
                <div className="flex h-full w-full flex-col items-center justify-center gap-1 bg-muted/60 px-1 text-muted-foreground">
                  <Icon className="h-6 w-6" />
                  <span className="line-clamp-1 text-[10px] font-medium uppercase tracking-wider">
                    {a.type === "DOCUMENT" ? "Doc" : a.type === "VIDEO" ? "Video" : "Audio"}
                  </span>
                </div>
              )}
              <span className="absolute inset-x-0 bottom-0 truncate bg-black/50 px-1.5 py-0.5 text-[10px] font-medium text-white opacity-0 transition group-hover:opacity-100">
                {a.name}
              </span>
            </button>
          );
        })}
      </div>

      {/* Inline preview area */}
      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-card shadow-card">
        <div className="flex flex-shrink-0 items-center gap-2 border-b border-border bg-muted/40 px-3 py-2 text-[12px]">
          <Paperclip className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="truncate font-semibold text-foreground" title={active.name}>{active.name}</span>
          <span className="ml-auto rounded bg-background px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            {active.type}
          </span>
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-auto">
          <PreviewBody attachment={active} audioTranscript={audioTranscript} />
        </div>
      </div>
    </div>
  );
}

function PreviewBody({ attachment, audioTranscript }: { attachment: GalleryAttachment; audioTranscript?: string | null }) {
  if (attachment.type === "IMAGE") {
    return (
      <div
        className="flex h-full w-full items-center justify-center bg-black/[0.03] p-4"
        onContextMenu={(e) => e.preventDefault()}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={attachment.url}
          alt={attachment.name}
          className="max-h-full max-w-full select-none object-contain"
          draggable={false}
        />
      </div>
    );
  }

  if (attachment.type === "AUDIO") {
    return (
      <div className="flex h-full min-h-0 flex-col gap-3 p-4">
        <div className="flex flex-shrink-0 items-center gap-3 rounded-xl border border-border bg-muted/40 px-3 py-3">
          <span className="grid h-10 w-10 flex-shrink-0 place-items-center rounded-full bg-brand/10 text-brand">
            <Mic className="h-5 w-5" />
          </span>
          <audio
            controls
            controlsList="nodownload noplaybackrate"
            preload="metadata"
            className="h-10 min-w-0 flex-1"
            onContextMenu={(e) => e.preventDefault()}
          >
            <source src={attachment.url} />
          </audio>
        </div>
        {audioTranscript && (
          <div className="min-h-0 flex-1 overflow-y-auto rounded-lg bg-muted/60 p-3">
            <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Transcript</div>
            <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-foreground/85">{audioTranscript}</p>
          </div>
        )}
      </div>
    );
  }

  if (attachment.type === "VIDEO") {
    return (
      <div className="flex h-full w-full items-center justify-center bg-black p-2">
        <video
          controls
          controlsList="nodownload noplaybackrate"
          disablePictureInPicture
          preload="metadata"
          className="max-h-full max-w-full"
          onContextMenu={(e) => e.preventDefault()}
        >
          <source src={attachment.url} />
        </video>
      </div>
    );
  }

  // DOCUMENT — try inline iframe (Chrome PDF viewer respects #toolbar=0).
  const isPdf = /\.pdf(\?|$)/i.test(attachment.url) || /\.pdf$/i.test(attachment.name);
  if (isPdf) {
    return (
      <iframe
        src={`${attachment.url}#toolbar=0&navpanes=0`}
        title={attachment.name}
        className="h-full w-full"
        // sandbox excludes 'allow-downloads' so the embedded viewer can't
        // trigger a save dialog through its built-in controls.
        sandbox="allow-same-origin allow-scripts"
      />
    );
  }

  // Non-PDF documents — render an info card with no link out.
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
      <div className="grid h-14 w-14 place-items-center rounded-xl bg-brand/10 text-brand">
        <FileText className="h-7 w-7" />
      </div>
      <div className="text-sm font-semibold text-foreground">{attachment.name}</div>
      <div className="text-xs text-muted-foreground">
        Inline preview isn't available for this document format.
      </div>
    </div>
  );
}
