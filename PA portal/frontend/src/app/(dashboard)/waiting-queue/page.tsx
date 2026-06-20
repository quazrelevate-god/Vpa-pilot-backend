"use client";

import { useState, useEffect } from "react";
import { Users, Clock, AlertCircle, RefreshCw } from "lucide-react";

interface WaitingAppointment {
  id: number;
  token: number;
  name: string;
  mobile: string;
  category: string;
  queue_position: number;
  waiting_since: string;
  priority_score: number;
  created_at: string;
}

export default function WaitingQueuePage() {
  const [appointments, setAppointments] = useState<WaitingAppointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    loadQueue();
  }, []);

  const loadQueue = async () => {
    try {
      setRefreshing(true);
      const response = await fetch("/api/v1/scheduling/admin/waiting-queue?limit=100");
      const data = await response.json();
      
      // Handle both array and error object responses
      if (Array.isArray(data)) {
        setAppointments(data);
      } else {
        console.error("Invalid response format:", data);
        setAppointments([]);
      }
    } catch (error) {
      console.error("Failed to load queue:", error);
      setAppointments([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const getDaysWaiting = (waitingSince: string) => {
    const now = new Date();
    const waiting = new Date(waitingSince);
    const diffTime = Math.abs(now.getTime() - waiting.getTime());
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    return diffDays;
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
          <div className="text-sm font-bold text-slate-900">Waiting Queue Management</div>
        </div>
        <button
          onClick={loadQueue}
          disabled={refreshing}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:bg-slate-300 transition-colors"
        >
          <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </header>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto p-6 space-y-6">
        {/* Page Title */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-extrabold text-slate-900">Waiting Queue</h1>
            <p className="text-sm text-slate-500 mt-0.5">
              {appointments.length} appointments waiting for scheduling
            </p>
          </div>
        </div>

        {/* Summary Card */}
        <div className="bg-gradient-to-r from-amber-500 to-orange-500 rounded-xl shadow-lg p-6 text-white">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-white/20 rounded-lg">
              <Users className="w-8 h-8" />
            </div>
            <div>
              <div className="text-3xl font-bold">{appointments.length}</div>
              <div className="text-sm opacity-90">Citizens waiting in queue</div>
            </div>
          </div>
          {appointments.length > 0 && (
            <div className="mt-4 pt-4 border-t border-white/20">
              <div className="text-sm">
                <strong>Oldest waiting:</strong> {getDaysWaiting(appointments[0].waiting_since)}{" "}
                days
              </div>
            </div>
          )}
        </div>

        {/* Queue Table */}
        {loading ? (
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-12 text-center">
            <RefreshCw className="w-8 h-8 text-slate-400 animate-spin mx-auto mb-3" />
            <p className="text-sm text-slate-500">Loading queue...</p>
          </div>
        ) : appointments.length === 0 ? (
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-12 text-center">
            <AlertCircle className="w-12 h-12 text-slate-300 mx-auto mb-3" />
            <h3 className="text-lg font-semibold text-slate-900 mb-2">No Waiting Appointments</h3>
            <p className="text-sm text-slate-500">All appointments have been scheduled!</p>
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">
                      Queue #
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">
                      Token
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">
                      Name
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">
                      Mobile
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">
                      Category
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">
                      Waiting Since
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">
                      Days
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">
                      Priority
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {appointments.map((appt) => {
                    const daysWaiting = getDaysWaiting(appt.waiting_since);
                    const isUrgent = daysWaiting >= 3;

                    return (
                      <tr
                        key={appt.id}
                        className={`hover:bg-slate-50 transition-colors ${
                          isUrgent ? "bg-red-50" : ""
                        }`}
                      >
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <div className="w-8 h-8 bg-amber-100 rounded-full flex items-center justify-center">
                              <span className="text-sm font-bold text-amber-700">
                                {appt.queue_position}
                              </span>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-sm font-semibold text-slate-900">
                            #{appt.token}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-sm text-slate-900">{appt.name}</span>
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-sm text-slate-600">{appt.mobile}</span>
                        </td>
                        <td className="px-4 py-3">
                          <span className="inline-flex px-2 py-1 text-xs font-medium rounded-full bg-blue-100 text-blue-700">
                            {appt.category || "General"}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-sm text-slate-600">
                            {formatDate(appt.waiting_since)}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`inline-flex items-center gap-1 text-sm font-semibold ${
                              isUrgent ? "text-red-600" : "text-slate-600"
                            }`}
                          >
                            <Clock className="w-4 h-4" />
                            {daysWaiting}d
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-sm font-semibold text-slate-900">
                            {appt.priority_score}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Info Box */}
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-blue-800">
              <p className="font-semibold mb-1">Auto-Scheduling</p>
              <p>
                When you set MLA availability, the system will automatically schedule appointments
                from this queue in priority order (oldest first). You can also manually schedule
                appointments from the appointments page.
              </p>
            </div>
          </div>
        </div>
      </main>
    </>
  );
}
