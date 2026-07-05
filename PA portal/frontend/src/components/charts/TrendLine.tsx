"use client";

import "@/components/charts/chartSetup";
import { Line } from "react-chartjs-2";
import type { ScriptableContext } from "chart.js";

const BRAND = "#5B5BD6";

export default function TrendLine({ labels, counts }: { labels: string[]; counts: number[] }) {
  return (
    <Line
      data={{
        labels,
        datasets: [{
          label: "Submissions",
          data: counts,
          borderColor: BRAND,
          borderWidth: 2.5,
          fill: true,
          backgroundColor: (ctx: ScriptableContext<"line">) => {
            const { chart } = ctx;
            const { ctx: c, chartArea } = chart;
            if (!chartArea) return "rgba(15,98,254,0.10)";
            const g = c.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
            g.addColorStop(0, "rgba(15,98,254,0.22)");
            g.addColorStop(1, "rgba(15,98,254,0.00)");
            return g;
          },
          tension: 0.4,
          pointBackgroundColor: "#fff",
          pointBorderColor: BRAND,
          pointBorderWidth: 2,
          pointRadius: 3,
          pointHoverRadius: 6,
          pointHoverBackgroundColor: BRAND,
          pointHoverBorderColor: "#fff",
        }],
      }}
      options={{
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: "#0c2e59",
            padding: 10,
            cornerRadius: 8,
            titleFont: { size: 11, weight: "bold" },
            bodyFont: { size: 12 },
            displayColors: false,
          },
        },
        scales: {
          y: {
            beginAtZero: true,
            ticks: { stepSize: 1, color: "#94a3b8", font: { size: 11 } },
            grid: { color: "#f1f5f9" },
            border: { display: false },
          },
          x: {
            ticks: { color: "#94a3b8", font: { size: 11 }, maxRotation: 0 },
            grid: { display: false },
            border: { display: false },
          },
        },
        animation: { duration: 900 },
      }}
    />
  );
}
