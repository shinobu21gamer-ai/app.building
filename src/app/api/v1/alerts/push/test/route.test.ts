import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ find: vi.fn(), update: vi.fn(), claim: vi.fn(), reset: vi.fn(), send: vi.fn(), user: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: {
  nativePushToken: { findFirst: mocks.find, update: mocks.update },
  loginAttemptBucket: { upsert: mocks.claim, updateMany: mocks.reset },
} }));
vi.mock("@/lib/auth/session", () => ({ requireApiUser: mocks.user }));
vi.mock("@/lib/push", () => ({ sendAndroidPushTest: mocks.send }));
vi.mock("@/lib/api", () => ({
  withErrorBoundary: (fn: unknown) => fn, assertSameOrigin: () => {},
  parseBody: async (req: Request, schema: { parse: (value: unknown) => unknown }) => schema.parse(await req.json()),
  ok: (body: unknown) => Response.json({ success: true, data: body }),
  createApiError: { badRequest: (message: string) => new Error(message), tooManyRequests: (message: string) => new Error(message) },
}));
import { POST } from "./route";
function request() { return new Request("https://app.test/api/v1/alerts/push/test", { method: "POST", body: JSON.stringify({ token: "current-phone-token", platform: "android" }) }); }
beforeEach(() => {
  vi.resetAllMocks(); mocks.user.mockResolvedValue({ id: 7 }); mocks.find.mockResolvedValue({ id: 22 });
  mocks.claim.mockResolvedValue({ windowStart: new Date(), failures: 1 }); mocks.reset.mockResolvedValue({ count: 1 });
  mocks.send.mockResolvedValue({ accepted: true, message: "Provider accepted, not delivery confirmed" });
});
describe("self-only Android push test", () => {
  it("requires active ownership of the exact token before sending", async () => {
    await POST(request());
    expect(mocks.find).toHaveBeenCalledWith({ where: { userId: 7, token: "current-phone-token", platform: "android", active: true }, select: { id: true } });
    expect(mocks.send).toHaveBeenCalledWith("current-phone-token");
  });
  it("refuses unregistered or other-account tokens without contacting Firebase", async () => {
    mocks.find.mockResolvedValue(null); await expect(POST(request())).rejects.toThrow("not registered to your account");
    expect(mocks.send).not.toHaveBeenCalled(); expect(mocks.claim).not.toHaveBeenCalled();
  });
  it("enforces a durable one-minute cooldown", async () => {
    mocks.claim.mockResolvedValue({ windowStart: new Date(), failures: 2 });
    await expect(POST(request())).rejects.toThrow("one minute"); expect(mocks.send).not.toHaveBeenCalled();
  });
  it("lets only one request claim an expired cooldown bucket", async () => {
    mocks.claim.mockResolvedValue({ windowStart: new Date(Date.now() - 120000), failures: 5 });
    mocks.reset.mockResolvedValue({ count: 0 });
    await expect(POST(request())).rejects.toThrow("one minute"); expect(mocks.send).not.toHaveBeenCalled();
  });
  it("deactivates only the stale token Firebase explicitly rejects", async () => {
    mocks.send.mockResolvedValue({ accepted: false, stale: true, message: "Token expired" });
    await expect(POST(request())).rejects.toThrow("Token expired");
    expect(mocks.update).toHaveBeenCalledWith({ where: { id: 22 }, data: { active: false } });
  });
  it("does not remove valid tokens on configuration or connectivity failures", async () => {
    mocks.send.mockResolvedValue({ accepted: false, message: "Configuration missing" });
    await expect(POST(request())).rejects.toThrow("Configuration missing");
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
