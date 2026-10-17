import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  updateMany: vi.fn(),
  findMany: vi.fn(),
  createMany: vi.fn(),
  createReport: vi.fn(),
  transaction: vi.fn(),
  recordAudit: vi.fn(),
  requireUser: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    $transaction: mocks.transaction,
  },
}));
vi.mock("@/lib/auth/session", () => ({
  requireApiUser: mocks.requireUser,
}));
vi.mock("@/lib/audit", () => ({
  recordAudit: mocks.recordAudit,
  requestMeta: () => ({ ip: "192.0.2.1", userAgent: "Test browser" }),
}));
vi.mock("@/lib/api", () => ({
  assertSameOrigin: vi.fn(),
  createApiError: { notFound: (message: string) => new Error(message) },
  ok: (data: unknown) => Response.json(data),
  parseBody: async (request: Request, schema: { parse: (value: unknown) => unknown }) =>
    schema.parse(await request.json()),
  withErrorBoundary: (handler: (...args: never[]) => unknown) => handler,
}));

import { POST } from "./route";

const context = { params: Promise.resolve({ id: "44" }) };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.requireUser.mockResolvedValue({ id: 17, email: "resident@example.test" });
  mocks.updateMany.mockResolvedValue({ count: 1 });
  mocks.findMany.mockResolvedValue([{ id: 3 }, { id: 4 }]);
  mocks.createMany.mockResolvedValue({ count: 2 });
  mocks.createReport.mockResolvedValue({ id: 91 });
  mocks.transaction.mockImplementation(async (callback) =>
    callback({
      notification: { updateMany: mocks.updateMany, createMany: mocks.createMany },
      loginSecurityReport: { create: mocks.createReport },
      user: { findMany: mocks.findMany },
    }),
  );
});

describe("login-alert report", () => {
  it("notifies active admins without revoking sessions or locking the account", async () => {
    const response = await POST(
      new Request("https://app.example/api/v1/auth/login-alerts/44", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ report: true }),
      }),
      context,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      reported: true,
      sessionsRevoked: false,
      accountLocked: false,
    });
    expect(mocks.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 44, userId: 17, type: "LOGIN_SECURITY_ALERT", title: "Was this sign-in you?" },
    }));
    expect(mocks.createReport).toHaveBeenCalledWith({
      data: expect.objectContaining({
        reportedUserId: 17,
        reportedEmail: "resident@example.test",
        sourceNotificationId: 44,
        responseDueAt: expect.any(Date),
      }),
      select: { id: true },
    });
    expect(mocks.findMany).toHaveBeenCalledWith({
      where: { isActive: true, role: { key: "ADMIN" } },
      select: { id: true },
    });
    expect(mocks.createMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.arrayContaining([
        expect.objectContaining({ userId: 3, type: "LOGIN_SECURITY_REPORT", loginSecurityReportId: 91 }),
        expect.objectContaining({ userId: 4, type: "LOGIN_SECURITY_REPORT", loginSecurityReportId: 91 }),
      ]),
    }));
  });

  it("does not accept a confirmation or ownership decision", async () => {
    await expect(POST(
      new Request("https://app.example/api/v1/auth/login-alerts/44", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ wasMe: true }),
      }),
      context,
    )).rejects.toThrow();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});
