import { useMemo } from "react";
import { useQueue } from "./useQueue";
import { QueueTable } from "./QueueTable";
import { EmptyState } from "../shared/components/EmptyState";
import { QueueSkeleton } from "../shared/components/Skeleton";
import { Icon, type IconName } from "../shared/components/Icon";

function todayLabel(): string {
  return new Date().toLocaleDateString([], {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

interface StatDef {
  key: string;
  value: number;
  label: string;
  icon: IconName;
  mod: string;
}

function StatCard({ stat }: { stat: StatDef }) {
  return (
    <div className={`stat stat--${stat.mod}`}>
      <span className="stat__icon">
        <Icon name={stat.icon} size={20} />
      </span>
      <div className="stat__body">
        <span className="stat__value">{stat.value}</span>
        <span className="stat__label">{stat.label}</span>
      </div>
    </div>
  );
}

export function QueuePage() {
  const { cases, loading, refreshing, error, lastUpdated, refresh, applyCase } =
    useQueue();

  const stats: StatDef[] = useMemo(() => {
    const count = (s: string) => cases.filter((c) => c.status === s).length;
    return [
      { key: "total", value: cases.length, label: "In queue", icon: "queue", mod: "total" },
      { key: "waiting", value: count("waiting"), label: "Waiting", icon: "clock", mod: "waiting" },
      { key: "called", value: count("called"), label: "Called in", icon: "checkCircle", mod: "called" },
      { key: "meeting", value: count("in_meeting"), label: "In meeting", icon: "user", mod: "meeting" },
    ];
  }, [cases]);

  return (
    <div className="page">
      <div className="page__head">
        <div>
          <h1 className="page__title">Live Queue</h1>
          <p className="page__subtitle">
            Everyone here today — walk-ins and booked appointments — in the order
            they should be seen. {todayLabel()}.
          </p>
        </div>
        <div className="page__head-actions">
          <span
            className="updated-pill"
            title="The list refreshes on its own every few seconds"
          >
            <span className={`updated-pill__dot${refreshing ? " is-pulsing" : ""}`} />
            {refreshing
              ? "Refreshing…"
              : lastUpdated
              ? `Updated ${lastUpdated.toLocaleTimeString([], {
                  hour: "numeric",
                  minute: "2-digit",
                })}`
              : "Live"}
          </span>
          <button className="btn btn--ghost btn--sm" onClick={refresh} disabled={refreshing}>
            <Icon name="refresh" size={15} /> Refresh
          </button>
        </div>
      </div>

      {!loading && !error && cases.length > 0 && (
        <div className="stat-strip">
          {stats.map((s) => (
            <StatCard key={s.key} stat={s} />
          ))}
        </div>
      )}

      {loading ? (
        <div className="card card--flush">
          <QueueSkeleton rows={5} />
        </div>
      ) : error ? (
        <div className="card">
          <EmptyState
            icon="alert"
            tone="warn"
            title="Couldn't load the queue"
            message={error}
            action={
              <button className="btn btn--primary" onClick={refresh}>
                <Icon name="refresh" size={16} /> Try again
              </button>
            }
          />
        </div>
      ) : cases.length === 0 ? (
        <div className="card">
          <EmptyState
            icon="partyCheck"
            tone="ok"
            title="No one is waiting"
            message="The queue is empty right now. New walk-ins and today's appointments will appear here automatically."
          />
        </div>
      ) : (
        <div className="card card--flush">
          <QueueTable cases={cases} onUpdated={applyCase} />
        </div>
      )}
    </div>
  );
}
