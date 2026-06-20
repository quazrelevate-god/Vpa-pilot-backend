"use client";

import "@/components/charts/chartSetup";
import { Line } from "react-chartjs-2";

export default function TrendLine({ labels, counts }: { labels: string[]; counts: number[] }) {
  return (
    <Line
      data={{
        labels,
        datasets: [{
          label: "Submissions",
          data: counts,
          borderColor: "#0f62fe",
          backgroundColor: "rgba(15,98,254,0.08)",
          fill: true,
          tension: 0.4,
          pointBackgroundColor: "#0f62fe",
          pointRadius: 4,
          pointHoverRadius: 6,
        }],
      }}
      options={{
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          y: { beginAtZero: true, ticks: { stepSize: 1 }, grid: { color: "#f1f5f9" } },
          x: { grid: { display: false } },
        },
        animation: { duration: 900 },
      }}
    />
  );
}
