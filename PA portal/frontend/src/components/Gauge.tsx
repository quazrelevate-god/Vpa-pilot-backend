"use client";

import "@/components/charts/chartSetup";
import { Doughnut } from "react-chartjs-2";
import { Card } from "@/components/ui/card";

// Semi-circle gauge — half-doughnut with `circumference: 180` and a small
// fixed value to force layout symmetry.
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
    <Card className="flex flex-col items-center justify-center p-6">
      <div className="self-start text-sm font-semibold text-foreground">{topLabel}</div>
      <div className="relative mt-2 inline-flex items-center justify-center" style={{ width: 200, height: 124 }}>
        <Doughnut
          data={{
            datasets: [{
              data: [pct, remaining, 100],
              backgroundColor: [color, "#eef2f7", "transparent"],
              borderWidth: 0,
              circumference: 180,
              rotation: 270,
              borderRadius: 8,
            }],
          }}
          options={{
            responsive: false,
            cutout: "74%",
            plugins: { legend: { display: false }, tooltip: { enabled: false } },
            animation: { duration: 1000, easing: "easeOutQuart" },
          }}
          width={200}
          height={124}
        />
        <div className="absolute text-center" style={{ bottom: 6 }}>
          <div className="text-3xl font-extrabold tracking-tight tabular-nums text-foreground">{pct}%</div>
          {caption && <div className="text-xs font-medium text-muted-foreground">{caption}</div>}
        </div>
      </div>
    </Card>
  );
}
