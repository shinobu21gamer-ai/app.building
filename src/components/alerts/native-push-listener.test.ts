// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  request: vi.fn(), nativeRequest: vi.fn(), diagnostics: vi.fn(), wait: vi.fn(),
  remember: vi.fn(), session: vi.fn(), register: vi.fn(), permission: vi.fn(),
  handlers: {} as Record<string, (value: unknown) => void>,
}));
vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => true } }));
vi.mock("@capacitor/push-notifications", () => ({ PushNotifications: {
  addListener: async (event: string, handler: (value: unknown) => void) => {
    mocks.handlers[event] = handler;
    return { remove: () => { delete mocks.handlers[event]; } };
  },
  checkPermissions: mocks.permission, requestPermissions: mocks.permission, register: mocks.register,
} }));
vi.mock("@/lib/api-client", () => ({ apiRequest: mocks.request }));
vi.mock("@/lib/capacitor-types", () => ({
  ensureSeverityChannels: async () => {}, getNativePlatform: () => "android",
  rememberNativeToken: mocks.remember, toNativeAlertView: (data: unknown) => data,
  // Existing builds used to stop at this cached token, never asking Firebase.
  readNativeToken: () => "stale-cached-token",
}));
vi.mock("@/lib/native-diagnostics", () => ({
  readPushDiagnostics: mocks.diagnostics, requestNativePushToken: mocks.nativeRequest, waitForAlertBridge: mocks.wait,
}));
vi.mock("@/lib/push-device", () => ({ setNativeSessionActive: mocks.session }));
import { setNativePushEnabled } from "@/lib/native-push-preference";
import { NativePushListener } from "./native-push-listener";
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.resetAllMocks(); mocks.handlers = {};
  setNativePushEnabled(true);
  mocks.diagnostics.mockReturnValue({ available: true }); mocks.wait.mockResolvedValue({});
  mocks.nativeRequest.mockReturnValue(true); mocks.permission.mockResolvedValue({ receive: "granted" });
  mocks.request.mockImplementation(async (url: string) => url === "/api/v1/auth/me"
    ? { success: true, data: { user: { id: 1 } } } : { success: true, data: { registered: true } });
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.useRealTimers(); });
async function mount() { await act(async () => root.render(createElement(NativePushListener))); }
async function event(name: string, detail?: unknown) {
  await act(async () => window.dispatchEvent(new CustomEvent(name, { detail })));
}
describe("native token lifecycle", () => {
  it("requests Firebase's current token despite an existing cached token", async () => {
    await mount(); expect(mocks.nativeRequest).toHaveBeenCalledOnce();
    await event("native-token-refreshed", { token: "fresh-firebase-token" });
    expect(mocks.request).toHaveBeenCalledWith("/api/v1/alerts/push/token", expect.objectContaining({ body: JSON.stringify({ token: "fresh-firebase-token", platform: "android" }) }));
    expect(mocks.session).toHaveBeenCalledWith(true);
    expect(container.textContent).toContain("Phone alerts are registered");
  });
  it("can retry after a failure instead of permanently settling failed", async () => {
    await mount(); await event("native-push-error", { message: "Temporarily offline" });
    expect(container.textContent).toContain("Temporarily offline");
    await event("native-push-retry");
    expect(mocks.nativeRequest).toHaveBeenCalledTimes(2);
    await event("native-token-refreshed", { token: "recovered-firebase-token" });
    expect(container.textContent).toContain("Phone alerts are registered");
  });
  it("retries a token that previously failed persistence even when its value is unchanged", async () => {
    await mount(); mocks.request.mockResolvedValueOnce({ success: false, error: { code: "NETWORK_ERROR", message: "Offline" } });
    await event("native-token-refreshed", { token: "same-firebase-token" });
    await event("native-token-refreshed", { token: "same-firebase-token" });
    expect(mocks.remember).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain("Phone alerts are registered");
  });
  it("does not register while signed out but resumes after sign-in", async () => {
    mocks.request.mockResolvedValueOnce({ success: false, error: { code: "UNAUTHORIZED", message: "Sign in" } });
    await mount(); expect(mocks.nativeRequest).not.toHaveBeenCalled();
    await event("native-auth-ready"); expect(mocks.nativeRequest).toHaveBeenCalledOnce();
  });
  it("retries on reconnection and reports a missing Firebase build without calling its plugin", async () => {
    await mount(); await event("online"); expect(mocks.nativeRequest).toHaveBeenCalledTimes(2);
    mocks.diagnostics.mockReturnValue({ available: false, reason: "Missing google-services.json" });
    await event("native-push-retry"); expect(mocks.nativeRequest).toHaveBeenCalledTimes(2);
    expect(mocks.register).not.toHaveBeenCalled(); expect(container.textContent).toContain("Missing google-services.json");
  });
  it("respects an explicit opt-out until the user enables phone push again", async () => {
    setNativePushEnabled(false);
    await mount(); await event("online"); await event("native-auth-ready");
    expect(mocks.nativeRequest).not.toHaveBeenCalled();
    await event("native-token-refreshed", { token: "do-not-save-this-token" });
    expect(mocks.remember).not.toHaveBeenCalled();
    setNativePushEnabled(true); await event("native-push-retry");
    expect(mocks.nativeRequest).toHaveBeenCalledOnce();
  });
  it("times out the legacy plugin path instead of hanging forever", async () => {
    vi.useFakeTimers(); mocks.nativeRequest.mockReturnValue(false);
    await mount(); expect(mocks.register).toHaveBeenCalledOnce();
    await act(async () => vi.advanceTimersByTimeAsync(25001));
    expect(container.textContent).toContain("Android did not return a push token");
  });
});
