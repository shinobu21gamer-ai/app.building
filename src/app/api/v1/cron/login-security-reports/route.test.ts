import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authorized: vi.fn(),
  admins: vi.fn(),
  reports: vi.fn(),
  updateMany: vi.fn(),
  createMany: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("@/lib/cron-auth", () => ({ isCronAuthorized: mocks.authorized }));
vi.mock("@/lib/db", () => ({
  db: {
    user: { findMany: mocks.admins },
    loginSecurityReport: { findMany: mocks.reports },
    $transaction: mocks.transaction,
  },
}));

import { POST } from "./route";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.authorized.mockReturnValue(true);
  mocks.admins.mockResolvedValue([{ id: 8 }, { id: 9 }]);
  mocks.reports.mockResolvedValue([
    { id: 31, reportedEmail: "resident@example.test", responseDueAt: new Date("2026-10-19T08:00:00Z") },
  ]);
  mocks.updateMany.mockResolvedValue({ count: 1 });
  mocks.createMany.mockResolvedValue({ count: 2 });
  mocks.transaction.mockImplementation(async (callback) =>
    callback({
      loginSecurityReport: { updateMany: mocks.updateMany },
      notification: { createMany: mocks.createMany },
    }),
  );
});

describe("login security report reminder cron", () => {
  it("sends one linked reminder per admin and claims each report once", async () => {
    const response = await POST(new Request("https://app.example/api/v1/cron/login-security-reports", { method: "POST" }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true, data: { reminded: 1 } });
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: { id: 31, reviewedAt: null, reminderSentAt: null },
      data: { reminderSentAt: expect.any(Date) },
    });
    expect(mocks.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({ userId: 8, loginSecurityReportId: 31, type: "LOGIN_SECURITY_REPORT_REMINDER" }),
        expect.objectContaining({ userId: 9, loginSecurityReportId: 31, type: "LOGIN_SECURITY_REPORT_REMINDER" }),
      ]),
    });
  });

  it("rejects callers without the cron secret", async () => {
    mocks.authorized.mockReturnValue(false);
    const response = await POST(new Request("https://app.example/api/v1/cron/login-security-reports", { method: "POST" }));
    expect(response.status).toBe(401);
    expect(mocks.reports).not.toHaveBeenCalled();
  });
});
