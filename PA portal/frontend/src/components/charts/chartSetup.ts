// One-time Chart.js registration for the whole app. Importing this module
// (anywhere) ensures the bar/line/doughnut/polar elements + scales are
// available before any <Chart .../> mounts.
import {
  ArcElement,
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  Filler,
  Legend,
  LinearScale,
  LineElement,
  PointElement,
  PolarAreaController,
  RadialLinearScale,
  Tooltip,
} from "chart.js";

ChartJS.register(
  ArcElement,
  BarElement,
  CategoryScale,
  Filler,
  Legend,
  LinearScale,
  LineElement,
  PointElement,
  PolarAreaController,
  RadialLinearScale,
  Tooltip,
);

export {};
