"use client";

import "@/components/charts/chartSetup";
import { Line } from "react-chartjs-2";
import type { ScriptableContext } from "chart.js";

const BRAND = "#5B5BD6";
const RESOLVED = "#10b981";

interface DualTrendProps {
  labels: string[];
  incoming: number[];
  resolved?: number[];
}

/** Submissions vs Resolved daily trend — the political "are we keeping up?" chart. */
export default function DualTrend({ labels, incoming, resolved }: DualTrendProps) {
  const datasets: Parameters<typeof Line>[0]["data"]["datasets"] = [
    {
      label: "Incoming",
      data: incoming,
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
      pointRadius: 0,
      pointHoverRadius: 5,
      pointHoverBackgroundColor: BRAND,
      pointHoverBorderColor: "#fff",
    },
  ];

  if (resolved && resolved.length) {
    datasets.push({
      label: "Resolved",
      data: resolved,
      borderColor: RESOLVED,
      borderWidth: 2.5,
      fill: false,
      tension: 0.4,
      borderDash: [],
      pointBackgroundColor: "#fff",
      pointBorderColor: RESOLVED,
      pointBorderWidth: 2,
      pointRadius: 0,
      pointHoverRadius: 5,
      pointHoverBackgroundColor: RESOLVED,
      pointHoverBorderColor: "#fff",
    });
  }

  return (
    <Line
      data={{ labels, datasets }}
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
            usePointStyle: true,
          },
        },
        scales: {
          y: {
            beginAtZero: true,
            ticks: { stepSize: 1, color: "#94a3b8", font: { size: 11 }, precision: 0 },
            grid: { color: "#f1f5f9" },
            border: { display: false },
          },
          x: {
            ticks: { color: "#94a3b8", font: { size: 11 }, maxRotation: 0 },
            grid: { display: false },
            border: { display: false },
          },
        },
        animation: { duration: 700 },
      }}
    />
  );
}
