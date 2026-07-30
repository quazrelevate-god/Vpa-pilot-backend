"use client";

// A slim banner shown only when the user is a reviewer AND either:
//   • hasn't yet granted notification permission (default) — offer Enable
//   • has denied it (denied)                              — nudge to unblock
// When permission is `granted` or the feature is off (unavailable /
// unsupported), the banner hides entirely — there's nothing for the user
// to do.

import { Bell, BellOff, X } from "../_lib/icons";
import type { PermissionState } from "../_lib/reminders";
import { useT } from "../_lib/i18n";

export default function RemindersBanner({
  permission, busy, onEnable, onDismiss,
}: {
  permission: PermissionState;
  busy: boolean;
  onEnable: () => void;
  onDismiss?: () => void;
}) {
  const { t } = useT();

  if (permission === "granted" || permission === "unsupported" || permission === "unavailable") {
    return null;
  }

  const isDenied = permission === "denied";

  return (
    <div className={
      "flex items-start gap-3 border-b px-4 py-3 text-[13px] " +
      (isDenied
        ? "border-red-200 bg-red-50 text-red-700"
        : "border-amber-200 bg-amber-50 text-amber-800")
    }>
      <span className="mt-0.5 shrink-0">
        {isDenied
          ? <BellOff className="h-4 w-4" strokeWidth={2} />
          : <Bell    className="h-4 w-4" strokeWidth={2} />}
      </span>
      <div className="min-w-0 flex-1">
        {isDenied ? (
          <>
            <div className="font-bold">
              {t("Event reminders are blocked", "நிகழ்வு நினைவூட்டல்கள் தடுக்கப்பட்டன")}
            </div>
            <div className="mt-0.5 opacity-90">
              {t(
                "Unblock notifications in your browser settings so you don't miss the Minister's calls.",
                "அமைச்சரின் நிகழ்வுகளை தவறவிடாமல் இருக்க உங்கள் உலாவி அமைப்பில் அறிவிப்புகளை அனுமதிக்கவும்.",
              )}
            </div>
          </>
        ) : (
          <>
            <div className="font-bold">
              {t("Turn on event reminders", "நிகழ்வு நினைவூட்டல்களை இயக்கவும்")}
            </div>
            <div className="mt-0.5 opacity-90">
              {t(
                "Reviewers get a nudge the night before, on the morning of, and one hour before every event.",
                "மதிப்பாய்வாளர்களுக்கு முதல் நாள் இரவு, அன்று காலை, நிகழ்வுக்கு ஒரு மணி நேரம் முன் நினைவூட்டல் வரும்.",
              )}
            </div>
            <button
              onClick={onEnable}
              disabled={busy}
              className="mt-2 inline-flex h-9 items-center gap-1.5 rounded-lg bg-amber-600 px-3 text-[13px] font-bold text-white transition-colors hover:bg-amber-700 disabled:opacity-60"
            >
              <Bell className="h-3.5 w-3.5" strokeWidth={2} />
              {busy
                ? t("Enabling…", "இயக்கப்படுகிறது…")
                : t("Enable reminders", "நினைவூட்டல்களை இயக்கு")}
            </button>
          </>
        )}
      </div>
      {onDismiss && !isDenied && (
        <button
          onClick={onDismiss}
          aria-label={t("Dismiss", "மூடு")}
          className="shrink-0 rounded-md p-1 text-current/60 transition-colors hover:bg-black/5"
        >
          <X className="h-3.5 w-3.5" strokeWidth={2} />
        </button>
      )}
    </div>
  );
}
