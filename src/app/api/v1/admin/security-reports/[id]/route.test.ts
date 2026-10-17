import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  updateReport: vi.fn(),
  updateNotifications: vi.fn(),
  requireAdmin: vi.fn(),
  recordAudit: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    loginSecurityReport: { updateMany: mocks.updateReport },
    notification: { updateMany: mocks.updateNotifications },
  },
}));
vi.mock("@/lib/auth/session", () => ({ requireApiRole: mocks.requireAdmin }));
vi.mock("@/lib/audit", () => ({
  recordAudit: mocks.recordAudit,
  requestMeta: () => ({ ip: "192.0.2.3", userAgent: "Admin browser" }),
}));
vi.mock("@/lib/api", () => ({
  assertSameOrigin: vi.fn(),
  createApiError: { notFound: (message: string) => new Error(message) },
  ok: (data: unknown) => Response.json(data),
  withErrorBoundary: (handler: (...args: never[]) => unknown) => handler,
}));

import { POST } from "./route";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.requireAdmin.mockResolvedValue({ id: 2, role: { key: "ADMIN" } });
  mocks.updateReport.mockResolvedValue({ count: 1 });
  mocks.updateNotifications.mockResolvedValue({ count: 2 });
});

describe("admin sign-in report review", () => {
  it("marks one open report reviewed and clears its outstanding notices", async () => {
    const response = await POST(
      new Request("https://app.example/api/v1/admin/security-reports/31", { method: "POST" }),
      { params: Promise.resolve({ id: "31" }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ reportId: 31, reviewed: true });
    expect(mocks.updateReport).toHaveBeenCalledWith({
      where: { id: 31, reviewedAt: null },
      data: { reviewedAt: expect.any(Date), reviewedById: 2 },
    });
    expect(mocks.updateNotifications).toHaveBeenCalledWith({
      where: { loginSecurityReportId: 31, type: { in: ["LOGIN_SECURITY_REPORT", "LOGIN_SECURITY_REPORT_REMINDER"] } },
      data: { isRead: true, readAt: expect.any(Date) },
    });
    expect(mocks.recordAudit).toHaveBeenCalled();
  });
});
