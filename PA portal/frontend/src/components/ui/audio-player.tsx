"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Play, Pause, Mic } from "lucide-react";
import { cn } from "@/lib/utils";

interface AudioPlayerProps {
  src: string;
  className?: string;
}

/** mm:ss */
function fmt(sec: number): string {
  if (!isFinite(sec) || sec < 0) return "0:00";
  const s = Math.floor(sec);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
}

/**
 * Custom audio player — replaces the browser's default <audio controls>.
 *
 * Why custom:
 *   1. WebM audio recorded via MediaRecorder (our voice petitions) has no
 *      duration in the container header. The browser reports Infinity /
 *      NaN until playback reaches the end. The classic workaround is:
 *      wait for `loadedmetadata` → if duration is Infinity, seek to
 *      Number.MAX_SAFE_INTEGER, wait for the next `durationchange`, then
 *      reset currentTime to 0. That forces the browser to read the whole
 *      file and calculate a real duration.
 *   2. The default player is inconsistent across browsers and doesn't
 *      match the app's visual language. This one is a compact pill with
 *      brand colors, keyboard-navigable, and download-disabled.
 */
export function AudioPlayer({ src, className }: AudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const barRef = useRef<HTMLDivElement | null>(null);
  const durationFixed = useRef(false);

  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [ready, setReady] = useState(false);

  // ── Fix WebM duration on load ────────────────────────────────────────
  const onLoadedMetadata = useCallback(() => {
    const el = audioRef.current;
    if (!el) return;
    if (el.duration === Infinity || isNaN(el.duration)) {
      // Force the browser to walk the whole stream.
      durationFixed.current = false;
      el.currentTime = Number.MAX_SAFE_INTEGER;
    } else {
      setDuration(el.duration);
      setReady(true);
      durationFixed.current = true;
    }
  }, []);

  const onDurationChange = useCallback(() => {
    const el = audioRef.current;
    if (!el || durationFixed.current) return;
    if (isFinite(el.duration) && el.duration > 0) {
      setDuration(el.duration);
      // Reset playhead — the Infinity seek trick left it at EOF.
      el.currentTime = 0;
      setCurrent(0);
      setReady(true);
      durationFixed.current = true;
    }
  }, []);

  const onTimeUpdate = useCallback(() => {
    const el = audioRef.current;
    if (!el) return;
    setCurrent(el.currentTime);
  }, []);

  const onEnded = useCallback(() => {
    setPlaying(false);
    setCurrent(0);
    if (audioRef.current) audioRef.current.currentTime = 0;
  }, []);

  const toggle = useCallback(() => {
    const el = audioRef.current;
    if (!el) return;
    if (playing) { el.pause(); setPlaying(false); }
    else { el.play().then(() => setPlaying(true)).catch(() => setPlaying(false)); }
  }, [playing]);

  // ── Seek on progress-bar click / drag ────────────────────────────────
  const seekTo = useCallback((clientX: number) => {
    const el = audioRef.current;
    const bar = barRef.current;
    if (!el || !bar || !ready || duration <= 0) return;
    const rect = bar.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    el.currentTime = pct * duration;
    setCurrent(el.currentTime);
  }, [ready, duration]);

  const dragRef = useRef(false);
  const onBarPointerDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    dragRef.current = true;
    seekTo(e.clientX);
  };
  const onBarPointerMove = (e: React.PointerEvent) => {
    if (dragRef.current) seekTo(e.clientX);
  };
  const onBarPointerUp = () => { dragRef.current = false; };

  useEffect(() => {
    // Reset when src changes (drawer swap)
    durationFixed.current = false;
    setPlaying(false); setCurrent(0); setDuration(0); setReady(false);
  }, [src]);

  const pct = duration > 0 ? Math.min(100, (current / duration) * 100) : 0;

  return (
    <div className={cn(
      "flex items-center gap-3 rounded-xl border border-border bg-card px-3 py-2.5 shadow-card",
      className,
    )}>
      <button
        type="button"
        onClick={toggle}
        disabled={!ready}
        aria-label={playing ? "Pause" : "Play"}
        className={cn(
          "grid h-10 w-10 shrink-0 place-items-center rounded-full text-white transition-all",
          "bg-brand hover:brightness-110 active:scale-95",
          "disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground",
        )}
      >
        {playing ? <Pause className="h-4 w-4 fill-current" /> : <Play className="h-4 w-4 fill-current translate-x-[1px]" />}
      </button>

      <Mic className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />

      <div
        ref={barRef}
        role="slider"
        aria-label="Seek"
        aria-valuemin={0}
        aria-valuemax={duration || 0}
        aria-valuenow={current}
        onPointerDown={onBarPointerDown}
        onPointerMove={onBarPointerMove}
        onPointerUp={onBarPointerUp}
        onPointerCancel={onBarPointerUp}
        className={cn(
          "group relative h-2 min-w-0 flex-1 cursor-pointer overflow-hidden rounded-full bg-muted",
          !ready && "cursor-not-allowed opacity-60",
        )}
      >
        <div
          className="h-full rounded-full bg-brand transition-[width] duration-100 ease-linear"
          style={{ width: `${pct}%` }}
        />
        {ready && (
          <div
            className="absolute top-1/2 h-3.5 w-3.5 -translate-y-1/2 rounded-full border-2 border-brand bg-white shadow opacity-0 transition-opacity group-hover:opacity-100"
            style={{ left: `calc(${pct}% - 7px)` }}
          />
        )}
      </div>

      <div className="shrink-0 font-mono text-[11px] font-semibold tabular-nums text-muted-foreground">
        {fmt(current)} / {ready ? fmt(duration) : "—:—"}
      </div>

      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        controlsList="nodownload noplaybackrate"
        onLoadedMetadata={onLoadedMetadata}
        onDurationChange={onDurationChange}
        onTimeUpdate={onTimeUpdate}
        onEnded={onEnded}
        onContextMenu={(e) => e.preventDefault()}
        // display:none prevents the browser from loading media in some
        // engines, so hide visually with size 0 + opacity instead.
        className="pointer-events-none absolute h-0 w-0 opacity-0"
        aria-hidden="true"
      />
    </div>
  );
}
