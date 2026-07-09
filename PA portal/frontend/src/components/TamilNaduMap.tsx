"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { geoMercator, geoPath } from "d3-geo";

// Each polygon is coloured, labelled, and filtered by its OWN district key, so
// the number on a district always equals what clicking it filters to. The
// bundled boundary set predates the 2004–2020 splits, so 8 newer districts have
// no polygon; their petitions still appear (and are clickable) in the ranked
// "Ranked by volume" list beside the map.

export interface DistrictCount { key: string; label: string; count: number }
interface MapPath { key: string; name: string; d: string; cx: number; cy: number }

// Hex → rgb lerp for the choropleth ramp (light tint → deep brand blue).
function lerp(a: string, b: string, t: number): string {
  const ah = parseInt(a.slice(1), 16), bh = parseInt(b.slice(1), 16);
  const ar = ah >> 16, ag = (ah >> 8) & 255, ab = ah & 255;
  const br = bh >> 16, bg = (bh >> 8) & 255, bb = bh & 255;
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return `rgb(${r},${g},${bl})`;
}
const RAMP_LO = "#CBD9F6";  // light
const RAMP_HI = "#15308A";  // deep brand
const NO_DATA = "#EEF2FA";

const W = 420, H = 480;

export default function TamilNaduMap({ data, activeKey, onSelect }: {
  data: DistrictCount[] | null; activeKey?: string; onSelect?: (key: string) => void;
}) {
  const [geo, setGeo] = useState<any>(null);
  const [failed, setFailed] = useState(false);
  const [hover, setHover] = useState<{ name: string; count: number; x: number; y: number } | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/tn-districts.geojson")
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(g => { if (alive) setGeo(g); })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, []);

  // Count per district key (no aggregation — polygon key == filter key).
  const { countByKey, max } = useMemo(() => {
    const m = new Map<string, number>();
    for (const d of data ?? []) m.set(d.key, (m.get(d.key) ?? 0) + d.count);
    return { countByKey: m, max: Math.max(1, ...m.values()) };
  }, [data]);

  const intensity = (key: string) => {
    const c = countByKey.get(key) ?? 0;
    return c > 0 ? Math.pow(c / max, 0.7) : 0;
  };
  const fill = (key: string) => {
    const c = countByKey.get(key) ?? 0;
    if (c === 0) return NO_DATA;
    return lerp(RAMP_LO, RAMP_HI, intensity(key));
  };

  const paths = useMemo<MapPath[]>(() => {
    if (!geo) return [];
    const proj = geoMercator().fitSize([W, H], geo);
    const path = geoPath(proj);
    return geo.features.map((f: any): MapPath => {
      const [cx, cy] = path.centroid(f);
      return { key: f.properties.key, name: f.properties.name, d: path(f) ?? "", cx, cy };
    });
  }, [geo]);

  if (failed) {
    return <div className="grid h-[300px] place-items-center text-[12px] italic text-muted-foreground">Map unavailable</div>;
  }
  if (!geo) {
    return <div className="grid h-[300px] w-full animate-pulse place-items-center rounded-xl bg-muted/40 text-[12px] text-muted-foreground">Loading map…</div>;
  }

  return (
    <div ref={wrapRef} className="relative w-full">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Tamil Nadu petition distribution by district">
        {paths.map(p => {
          const c = countByKey.get(p.key) ?? 0;
          const clickable = c > 0 && !!onSelect;
          const isActive = activeKey === p.key;
          const dimmed = !!activeKey && !isActive;
          return (
            <path
              key={p.key}
              d={p.d}
              fill={fill(p.key)}
              stroke={isActive ? "#1E40AF" : "#FFFFFF"}
              className="transition-[fill,stroke,opacity] duration-150 hover:stroke-[#1E40AF]"
              style={{
                strokeWidth: isActive ? 1.8 : hover?.name === p.name ? 1.4 : 0.6,
                opacity: dimmed ? 0.4 : 1,
                cursor: clickable ? "pointer" : "default",
              }}
              onClick={clickable ? () => onSelect!(p.key) : undefined}
              onMouseMove={(e) => {
                const rect = wrapRef.current?.getBoundingClientRect();
                setHover({
                  name: p.name,
                  count: c,
                  x: e.clientX - (rect?.left ?? 0),
                  y: e.clientY - (rect?.top ?? 0),
                });
              }}
              onMouseLeave={() => setHover(null)}
            />
          );
        })}
        {/* Count labels — only on districts with petitions; text colour flips
            to white once the fill is dark enough to keep it legible. */}
        {paths.map(p => {
          const c = countByKey.get(p.key) ?? 0;
          if (c === 0 || !Number.isFinite(p.cx)) return null;
          return (
            <text
              key={`t-${p.key}`}
              x={p.cx}
              y={p.cy}
              textAnchor="middle"
              dominantBaseline="central"
              className="pointer-events-none select-none"
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 11,
                fontWeight: 700,
                fill: intensity(p.key) > 0.45 ? "#FFFFFF" : "#21395B",
              }}
            >
              {c.toLocaleString("en-IN")}
            </text>
          );
        })}
      </svg>

      {hover && (
        <div
          className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-lg border border-border bg-card px-2.5 py-1.5 shadow-card-md"
          style={{ left: hover.x, top: hover.y - 8 }}
        >
          <div className="text-[12px] font-semibold text-foreground">{hover.name}</div>
          <div className="font-mono text-[11px] tabular-nums text-muted-foreground">
            {hover.count.toLocaleString("en-IN")} petition{hover.count === 1 ? "" : "s"}
          </div>
        </div>
      )}

      {/* Legend */}
      <div className="mt-2 flex items-center justify-center gap-2 text-[10.5px] text-muted-foreground">
        <span>Fewer</span>
        <span className="h-2 w-28 rounded-full" style={{ background: `linear-gradient(to right, ${RAMP_LO}, ${RAMP_HI})` }} />
        <span>More</span>
      </div>
    </div>
  );
}
