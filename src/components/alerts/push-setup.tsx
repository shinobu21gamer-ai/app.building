"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { apiRequest } from "@/lib/api-client";
import { forgetNativeToken, getNativePlatform, getPushMode, readNativeToken, ensureSeverityChannels, PushNotifications } from "@/lib/capacitor-types";

function decodeKey(value: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replaceAll("-", "+").replaceAll("_", "/");
  const chars = atob(base64);
  const bytes = new Uint8Array(chars.length);
  for (let i = 0; i < chars.length; i++) bytes[i] = chars.charCodeAt(i);
  return bytes;
}

type PushStatus = "unsupported" | "prompt" | "enabled" | "disabled" | "error";
type PushMode = "web" | "capacitor" | "unknown";

export function PushSetup() {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<PushStatus>("prompt");
  const [message, setMessage] = useState<string | null>(null);
  const [mode, setMode] = useState<PushMode>("unknown");

  useEffect(() => {
    const m = getPushMode();
    setMode(m);
    checkSubscription(m);
  }, []);

  async function checkSubscription(currentMode: PushMode) {
    try {
      if (currentMode === "capacitor") {
        const perm = await PushNotifications.checkPermissions();
        if (perm.receive === "granted") {
          setStatus("enabled");
        } else if (perm.receive === "denied") {
          setStatus("error");
        } else {
          setStatus("prompt");
        }
        return;
      }

      // Web push
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
        setStatus("unsupported");
        return;
      }
      const reg = await navigator.serviceWorker.getRegistration("/push-sw.js");
      if (reg) {
        const sub = await reg.pushManager.getSubscription();
        if (sub) {
          const res = await apiRequest("/api/v1/alerts/push", { method: "POST", body: JSON.stringify(sub.toJSON()) });
          if (res.success) {
            setStatus("enabled");
            return;
          }
        }
      }
      const perm = Notification.permission;
      if (perm === "granted") setStatus("disabled");
      else if (perm === "denied") setStatus("error");
      else setStatus("prompt");
    } catch {
      setStatus("error");
    }
  }

  async function enable() {
    setBusy(true);
    setMessage(null);
    try {
      if (mode === "capacitor") {
        const perm = await PushNotifications.requestPermissions();
        if (perm.receive !== "granted") {
          setMessage("Allow notifications in system settings to receive phone alerts.");
          setStatus("error");
          return;
        }
        await ensureSeverityChannels();
        await PushNotifications.register();
        setStatus("enabled");
        setMessage("Phone alerts enabled. Alerts still arrive while the app is closed.");
        return;
      }

      // Web push
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
        setMessage("Push alerts are not supported by this browser.");
        setStatus("unsupported");
        return;
      }
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setMessage("Allow notifications in your browser settings to receive phone alerts.");
        setStatus("error");
        return;
      }
      const keyResult = await apiRequest<{ publicKey: string | null }>("/api/v1/alerts/push");
      if (!keyResult.success || !keyResult.data.publicKey) {
        setMessage("Push alerts are not configured on this server yet.");
        setStatus("error");
        return;
      }
      const registration = await navigator.serviceWorker.register("/push-sw.js");
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: decodeKey(keyResult.data.publicKey),
      });
      const result = await apiRequest("/api/v1/alerts/push", {
        method: "POST",
        body: JSON.stringify(subscription.toJSON()),
      });
      if (result.success) {
        setStatus("enabled");
        setMessage("Phone alerts are enabled. They work even when browser is closed.");
      } else {
        setMessage(result.error.message);
        setStatus("error");
      }
    } catch {
      setMessage("Could not enable phone alerts. Use HTTPS (the tunnel URL).");
      setStatus("error");
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    setMessage(null);
    try {
      if (mode === "capacitor") {
        const token = readNativeToken();
        if (token) {
          await apiRequest("/api/v1/alerts/push/token", {
            method: "POST",
            body: JSON.stringify({ token, platform: getNativePlatform(), active: false }),
          });
          forgetNativeToken();
        }
        await PushNotifications.unregister();
        setStatus("disabled");
        setMessage("Phone alerts disabled.");
        return;
      }

      // Web push
      const reg = await navigator.serviceWorker.getRegistration("/push-sw.js");
      if (reg) {
        const sub = await reg.pushManager.getSubscription();
        if (sub) {
          await sub.unsubscribe();
          await apiRequest(
            `/api/v1/alerts/push?endpoint=${encodeURIComponent(sub.endpoint)}`,
            { method: "DELETE" }
          );
        }
      }
      setStatus("disabled");
      setMessage("Phone alerts disabled.");
    } catch {
      setMessage("Failed to disable.");
    } finally {
      setBusy(false);
    }
  }

  const label = status === "enabled" ? "Disable phone alerts" : "Enable phone alerts";
  const variant = status === "enabled" ? "destructive" : "secondary";

  return (
    <div className="flex flex-col items-start gap-2">
      <Button type="button" variant={variant} size="sm" onClick={status === "enabled" ? disable : enable} disabled={busy || status === "unsupported"}>
        {busy ? "Working..." : label}
      </Button>
      {message && <p className="text-xs text-slate-600" role="status">{message}</p>}
      <p className="text-xs text-slate-500">
        Mode: {mode === "capacitor" ? "📱 Native (FCM/APNs)" : mode === "web" ? "🌐 Web Push" : "❓ Unknown"}
      </p>
      <p className="text-xs text-slate-500">
        Status: {status === "enabled" ? "✅ Enabled" : status === "disabled" ? "⭕ Disabled" : status === "prompt" ? "❓ Not enabled" : status === "error" ? "❌ Error/Blocked" : "❌ Unsupported"}
      </p>
    </div>
  );
}