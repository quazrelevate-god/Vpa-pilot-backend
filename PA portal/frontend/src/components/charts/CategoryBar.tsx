"use client";

import "@/components/charts/chartSetup";
import { Bar } from "react-chartjs-2";

const PALETTE = [
  "#5B5BD6", "#10b981", "#f97316", "#8b5cf6",
  "#ef4444", "#06b6d4", "#eab308", "#ec4899",
  "#14b8a6", "#6366f1",
];

export default function CategoryBar({ items }: { items: { label: string; count: number }[] }) {
  return (
    <Bar
      data={{
        labels: items.map((c) => c.label),
        datasets: [{
          label: "Petitions",
          data: items.map((c) => c.count),
          backgroundColor: items.map((_, i) => PALETTE[i % PALETTE.length]),
          borderRadius: 6,
          borderSkipped: false,
          barThickness: "flex",
          maxBarThickness: 22,
        }],
      }}
      options={{
        indexAxis: "y",
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: "#0c2e59",
            padding: 10,
            cornerRadius: 8,
            displayColors: false,
            callbacks: { label: (ctx) => ` ${(ctx.parsed.x ?? 0).toLocaleString()} petitions` },
          },
        },
        scales: {
          x: {
            beginAtZero: true,
            ticks: { color: "#94a3b8", font: { size: 11 }, precision: 0 },
            grid: { color: "#f4f6f9" },
            border: { display: false },
          },
          y: {
            ticks: { color: "#475569", font: { size: 11.5, weight: 500 } },
            grid: { display: false },
            border: { display: false },
          },
        },
        animation: { duration: 800 },
      }}
    />
  );
}
