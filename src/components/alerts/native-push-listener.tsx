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
  type AlertView,
  type NativeAlertPayload,
} from "@/lib/capacitor-types";

type PushStatus = "idle" | "registering" | "registered" | "failed";

/**
 * Registers the device's FCM token with the server so alerts can wake the phone
 * even when the app is closed. Mounted globally in the root layout.
 *
 * Every step is isolated so a single failure (channel creation, permission
 * dialog, token fetch) can never block the others — the app must always end up
 * registered. A small diagnostic banner reports the outcome on-device.
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
        await apiRequest("/api/v1/alerts/push/token", {
          method: "POST",
          body: JSON.stringify({ token, platform: getNativePlatform() }),
        });
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

    const toAlertView = (data: NativeAlertPayload): AlertView => ({
      id: data.alertId || Date.now(),
      title: data.title || "BarangayResolve Alert",
      message: data.body || data.message || "You have a new alert",
      severity: data.severity || "INFO",
      sound: data.sound !== false,
      createdAt: data.createdAt || new Date().toISOString(),
      expiresAt: data.expiresAt || null,
      acknowledged: false,
      reactions: {},
    });

    const handlePushReceived = (notification: { data?: unknown }) => {
      const data = (notification?.data ?? {}) as NativeAlertPayload;
      window.dispatchEvent(new CustomEvent("native-push-received", { detail: toAlertView(data) }));
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
          {status === "registered" && "Push registered — alerts will wake your phone"}
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