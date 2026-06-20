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
          backgroundColor: ["#f97316", "#10b981", "#ef4444", "#facc15"],
          borderWidth: 2,
          borderColor: "#fff",
          hoverOffset: 6,
        }],
      }}
      options={{
        responsive: true,
        maintainAspectRatio: false,
        cutout: "60%",
        plugins: {
          legend: { position: "bottom", labels: { boxWidth: 10, padding: 12, font: { size: 11 } } },
          tooltip: { callbacks: { label: (ctx) => ` ${ctx.label}: ${ctx.parsed.toLocaleString()}` } },
        },
        animation: { duration: 800 },
      }}
    />
  );
}
