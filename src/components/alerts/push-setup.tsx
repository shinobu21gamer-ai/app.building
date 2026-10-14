"use client";

import { useEffect, useState } from "react";
import { Bell, BellOff, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiRequest } from "@/lib/api-client";
import { copy, type Locale } from "@/lib/i18n";
import { forgetNativeToken, getNativePlatform, getPushMode, ensureSeverityChannels, PushNotifications } from "@/lib/capacitor-types";
import { nativePushOptedOut, setNativePushEnabled } from "@/lib/native-push-preference";
import { checkNativePushStatus, currentNativeToken } from "@/lib/native-push-status";
import { readPushDiagnostics, waitForAlertBridge } from "@/lib/native-diagnostics";

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
type NativeRegistrationEvent = {
  token?: string;
  registered: boolean;
  message?: string;
};

function waitForNativeRegistration(): Promise<NativeRegistrationEvent> {
  return new Promise((resolve) => {
    const finish = (result: NativeRegistrationEvent) => {
      window.removeEventListener("native-token-registration", onRegistration);
      window.clearTimeout(timeout);
      resolve(result);
    };
    const onRegistration = (event: Event) => {
      finish((event as CustomEvent<NativeRegistrationEvent>).detail);
    };
    const timeout = window.setTimeout(
      () => finish({ registered: false, message: "Android did not return a push token in time." }),
      15000
    );
    window.addEventListener("native-token-registration", onRegistration);
  });
}

