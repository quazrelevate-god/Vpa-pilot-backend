"use client";

import "@/components/charts/chartSetup";
import { Doughnut } from "react-chartjs-2";

// Semi-circle gauge — half-doughnut with `circumference: 180` and a small
// fixed value to force layout symmetry, matching the Jinja gauges.
export default function Gauge({
  value,
  color,
  caption,
  topLabel,
}: {
  value: number;        // 0-100
  color: string;        // bar colour
  caption?: string;     // small grey caption below the number
  topLabel: string;     // headline above the gauge
}) {
  const pct = Math.max(0, Math.min(100, value));
  const remaining = 100 - pct;
  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 flex flex-col items-center justify-center">
      <div className="text-sm font-semibold text-slate-600 mb-4">{topLabel}</div>
      <div className="relative inline-flex items-center justify-center" style={{ width: 200, height: 120 }}>
        <Doughnut
          data={{
            datasets: [{
              data: [pct, remaining, 100],
              backgroundColor: [color, "#f1f5f9", "transparent"],
              borderWidth: 0,
              circumference: 180,
              rotation: 270,
            }],
          }}
          options={{
            responsive: false,
            cutout: "72%",
            plugins: { legend: { display: false }, tooltip: { enabled: false } },
            animation: { duration: 900, easing: "easeOutQuart" },
          }}
          width={200}
          height={120}
        />
        <div className="absolute text-center" style={{ bottom: 8 }}>
          <div className="text-3xl font-extrabold text-slate-800">{pct}%</div>
          <div className="text-xs text-slate-400">{caption}</div>
        </div>
      </div>
    </div>
  );
}
