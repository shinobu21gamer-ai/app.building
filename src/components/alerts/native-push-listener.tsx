"use client";

import { useEffect } from "react";
import { apiRequest } from "@/lib/api-client";
import {
  ensureSeverityChannels,
  getNativePlatform,
  getPushMode,
  PushNotifications,
  rememberNativeToken,
  type AlertView,
  type NativeAlertPayload,
} from "@/lib/capacitor-types";

export function NativePushListener({ enabled = true }: { enabled?: boolean }) {
  useEffect(() => {
    if (!enabled) return;
    if (getPushMode() !== "capacitor") return;

    let cancelled = false;
    const handles: Array<{ remove: () => void }> = [];

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
      try {
        await ensureSeverityChannels();
        rememberNativeToken(token.value);
        await apiRequest("/api/v1/alerts/push/token", {
          method: "POST",
          body: JSON.stringify({ token: token.value, platform: getNativePlatform() }),
        });
      } catch {
        // Registration is retried on the next app launch.
      }
    };

    const handleRegistrationError = (error: { error: string }) => {
      console.error("Push registration failed:", error?.error);
    };

    const setup = async () => {
      handles.push(
        await PushNotifications.addListener("pushNotificationReceived", handlePushReceived),
        await PushNotifications.addListener("registration", handleRegistration),
        await PushNotifications.addListener("registrationError", handleRegistrationError),
      );
      if (cancelled) return;

      const permission = await PushNotifications.checkPermissions();
      if (permission.receive !== "granted") return;
      await ensureSeverityChannels();
      await PushNotifications.register();
    };

    setup().catch(() => {});

    return () => {
      cancelled = true;
      for (const handle of handles) handle.remove();
    };
  }, [enabled]);

  return null;
}