export function PushSetup({ locale = "en" }: { locale?: Locale } = {}) {
  const t = copy[locale].alerts.push;
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<PushStatus>("prompt");
  const [message, setMessage] = useState<string | null>(null);
  const [mode, setMode] = useState<PushMode>("unknown");

  useEffect(() => {
    const m = getPushMode();
    setMode(m);
    checkSubscription(m);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locale]);

  async function checkSubscription(currentMode: PushMode) {
    try {
      if (currentMode === "capacitor") {
        if (nativePushOptedOut()) { setStatus("disabled"); setMessage(t.disabledOnDevice); return; }
        // A build that cannot talk to Firebase says so up front; asking the
        // Capacitor plugin to register anyway is what used to close the app.
        const diagnostics = readPushDiagnostics();
        if (diagnostics && !diagnostics.available) {
          setStatus("error");
          setMessage(diagnostics.reason ?? t.unavailableBuild);
          return;
        }

        const perm = await PushNotifications.checkPermissions();
        if (perm.receive === "granted") {
          const result = await checkNativePushStatus();
          if (!result.success) {
            setStatus("error");
            setMessage(result.error.message);
          } else if (result.data.registered) {
            setStatus("enabled");
            if (result.data.serverConfigured === false) {
              setMessage(t.serverNotConfigured);
            } else if (diagnostics?.lastError) {
              setMessage(diagnostics.lastError);
            }
          } else {
            setStatus("disabled");
            setMessage(diagnostics?.lastError ?? t.registeredNotOnServer);
          }
        } else if (perm.receive === "denied") {
          setStatus("error");
          setMessage(t.blockedAndroid);
        } else {
          setStatus("prompt");
          if (diagnostics?.lastError) setMessage(diagnostics.lastError);
        }
        return;
      }

      // Web push
      if (
        !("serviceWorker" in navigator) ||
        !("PushManager" in window) ||
        !("Notification" in window)
      ) {
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
          setStatus("error");
          setMessage(res.error.message);
          return;
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
        // The bridge object arrives with the first resume; give it a moment so a
        // current APK is never mistaken for an old one that still needs the
        // Capacitor plugin (whose failure closes the app).
        if (!readPushDiagnostics()) await waitForAlertBridge(2000);
        const diagnostics = readPushDiagnostics();
        if (diagnostics && !diagnostics.available) {
          setMessage(diagnostics.reason ?? t.unavailableBuild);
          setStatus("error");
          return;
        }
        const perm = await PushNotifications.requestPermissions();
        if (perm.receive !== "granted") {
          setMessage(t.allowSystemSettings);
          setStatus("error");
          return;
        }
        await ensureSeverityChannels();
        const registrationResult = waitForNativeRegistration();
        // Let the global listener own registration/retries and error reporting.
        setNativePushEnabled(true);
        window.dispatchEvent(new Event("native-push-retry"));
        const registration = await registrationResult;
        if (!registration.registered) {
          setStatus("error");
          setMessage(registration.message ?? t.registrationTimeout);
          return;
        }
        const current = await checkNativePushStatus();
        if (!current.success || !current.data.registered || !current.data.serverConfigured) {
          setStatus("error");
          setMessage(current.success ? t.notReadyDetails : current.error.message);
          return;
        }
        setStatus("enabled");
        setMessage(t.registered);
        return;
      }

      // Web push
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
        setMessage(t.notSupportedBrowser);
        setStatus("unsupported");
        return;
      }
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setMessage(t.allowBrowserSettings);
        setStatus("error");
        return;
      }
      const keyResult = await apiRequest<{ publicKey: string | null }>("/api/v1/alerts/push");
      if (!keyResult.success || !keyResult.data.publicKey) {
        setMessage(t.notConfiguredServer);
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
        setMessage(t.enabledBrowserPolicy);
      } else {
        setMessage(result.error.message);
        setStatus("error");
      }
    } catch {
      setMessage(t.enableFailedHttps);
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
        const token = currentNativeToken();
        if (token) {
          const result = await apiRequest("/api/v1/alerts/push/token", {
            method: "POST",
            body: JSON.stringify({ token, platform: getNativePlatform(), active: false }),
          });
          if (!result.success) {
            setMessage(result.error.message);
            setStatus("error");
            return;
          }
          forgetNativeToken();
        }
        setNativePushEnabled(false);
        window.dispatchEvent(new Event("native-push-disabled"));
        // Unregistering touches Firebase; skip it when the build cannot talk to
        // Firebase at all (the server-side deactivation above is what matters).
        const diagnostics = readPushDiagnostics();
        if (!diagnostics || diagnostics.available) {
          try {
            await PushNotifications.unregister();
          } catch {
            // Older/broken builds: the server-side deactivation already ran.
          }
        }
        setStatus("disabled");
        setMessage(t.disabled);
        return;
      }

      // Web push
      const reg = await navigator.serviceWorker.getRegistration("/push-sw.js");
      if (reg) {
        const sub = await reg.pushManager.getSubscription();
        if (sub) {
          const result = await apiRequest<{ unsubscribed: boolean }>(
            `/api/v1/alerts/push?endpoint=${encodeURIComponent(sub.endpoint)}`,
            { method: "DELETE" }
          );
          if (!result.success) {
            setMessage(result.error.message);
            setStatus("error");
            return;
          }
          await sub.unsubscribe();
        }
      }
      setStatus("disabled");
      setMessage(t.disabled);
    } catch {
      setMessage(t.disableFailed);
    } finally {
      setBusy(false);
    }
  }

  const label = status === "enabled" ? t.disable : t.enable;
  const variant = status === "enabled" ? "destructive" : "secondary";
  const PushIcon = status === "enabled" ? BellOff : Bell;
  const modeText = mode === "capacitor" ? t.modeNative : mode === "web" ? t.modeWeb : t.modeUnknown;
  const statusText =
    status === "enabled"
      ? t.statusEnabled
      : status === "disabled"
        ? t.statusDisabled
        : status === "prompt"
          ? t.statusPrompt
          : status === "error"
            ? t.statusError
            : t.statusUnsupported;

  return (
    <div className="flex flex-col items-start gap-2">
      <Button type="button" variant={variant} size="sm" onClick={status === "enabled" ? disable : enable} disabled={busy || status === "unsupported"}>
        <PushIcon size={15} aria-hidden="true" />
        {busy ? t.working : label}
      </Button>
      {message && <p className="text-xs text-slate-600" role="status">{message}</p>}
      <p className="text-xs text-slate-500">
        {t.modeLabel}: {modeText}
      </p>
      <p className="text-xs text-slate-500">
        {t.statusLabel}: {statusText}
      </p>
      {mode === "capacitor" && (
        <>
          <p className="max-w-xl text-xs leading-5 text-slate-600">
            {t.nativeHint}
          </p>
          <p className="max-w-xl text-xs leading-5 text-slate-600">
            {t.nativeDiagnosticsHint}
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              try {
                window.AlertBridge?.openAlertPermissions();
              } catch {
                setMessage(t.openSettingsFallback);
              }
            }}
          >
            <Settings2 size={15} aria-hidden="true" />
            {t.reviewPermissions}
          </Button>
        </>
      )}
    </div>
  );
}