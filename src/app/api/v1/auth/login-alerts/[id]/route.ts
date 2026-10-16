import {
  assertSameOrigin,
  createApiError,
  ok,
  parseBody,
  withErrorBoundary,
} from "@/lib/api";
import { db } from "@/lib/db";
import { requireApiUser, clearSessionCookie } from "@/lib/auth/session";
import { recordAudit, requestMeta } from "@/lib/audit";
import { loginAlertDecisionSchema } from "@/lib/validations/notification";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

/** Responds to a new-browser login alert for the signed-in account only. */
export const POST = withErrorBoundary<[Request, RouteContext]>(async (req, ctx) => {
  assertSameOrigin(req);
  const user = await requireApiUser();
  const { ip, userAgent } = requestMeta(req);
  const { id } = await ctx.params;
  const notificationId = Number(id);
  if (!Number.isInteger(notificationId) || notificationId <= 0) {
    throw createApiError.notFound("Login alert not found.");
  }
  const { wasMe } = await parseBody(req, loginAlertDecisionSchema);
  const pendingAlert = {
    id: notificationId,
    userId: user.id,
    type: "LOGIN_SECURITY_ALERT",
    title: "Was this sign-in you?",
  };

  if (wasMe) {
    const result = await db.notification.updateMany({
      where: pendingAlert,
      data: {
        title: "Sign-in confirmed",
        message: "You confirmed that this sign-in was yours.",
        isRead: true,
        readAt: new Date(),
      },
    });
    if (result.count !== 1) throw createApiError.notFound("Login alert not found.");
    await recordAudit({
      action: "LOGIN_ALERT_CONFIRMED",
      resourceType: "auth",
      resourceId: String(user.id),
      description: "User confirmed a new-browser sign-in was theirs.",
      userId: user.id,
      ip,
      userAgent,
    });
    return ok({ wasMe: true });
  }

  await db.$transaction(async (tx) => {
    const result = await tx.notification.updateMany({
      where: pendingAlert,
      data: {
        title: "Unrecognized sign-in reported",
        message: "You reported that this sign-in was not yours. All sessions were signed out. Contact a barangay administrator for a reset code, then reset your password to unlock your account.",
        isRead: true,
        readAt: new Date(),
      },
    });
    if (result.count !== 1) throw createApiError.notFound("Login alert not found.");
    await tx.user.update({
      where: { id: user.id },
      data: {
        tokenVersion: { increment: 1 },
        loginLockedAt: new Date(),
      },
    });
  });

  await clearSessionCookie();
  await recordAudit({
    action: "LOGIN_ALERT_REPORTED_UNRECOGNIZED",
    resourceType: "auth",
    resourceId: String(user.id),
    description: "User reported a new-browser sign-in as unrecognized; all sessions were revoked and password reset is required.",
    userId: user.id,
    ip,
    userAgent,
  });
  return ok({ wasMe: false, sessionsRevoked: true, passwordResetRequired: true });
});
