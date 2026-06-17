import type { CaseStatus } from "../types";

const LABELS: Record<CaseStatus, string> = {
  waiting: "Waiting",
  called: "Called in",
  in_meeting: "In meeting",
  closed: "Closed",
  rescheduled: "Rescheduled",
};

export function StatusBadge({ status }: { status: CaseStatus }) {
  return (
    <span className={`badge badge--${status}`}>
      <span className="badge__dot" aria-hidden="true" />
      {LABELS[status]}
    </span>
  );
}
