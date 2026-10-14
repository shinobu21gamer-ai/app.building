import { generateKeyPairSync } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ tokens: vi.fn(), subscriptions: vi.fn(), read: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: {
  nativePushToken: { findMany: mocks.tokens }, pushSubscription: { findMany: mocks.subscriptions },
} }));
vi.mock("node:fs/promises", () => ({ readFile: mocks.read }));
const privateKey = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" });
const account = { project_id: "test-project", client_email: "sender@test-project.iam.gserviceaccount.com", private_key: privateKey };
let push: typeof import("./push");
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(async () => {
  vi.resetModules(); vi.resetAllMocks();
  vi.stubEnv("FIREBASE_SERVICE_ACCOUNT_PATH", ""); vi.stubEnv("FIREBASE_SERVICE_ACCOUNT", JSON.stringify(account));
  vi.stubEnv("VAPID_PUBLIC_KEY", ""); vi.stubEnv("VAPID_PRIVATE_KEY", "");
  mocks.read.mockRejectedValue(new Error("file unavailable"));
  mocks.tokens.mockResolvedValue([]); mocks.subscriptions.mockResolvedValue([]);
  fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "fake-access-token", expires_in: 3600 }), { status: 200 }))
    .mockResolvedValue(new Response(JSON.stringify({ name: "projects/test-project/messages/test" }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  push = await import("./push");
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
describe("Android alert delivery", () => {
  it("returns public configuration only and rejects malformed credentials", async () => {
    expect(await push.nativePushConfiguration("android")).toEqual({ serverConfigured: true, projectId: "test-project" });
    vi.stubEnv("FIREBASE_SERVICE_ACCOUNT", "{}");
    expect(await push.isNativePushConfigured()).toBe(false);
    expect(await push.sendAndroidPushTest("test-device-token")).toMatchObject({ accepted: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("uses inline configuration when a deployment cannot read the local file path", async () => {
    vi.stubEnv("FIREBASE_SERVICE_ACCOUNT_PATH", "/not-packaged/service-account.json");
    expect(await push.isNativePushConfigured()).toBe(true);
  });
  it("sends a short-lived test only to the selected token, without a real alert ID or alarm", async () => {
    expect((await push.sendAndroidPushTest("this-phone-token")).accepted).toBe(true);
    const request = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(request.message.token).toBe("this-phone-token");
    expect(request.message.data.test).toBe("true");
    expect(request.message.data).not.toHaveProperty("alertId");
    expect(request.message.android).toEqual({ priority: "HIGH", ttl: "60s" });
    expect(mocks.tokens).not.toHaveBeenCalled();
  });
  it.each([
    ["UNREGISTERED", "Register this phone again"],
    ["SENDER_ID_MISMATCH", "different Firebase projects"],
    ["PERMISSION_DENIED", "server credentials or permissions"],
  ])("reports actionable %s failures", async (code, message) => {
    fetchMock.mockReset().mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "fake", expires_in: 3600 })))
      .mockResolvedValue(new Response(JSON.stringify({ error: { status: code, details: [{ errorCode: code }] } }), { status: 403 }));
    const result = await push.sendAndroidPushTest("test-device-token");
    expect(result.accepted).toBe(false); expect(result.message.toLowerCase()).toContain(message.toLowerCase());
    if (code === "UNREGISTERED") expect(result.stale).toBe(true);
  });
  it("shares one OAuth exchange across concurrent phone deliveries", async () => {
    mocks.tokens.mockResolvedValue([
      { id: 1, token: "phone-one", platform: "android" },
      { id: 2, token: "phone-two", platform: "android" },
    ]);
    const report = await push.sendSystemAlertPush({ title: "Official alert", message: "Test fixture only", severity: "INFO", sound: false,
      alertId: 42, createdAt: new Date().toISOString(), expiresAt: null });
    expect(report.android.accepted).toBe(2);
    expect(fetchMock.mock.calls.filter(([url]) => url === "https://oauth2.googleapis.com/token")).toHaveLength(1);
    expect(fetchMock.mock.calls).toHaveLength(3);
  });
  it("continues to send real broadcasts with an alert ID and high-priority data", async () => {
    mocks.tokens.mockResolvedValue([{ id: 1, token: "phone-token", platform: "android" }]);
    const report = await push.sendSystemAlertPush({ title: "Official alert", message: "Test fixture only", severity: "WARNING", sound: true,
      alertId: 42, createdAt: new Date().toISOString(), expiresAt: null });
    expect(report.android.accepted).toBe(1);
    const request = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(request.message.data.alertId).toBe("42");
    expect(request.message.data).not.toHaveProperty("test");
  });
});
