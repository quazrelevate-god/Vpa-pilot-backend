"use client";

import { useState, useEffect } from "react";
import { Users, Clock, AlertCircle, RefreshCw, Info } from "lucide-react";

import TopBar from "@/components/TopBar";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn, formatDateTime } from "@/lib/utils";

interface WaitingAppointment {
  id: number; token: number; name: string; mobile: string; category: string;
  queue_position: number; waiting_since: string; priority_score: number; created_at: string;
}

export default function WaitingQueuePage() {
  const [appointments, setAppointments] = useState<WaitingAppointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => { loadQueue(); }, []);

  const loadQueue = async () => {
    try {
      setRefreshing(true);
      const response = await fetch("/api/v1/scheduling/admin/waiting-queue?limit=100");
      const data = await response.json();
      if (Array.isArray(data)) setAppointments(data);
      else { console.error("Invalid response format:", data); setAppointments([]); }
    } catch (error) {
      console.error("Failed to load queue:", error);
      setAppointments([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const getDaysWaiting = (waitingSince: string) => {
    const diff = Math.abs(Date.now() - new Date(waitingSince).getTime());
    return Math.floor(diff / (1000 * 60 * 60 * 24));
  };

  const th = "px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground";

  return (
    <>
      <TopBar
        rightSlot={
          <Button variant="outline" size="sm" onClick={loadQueue} disabled={refreshing}>
            <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} /> Refresh
          </Button>
        }
      />
      <main className="flex-1 overflow-y-auto bg-background">
        <div className="mx-auto max-w-[1200px] space-y-6 p-6 animate-in-up">
          {/* Title */}
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-extrabold tracking-tight text-foreground">
              <Users className="h-6 w-6 text-brand" /> Waiting Queue
            </h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {appointments.length} appointments waiting for scheduling.
            </p>
          </div>

          {/* Summary banner */}
          <Card className="relative overflow-hidden border-0 bg-gradient-to-r from-amber-500 to-orange-500 p-6 text-white shadow-card-md">
            <div className="pointer-events-none absolute -right-8 -top-8 h-32 w-32 rounded-full bg-white/10 blur-2xl" />
            <div className="relative flex items-center gap-4">
              <div className="grid h-14 w-14 place-items-center rounded-2xl bg-white/20 ring-1 ring-white/20">
                <Users className="h-7 w-7" />
              </div>
              <div>
                <div className="text-3xl font-extrabold tabular-nums">{appointments.length}</div>
                <div className="text-sm text-white/90">Citizens waiting in queue</div>
              </div>
              {appointments.length > 0 && (
                <div className="ml-auto rounded-xl bg-white/15 px-4 py-2 text-sm ring-1 ring-white/20">
                  <span className="opacity-80">Oldest waiting</span>{" "}
                  <span className="font-bold">{getDaysWaiting(appointments[0].waiting_since)} days</span>
                </div>
              )}
            </div>
          </Card>

          {/* Queue table */}
          {loading ? (
            <Card className="p-12 text-center">
              <RefreshCw className="mx-auto mb-3 h-8 w-8 animate-spin text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Loading queue…</p>
            </Card>
          ) : appointments.length === 0 ? (
            <Card className="p-12 text-center">
              <AlertCircle className="mx-auto mb-3 h-12 w-12 text-muted-foreground/30" />
              <h3 className="mb-1 text-lg font-semibold text-foreground">No Waiting Appointments</h3>
              <p className="text-sm text-muted-foreground">All appointments have been scheduled!</p>
            </Card>
          ) : (
            <Card className="overflow-hidden p-0">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[820px]">
                  <thead className="bg-muted/60">
                    <tr className="border-b border-border">
                      <th className={th}>Queue #</th>
                      <th className={th}>Token</th>
                      <th className={th}>Name</th>
                      <th className={th}>Mobile</th>
                      <th className={th}>Category</th>
                      <th className={th}>Waiting Since</th>
                      <th className={th}>Days</th>
                      <th className={th}>Priority</th>
                    </tr>
                  </thead>
                  <tbody>
                    {appointments.map((appt) => {
                      const daysWaiting = getDaysWaiting(appt.waiting_since);
                      const isUrgent = daysWaiting >= 3;
                      return (
                        <tr key={appt.id} className={cn("border-b border-border/70 transition-colors hover:bg-muted/40", isUrgent && "bg-red-50/60")}>
                          <td className="px-4 py-3">
                            <div className="grid h-8 w-8 place-items-center rounded-full bg-amber-100 text-sm font-bold text-amber-700">
                              {appt.queue_position}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-sm font-semibold text-foreground">#{appt.token}</td>
                          <td className="px-4 py-3 text-sm text-foreground">{appt.name}</td>
                          <td className="px-4 py-3 text-sm text-muted-foreground">{appt.mobile}</td>
                          <td className="px-4 py-3">
                            <span className="inline-flex rounded-full bg-brand/10 px-2.5 py-0.5 text-xs font-medium text-brand">
                              {appt.category || "General"}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-sm text-muted-foreground">{formatDateTime(appt.waiting_since)}</td>
                          <td className="px-4 py-3">
                            <span className={cn("inline-flex items-center gap-1 text-sm font-semibold", isUrgent ? "text-red-600" : "text-muted-foreground")}>
                              <Clock className="h-4 w-4" /> {daysWaiting}d
                            </span>
                          </td>
                          <td className="px-4 py-3 text-sm font-semibold tabular-nums text-foreground">{appt.priority_score}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {/* Info box */}
          <div className="flex items-start gap-3 rounded-xl border border-brand/20 bg-brand/5 p-4">
            <Info className="mt-0.5 h-5 w-5 flex-shrink-0 text-brand" />
            <div className="text-sm text-foreground/80">
              <p className="mb-1 font-semibold text-foreground">Auto-Scheduling</p>
              <p>
                When you set MLA availability, the system automatically schedules appointments from
                this queue in priority order (oldest first). You can also manually schedule from the
                appointments page.
              </p>
            </div>
          </div>
        </div>
      </main>
    </>
  );
}
