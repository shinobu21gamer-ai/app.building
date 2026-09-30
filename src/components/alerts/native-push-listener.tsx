"use client";

import { useEffect } from "react";
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

export function NativePushListener({ enabled = true }: { enabled?: boolean }) {
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
      } catch {
        // Registration is retried on the next app launch.
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
      console.error("Push registration failed:", error?.error);
    };

    const requestPermissions = async () => {
      // POST_NOTIFICATIONS only controls whether the OS shows the channel
      // notification. FCM *data* delivery, the full-screen popup, and the
      // alarm sound/vibration do NOT need it, so a denial must never block
      // registration or the app goes permanently deaf.
      let permission = await PushNotifications.checkPermissions();
      if (permission.receive !== "granted") {
        permission = await PushNotifications.requestPermissions();
      }
      if (permission.receive !== "granted") {
        console.warn("Notification permission not granted; alarms will still run via FCM data + overlay.");
      }
    };

    const setup = async () => {
      handles.push(
        await PushNotifications.addListener("pushNotificationReceived", handlePushReceived),
        await PushNotifications.addListener("registration", handleRegistration),
        await PushNotifications.addListener("registrationError", handleRegistrationError),
      );
      if (cancelled) return;

      await requestPermissions();
      await ensureSeverityChannels();

      // Always register: a launch may have happened before the user signed in,
      // so the earlier registration POST 401'd (it needs the session). Re-sync
      // the previously remembered token now that the webview is mounted, and
      // request a fresh token from FCM.
      const remembered = readNativeToken();
      if (remembered) void persistToken(remembered);
      await PushNotifications.register();
    };

    setup().catch(() => {});

    return () => {
      cancelled = true;
      window.removeEventListener("native-token-refreshed", handleTokenRefreshed as EventListener);
      for (const handle of handles) handle.remove();
    };
  }, [enabled]);

  return null;
}