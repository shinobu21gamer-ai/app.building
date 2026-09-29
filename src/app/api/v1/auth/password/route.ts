import {
  ok,
  withErrorBoundary,
  parseBody,
  assertSameOrigin,
  createApiError,
} from "@/lib/api";
import { db } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import {
  createSessionToken,
  requireApiUser,
  setSessionCookie,
} from "@/lib/auth/session";
import { changePasswordSchema } from "@/lib/validations/auth";
import { recordAudit, requestMeta } from "@/lib/audit";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/v1/auth/password
 * Changes the signed-in user's password after verifying the current one.
 * Bumping tokenVersion revokes every other issued session; a fresh token is
 * issued so the current device stays signed in.
 */
export const PATCH = withErrorBoundary(async (req: Request) => {
  assertSameOrigin(req);
  const { ip, userAgent } = requestMeta(req);
  const current = await requireApiUser();
  const data = await parseBody(req, changePasswordSchema);

  const valid = await verifyPassword(data.currentPassword, current.passwordHash);
  if (!valid) {
    throw createApiError.badRequest("Current password is incorrect.");
  }

  const passwordHash = await hashPassword(data.newPassword);

  const updated = await db.user.update({
    where: { id: current.id },
    data: { passwordHash, tokenVersion: { increment: 1 } },
    include: { role: true, office: true },
  });

  const token = await createSessionToken({
    sub: String(updated.id),
    role: updated.role.key,
    officeId: updated.officeId,
    email: updated.email,
    tv: updated.tokenVersion,
  });
  await setSessionCookie(token);

  await recordAudit({
    action: "PASSWORD_CHANGED",
    resourceType: "user",
    resourceId: String(current.id),
    description: "User changed their own password.",
    userId: current.id,
    ip,
    userAgent,
  });

  return ok({ success: true });
});