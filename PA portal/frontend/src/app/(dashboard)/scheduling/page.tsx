"use client";

import { useState, useEffect } from "react";
import { Calendar, Clock, Users, AlertCircle, CheckCircle } from "lucide-react";

interface MLA {
  id: number;
  name: string;
  constituency: string;
  is_active: boolean;
}

interface Statistics {
  waiting_count: number;
  scheduled_today: number;
  oldest_waiting_days: number;
}

interface TodaySchedule {
  has_availability: boolean;
  total_slots?: number;
  booked_slots?: number;
  remaining_slots?: number;
  time_range?: string;
  date?: string;
  message?: string;
}

export default function SchedulingPage() {
  const [mlas, setMlas] = useState<MLA[]>([]);
  const [statistics, setStatistics] = useState<Statistics | null>(null);
  const [todaySchedule, setTodaySchedule] = useState<TodaySchedule | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Form state
  const [formData, setFormData] = useState({
    mla_id: "",
    date: new Date().toISOString().split("T")[0],
    start_time: "16:00",
    end_time: "18:00",
    slot_duration_minutes: 5,
    window_duration_minutes: 30,
  });

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      // Load MLAs
      const mlasRes = await fetch("/api/v1/scheduling/admin/mlas");
      const mlasData = await mlasRes.json();
      if (Array.isArray(mlasData)) {
        setMlas(mlasData);
        if (mlasData.length > 0 && !formData.mla_id) {
          setFormData((prev) => ({ ...prev, mla_id: mlasData[0].id.toString() }));
        }
      }

      // Load statistics
      const statsRes = await fetch("/api/v1/scheduling/admin/statistics");
      const statsData = await statsRes.json();
      if (statsData && !statsData.error) {
        setStatistics(statsData);
      }

      // Load today's schedule
      const scheduleRes = await fetch("/api/v1/scheduling/admin/today-schedule");
      const scheduleData = await scheduleRes.json();
      if (scheduleData && !scheduleData.error) {
        setTodaySchedule(scheduleData);
      }
    } catch (error) {
      console.error("Failed to load data:", error);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMessage(null);

    try {
      const response = await fetch("/api/v1/scheduling/admin/set-availability", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...formData,
          mla_id: parseInt(formData.mla_id),
          start_time: `${formData.start_time}:00`,
          end_time: `${formData.end_time}:00`,
        }),
      });

      const data = await response.json();

      if (response.ok) {
        setMessage({
          type: "success",
          text: `Success! ${data.message}`,
        });
        loadData(); // Refresh data
      } else {
        setMessage({
          type: "error",
          text: data.error || "Failed to set availability",
        });
      }
    } catch (error) {
      setMessage({
        type: "error",
        text: "Network error. Please try again.",
      });
    } finally {
      setLoading(false);
    }
  };

  const calculateTotalSlots = () => {
    const [startHour, startMin] = formData.start_time.split(":").map(Number);
    const [endHour, endMin] = formData.end_time.split(":").map(Number);
    const totalMinutes = endHour * 60 + endMin - (startHour * 60 + startMin);
    return Math.floor(totalMinutes / formData.slot_duration_minutes);
  };

  return (
    <>
      {/* Header */}
      <header className="h-16 bg-white border-b flex items-center px-6 gap-4 flex-shrink-0 justify-between">
        <div className="flex items-center gap-4">
          <div className="text-xs text-slate-500 font-medium tracking-wide">
            Government of Tamil Nadu
          </div>
          <div className="h-5 w-px bg-slate-200"></div>
          <div className="text-sm font-bold text-slate-900">MLA Scheduling Management</div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto p-6 space-y-6">
        {/* Page Title */}
        <div>
          <h1 className="text-2xl font-extrabold text-slate-900">MLA Availability</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Set MLA availability and manage appointment scheduling
          </p>
        </div>

        {/* Statistics Cards */}
        {statistics && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-amber-100 rounded-lg">
                  <Users className="w-5 h-5 text-amber-600" />
                </div>
                <div>
                  <div className="text-2xl font-bold text-slate-900">
                    {statistics.waiting_count}
                  </div>
                  <div className="text-xs text-slate-500">Waiting in Queue</div>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-green-100 rounded-lg">
                  <CheckCircle className="w-5 h-5 text-green-600" />
                </div>
                <div>
                  <div className="text-2xl font-bold text-slate-900">
                    {statistics.scheduled_today}
                  </div>
                  <div className="text-xs text-slate-500">Scheduled Today</div>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-red-100 rounded-lg">
                  <AlertCircle className="w-5 h-5 text-red-600" />
                </div>
                <div>
                  <div className="text-2xl font-bold text-slate-900">
                    {statistics.oldest_waiting_days}
                  </div>
                  <div className="text-xs text-slate-500">Oldest Waiting (days)</div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Today's Schedule */}
        {todaySchedule && (
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
            <h2 className="text-lg font-bold text-slate-900 mb-4">Today's Schedule</h2>
            {todaySchedule.has_availability ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-slate-600">Time Range:</span>
                  <span className="text-sm font-semibold text-slate-900">
                    {todaySchedule.time_range}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-slate-600">Total Slots:</span>
                  <span className="text-sm font-semibold text-slate-900">
                    {todaySchedule.total_slots}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-slate-600">Booked:</span>
                  <span className="text-sm font-semibold text-green-600">
                    {todaySchedule.booked_slots}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-slate-600">Remaining:</span>
                  <span className="text-sm font-semibold text-amber-600">
                    {todaySchedule.remaining_slots}
                  </span>
                </div>
                <div className="mt-4 pt-4 border-t">
                  <div className="w-full bg-slate-200 rounded-full h-2">
                    <div
                      className="bg-green-600 h-2 rounded-full transition-all"
                      style={{
                        width: `${
                          ((todaySchedule.booked_slots || 0) / (todaySchedule.total_slots || 1)) *
                          100
                        }%`,
                      }}
                    ></div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-center py-8">
                <AlertCircle className="w-12 h-12 text-slate-300 mx-auto mb-3" />
                <p className="text-sm text-slate-500">No availability set for today</p>
              </div>
            )}
          </div>
        )}

        {/* Set Availability Form */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
          <h2 className="text-lg font-bold text-slate-900 mb-4">Set MLA Availability</h2>

          {message && (
            <div
              className={`mb-4 p-4 rounded-lg ${
                message.type === "success"
                  ? "bg-green-50 border border-green-200 text-green-800"
                  : "bg-red-50 border border-red-200 text-red-800"
              }`}
            >
              {message.text}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* MLA Selection */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Select MLA
                </label>
                <select
                  value={formData.mla_id}
                  onChange={(e) => setFormData({ ...formData, mla_id: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required
                >
                  <option value="">Select MLA</option>
                  {mlas.map((mla) => (
                    <option key={mla.id} value={mla.id}>
                      {mla.name} - {mla.constituency}
                    </option>
                  ))}
                </select>
              </div>

              {/* Date */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Date</label>
                <input
                  type="date"
                  value={formData.date}
                  onChange={(e) => setFormData({ ...formData, date: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required
                />
              </div>

              {/* Start Time */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Start Time
                </label>
                <input
                  type="time"
                  value={formData.start_time}
                  onChange={(e) => setFormData({ ...formData, start_time: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required
                />
              </div>

              {/* End Time */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">End Time</label>
                <input
                  type="time"
                  value={formData.end_time}
                  onChange={(e) => setFormData({ ...formData, end_time: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required
                />
              </div>

              {/* Slot Duration */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Slot Duration (minutes)
                </label>
                <select
                  value={formData.slot_duration_minutes}
                  onChange={(e) =>
                    setFormData({ ...formData, slot_duration_minutes: parseInt(e.target.value) })
                  }
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="5">5 minutes</option>
                  <option value="10">10 minutes</option>
                  <option value="15">15 minutes</option>
                </select>
              </div>

              {/* Window Duration */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Window Duration (minutes)
                </label>
                <select
                  value={formData.window_duration_minutes}
                  onChange={(e) =>
                    setFormData({ ...formData, window_duration_minutes: parseInt(e.target.value) })
                  }
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="30">30 minutes</option>
                  <option value="60">60 minutes</option>
                </select>
              </div>
            </div>

            {/* Calculation Info */}
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <div className="flex items-center gap-2 text-sm text-blue-800">
                <Clock className="w-4 h-4" />
                <span className="font-semibold">Calculated:</span>
                <span>
                  {calculateTotalSlots()} slots will be created (
                  {formData.slot_duration_minutes} min each)
                </span>
              </div>
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={loading}
              className="w-full px-4 py-3 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 disabled:bg-slate-300 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? "Setting Availability..." : "Set Availability & Auto-Schedule Queue"}
            </button>
          </form>
        </div>

        {/* Quick Actions */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <a
            href="/waiting-queue"
            className="block bg-white rounded-xl border border-slate-200 shadow-sm p-6 hover:shadow-md transition-shadow"
          >
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-bold text-slate-900">View Waiting Queue</h3>
                <p className="text-sm text-slate-500 mt-1">
                  Manage {statistics?.waiting_count || 0} waiting appointments
                </p>
              </div>
              <Users className="w-8 h-8 text-slate-400" />
            </div>
          </a>

          <a
            href="/appointments"
            className="block bg-white rounded-xl border border-slate-200 shadow-sm p-6 hover:shadow-md transition-shadow"
          >
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-bold text-slate-900">View All Appointments</h3>
                <p className="text-sm text-slate-500 mt-1">
                  See {statistics?.scheduled_today || 0} scheduled today
                </p>
              </div>
              <Calendar className="w-8 h-8 text-slate-400" />
            </div>
          </a>
        </div>
      </main>
    </>
  );
}
