// Skeleton placeholders — calmer and more professional than a spinner for
// content that has a known shape (queue rows, slot cards).

export function QueueSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div aria-hidden="true">
      {Array.from({ length: rows }).map((_, i) => (
        <div className="sk-row" key={i}>
          <span className="skeleton" style={{ height: 36, width: 110 }} />
          <div className="sk-main">
            <span
              className="skeleton"
              style={{ height: 40, width: 40, borderRadius: 11 }}
            />
            <div style={{ flex: 1, display: "grid", gap: 8 }}>
              <span className="skeleton" style={{ height: 13, width: "45%" }} />
              <span className="skeleton" style={{ height: 11, width: "80%" }} />
            </div>
          </div>
          <span className="skeleton" style={{ height: 24, width: 96, borderRadius: 999 }} />
          <span className="skeleton" style={{ height: 36, width: 96, borderRadius: 10 }} />
        </div>
      ))}
    </div>
  );
}

export function SlotSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div className="slot-grid" aria-hidden="true">
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="card"
          style={{ padding: 18, display: "grid", gap: 14 }}
        >
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span className="skeleton" style={{ height: 22, width: 80 }} />
            <span className="skeleton" style={{ height: 20, width: 56, borderRadius: 999 }} />
          </div>
          <span className="skeleton" style={{ height: 7, width: "100%", borderRadius: 999 }} />
          <span className="skeleton" style={{ height: 12, width: "55%" }} />
          <span className="skeleton" style={{ height: 38, width: "100%", borderRadius: 10 }} />
        </div>
      ))}
    </div>
  );
}
