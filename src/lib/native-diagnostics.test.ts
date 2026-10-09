import { afterEach, describe, expect, it } from "vitest";
import {
  clearNativeCrashReport,
  isNativeShell,
  readAlertBridgeState,
  readLastExitReport,
  readNativeCrashReport,
  readPushDiagnostics,
  requestNativePushToken,
  staleBridgeExplanation,
} from "./native-diagnostics";

/**
 * The bridge only exists inside the APK; here it is faked so the parsing and the
 * defensive behaviour (never throw, never invent data) are pinned down. A web
 * browser has no bridge at all, which is the other half of these tests.
 */
function fakeBridge(methods: Record<string, unknown>) {
  (globalThis as unknown as { window: unknown }).window = { AlertBridge: methods };
}

afterEach(() => {
  delete (globalThis as unknown as { window?: unknown }).window;
});

describe("readPushDiagnostics", () => {
  it("returns null when there is no native bridge (plain browser)", () => {
    expect(readPushDiagnostics()).toBeNull();
    expect(isNativeShell()).toBe(false);
  });

  it("parses the JSON the Android shell reports", () => {
    fakeBridge({
      pushDiagnostics: () =>
        JSON.stringify({
          available: false,
          reason: "This APK was built without android/app/google-services.json.",
          firebaseInitialized: false,
          configPresent: false,
          lastError: "Push registration failed.",
          lastErrorAt: "2026-10-08T10:00:00.000+08:00",
          lastToken: null,
        }),
    });

    const diagnostics = readPushDiagnostics();
    expect(diagnostics?.available).toBe(false);
    expect(diagnostics?.configPresent).toBe(false);
    expect(diagnostics?.reason).toContain("google-services.json");
  });

  it("survives a bridge that returns garbage or throws", () => {
    fakeBridge({ pushDiagnostics: () => "not json" });
    expect(readPushDiagnostics()).toBeNull();

    fakeBridge({
      pushDiagnostics: () => {
        throw new Error("bridge exploded");
      },
    });
    expect(readPushDiagnostics()).toBeNull();
  });
});

describe("requestNativePushToken", () => {
  it("reports false on APKs without the native registration path", () => {
    expect(requestNativePushToken()).toBe(false);
    fakeBridge({ pushDiagnostics: () => "{}" });
    expect(requestNativePushToken()).toBe(false);
  });

  it("calls the native registration when the bridge has it", () => {
    let called = 0;
    fakeBridge({ requestPushToken: () => void (called += 1) });
    expect(requestNativePushToken()).toBe(true);
    expect(called).toBe(1);
  });
});

describe("readAlertBridgeState", () => {
  it("reports missing when there is no bridge (plain browser)", () => {
    expect(readAlertBridgeState()).toBe("missing");
    expect(staleBridgeExplanation("missing")).toContain("older than the current app");
  });

  it("reports legacy when the bridge predates push diagnostics", () => {
    fakeBridge({ setSessionActive: () => {} });
    expect(readAlertBridgeState()).toBe("legacy");
    expect(staleBridgeExplanation("legacy")).toContain("Reinstall the latest APK");
  });

  it("reports current when the bridge can report push diagnostics", () => {
    fakeBridge({ pushDiagnostics: () => "{}" });
    expect(readAlertBridgeState()).toBe("current");
    expect(staleBridgeExplanation("current")).toBeNull();
  });
});

describe("crash and exit reports", () => {
  it("returns the saved crash report, and nothing when it is whitespace", () => {
    fakeBridge({ crashReport: () => "java.lang.RuntimeException: boom" });
    expect(readNativeCrashReport()).toContain("boom");

    fakeBridge({ crashReport: () => "   " });
    expect(readNativeCrashReport()).toBeNull();
  });

  it("clears the report through the bridge", () => {
    let cleared = false;
    fakeBridge({ clearCrashReport: () => void (cleared = true) });
    clearNativeCrashReport();
    expect(cleared).toBe(true);
  });

  it("reads Android's own account of why the last run ended", () => {
    fakeBridge({
      lastExitReport: () =>
        JSON.stringify({
          reason: "a crash inside the native code",
          label: "Android reported that the previous run ended because: a crash inside the native code",
          description: null,
          at: "2026-10-08 10:00:00",
          abnormal: true,
        }),
    });

    const exit = readLastExitReport();
    expect(exit?.abnormal).toBe(true);
    expect(exit?.label).toContain("native code");
  });

  it("ignores an exit report without a label", () => {
    fakeBridge({ lastExitReport: () => "{}" });
    expect(readLastExitReport()).toBeNull();
  });
});
