// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ request: vi.fn(), native: false }));

vi.mock("@/lib/api-client", () => ({ apiRequest: mocks.request }));
// Real capacitor-types (including toNativeAlertView) over a shell whose
// native-ness each test controls: web by default, native for the bridge tests.
vi.mock("@capacitor/core", () => ({
  Capacitor: {
    isNativePlatform: () => mocks.native,
    getPlatform: () => (mocks.native ? "android" : "web"),
  },
}));
vi.mock("@capacitor/push-notifications", () => ({
  PushNotifications: { createChannel: async () => {} },
}));

import { AlertListener } from "./alert-listener";

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.resetAllMocks();
  mocks.native = false;
  // Polling finds nothing; only the native push event can surface an alert.
  mocks.request.mockResolvedValue({ success: true, data: { alerts: [] } });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  delete (window as Window & { AlertBridge?: unknown }).AlertBridge;
});

async function mount() {
  await act(async () => root.render(createElement(AlertListener)));
}

async function nativePush(detail: unknown) {
  await act(async () =>
    window.dispatchEvent(new CustomEvent("native-push-received", { detail }))
  );
}

describe("AlertListener native push intake", () => {
  it("shows an alert delivered in the Android foreground-service shape (alertId/message)", async () => {
    await mount();
    // Exactly what AlertMessagingService.toAlertJson() evaluates into the
    // WebView when the app is in the foreground: `alertId`, not `id`.
    await nativePush({
      alertId: 42,
      title: "Flood warning",
      message: "Evacuate to higher ground",
      severity: "CRITICAL",
      url: "/alerts",
      createdAt: "2026-10-14T09:30:00.000Z",
      expiresAt: null,
      sound: true,
    });
    expect(container.textContent).toContain("Flood warning");
    expect(container.textContent).toContain("Evacuate to higher ground");
  });

  it("still shows an alert already converted to AlertView shape (id/body)", async () => {
    await mount();
    await nativePush({
      id: 7,
      title: "Road closure",
      message: "Main street is closed",
      severity: "WARNING",
      sound: false,
      createdAt: "2026-10-14T09:30:00.000Z",
      expiresAt: null,
      acknowledged: false,
      reactions: {},
    });
    expect(container.textContent).toContain("Road closure");
  });

  it("ignores native events that carry no alert id instead of inventing one", async () => {
    await mount();
    await nativePush({ title: "Test", message: "Not a real alert", severity: "INFO" });
    expect(container.textContent).not.toContain("Not a real alert");
  });
});

describe("AlertListener native alarm stopping", () => {
  const bridge = {
    startAlertFor: vi.fn(),
    stopAlertFor: vi.fn(),
    stopAlertSoundFor: vi.fn(),
    stopAlertSound: vi.fn(),
    openAlertsPage: vi.fn(),
    consumePendingAck: vi.fn(() => -1),
  };

  beforeEach(() => {
    mocks.native = true;
    (window as unknown as { AlertBridge?: typeof bridge }).AlertBridge = bridge;
  });

  function okButton(): HTMLButtonElement {
    const button = [...container.querySelectorAll("button")].find((candidate) =>
      candidate.textContent?.includes("OK, I understand")
    );
    if (!button) throw new Error("OK button was not rendered");
    return button as HTMLButtonElement;
  }

  async function showAlert(id: number) {
    await mount();
    await nativePush({
      alertId: id,
      title: "Flood warning",
      message: "Evacuate to higher ground",
      severity: "CRITICAL",
      url: "/alerts",
      createdAt: "2026-10-14T09:30:00.000Z",
      expiresAt: null,
      sound: true,
    });
    expect(container.textContent).toContain("Flood warning");
  }

  it("stops the sounding alarm the moment OK is tapped, before the server answers", async () => {
    let resolveAck: (value: unknown) => void = () => {};
    mocks.request.mockImplementation((url: string) => {
      if (url.includes("/acknowledge")) {
        return new Promise((resolve) => {
          resolveAck = resolve;
        });
      }
      return Promise.resolve({ success: true, data: { alerts: [] } });
    });

    await showAlert(42);
    await act(async () => okButton().click());

    // The ack request is still in flight, but the alarm must already be silent.
    expect(bridge.stopAlertSoundFor).toHaveBeenCalledWith(42);
    expect(bridge.stopAlertSound).toHaveBeenCalled();

    await act(async () => resolveAck({ success: true, data: { acknowledged: true } }));
    // Server confirmed: the alert's own alarm/notification cleanup runs too.
    expect(bridge.stopAlertFor).toHaveBeenCalledWith(42);
    expect(container.textContent).not.toContain("Flood warning");
  });

  it("keeps the dialog and its error when the acknowledgement fails", async () => {
    mocks.request.mockImplementation((url: string) => {
      if (url.includes("/acknowledge")) {
        return Promise.resolve({
          success: false,
          error: { code: "NETWORK_ERROR", message: "Could not reach the server. Please try again." },
        });
      }
      return Promise.resolve({ success: true, data: { alerts: [] } });
    });

    await showAlert(7);
    await act(async () => okButton().click());

    // The tap still silenced the device, but nothing was confirmed: the
    // dialog stays, the error shows, and the confirmed-stop never ran.
    expect(bridge.stopAlertSound).toHaveBeenCalled();
    expect(bridge.stopAlertFor).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Flood warning");
    expect(container.textContent).toContain("Could not reach the server. Please try again.");
  });

  it("acknowledges a native popup tap delivered as an event", async () => {
    await mount();
    await act(async () =>
      window.dispatchEvent(new CustomEvent("native-ack-requested", { detail: { id: 9 } }))
    );
    expect(mocks.request).toHaveBeenCalledWith("/api/v1/alerts/9/acknowledge", { method: "POST" });
    expect(bridge.stopAlertFor).toHaveBeenCalledWith(9);
  });

  it("picks up a popup tap recorded before the page finished loading", async () => {
    // Cold start from the lock-screen popup: the one-shot event fired before
    // this listener existed, so the bridge kept the tap pending instead.
    bridge.consumePendingAck.mockReturnValue(11);
    await mount();
    expect(mocks.request).toHaveBeenCalledWith("/api/v1/alerts/11/acknowledge", { method: "POST" });
    expect(bridge.stopAlertFor).toHaveBeenCalledWith(11);
  });
});
