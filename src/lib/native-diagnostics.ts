import { Capacitor } from "@capacitor/core";
import type { AlertBridge } from "@/lib/capacitor-types";

/**
 * Reads the push/crash state the Android shell reports through
 * `window.AlertBridge`.
 *
 * The APK is a thin WebView, so when something goes wrong below the page the
 * user only saw the app disappear. The native side now records what happened
 * (`AlertBridge.pushDiagnostics()`, `AlertBridge.crashReport()`) and this module
 * is the single, defensive place the page reads it from — every call is optional
 * and wrapped, so an older APK without those methods still works.
 */

export type NativePushDiagnostics = {
  /** False when this build cannot register for push at all (reason explains why). */
  available: boolean;
  reason: string | null;
  firebaseInitialized: boolean;
  configPresent: boolean;
  /** Last registration failure, already translated into plain language. */
  lastError: string | null;
  lastErrorAt: string | null;
  lastToken: string | null;
  sessionActive: boolean;
  generatedAt: string;
};

export function isNativeShell(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

export function getAlertBridge(): AlertBridge | undefined {
  if (typeof window === "undefined") return undefined;
  return window.AlertBridge;
}

/**
 * The bridge object is injected when the activity resumes, which can land a
 * moment after the page starts running its effects. This waits briefly for it so
 * the push decision is made against real information instead of falling back to
 * the plugin call that used to close the app.
 */
export async function waitForAlertBridge(timeoutMs = 3000): Promise<AlertBridge | null> {
  const existing = getAlertBridge();
  if (existing) return existing;
  if (!isNativeShell()) return null;

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((resolve) => window.setTimeout(resolve, 100));
    const bridge = getAlertBridge();
    if (bridge) return bridge;
  }
  return getAlertBridge() ?? null;
}

export function readPushDiagnostics(): NativePushDiagnostics | null {
  const raw = safeCall<string | null>(() => getAlertBridge()?.pushDiagnostics?.() ?? null);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<NativePushDiagnostics>;
    return {
      available: parsed.available !== false,
      reason: parsed.reason ?? null,
      firebaseInitialized: Boolean(parsed.firebaseInitialized),
      configPresent: Boolean(parsed.configPresent),
      lastError: parsed.lastError ?? null,
      lastErrorAt: parsed.lastErrorAt ?? null,
      lastToken: parsed.lastToken ?? null,
      sessionActive: Boolean(parsed.sessionActive),
      generatedAt: parsed.generatedAt ?? new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

/** True when this APK can register through the app's own (crash-safe) path. */
export function canRegisterPushNatively(): boolean {
  return typeof getAlertBridge()?.requestPushToken === "function";
}

/**
 * Starts registration inside the native app code, which catches every failure
 * itself and reports it through `native-token-refreshed` / `native-push-error`.
 * Returns false when this APK predates that path.
 */
export function requestNativePushToken(): boolean {
  const bridge = getAlertBridge();
  if (typeof bridge?.requestPushToken !== "function") return false;
  try {
    bridge.requestPushToken();
    return true;
  } catch {
    return false;
  }
}

/**
 * Which generation of the native shell this APK is. The diagnostics card uses
 * this to tell an old APK apart from a reading that simply has not arrived yet:
 * an APK built before the bridge existed reports every native value as
 * "unknown", which reads like a mystery instead of the actionable answer
 * ("reinstall the latest APK") it actually is.
 */
export type AlertBridgeState = "missing" | "legacy" | "current";

export function readAlertBridgeState(): AlertBridgeState {
  const bridge = getAlertBridge();
  if (!bridge) return "missing";
  if (typeof bridge.pushDiagnostics !== "function") return "legacy";
  return "current";
}

/**
 * Plain-language explanation for the diagnostics card, or null when the APK is
 * current and the rows below can be trusted.
 */
export function staleBridgeExplanation(state: AlertBridgeState): string | null {
  if (state === "missing") {
    return "This APK is older than the current app: it cannot report its push state at all, so every native value below is unreadable. Reinstall the latest APK (built with google-services.json in place), then reopen this screen.";
  }
  if (state === "legacy") {
    return "This APK predates the app's push diagnostics. Reinstall the latest APK to see the push state.";
  }
  return null;
}

export type NativeExitReport = {
  reason: string;
  label: string;
  description: string | null;
  at: string;
  /** True when the exit was a crash/ANR/memory kill rather than a user action. */
  abnormal: boolean;
};

/** Why Android says the previous run ended, when it can be read. */
export function readLastExitReport(): NativeExitReport | null {
  const raw = safeCall<string | null>(() => getAlertBridge()?.lastExitReport?.() ?? null);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<NativeExitReport>;
    if (!parsed.label) return null;
    return {
      reason: parsed.reason ?? "unknown",
      label: parsed.label,
      description: parsed.description ?? null,
      at: parsed.at ?? "",
      abnormal: Boolean(parsed.abnormal),
    };
  } catch {
    return null;
  }
}

export function readNativeCrashReport(): string | null {
  const report = safeCall<string | null>(() => getAlertBridge()?.crashReport?.() ?? null);
  return report && report.trim() ? report : null;
}

export function clearNativeCrashReport(): void {
  safeCall(() => getAlertBridge()?.clearCrashReport?.());
}

function safeCall<T>(fn: () => T): T | null {
  try {
    return fn() ?? null;
  } catch {
    // A bridge that throws must never take the page down with it.
    return null;
  }
}
