import { useMemo, useState } from "react";
import { useSlots } from "./useSlots";
import { SlotCalendar } from "./SlotCalendar";
import { BookAppointmentModal } from "./BookAppointmentModal";
import { EmptyState } from "../shared/components/EmptyState";
import { SlotSkeleton } from "../shared/components/Skeleton";
import { Icon } from "../shared/components/Icon";
import type { Slot } from "../shared/types";

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function prettyDate(date: string): string {
  return new Date(`${date}T00:00:00`).toLocaleDateString([], {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

// Build a strip of the next 7 days for quick selection.
function nextDays(count: number): string[] {
  const base = new Date();
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(base);
    d.setDate(base.getDate() + i);
    return isoDate(d);
  });
}

export function SchedulerPage() {
  const days = useMemo(() => nextDays(7), []);
  const [selectedDate, setSelectedDate] = useState(days[0]);
  const [activeSlot, setActiveSlot] = useState<Slot | null>(null);

  const { slots, loading, error, reload } = useSlots(selectedDate);

  const totals = useMemo(() => {
    const capacity = slots.reduce((s, x) => s + x.capacity, 0);
    const booked = slots.reduce((s, x) => s + x.bookedCount, 0);
    return { capacity, booked, free: capacity - booked };
  }, [slots]);

  return (
    <div className="page">
      <div className="page__head">
        <div>
          <h1 className="page__title">Scheduler</h1>
          <p className="page__subtitle">
            Book a citizen into a future appointment so they don't have to wait
            in line. Pick a day, then choose an open time slot.
          </p>
        </div>
      </div>

      {/* Quick day selector */}
      <div className="day-strip" role="tablist" aria-label="Choose a day">
        {days.map((d, i) => {
          const date = new Date(`${d}T00:00:00`);
          const active = d === selectedDate;
          return (
            <button
              key={d}
              role="tab"
              aria-selected={active}
              className={`day-pill${active ? " day-pill--active" : ""}`}
              onClick={() => setSelectedDate(d)}
            >
              <span className="day-pill__dow">
                {i === 0
                  ? "Today"
                  : i === 1
                  ? "Tomorrow"
                  : date.toLocaleDateString([], { weekday: "short" })}
              </span>
              <span className="day-pill__date">
                {date.toLocaleDateString([], { day: "numeric", month: "short" })}
              </span>
            </button>
          );
        })}
        <label className="day-picker">
          <span className="day-picker__label">Other date</span>
          <input
            type="date"
            className="day-picker__input"
            value={selectedDate}
            min={days[0]}
            onChange={(e) => e.target.value && setSelectedDate(e.target.value)}
          />
        </label>
      </div>

      <div className="scheduler-head">
        <h2 className="scheduler-head__title">{prettyDate(selectedDate)}</h2>
        {!loading && !error && slots.length > 0 && (
          <span className="scheduler-head__summary">
            <strong>{totals.free}</strong> open of {totals.capacity} across{" "}
            {slots.length} slots
          </span>
        )}
      </div>

      {loading ? (
        <SlotSkeleton count={8} />
      ) : error ? (
        <div className="card">
          <EmptyState
            icon="alert"
            tone="warn"
            title="Couldn't load slots"
            message={error}
            action={
              <button className="btn btn--primary" onClick={reload}>
                <Icon name="refresh" size={16} /> Try again
              </button>
            }
          />
        </div>
      ) : slots.length === 0 ? (
        <div className="card">
          <EmptyState
            icon="inbox"
            title="No slots for this day"
            message="There's no appointment capacity configured for this date. Try another day."
          />
        </div>
      ) : (
        <SlotCalendar slots={slots} onBook={setActiveSlot} />
      )}

      <BookAppointmentModal
        slot={activeSlot}
        onClose={() => setActiveSlot(null)}
        onBooked={() => {
          setActiveSlot(null);
          reload();
        }}
      />
    </div>
  );
}
