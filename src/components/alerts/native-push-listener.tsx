"use client";

import { useEffect, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { PushNotifications } from "@capacitor/push-notifications";
import { apiRequest } from "@/lib/api-client";
import {
  ensureSeverityChannels,
  getNativePlatform,
  readNativeToken,
  rememberNativeToken,
  toNativeAlertView,
  type NativeAlertPayload,
} from "@/lib/capacitor-types";

type PushStatus = "idle" | "registering" | "registered" | "failed";

/**
 * Registers the device's FCM token with the server so Android can receive alerts
 * while the app is backgrounded. Mounted globally in the root layout.
 *
 * Every step is isolated so a transient failure is visible and can be retried.
 * A small diagnostic banner reports the server registration outcome on-device.
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
    const handles: Array<{ remove: () => void }> = [];

    const persistToken = async (token: string) => {
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
        window.dispatchEvent(
          new CustomEvent("native-token-registration", {
            detail: { token, registered: true },
          })
        );
        if (!cancelled) setStatus("registered");
      } catch (e) {
        console.error("[push] token registration failed:", e);
        if (!cancelled) {
          setStatus("failed");
          setError(e instanceof Error ? e.message : "registration failed");
        }
      }
    };

    let lastRefreshedToken: string | null = null;
    const handleTokenRefreshed = (event: Event) => {
      const token = (event as CustomEvent<{ token?: string }>).detail?.token;
      if (!token || token === lastRefreshedToken) return;
      lastRefreshedToken = token;
      void persistToken(token);
    };
    window.addEventListener("native-token-refreshed", handleTokenRefreshed as EventListener);
    const handleAuthReady = () => {
      const remembered = readNativeToken();
      if (remembered) {
        void persistToken(remembered);
      } else {
        void PushNotifications.register().catch((e) => {
          if (!cancelled) {
            setStatus("failed");
            setError(e instanceof Error ? e.message : "register failed");
          }
        });
      }
    };
    window.addEventListener("native-auth-ready", handleAuthReady);

    const handlePushReceived = (notification: { data?: unknown }) => {
      const data = (notification?.data ?? {}) as NativeAlertPayload;
      window.dispatchEvent(new CustomEvent("native-push-received", { detail: toNativeAlertView(data) }));
    };

    const handleRegistration = async (token: { value: string }) => {
      await persistToken(token.value);
    };

    const handleRegistrationError = (error: { error: string }) => {
      console.error("[push] registration error:", error?.error);
      if (!cancelled) {
        setStatus("failed");
        setError(error?.error ?? "registration error");
      }
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

    const setup = async () => {
      if (cancelled) return;
      setStatus("registering");

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

      await requestPermissions();

      try {
        await ensureSeverityChannels();
      } catch (e) {
        console.warn("[push] channel creation failed:", e);
      }

      try {
        const remembered = readNativeToken();
        if (remembered) await persistToken(remembered);
      } catch (e) {
        console.warn("[push] remembered-token sync failed:", e);
      }

      try {
        await PushNotifications.register();
      } catch (e) {
        console.error("[push] register() failed:", e);
        if (!cancelled) {
          setStatus("failed");
          setError(e instanceof Error ? e.message : "register failed");
        }
      }
    };

    setup().catch((e) => {
      console.error("[push] setup failed:", e);
      if (!cancelled) {
        setStatus("failed");
        setError(e instanceof Error ? e.message : "setup failed");
      }
    });

    return () => {
      cancelled = true;
      window.removeEventListener("native-token-refreshed", handleTokenRefreshed as EventListener);
      window.removeEventListener("native-auth-ready", handleAuthReady);
      for (const handle of handles) handle.remove();
    };
  }, [enabled]);

  // Auto-dismiss the banner after a while so it doesn't linger.
  useEffect(() => {
    if (status === "idle" || dismissed) return;
    const ms = status === "failed" ? 30000 : 12000;
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
      <div className="flex items-center justify-between gap-3">
        <span>
          {status === "registering" && "Registering push notifications…"}
          {status === "registered" && "Phone alerts are registered. The phone must be powered on and connected."}
          {status === "failed" && `Push failed: ${error ?? "unknown error"}`}
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