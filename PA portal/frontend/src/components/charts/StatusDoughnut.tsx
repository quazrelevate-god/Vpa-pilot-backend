"use client";

import "@/components/charts/chartSetup";
import { Doughnut } from "react-chartjs-2";

export default function StatusDoughnut({
  scheduled, submitted, closed, rescheduled,
}: { scheduled: number; submitted: number; closed: number; rescheduled: number }) {
  return (
    <Doughnut
      data={{
        labels: ["Scheduled", "Submitted", "Closed", "Rescheduled"],
        datasets: [{
          data: [scheduled, submitted, closed, rescheduled],
          backgroundColor: ["#f97316", "#10b981", "#94a3b8", "#eab308"],
          borderWidth: 3,
          borderColor: "#fff",
          hoverOffset: 8,
        }],
      }}
      options={{
        responsive: true,
        maintainAspectRatio: false,
        cutout: "64%",
        plugins: {
          legend: {
            position: "bottom",
            labels: {
              boxWidth: 8,
              boxHeight: 8,
              usePointStyle: true,
              pointStyle: "circle",
              padding: 14,
              font: { size: 11.5, weight: 500 },
              color: "#475569",
            },
          },
          tooltip: {
            backgroundColor: "#0c2e59",
            padding: 10,
            cornerRadius: 8,
            displayColors: false,
            callbacks: { label: (ctx) => ` ${ctx.label}: ${ctx.parsed.toLocaleString()}` },
          },
        },
        animation: { duration: 800 },
      }}
    />
  );
}
