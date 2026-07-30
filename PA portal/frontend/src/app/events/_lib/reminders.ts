// Web-push reminder subscription flow for the events PWA.
//
// Reviewers are always-on: their role gets 9 PM night-before + 9 AM morning
// + T-60min reminders for every event. This module owns the client-side
// dance:
//
//   1. Ask the backend for the VAPID public key (503 → feature off, bail).
//   2. Check Notification.permission:
//        granted → subscribe silently, POST to backend.
//        default → surface the enable banner; user click triggers the
//                  native permission prompt, then subscribe.
//        denied  → surface the "reminders blocked" banner; only the user
//                  can un-block from browser settings.
//   3. Re-check on tab focus (permission can change from settings while
//      we're in the background).
//
// We DO NOT toggle a preference — reviewers can only turn OFF by revoking
// permission from browser settings. The role-carries-mandate is enforced
// UX-side; the backend simply pushes to every active subscription.

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";

export type PermissionState = "unsupported" | "unavailable" | "default" | "granted" | "denied";

const VAPID_KEY_CACHE = { key: null as string | null, tried: false };

/** Convert a base64-URL VAPID public key to an ArrayBuffer as the browser
 *  wants. Uses ArrayBuffer (not Uint8Array) because
 *  PushManager.subscribe's `applicationServerKey` typing is
 *  `BufferSource` and the Uint8Array<ArrayBufferLike> the compiler
 *  infers from `new Uint8Array(n)` doesn't cleanly narrow to it. */
function base64UrlToBuffer(b64: string): ArrayBuffer {
  const padding = "=".repeat((4 - (b64.length % 4)) % 4);
  const s = (b64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(s);
  const buf = new ArrayBuffer(raw.length);
  const view = new Uint8Array(buf);
  for (let i = 0; i < raw.length; i++) view[i] = raw.charCodeAt(i);
  return buf;
}

function browserSupportsPush(): boolean {
  return typeof window !== "undefined"
    && "serviceWorker" in navigator
    && "PushManager" in window
    && "Notification" in window;
}

async function getVapidKey(): Promise<string | null> {
  if (VAPID_KEY_CACHE.tried) return VAPID_KEY_CACHE.key;
  VAPID_KEY_CACHE.tried = true;
  try {
    const { public_key } = await api.vapidPublicKey();
    VAPID_KEY_CACHE.key = public_key;
    return public_key;
  } catch {
    // 503 (push disabled) or any error — feature is off for this deploy.
    return null;
  }
}

async function currentSubscription(): Promise<PushSubscription | null> {
  if (!browserSupportsPush()) return null;
  const reg = await navigator.serviceWorker.getRegistration("/events/");
  if (!reg) return null;
  return reg.pushManager.getSubscription();
}

/** Subscribe (or upgrade the existing subscription) and POST to backend. */
async function subscribeAndRegister(): Promise<PushSubscription | null> {
  const key = await getVapidKey();
  if (!key) return null;
  const reg = await navigator.serviceWorker.ready;
  // If we already have a live subscription (same VAPID key), reuse it.
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: base64UrlToBuffer(key),
    });
  }
  const raw = sub.toJSON();
  await api.pushSubscribe({
    endpoint: raw.endpoint as string,
    keys: {
      p256dh: (raw.keys as Record<string, string>).p256dh,
      auth:   (raw.keys as Record<string, string>).auth,
    },
    device_label: navigator.userAgent.slice(0, 200),
  });
  return sub;
}

/** Owns the reviewer subscription lifecycle. Auto-subscribes silently
 *  when permission is already granted; surfaces `permission` so the UI
 *  can prompt on user click for the `default` case. */
export function useEventReminders(enabled: boolean): {
  permission: PermissionState;
  /** Trigger the browser's permission prompt + subscribe. Must be called
   *  from a user gesture — iOS Safari drops the prompt otherwise. */
  enable: () => Promise<void>;
  busy: boolean;
} {
  const [permission, setPermission] = useState<PermissionState>("unsupported");
  const [busy, setBusy] = useState(false);
  // Guards the "already tried to auto-subscribe this session" flag —
  // stops us re-POSTing on every re-render.
  const attempted = useRef(false);

  const reevaluate = useCallback(async () => {
    if (!enabled) return;
    if (!browserSupportsPush()) { setPermission("unsupported"); return; }
    const key = await getVapidKey();
    if (!key) { setPermission("unavailable"); return; }
    const p = Notification.permission;
    setPermission(p as PermissionState);
    // Already granted — subscribe silently once per session.
    if (p === "granted" && !attempted.current) {
      attempted.current = true;
      try { await subscribeAndRegister(); } catch { /* non-fatal */ }
    }
  }, [enabled]);

  useEffect(() => { reevaluate(); }, [reevaluate]);

  // Permission can change while the tab is backgrounded (user opens
  // browser settings, unblocks). Re-check on visibility flip.
  useEffect(() => {
    const onVis = () => { if (!document.hidden) reevaluate(); };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [reevaluate]);

  const enable = useCallback(async () => {
    if (busy) return;
    if (!browserSupportsPush()) return;
    setBusy(true);
    try {
      // requestPermission MUST be called from a user gesture on iOS.
      const p = await Notification.requestPermission();
      setPermission(p as PermissionState);
      if (p === "granted") {
        attempted.current = true;
        await subscribeAndRegister();
      }
    } catch {
      /* user cancelled or subscribe failed — banner stays visible */
    } finally {
      setBusy(false);
    }
  }, [busy]);

  return { permission, enable, busy };
}
