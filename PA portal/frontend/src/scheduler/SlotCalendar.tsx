import { Icon } from "../shared/components/Icon";
import type { Slot } from "../shared/types";

function formatBlock(startTime: string): string {
  const [h, m] = startTime.split(":").map(Number);
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

interface SlotCardProps {
  slot: Slot;
  index: number;
  onBook: (slot: Slot) => void;
}

function SlotCard({ slot, index, onBook }: SlotCardProps) {
  const free = slot.capacity - slot.bookedCount;
  const isFull = free <= 0;
  const pct = Math.round((slot.bookedCount / slot.capacity) * 100);
  const tone = isFull ? "full" : free <= 1 ? "low" : "ok";

  return (
    <div
      className={`slot-card slot-card--${tone}`}
      style={{ animationDelay: `${Math.min(index, 10) * 40}ms` }}
    >
      <div className="slot-card__top">
        <span className="slot-card__time">
          <Icon name="clock" size={17} />
          {formatBlock(slot.startTime)}
        </span>
        <span className={`slot-chip slot-chip--${tone}`}>
          {isFull ? "Full" : `${free} free`}
        </span>
      </div>

      <div className="slot-meter" aria-hidden="true">
        <div
          className={`slot-meter__fill slot-meter__fill--${tone}`}
          style={{ width: `${pct}%` }}
        />
      </div>

      <p className="slot-card__count">
        <strong>{slot.bookedCount}</strong> of <strong>{slot.capacity}</strong> booked
      </p>

      <button
        className="btn btn--primary slot-card__btn"
        onClick={() => onBook(slot)}
        disabled={isFull}
      >
        {isFull ? (
          "No space left"
        ) : (
          <>
            Book this slot <Icon name="arrowRight" size={16} />
          </>
        )}
      </button>
    </div>
  );
}

interface SlotCalendarProps {
  slots: Slot[];
  onBook: (slot: Slot) => void;
}

export function SlotCalendar({ slots, onBook }: SlotCalendarProps) {
  return (
    <div className="slot-grid">
      {slots.map((s, i) => (
        <SlotCard key={s.id} slot={s} index={i} onBook={onBook} />
      ))}
    </div>
  );
}
