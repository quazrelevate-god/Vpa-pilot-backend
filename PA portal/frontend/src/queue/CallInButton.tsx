import { useState } from "react";
import { api } from "../api/client";
import { useToast } from "../shared/components/Toast";
import { Icon } from "../shared/components/Icon";
import type { Case } from "../shared/types";

interface CallInButtonProps {
  caseRecord: Case;
  onUpdated: (updated: Case) => void;
}

export function CallInButton({ caseRecord, onUpdated }: CallInButtonProps) {
  const [busy, setBusy] = useState(false);
  const { notify } = useToast();

  // Once a case is past "waiting" it's already been called / is being seen.
  const alreadyHandled = caseRecord.status !== "waiting";

  const handleClick = async () => {
    setBusy(true);
    try {
      const updated = await api.callIn(caseRecord.id);
      onUpdated(updated);
      notify(`${caseRecord.citizenName} has been called in.`, "success");
    } catch (e) {
      notify(
        e instanceof Error ? e.message : "Couldn't call this person in.",
        "error"
      );
    } finally {
      setBusy(false);
    }
  };

  if (alreadyHandled) {
    const inMeeting = caseRecord.status === "in_meeting";
    return (
      <span
        className={`callin callin--done${inMeeting ? " callin--meeting" : ""}`}
        aria-label={inMeeting ? "In meeting" : "Already called in"}
      >
        <Icon name={inMeeting ? "user" : "checkCircle"} size={14} />
        {inMeeting ? "In meeting" : "Called"}
      </span>
    );
  }

  return (
    <button
      className="btn btn--primary btn--sm callin"
      onClick={handleClick}
      disabled={busy}
    >
      {busy ? (
        "Calling…"
      ) : (
        <>
          <Icon name="phone" size={15} /> Call in
        </>
      )}
    </button>
  );
}
