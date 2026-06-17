import type { ReactNode } from "react";
import { Icon, type IconName } from "./Icon";

type Tone = "default" | "ok" | "warn";

interface EmptyStateProps {
  icon?: IconName;
  tone?: Tone;
  title: string;
  message: string;
  action?: ReactNode;
}

export function EmptyState({
  icon = "inbox",
  tone = "default",
  title,
  message,
  action,
}: EmptyStateProps) {
  return (
    <div className="empty-state">
      <div
        className={`empty-state__icon${
          tone !== "default" ? ` empty-state__icon--${tone}` : ""
        }`}
      >
        <Icon name={icon} size={26} />
      </div>
      <h3 className="empty-state__title">{title}</h3>
      <p className="empty-state__msg">{message}</p>
      {action && <div className="empty-state__action">{action}</div>}
    </div>
  );
}
