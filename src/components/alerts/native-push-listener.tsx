"use client";

import { useEffect, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { PushNotifications } from "@capacitor/push-notifications";
import { apiRequest } from "@/lib/api-client";
import { nativePushOptedOut } from "@/lib/native-push-preference";
import { setNativeSessionActive } from "@/lib/push-device";
import {
  ensureSeverityChannels,
  getNativePlatform,
  rememberNativeToken,
  toNativeAlertView,
  type NativeAlertPayload,
} from "@/lib/capacitor-types";
import {
  readPushDiagnostics,
  requestNativePushToken,
  waitForAlertBridge,
} from "@/lib/native-diagnostics";

type PushStatus = "idle" | "registering" | "registered" | "failed";

/**
 * Registers the device's FCM token with the server so Android can receive alerts
 * while the app is backgrounded. Mounted globally in the root layout.
 *
 * Two registration paths exist on purpose:
 *
 * 1. `AlertBridge.requestPushToken()` (current APKs) registers inside the app's
 *    own code, which catches every failure. The Capacitor plugin's
 *    `register()` throws on a background thread when a build has no Firebase
 *    configuration, and Capacitor turns that into an uncaught RuntimeException
 *    that closes the whole app with no warning — so it is never the first choice.
 * 2. The plugin call is the fallback for APKs built before that bridge existed.
 *
 * A build whose diagnostics say push cannot work is not asked to register at
 * all; it reports the reason instead.
 */
export function NativePushListener({ enabled = true }: { enabled?: boolean }) {
  const [status, setStatus] = useState<PushStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const isNative = typeof window !== "undefined" && Capacitor.isNativePlatform();

  useEffect(() => {
    if (!enabled) return;
    if (!Capacitor.isNativePlatform()) return;

    let cancelled = false;
    let settled = false;
    let timeoutId: number | null = null;
    const handles: Array<{ remove: () => void }> = [];

    const clearTimer = () => {
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
        timeoutId = null;
      }
    };

    /** Reports a failure once, and answers any UI waiting on the token event. */
    const fail = (message: string) => {
      if (cancelled) return;
      settled = true;
      clearTimer();
      setDismissed(false);
      setStatus("failed");
      setError(message);
      window.dispatchEvent(
        new CustomEvent("native-token-registration", {
          detail: { registered: false, message },
        })
      );
    };

    const persistToken = async (token: string) => {
      if (cancelled || nativePushOptedOut()) return;
      try {
        await ensureSeverityChannels();
        rememberNativeToken(token);
        const result = await apiRequest<{ registered: boolean }>("/api/v1/alerts/push/token", {
          method: "POST",
          body: JSON.stringify({ token, platform: getNativePlatform() }),
        });
        if (!result.success || !result.data.registered) {
          const message = result.success
            ? "The server did not confirm this device registration."
            : result.error.message;
          window.dispatchEvent(
            new CustomEvent("native-token-registration", {
              detail: { token, registered: false, message },
            })
          );
          throw new Error(message);
        }
        if (cancelled || nativePushOptedOut()) return;
        setNativeSessionActive(true);
        settled = true;
        clearTimer();
        window.dispatchEvent(
          new CustomEvent("native-token-registration", {
            detail: { token, registered: true },
          })
        );
        if (!cancelled) setStatus("registered");
      } catch (e) {
        console.error("[push] token registration failed:", e);
        fail(e instanceof Error ? e.message : "registration failed");
      }
    };

    const handleTokenRefreshed = (event: Event) => {
      const token = (event as CustomEvent<{ token?: string }>).detail?.token;
      if (!token) return;
      void persistToken(token);
    };

    const handleNativePushError = (event: Event) => {
      const message = (event as CustomEvent<{ message?: string }>).detail?.message;
      if (!message) return;
      console.error("[push] native registration error:", message);
      fail(message);
    };

    const handlePushReceived = (notification: { data?: unknown }) => {
      const data = (notification?.data ?? {}) as NativeAlertPayload;
      window.dispatchEvent(new CustomEvent("native-push-received", { detail: toNativeAlertView(data) }));
    };

    const handleRegistration = async (token: { value: string }) => {
      await persistToken(token.value);
    };

    const handleRegistrationError = (error: { error: string }) => {
      console.error("[push] registration error:", error?.error);
      fail(error?.error ?? "registration error");
    };

    const requestPermissions = async () => {
      try {
        let permission = await PushNotifications.checkPermissions();
        if (permission.receive !== "granted") {
          permission = await PushNotifications.requestPermissions();
        }
        if (permission.receive !== "granted") {
          console.warn("[push] notification permission not granted; FCM data + overlay still work.");
        }
      } catch (e) {
        console.warn("[push] permission request failed:", e);
      }
    };

    /** Registers on whichever path this APK supports. */
    const registerDevice = async (force = false) => {
      if (cancelled || nativePushOptedOut() || (settled && !force)) return;
      const diagnostics = readPushDiagnostics();
      if (diagnostics && !diagnostics.available && !nativePushOptedOut()) {
        fail(diagnostics.reason ?? "Push alerts are unavailable in this build.");
        return;
      }
      const me = await apiRequest("/api/v1/auth/me");
      if (cancelled) return;
      if (!me.success) {
        if (me.error.code === "UNAUTHORIZED") setStatus("idle");
        else fail(me.error.message);
        return;
      }
      settled = false;
      setDismissed(false);
      setError(null);
      setStatus("registering");
      clearTimer();

      // Both native and legacy paths need a timeout; otherwise a plugin that
      // never fires its registration event leaves the phone stuck forever.
      timeoutId = window.setTimeout(
        () => fail("Android did not return a push token. Check the phone's connection and try again."),
        25000
      );
      if (requestNativePushToken()) return;

      // Older APKs only have the Capacitor plugin.
      try {
        await PushNotifications.register();
      } catch (e) {
        fail(e instanceof Error ? e.message : "register failed");
      }
    };

    const handleAuthReady = () => { void registerDevice(true); };
    const handleDisabled = () => { clearTimer(); settled = true; setStatus("idle"); };
    const handleVisible = () => {
      if (document.visibilityState === "visible") handleAuthReady();
    };

    const setup = async () => {
      if (cancelled) return;
      setStatus("registering");

      // Give the native bridge a moment to appear before deciding anything: it
      // carries whether this build can register at all.
      await waitForAlertBridge(3000);
      if (cancelled) return;

      const diagnostics = readPushDiagnostics();
      if (diagnostics && !diagnostics.available && !nativePushOptedOut()) {
        fail(diagnostics.reason ?? "Push alerts are unavailable in this build.");
        return;
      }

      try {
        handles.push(
          await PushNotifications.addListener("pushNotificationReceived", handlePushReceived),
          await PushNotifications.addListener("registration", handleRegistration),
          await PushNotifications.addListener("registrationError", handleRegistrationError),
        );
      } catch (e) {
        console.error("[push] failed to attach listeners:", e);
      }
      if (cancelled) return;

      if (nativePushOptedOut()) { setStatus("idle"); return; }
      await requestPermissions();

      try {
        await ensureSeverityChannels();
      } catch (e) {
        console.warn("[push] channel creation failed:", e);
      }

      // Never stop at a localStorage token: Firebase can rotate it while the
      // app is closed. Asking the native layer returns the current token.
      if (cancelled) return;
      await registerDevice(true);
    };

    window.addEventListener("native-token-refreshed", handleTokenRefreshed as EventListener);
    window.addEventListener("native-push-error", handleNativePushError as EventListener);
    window.addEventListener("native-auth-ready", handleAuthReady);
    window.addEventListener("native-push-retry", handleAuthReady);
    window.addEventListener("native-push-disabled", handleDisabled);
    window.addEventListener("online", handleAuthReady);
    document.addEventListener("visibilitychange", handleVisible);

    setup().catch((e) => {
      console.error("[push] setup failed:", e);
      fail(e instanceof Error ? e.message : "setup failed");
    });

    return () => {
      cancelled = true;
      clearTimer();
      window.removeEventListener("native-token-refreshed", handleTokenRefreshed as EventListener);
      window.removeEventListener("native-push-error", handleNativePushError as EventListener);
      window.removeEventListener("native-auth-ready", handleAuthReady);
      window.removeEventListener("native-push-retry", handleAuthReady);
      window.removeEventListener("native-push-disabled", handleDisabled);
      window.removeEventListener("online", handleAuthReady);
      document.removeEventListener("visibilitychange", handleVisible);
      for (const handle of handles) handle.remove();
    };
  }, [enabled]);

  // Auto-dismiss the banner after a while so it doesn't linger.
  useEffect(() => {
    if (status === "idle" || dismissed) return;
    const ms = status === "failed" ? 45000 : 12000;
    const t = window.setTimeout(() => setDismissed(true), ms);
    return () => window.clearTimeout(t);
  }, [status, dismissed]);

  if (!isNative || dismissed || status === "idle") return null;

  const styles: Record<PushStatus, string> = {
    registering: "bg-blue-600",
    registered: "bg-green-600",
    failed: "bg-red-600",
    idle: "bg-slate-600",
  };

  return (
    <div
      className={`fixed bottom-4 left-4 right-4 z-[200] rounded-lg px-4 py-3 text-sm text-white shadow-lg ${styles[status]}`}
      role="status"
    >
      <div className="flex items-start justify-between gap-3">
        <span className="max-h-32 overflow-y-auto">
          {status === "registering" &&
            "Registering push notifications… if this stays here, the app is waiting for the phone to answer."}
          {status === "registered" &&
            "Phone alerts are registered. The phone must be powered on and connected."}
          {status === "failed" && (
            <>
              Push failed: {error ?? "unknown error"}
              <span className="mt-1 block text-xs text-white/80">
                Open Alerts → Alert diagnostics to copy this message, or see what the app last crashed on.
              </span>
            </>
          )}
        </span>
        <button
          onClick={() => setDismissed(true)}
          className="shrink-0 text-white/80 hover:text-white"
          aria-label="Dismiss"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
