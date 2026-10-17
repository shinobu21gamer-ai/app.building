import {
  assertSameOrigin,
  createApiError,
  ok,
  withErrorBoundary,
} from "@/lib/api";
import { db } from "@/lib/db";
import { requireApiRole } from "@/lib/auth/session";
import { recordAudit, requestMeta } from "@/lib/audit";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

export const POST = withErrorBoundary<[Request, RouteContext]>(async (req, ctx) => {
  assertSameOrigin(req);
  const admin = await requireApiRole(["ADMIN"]);
  const { ip, userAgent } = requestMeta(req);
  const { id } = await ctx.params;
  const reportId = Number(id);
  if (!Number.isInteger(reportId) || reportId <= 0) {
    throw createApiError.notFound("Security report not found.");
  }

  const result = await db.loginSecurityReport.updateMany({
    where: { id: reportId, reviewedAt: null },
    data: { reviewedAt: new Date(), reviewedById: admin.id },
  });
  if (result.count !== 1) throw createApiError.notFound("Open security report not found.");

  await db.notification.updateMany({
    where: { loginSecurityReportId: reportId, type: { in: ["LOGIN_SECURITY_REPORT", "LOGIN_SECURITY_REPORT_REMINDER"] } },
    data: { isRead: true, readAt: new Date() },
  });
  await recordAudit({
    action: "LOGIN_SECURITY_REPORT_REVIEWED",
    resourceType: "auth",
    resourceId: String(reportId),
    description: "Administrator marked an unfamiliar sign-in report reviewed.",
    userId: admin.id,
    ip,
    userAgent,
  });

  return ok({ reportId, reviewed: true });
});
