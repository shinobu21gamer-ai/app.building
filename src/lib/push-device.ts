import { apiRequest } from "@/lib/api-client";
import {
  getNativePlatform,
  getPushMode,
  readNativeToken,
} from "@/lib/capacitor-types";

/**
 * Everything the server needs to unregister the device the user is signing out
 * of — and nothing else. Sign-out must never disturb the push registration of
 * the user's other devices (a desktop browser, a second phone), so callers
 * send the identifiers of *this* device and the server scopes the change to it.
 */
export type PushDeviceIdentity = {
  /** Web-push endpoint for this browser profile, when subscribed. */
  endpoint?: string;
  /** Full web-push subscription, used to re-bind the endpoint after sign-in. */
  subscription?: PushSubscriptionJSON;
  /** FCM/APNs device token, when running inside the native shell. */
  token?: string;
  platform?: "android" | "ios";
};

const PUSH_SW_URL = "/push-sw.js";

/** Returns the live web-push subscription for this browser, if there is one. */
async function currentWebSubscription(): Promise<PushSubscription | null> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    return null;
  }
  try {
    const registration = await navigator.serviceWorker.getRegistration(PUSH_SW_URL);
    return (await registration?.pushManager.getSubscription()) ?? null;
  } catch {
    // Service workers are unavailable (insecure origin, private mode, …).
    return null;
  }
}

/**
 * Collects the identifiers of the current device. Never throws: failing to
 * identify the device must not block a sign-out.
 */
export async function collectPushDeviceIdentity(): Promise<PushDeviceIdentity> {
  const identity: PushDeviceIdentity = {};

  if (getPushMode() === "capacitor") {
    const token = readNativeToken();
    if (token) {
      identity.token = token;
      identity.platform = getNativePlatform();
    }
  }

  const subscription = await currentWebSubscription();
  if (subscription) {
    identity.endpoint = subscription.endpoint;
    identity.subscription = subscription.toJSON();
  }

  return identity;
}

/**
 * Tells the native Android layer whether a session is currently signed in.
 *
 * The alarm runs in a foreground service that Android can start while the app
 * is backgrounded, so it has no way to read the WebView session. This flag is
 * the bridge: the web layer is the single source of truth and the native layer
 * refuses to sound an alarm while it is false.
 *
 * No-ops outside the native shell.
 */
export function setNativeSessionActive(active: boolean): void {
  if (getPushMode() !== "capacitor") return;
  const bridge = (
    window as Window & {
      AlertBridge?: { setSessionActive?: (active: boolean) => void };
    }
  ).AlertBridge;
  if (typeof bridge?.setSessionActive !== "function") return;
  try {
    bridge.setSessionActive(active);
  } catch {
    // An APK without the bridge keeps its previous state; the server-side
    // device revocation on sign-out is still the primary defence.
  }
}

/**
 * Re-binds an existing browser push subscription to the account that is signed
 * in right now. Only ever runs when the browser already holds a subscription,
 * so this can never enable push for a user who never opted in.
 */
export async function syncWebPushRegistration(): Promise<void> {
  const subscription = await currentWebSubscription();
  if (!subscription) return;
  await apiRequest("/api/v1/alerts/push", {
    method: "POST",
    body: JSON.stringify(subscription.toJSON()),
  });
}
