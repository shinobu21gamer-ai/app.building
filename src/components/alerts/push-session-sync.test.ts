// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ request: vi.fn(), session: vi.fn(), web: vi.fn(), wait: vi.fn() }));
vi.mock("@/lib/api-client", () => ({ apiRequest: mocks.request }));
vi.mock("@/lib/push-device", () => ({ setNativeSessionActive: mocks.session, syncWebPushRegistration: mocks.web }));
vi.mock("@/lib/native-diagnostics", () => ({ isNativeShell: () => true, waitForAlertBridge: mocks.wait }));
import { PushSessionSync } from "./push-session-sync";
let root: Root; let container: HTMLDivElement;
beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.resetAllMocks(); mocks.wait.mockResolvedValue({}); mocks.web.mockResolvedValue(undefined);
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
describe("native session bridge synchronization", () => {
  it("waits for the bridge before mirroring a signed-in session", async () => {
    let ready!: (value: unknown) => void;
    mocks.wait.mockReturnValue(new Promise((resolve) => { ready = resolve; }));
    await act(async () => root.render(createElement(PushSessionSync, { signedIn: true })));
    expect(mocks.session).not.toHaveBeenCalled();
    await act(async () => ready({}));
    expect(mocks.session).toHaveBeenCalledWith(true);
  });
  it("does not interpret server failures as sign-out", async () => {
    await act(async () => root.render(createElement(PushSessionSync, { signedIn: true })));
    mocks.session.mockClear();
    mocks.request.mockResolvedValue({ success: false, error: { code: "INTERNAL_ERROR" } });
    await act(async () => window.dispatchEvent(new Event("online")));
    expect(mocks.session).not.toHaveBeenCalled();
  });
  it("does mirror an explicit expired session", async () => {
    await act(async () => root.render(createElement(PushSessionSync, { signedIn: true })));
    mocks.request.mockResolvedValue({ success: false, error: { code: "UNAUTHORIZED" } });
    await act(async () => window.dispatchEvent(new Event("native-auth-ready")));
    expect(mocks.session).toHaveBeenLastCalledWith(false);
  });
  it("prevents a delayed guest-layout result from overwriting newer sign-in", async () => {
    let oldReady!: (value: unknown) => void;
    mocks.wait.mockReturnValueOnce(new Promise((resolve) => { oldReady = resolve; })).mockResolvedValue({});
    await act(async () => root.render(createElement(PushSessionSync, { signedIn: false })));
    mocks.request.mockResolvedValue({ success: true, data: { user: {} } });
    await act(async () => window.dispatchEvent(new Event("native-auth-ready")));
    await act(async () => oldReady({}));
    expect(mocks.session.mock.calls).toEqual([[true]]);
  });
});
