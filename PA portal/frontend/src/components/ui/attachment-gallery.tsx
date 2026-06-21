"use client";

import { useMemo, useState } from "react";
import { FileText, Film, Mic, Paperclip, ExternalLink, ImageIcon } from "lucide-react";
import { ImageLightbox } from "@/components/ui/image-lightbox";
import { cn } from "@/lib/utils";

export interface GalleryAttachment {
  name: string;
  url: string;
  type: "IMAGE" | "DOCUMENT" | "AUDIO" | "VIDEO";
}

interface AttachmentGalleryProps {
  attachments: GalleryAttachment[];
  audioTranscript?: string | null;
  className?: string;
}

/**
 * Unified attachment renderer:
 * - Images: thumbnail grid with click-to-zoom lightbox
 * - Audio: inline <audio> player with optional transcript pane
 * - Documents / Video: icon cards opening in a new tab
 */
export function AttachmentGallery({ attachments, audioTranscript, className }: AttachmentGalleryProps) {
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);

  const { images, audios, others } = useMemo(() => {
    const images = attachments.filter((a) => a.type === "IMAGE");
    const audios = attachments.filter((a) => a.type === "AUDIO");
    const others = attachments.filter((a) => a.type === "DOCUMENT" || a.type === "VIDEO");
    return { images, audios, others };
  }, [attachments]);

  if (attachments.length === 0) {
    return (
      <div className={cn("flex h-24 items-center justify-center rounded-xl border border-dashed border-border bg-card text-sm text-muted-foreground", className)}>
        <Paperclip className="mr-2 h-4 w-4" /> No files attached
      </div>
    );
  }

  return (
    <div className={cn("space-y-3", className)}>
      {/* Image grid */}
      {images.length > 0 && (
        <div>
          <SubHead>
            <ImageIcon className="h-3 w-3" /> Images ({images.length})
          </SubHead>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {images.map((a, i) => (
              <button
                key={a.url}
                onClick={() => setLightboxIdx(i)}
                className="group relative aspect-square overflow-hidden rounded-lg border border-border bg-muted transition hover:ring-2 hover:ring-brand/50"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={a.url} alt={a.name} className="h-full w-full object-cover transition group-hover:scale-105" />
                <div className="absolute inset-0 bg-black/0 transition group-hover:bg-black/20" />
                <div className="absolute bottom-1 right-1 hidden rounded bg-white/95 px-1.5 py-0.5 text-[10px] font-semibold text-slate-800 group-hover:block">
                  Zoom
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Audio + transcript */}
      {audios.length > 0 && (
        <div>
          <SubHead>
            <Mic className="h-3 w-3" /> Voice recording{audios.length > 1 ? "s" : ""}
          </SubHead>
          <div className="space-y-2">
            {audios.map((a) => (
              <div key={a.url} className="rounded-xl border border-border bg-card p-3 shadow-card">
                <audio controls preload="metadata" className="h-9 w-full">
                  <source src={a.url} />
                </audio>
                {audioTranscript && (
                  <details className="mt-2 group" open>
                    <summary className="flex cursor-pointer items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground hover:text-foreground">
                      Transcript
                    </summary>
                    <div className="mt-1.5 rounded-lg bg-muted/60 p-2.5">
                      <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-foreground/85">
                        {audioTranscript}
                      </p>
                    </div>
                  </details>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Other files */}
      {others.length > 0 && (
        <div>
          <SubHead>
            <Paperclip className="h-3 w-3" /> Other files ({others.length})
          </SubHead>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {others.map((a) => {
              const Icon = a.type === "DOCUMENT" ? FileText : Film;
              return (
                <a key={a.url} href={a.url} target="_blank" rel="noreferrer"
                   className="group flex items-center gap-2.5 rounded-lg border border-border bg-card p-2.5 transition hover:border-brand/40 hover:bg-accent">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-brand/10 text-brand">
                    <Icon className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-medium text-foreground">{a.name}</div>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{a.type}</div>
                  </div>
                  <ExternalLink className="h-3.5 w-3.5 text-muted-foreground opacity-0 transition group-hover:opacity-100" />
                </a>
              );
            })}
          </div>
        </div>
      )}

      <ImageLightbox
        open={lightboxIdx !== null}
        initialIndex={lightboxIdx ?? 0}
        images={images.map((a) => ({ url: a.url, name: a.name }))}
        onClose={() => setLightboxIdx(null)}
      />
    </div>
  );
}

function SubHead({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-1.5 inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
      {children}
    </div>
  );
}
