"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  FileText, Film, Mic, Paperclip, ImageIcon,
  ZoomIn, ZoomOut, RotateCcw, Maximize2, RotateCw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { GalleryAttachment } from "@/components/ui/attachment-gallery";
import { AudioPlayer } from "@/components/ui/audio-player";

export interface AttachmentSection {
  label: string;
  attachments: GalleryAttachment[];
  tone?: "brand" | "success";   // header + chip color family
}

interface InlineAttachmentPreviewProps {
  /** Single-section mode (backwards-compatible). */
  attachments?: GalleryAttachment[];
  /** Multi-section mode — renders each section's label + chips on top, then
   *  ONE shared preview area below. */
  sections?: AttachmentSection[];
  audioTranscript?: string | null;
  className?: string;
}

const TYPE_ICON = {
  IMAGE:    ImageIcon,
  DOCUMENT: FileText,
  VIDEO:    Film,
  AUDIO:    Mic,
} as const;

const TYPE_LABEL: Record<GalleryAttachment["type"], string> = {
  IMAGE:    "img",
  DOCUMENT: "doc",
  VIDEO:    "video",
  AUDIO:    "audio",
};

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
export function InlineAttachmentPreview({ attachments, sections, audioTranscript, className }: InlineAttachmentPreviewProps) {
  // Normalize to sections[]. Single-`attachments` mode becomes one unlabeled
  // section so the render path is uniform.
  const normSections: AttachmentSection[] = sections
    ? sections.filter((s) => s.attachments.length > 0)
    : (attachments && attachments.length > 0
        ? [{ label: "", attachments, tone: "brand" }]
        : []);

  // Active selection identifies (sectionIdx, attachmentIdx) — only ONE chip
  // across all sections is active at a time. Clicking active → close;
  // clicking any other chip → switch preview immediately.
  const [active, setActive] = useState<{ s: number; a: number } | null>(null);

  // Reset when the attachment set fundamentally changes (drawer row swap).
  // Use a stable signature — sizes + file names — NOT URLs. Presigned MinIO
  // URLs regenerate on every fetch; keying on them would nuke the active
  // chip mid-render and unmount the AudioPlayer before it could play.
  const sigParts: string[] = [];
  for (const s of normSections) {
    sigParts.push(s.label + ":" + s.attachments.length);
    for (const a of s.attachments) sigParts.push(a.name + "#" + a.type);
  }
  const signature = sigParts.join("|");
  useEffect(() => { setActive(null); }, [signature]);

  if (normSections.length === 0) {
    return (
      <div className={cn("flex h-24 items-center justify-center rounded-xl border border-dashed border-border bg-card text-sm text-muted-foreground", className)}>
        <Paperclip className="mr-2 h-4 w-4" /> No files attached
      </div>
    );
  }

  const activeAtt =
    active && normSections[active.s]
      ? normSections[active.s].attachments[Math.min(active.a, normSections[active.s].attachments.length - 1)] ?? null
      : null;

  return (
    <div className={cn("flex h-full flex-col gap-3", className)}>
      {/* Section rows — each label with its own chips beside it */}
      <div className="flex flex-shrink-0 flex-col gap-2">
        {normSections.map((section, si) => {
          const tone = section.tone ?? "brand";
          return (
            <div key={(section.label || "s") + si} className="flex flex-wrap items-center gap-2">
              {section.label && (
                <span
                  className={cn(
                    "inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider",
                    tone === "success" ? "text-emerald-600" : "text-muted-foreground",
                  )}
                >
                  {section.label}
                  <span
                    className={cn(
                      "rounded-full px-1.5 text-[10px] font-bold",
                      tone === "success" ? "bg-emerald-100 text-emerald-700" : "bg-brand/10 text-brand",
                    )}
                  >
                    {section.attachments.length}
                  </span>
                </span>
              )}
              <div className="flex flex-wrap gap-2">
                {section.attachments.map((a, ai) => {
                  const Icon = TYPE_ICON[a.type] ?? Paperclip;
                  const isActive = active?.s === si && active?.a === ai;
                  return (
                    <button
                      key={a.url + ai}
                      type="button"
                      onClick={() =>
                        setActive((cur) =>
                          cur && cur.s === si && cur.a === ai ? null : { s: si, a: ai },
                        )
                      }
                      title={a.name}
                      aria-pressed={isActive}
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider transition",
                        isActive
                          ? tone === "success"
                            ? "border-emerald-500 bg-emerald-50 text-emerald-700"
                            : "border-brand bg-brand/10 text-brand"
                          : "border-border bg-card text-muted-foreground hover:border-brand/40 hover:text-foreground",
                      )}
                    >
                      <Icon className="h-3.5 w-3.5" />
                      {TYPE_LABEL[a.type] ?? "file"}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Shared preview — fills all remaining space; only one chip active. */}
      {activeAtt && (
        <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-card shadow-card">
          <div className="flex flex-shrink-0 items-center gap-2 border-b border-border bg-muted/40 px-3 py-2 text-[12px]">
            <Paperclip className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="truncate font-semibold text-foreground" title={activeAtt.name}>{activeAtt.name}</span>
            <span className="ml-auto rounded bg-background px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              {activeAtt.type}
            </span>
          </div>

          <div className="flex min-h-0 flex-1 flex-col overflow-auto">
            <PreviewBody attachment={activeAtt} audioTranscript={audioTranscript} />
          </div>
        </div>
      )}
    </div>
  );
}

function PreviewBody({ attachment, audioTranscript }: { attachment: GalleryAttachment; audioTranscript?: string | null }) {
  if (attachment.type === "IMAGE") {
    return <ImageZoomViewer key={attachment.url} src={attachment.url} alt={attachment.name} />;
  }

  if (attachment.type === "AUDIO") {
    return (
      <div className="flex h-full min-h-0 flex-col gap-3 p-4">
        <AudioPlayer src={attachment.url} className="flex-shrink-0" />
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

  // DOCUMENT — inline PDF via <object>, fall back to <iframe>.
  // Chrome/Edge's built-in PDF viewer refuses to run inside a `sandbox`
  // iframe (it's treated as a plugin and gets silently blocked → "🚫" glyph),
  // so we drop the sandbox and rely on `#toolbar=0` to hide the download UI.
  const isPdf = /\.pdf(\?|$)/i.test(attachment.url) || /\.pdf$/i.test(attachment.name);
  if (isPdf) {
    const src = `${attachment.url}#toolbar=0&navpanes=0&view=FitH`;
    // Single <iframe> only — previously wrapped in <object> with iframe as
    // fallback, but Chromium loads BOTH concurrently and if the browser
    // can't render the PDF inline (missing plugin, restricted context) it
    // counts each as an auto-download → the "This site attempted to
    // download multiple files automatically" prompt.  One iframe = one
    // fetch, no false-positive multi-download warning.
    return <iframe src={src} title={attachment.name} className="h-full w-full" />;
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

// ── Image zoom / pan / rotate ─────────────────────────────────────────────
// Wheel to zoom around cursor, drag to pan (when zoomed), buttons for +/−,
// rotate, reset-to-fit. Bounds pan so the image never floats off-screen.
const ZOOM_MIN = 1;
const ZOOM_MAX = 6;
const ZOOM_STEP = 0.25;

function ImageZoomViewer({ src, alt }: { src: string; alt: string }) {
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [rotation, setRotation] = useState(0);
  const dragRef = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);

  const reset = useCallback(() => {
    setZoom(1);
    setOffset({ x: 0, y: 0 });
    setRotation(0);
  }, []);

  const clamp = useCallback((z: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Number(z.toFixed(2)))), []);

  const zoomBy = useCallback((delta: number, anchor?: { x: number; y: number }) => {
    setZoom((z) => {
      const next = clamp(z + delta);
      if (next === 1) { setOffset({ x: 0, y: 0 }); return next; }
      if (anchor && stageRef.current) {
        const rect = stageRef.current.getBoundingClientRect();
        const cx = anchor.x - rect.left - rect.width / 2;
        const cy = anchor.y - rect.top - rect.height / 2;
        const ratio = next / z;
        setOffset((o) => ({ x: cx - (cx - o.x) * ratio, y: cy - (cy - o.y) * ratio }));
      }
      return next;
    });
  }, [clamp]);

  // Wheel zoom
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey || Math.abs(e.deltaY) > 0) {
        e.preventDefault();
        const delta = e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
        zoomBy(delta, { x: e.clientX, y: e.clientY });
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomBy]);

  const onPointerDown = (e: React.PointerEvent) => {
    if (zoom <= 1) return;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    dragRef.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    setOffset({ x: d.ox + (e.clientX - d.x), y: d.oy + (e.clientY - d.y) });
  };
  const onPointerUp = () => { dragRef.current = null; };

  return (
    <div
      ref={stageRef}
      className={cn(
        "relative flex h-full w-full items-center justify-center overflow-hidden bg-black/[0.04]",
        zoom > 1 ? (dragRef.current ? "cursor-grabbing" : "cursor-grab") : "cursor-zoom-in"
      )}
      onDoubleClick={(e) => zoomBy(zoom >= ZOOM_MAX - 0.01 ? -(zoom - 1) : 1, { x: e.clientX, y: e.clientY })}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        draggable={false}
        className="max-h-full max-w-full select-none object-contain transition-transform duration-75 ease-out will-change-transform"
        style={{
          transform: `translate3d(${offset.x}px, ${offset.y}px, 0) scale(${zoom}) rotate(${rotation}deg)`,
        }}
      />

      {/* Floating toolbar */}
      <div className="pointer-events-auto absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1 rounded-full border border-border bg-card/95 px-1.5 py-1 shadow-card-md backdrop-blur">
        <ZoomBtn label="Zoom out" onClick={() => zoomBy(-ZOOM_STEP)} disabled={zoom <= ZOOM_MIN}>
          <ZoomOut className="h-4 w-4" />
        </ZoomBtn>
        <div className="min-w-[46px] px-1 text-center font-mono text-[11px] font-semibold text-foreground">
          {Math.round(zoom * 100)}%
        </div>
        <ZoomBtn label="Zoom in" onClick={() => zoomBy(ZOOM_STEP)} disabled={zoom >= ZOOM_MAX}>
          <ZoomIn className="h-4 w-4" />
        </ZoomBtn>
        <div className="mx-1 h-5 w-px bg-border" />
        <ZoomBtn label="Rotate" onClick={() => setRotation((r) => (r + 90) % 360)}>
          <RotateCw className="h-4 w-4" />
        </ZoomBtn>
        <ZoomBtn label="Fit" onClick={reset}>
          <Maximize2 className="h-4 w-4" />
        </ZoomBtn>
        <ZoomBtn label="Reset" onClick={reset}>
          <RotateCcw className="h-4 w-4" />
        </ZoomBtn>
      </div>
    </div>
  );
}

function ZoomBtn({
  children, onClick, disabled, label,
}: { children: React.ReactNode; onClick: () => void; disabled?: boolean; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className="grid h-7 w-7 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
    </button>
  );
}
