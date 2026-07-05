"use client";

import { useEffect, useState } from "react";
import { X, ZoomIn, ZoomOut, ChevronLeft, ChevronRight, Download } from "lucide-react";
import { cn } from "@/lib/utils";

export interface LightboxImage {
  url: string;
  name?: string;
}

interface ImageLightboxProps {
  images: LightboxImage[];
  initialIndex?: number;
  open: boolean;
  onClose: () => void;
}

/** Full-screen image viewer with zoom, pan, and prev/next navigation. */
export function ImageLightbox({ images, initialIndex = 0, open, onClose }: ImageLightboxProps) {
  const [index, setIndex] = useState(initialIndex);
  const [scale, setScale] = useState(1);

  useEffect(() => { if (open) { setIndex(initialIndex); setScale(1); } }, [open, initialIndex]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") setIndex((i) => Math.min(i + 1, images.length - 1));
      if (e.key === "ArrowLeft") setIndex((i) => Math.max(i - 1, 0));
      if (e.key === "+" || e.key === "=") setScale((s) => Math.min(s + 0.25, 4));
      if (e.key === "-") setScale((s) => Math.max(s - 0.25, 0.5));
      if (e.key === "0") setScale(1);
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = prevOverflow; };
  }, [open, onClose, images.length]);

  if (!open || images.length === 0) return null;

  const current = images[index];
  const hasPrev = index > 0;
  const hasNext = index < images.length - 1;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 animate-in fade-in-0"
      onClick={onClose}
    >
      {/* Header */}
      <div className="absolute top-0 left-0 right-0 flex items-center justify-between px-5 py-3 text-white">
        <div className="text-sm font-medium">
          <span className="text-white/60">{index + 1} / {images.length}</span>
          {current.name && <span className="ml-3">{current.name}</span>}
        </div>
        <div className="flex items-center gap-1.5">
          <IconBtn onClick={(e) => { e.stopPropagation(); setScale((s) => Math.max(s - 0.25, 0.5)); }} title="Zoom out (-)">
            <ZoomOut className="h-4 w-4" />
          </IconBtn>
          <span className="rounded bg-white/10 px-2 py-1 text-xs tabular-nums">{Math.round(scale * 100)}%</span>
          <IconBtn onClick={(e) => { e.stopPropagation(); setScale((s) => Math.min(s + 0.25, 4)); }} title="Zoom in (+)">
            <ZoomIn className="h-4 w-4" />
          </IconBtn>
          <IconBtn onClick={(e) => { e.stopPropagation(); window.open(current.url, "_blank"); }} title="Open in new tab">
            <Download className="h-4 w-4" />
          </IconBtn>
          <IconBtn onClick={(e) => { e.stopPropagation(); onClose(); }} title="Close (Esc)">
            <X className="h-4 w-4" />
          </IconBtn>
        </div>
      </div>

      {/* Image */}
      <div className="flex h-full w-full items-center justify-center overflow-auto" onClick={onClose}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={current.url}
          alt={current.name ?? ""}
          onClick={(e) => e.stopPropagation()}
          onDoubleClick={() => setScale((s) => (s === 1 ? 2 : 1))}
          style={{ transform: `scale(${scale})`, transition: "transform 0.15s ease-out" }}
          className="max-h-[85vh] max-w-[90vw] cursor-zoom-in select-none object-contain shadow-2xl"
        />
      </div>

      {/* Prev / Next */}
      {hasPrev && (
        <button
          onClick={(e) => { e.stopPropagation(); setIndex((i) => i - 1); setScale(1); }}
          className="absolute left-4 top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full bg-white/10 text-white transition hover:bg-white/20"
          aria-label="Previous"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
      )}
      {hasNext && (
        <button
          onClick={(e) => { e.stopPropagation(); setIndex((i) => i + 1); setScale(1); }}
          className="absolute right-4 top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full bg-white/10 text-white transition hover:bg-white/20"
          aria-label="Next"
        >
          <ChevronRight className="h-5 w-5" />
        </button>
      )}
    </div>
  );
}

function IconBtn({ children, onClick, title }: { children: React.ReactNode; onClick: (e: React.MouseEvent) => void; title?: string }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={cn("grid h-8 w-8 place-items-center rounded-md bg-white/10 text-white transition hover:bg-white/20")}
    >
      {children}
    </button>
  );
}
