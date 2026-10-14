// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ request: vi.fn() }));

vi.mock("@/lib/api-client", () => ({ apiRequest: mocks.request }));
// Real capacitor-types (including toNativeAlertView) over a non-native shell,
// so getPushMode() is "web" and no native alarm bridge is expected.
vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => false, getPlatform: () => "web" },
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
  // Polling finds nothing; only the native push event can surface an alert.
  mocks.request.mockResolvedValue({ success: true, data: { alerts: [] } });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
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
