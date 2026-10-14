import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ find: vi.fn(), config: vi.fn(), user: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { nativePushToken: { findFirst: mocks.find } } }));
vi.mock("@/lib/auth/session", () => ({ requireApiUser: mocks.user }));
vi.mock("@/lib/push", () => ({ nativePushConfiguration: mocks.config }));
vi.mock("@/lib/api", () => ({
  withErrorBoundary: (fn: unknown) => fn, assertSameOrigin: () => {},
  parseBody: async (req: Request, schema: { parse: (value: unknown) => unknown }) => schema.parse(await req.json()),
  ok: (body: unknown, init: ResponseInit) => Response.json({ success: true, data: body }, init),
}));
import { POST } from "./route";
beforeEach(() => {
  vi.resetAllMocks(); mocks.user.mockResolvedValue({ id: 7 }); mocks.find.mockResolvedValue(null);
  mocks.config.mockResolvedValue({ serverConfigured: true, projectId: "test-project" });
});
function request(token: string | null) { return new Request("https://app.test/api/v1/alerts/push/status", { method: "POST", body: JSON.stringify({ token, platform: "android" }) }); }
describe("exact device diagnostics", () => {
  it("does not claim this phone is registered just because a different phone is", async () => {
    const response = await POST(request("current-phone-token"));
    expect(mocks.find).toHaveBeenCalledWith({ where: { userId: 7, token: "current-phone-token", platform: "android", active: true }, select: { id: true } });
    expect((await response.json()).data.registered).toBe(false);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
  it("reports the current phone and public configuration without leaking its token", async () => {
    mocks.find.mockResolvedValue({ id: 1 });
    const body = await (await POST(request("current-phone-token"))).json();
    expect(body.data).toEqual({ registered: true, serverConfigured: true, projectId: "test-project" });
    expect(JSON.stringify(body)).not.toContain("current-phone-token");
  });
  it("handles a phone with no token without looking up any other device", async () => {
    const body = await (await POST(request(null))).json();
    expect(body.data.registered).toBe(false); expect(mocks.find).not.toHaveBeenCalled();
  });
  it("requires a signed-in user", async () => {
    mocks.user.mockRejectedValue(new Error("Sign in required"));
    await expect(POST(request("current-phone-token"))).rejects.toThrow("Sign in required");
    expect(mocks.find).not.toHaveBeenCalled();
  });
});
