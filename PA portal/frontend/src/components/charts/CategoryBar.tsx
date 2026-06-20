"use client";

import "@/components/charts/chartSetup";
import { Bar } from "react-chartjs-2";

const PALETTE = [
  "#0f62fe", "#10b981", "#f97316", "#8b5cf6",
  "#ef4444", "#facc15", "#06b6d4", "#ec4899",
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
        }],
      }}
      options={{
        indexAxis: "y",
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { beginAtZero: true, grid: { color: "#f8fafc" } },
          y: { grid: { display: false }, ticks: { font: { size: 11 } } },
        },
        animation: { duration: 800 },
      }}
    />
  );
}
