"use client";

import "@/components/charts/chartSetup";
import { PolarArea } from "react-chartjs-2";

export default function SentimentPolar({ sentiment }: { sentiment: Record<string, number> }) {
  const labels = Object.keys(sentiment).map((s) => s.charAt(0).toUpperCase() + s.slice(1));
  const data = Object.values(sentiment);
  return (
    <PolarArea
      data={{
        labels,
        datasets: [{
          data,
          backgroundColor: [
            "rgba(239,68,68,0.7)",  // distressed
            "rgba(249,115,22,0.7)", // frustrated
            "rgba(100,116,139,0.7)",// neutral
            "rgba(16,185,129,0.7)", // hopeful
          ],
          borderWidth: 1,
          borderColor: "#fff",
        }],
      }}
      options={{
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: "bottom", labels: { boxWidth: 9, font: { size: 10 }, padding: 8 } },
        },
        scales: { r: { ticks: { display: false }, grid: { color: "#f1f5f9" } } },
        animation: { duration: 700 },
      }}
    />
  );
}
