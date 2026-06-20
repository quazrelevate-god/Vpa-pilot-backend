"use client";

import { useCallback, useEffect, useState } from "react";
import {
  CalendarCheck, CheckCircle, FileText, RefreshCw, XCircle,
} from "lucide-react";

import TopBar from "@/components/TopBar";
import KPICard from "@/components/KPICard";
import Gauge from "@/components/Gauge";
import StatusDoughnut from "@/components/charts/StatusDoughnut";
import TrendLine from "@/components/charts/TrendLine";
import CategoryBar from "@/components/charts/CategoryBar";
import SentimentPolar from "@/components/charts/SentimentPolar";
import UrgencyBars from "@/components/UrgencyBars";
import { fetchStats } from "@/lib/api";
import type { StatsResponse } from "@/lib/types";

function today() {
  return new Date().toISOString().split("T")[0];
}

export default function OverviewPage() {
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [updated, setUpdated] = useState<string>("");

  const load = useCallback(async () => {
    setError(null);
    try {
      const d = today();
      const s = await fetchStats(d, d);
      setStats(s);
      setUpdated(`Updated ${new Date().toLocaleTimeString()}`);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const todayDate = new Date().toLocaleDateString("en-IN", {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
  });

  return (
    <>
      <TopBar rightSlot={updated} />
      <main className="flex-1 overflow-y-auto p-6 space-y-6 bg-slate-50">
        {/* Page title */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-extrabold text-slate-900">Performance Overview</h1>
            <p className="text-sm text-slate-500 mt-0.5">
              Today's petition analytics — {todayDate}
            </p>
          </div>
          <button
            onClick={load}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-brand rounded-lg hover:bg-blue-700 transition shadow-sm"
          >
            <RefreshCw className="w-4 h-4" /> Refresh
          </button>
        </div>

        {/* KPI strip */}
        {error ? (
          <div className="text-red-500 text-sm p-4 bg-red-50 rounded-xl border border-red-200">
            Failed to load stats: {error}
          </div>
        ) : !stats ? (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="skeleton h-28 rounded-xl" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <KPICard label="Total Petitions"    value={stats.total}     icon={FileText}      color="text-brand"     bg="bg-blue-50"   footnote={`AI covered: ${stats.ai_coverage}%`} />
            <KPICard label="Scheduled Meetings" value={stats.scheduled} icon={CalendarCheck} color="text-orange-600" bg="bg-orange-50" />
            <KPICard label="Submitted Petitions" value={stats.submitted} icon={CheckCircle}   color="text-green-600"  bg="bg-green-50"  footnote={`Resolution: ${stats.resolution_rate}%`} />
            <KPICard label="Closed"             value={stats.closed}    icon={XCircle}       color="text-red-500"    bg="bg-red-50"    />
          </div>
        )}

        {/* Row 1: gauges + status doughnut */}
        {stats && (
          <>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <Gauge
                topLabel="Resolution Rate"
                value={stats.resolution_rate}
                color="#10b981"
                caption="of total"
              />
              <Gauge
                topLabel="AI Summary Coverage"
                value={stats.ai_coverage}
                color="#0f62fe"
                caption="summarised"
              />
              <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 flex flex-col">
                <div className="text-sm font-semibold text-slate-600 mb-4">Status Breakdown</div>
                <div className="flex-1 flex items-center justify-center h-44">
                  <StatusDoughnut
                    scheduled={stats.scheduled}
                    submitted={stats.submitted}
                    closed={stats.closed}
                    rescheduled={stats.rescheduled}
                  />
                </div>
              </div>
            </div>

            {/* Row 2: submission trend (full width) */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <div className="text-sm font-semibold text-slate-700">Submission Trend</div>
                  <div className="text-xs text-slate-400">Daily petition submissions — last 14 days</div>
                </div>
                <div className="flex items-center gap-2 text-xs text-slate-500">
                  <span className="w-3 h-3 rounded-full bg-brand inline-block" /> Submissions
                </div>
              </div>
              <div className="h-52">
                <TrendLine labels={stats.trend_labels} counts={stats.trend_counts} />
              </div>
            </div>

            {/* Row 3: category bar + urgency + sentiment */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2 bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
                <div className="text-sm font-semibold text-slate-700 mb-1">Petitions by Category</div>
                <div className="text-xs text-slate-400 mb-4">Top categories by volume</div>
                <div className="h-56">
                  <CategoryBar items={stats.categories} />
                </div>
              </div>
              <div className="flex flex-col gap-6">
                <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 flex-1">
                  <div className="text-sm font-semibold text-slate-700 mb-4">Urgency Distribution</div>
                  <UrgencyBars urgency={stats.urgency} />
                </div>
                <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 flex-1">
                  <div className="text-sm font-semibold text-slate-700 mb-3">Citizen Sentiment</div>
                  <div className="h-36 flex items-center justify-center">
                    <SentimentPolar sentiment={stats.sentiment} />
                  </div>
                </div>
              </div>
            </div>
          </>
        )}
      </main>
    </>
  );
}
