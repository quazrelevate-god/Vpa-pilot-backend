"use client";

import { useState, useEffect } from "react";
import { Calendar, Clock, Users, AlertCircle, CheckCircle, ChevronRight } from "lucide-react";

import TopBar from "@/components/TopBar";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface MLA { id: number; name: string; constituency: string; is_active: boolean; }
interface Statistics { waiting_count: number; scheduled_today: number; oldest_waiting_days: number; }
interface TodaySchedule {
  has_availability: boolean;
  total_slots?: number; booked_slots?: number; remaining_slots?: number;
  time_range?: string; date?: string; message?: string;
}

export default function SchedulingPage() {
  const [, setMlas] = useState<MLA[]>([]);
  const [statistics, setStatistics] = useState<Statistics | null>(null);
  const [todaySchedule, setTodaySchedule] = useState<TodaySchedule | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const [formData, setFormData] = useState({
    mla_id: "1",
    date: new Date().toISOString().split("T")[0],
    start_time: "16:00",
    end_time: "18:00",
    slot_duration_minutes: 5,
    window_duration_minutes: 30,
  });

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    try {
      const mlasRes = await fetch("/api/v1/scheduling/admin/mlas");
      const mlasData = await mlasRes.json();
      if (Array.isArray(mlasData)) {
        setMlas(mlasData);
        if (mlasData.length > 0 && !formData.mla_id) {
          setFormData((prev) => ({ ...prev, mla_id: mlasData[0].id.toString() }));
        }
      }
      const statsRes = await fetch("/api/v1/scheduling/admin/statistics");
      const statsData = await statsRes.json();
      if (statsData && !statsData.error) setStatistics(statsData);

      const scheduleRes = await fetch("/api/v1/scheduling/admin/today-schedule");
      const scheduleData = await scheduleRes.json();
      if (scheduleData && !scheduleData.error) setTodaySchedule(scheduleData);
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
        setMessage({ type: "success", text: `Success! ${data.message}` });
        loadData();
      } else {
        setMessage({ type: "error", text: data.error || "Failed to set availability" });
      }
    } catch {
      setMessage({ type: "error", text: "Network error. Please try again." });
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

  const labelCls = "mb-1.5 block text-xs font-semibold uppercase tracking-wider text-muted-foreground";
  const selectCls = "h-10 w-full rounded-lg border border-input bg-card px-3 text-sm shadow-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20";

  const stats = statistics
    ? [
        { icon: Users,       value: statistics.waiting_count,      label: "Waiting in Queue",   color: "text-amber-600",   bg: "bg-amber-100" },
        { icon: CheckCircle, value: statistics.scheduled_today,    label: "Scheduled Today",    color: "text-emerald-600", bg: "bg-emerald-100" },
        { icon: AlertCircle, value: statistics.oldest_waiting_days, label: "Oldest Waiting (days)", color: "text-red-600",  bg: "bg-red-100" },
      ]
    : [];

  return (
    <>
      <TopBar />
      <main className="flex-1 overflow-y-auto bg-background">
        <div className="mx-auto max-w-[1100px] space-y-6 p-6 animate-in-up">
          {/* Title */}
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-extrabold tracking-tight text-foreground">
              <Clock className="h-6 w-6 text-brand" /> Availability &amp; Scheduling
            </h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Set time-slot availability for citizen appointments.
            </p>
          </div>

          {/* Stats */}
          {stats.length > 0 && (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              {stats.map((s) => (
                <Card key={s.label} className="p-5">
                  <div className="flex items-center gap-3">
                    <div className={cn("grid h-11 w-11 place-items-center rounded-xl", s.bg)}>
                      <s.icon className={cn("h-5 w-5", s.color)} />
                    </div>
                    <div>
                      <div className="text-2xl font-extrabold tabular-nums text-foreground">{s.value}</div>
                      <div className="text-xs text-muted-foreground">{s.label}</div>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
            {/* Set Availability Form */}
            <Card className="p-6 lg:col-span-3">
              <h2 className="mb-4 text-lg font-bold text-foreground">Set Availability</h2>

              {message && (
                <div className={cn(
                  "mb-4 rounded-lg border px-4 py-3 text-sm",
                  message.type === "success"
                    ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                    : "border-red-200 bg-red-50 text-red-800"
                )}>
                  {message.text}
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label className={labelCls}>Date</label>
                    <Input type="date" value={formData.date}
                      onChange={(e) => setFormData({ ...formData, date: e.target.value })} required />
                  </div>
                  <div>
                    <label className={labelCls}>Start Time</label>
                    <Input type="time" value={formData.start_time}
                      onChange={(e) => setFormData({ ...formData, start_time: e.target.value })} required />
                  </div>
                  <div>
                    <label className={labelCls}>End Time</label>
                    <Input type="time" value={formData.end_time}
                      onChange={(e) => setFormData({ ...formData, end_time: e.target.value })} required />
                  </div>
                  <div>
                    <label className={labelCls}>Slot Duration</label>
                    <select className={selectCls} value={formData.slot_duration_minutes}
                      onChange={(e) => setFormData({ ...formData, slot_duration_minutes: parseInt(e.target.value) })}>
                      <option value="5">5 minutes</option>
                      <option value="10">10 minutes</option>
                      <option value="15">15 minutes</option>
                    </select>
                  </div>
                  <div>
                    <label className={labelCls}>Window Duration</label>
                    <select className={selectCls} value={formData.window_duration_minutes}
                      onChange={(e) => setFormData({ ...formData, window_duration_minutes: parseInt(e.target.value) })}>
                      <option value="30">30 minutes</option>
                      <option value="60">60 minutes</option>
                    </select>
                  </div>
                </div>

                <div className="flex items-center gap-2 rounded-lg border border-brand/20 bg-brand/5 px-4 py-3 text-sm text-brand">
                  <Clock className="h-4 w-4" />
                  <span className="font-semibold">Calculated:</span>
                  <span>{calculateTotalSlots()} slots ({formData.slot_duration_minutes} min each)</span>
                </div>

                <Button type="submit" size="lg" disabled={loading} className="w-full">
                  {loading ? "Setting Availability…" : "Set Availability & Auto-Schedule Queue"}
                </Button>
              </form>
            </Card>

            {/* Today's schedule */}
            <Card className="p-6 lg:col-span-2">
              <h2 className="mb-4 text-lg font-bold text-foreground">Today's Schedule</h2>
              {todaySchedule?.has_availability ? (
                <div className="space-y-3">
                  {[
                    { label: "Time Range", value: todaySchedule.time_range, cls: "text-foreground" },
                    { label: "Total Slots", value: todaySchedule.total_slots, cls: "text-foreground" },
                    { label: "Booked", value: todaySchedule.booked_slots, cls: "text-emerald-600" },
                    { label: "Remaining", value: todaySchedule.remaining_slots, cls: "text-amber-600" },
                  ].map((r) => (
                    <div key={r.label} className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">{r.label}</span>
                      <span className={cn("text-sm font-semibold", r.cls)}>{r.value}</span>
                    </div>
                  ))}
                  <div className="border-t border-border pt-4">
                    <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-emerald-500 transition-all"
                        style={{ width: `${((todaySchedule.booked_slots || 0) / (todaySchedule.total_slots || 1)) * 100}%` }}
                      />
                    </div>
                  </div>
                </div>
              ) : (
                <div className="py-10 text-center">
                  <AlertCircle className="mx-auto mb-3 h-12 w-12 text-muted-foreground/30" />
                  <p className="text-sm text-muted-foreground">No availability set for today.</p>
                </div>
              )}
            </Card>
          </div>

          {/* Quick actions */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {[
              { href: "/waiting-queue", title: "View Waiting Queue", sub: `Manage ${statistics?.waiting_count || 0} waiting appointments`, icon: Users },
              { href: "/appointments",  title: "View All Appointments", sub: `See ${statistics?.scheduled_today || 0} scheduled today`, icon: Calendar },
            ].map((a) => (
              <a key={a.href} href={a.href} className="group">
                <Card className="p-6 transition-all hover:-translate-y-0.5 hover:shadow-card-lg">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="grid h-11 w-11 place-items-center rounded-xl bg-brand/10 text-brand">
                        <a.icon className="h-5 w-5" />
                      </div>
                      <div>
                        <h3 className="font-bold text-foreground">{a.title}</h3>
                        <p className="text-sm text-muted-foreground">{a.sub}</p>
                      </div>
                    </div>
                    <ChevronRight className="h-5 w-5 text-muted-foreground transition-transform group-hover:translate-x-1" />
                  </div>
                </Card>
              </a>
            ))}
          </div>
        </div>
      </main>
    </>
  );
}
