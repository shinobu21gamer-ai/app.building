import {
  assertSameOrigin,
  createApiError,
  ok,
  parseBody,
  withErrorBoundary,
} from "@/lib/api";
import { db } from "@/lib/db";
import { requireApiUser } from "@/lib/auth/session";
import { recordAudit, requestMeta } from "@/lib/audit";
import { loginAlertReportSchema } from "@/lib/validations/notification";
import { loginReportDueAt } from "@/lib/auth/login-report-deadline";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

/** Reports an unfamiliar sign-in without deciding ownership or changing sessions. */
export const POST = withErrorBoundary<[Request, RouteContext]>(async (req, ctx) => {
  assertSameOrigin(req);
  const user = await requireApiUser();
  const { ip, userAgent } = requestMeta(req);
  const { id } = await ctx.params;
  const notificationId = Number(id);
  if (!Number.isInteger(notificationId) || notificationId <= 0) {
    throw createApiError.notFound("Login alert not found.");
  }
  await parseBody(req, loginAlertReportSchema);

  const pendingAlert = {
    id: notificationId,
    userId: user.id,
    type: "LOGIN_SECURITY_ALERT",
    title: "Was this sign-in you?",
  };
  const reportedAt = new Date();
  const responseDueAt = loginReportDueAt(reportedAt);
  const dueLabel = new Intl.DateTimeFormat("en-PH", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Manila",
  }).format(responseDueAt);

  await db.$transaction(async (tx) => {
    const result = await tx.notification.updateMany({
      where: pendingAlert,
      data: {
        title: "Unfamiliar sign-in reported",
        message: "Your report was sent to barangay administrators for review within one business day. It did not sign out other sessions or lock your account.",
        isRead: true,
        readAt: reportedAt,
      },
    });
    if (result.count !== 1) throw createApiError.notFound("Login alert not found.");

    const report = await tx.loginSecurityReport.create({
      data: {
        reportedUserId: user.id,
        reportedEmail: user.email,
        sourceNotificationId: notificationId,
        reportedAt,
        responseDueAt,
      },
      select: { id: true },
    });

    const admins = await tx.user.findMany({
      where: { isActive: true, role: { key: "ADMIN" } },
      select: { id: true },
    });
    if (admins.length > 0) {
      await tx.notification.createMany({
        data: admins.map((admin) => ({
          userId: admin.id,
          concernId: null,
          loginSecurityReportId: report.id,
          type: "LOGIN_SECURITY_REPORT",
          title: "Unfamiliar sign-in reported",
          message: `An account holder reported a sign-in as unfamiliar for ${user.email}. Review by ${dueLabel} Manila time. This report is not proof of account ownership.`,
          createdAt: reportedAt,
        })),
      });
    }
  });

  await recordAudit({
    action: "LOGIN_ALERT_REPORTED_UNRECOGNIZED",
    resourceType: "auth",
    resourceId: String(user.id),
    description: "User reported a new-browser sign-in as unfamiliar; administrators were notified. No sessions were revoked and the account was not locked.",
    userId: user.id,
    ip,
    userAgent,
  });
  return ok({ reported: true, sessionsRevoked: false, accountLocked: false });
});
