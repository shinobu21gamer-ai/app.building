import {
  ok,
  withErrorBoundary,
  parseBody,
  assertSameOrigin,
  createApiError,
} from "@/lib/api";
import { db } from "@/lib/db";
import { hashPassword, verifyPassword, DUMMY_PASSWORD_HASH } from "@/lib/auth/password";
import { resetPasswordSchema } from "@/lib/validations/auth";
import { recordAudit, requestMeta } from "@/lib/audit";
import { checkIpAllowed, clearLoginFailures, recordIpFailure } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const RESET_CODE_MAX_FAILURES = 5;

/**
 * POST /api/v1/auth/reset-password
 * Redeems an admin-generated one-time reset code (email + code + new
 * password). Public, but throttled per IP to blunt code brute-forcing.
 *
 * The response intentionally does not reveal whether the email exists, the
 * code was valid, or the code was already used.
 */
export const POST = withErrorBoundary(async (req: Request) => {
  assertSameOrigin(req);
  const data = await parseBody(req, resetPasswordSchema);
  const { ip, userAgent } = requestMeta(req);

  const decision = await checkIpAllowed(ip, RESET_CODE_MAX_FAILURES);
  if (!decision.allowed) {
    await recordAudit({
      action: "RESET_RATE_LIMITED",
      resourceType: "auth",
      description:
        "Password-reset redemption throttled from this network address.",
      ip,
      userAgent,
    });
    throw createApiError.tooManyRequests(
      `Too many reset attempts from this network. Try again in ${decision.retryAfterSeconds} seconds.`,
      decision.retryAfterSeconds ?? undefined
    );
  }

  const invalidCode = () =>
    createApiError.badRequest("Invalid or expired reset code.");

  const user = await db.user.findUnique({ where: { email: data.email } });
  if (!user) {
    // Equalize timing with a real bcrypt compare so the response time does
    // not reveal whether the account exists.
    await verifyPassword(data.code, DUMMY_PASSWORD_HASH);
    throw invalidCode();
  }

  const reset = await db.passwordResetCode.findUnique({
    where: { userId: user.id },
  });
  if (!reset || reset.usedAt !== null || reset.expiresAt.getTime() < Date.now()) {
    await verifyPassword(data.code, DUMMY_PASSWORD_HASH);
    throw invalidCode();
  }

  const codeValid = await verifyPassword(data.code, reset.codeHash);
  if (!codeValid) {
    await recordIpFailure(ip);
    await recordAudit({
      action: "PASSWORD_RESET_FAILED",
      resourceType: "user",
      resourceId: String(user.id),
      description: "Invalid reset code submitted for account.",
      userId: user.id,
      ip,
      userAgent,
    });
    throw invalidCode();
  }

  const newPasswordHash = await hashPassword(data.newPassword);

  await db.$transaction(async (tx) => {
    const claimed = await tx.passwordResetCode.updateMany({
      where: {
        id: reset.id,
        usedAt: null,
        expiresAt: { gt: new Date() },
      },
      data: { usedAt: new Date() },
    });

    if (claimed.count !== 1) throw invalidCode();

    await tx.user.update({
      where: { id: user.id },
      data: { passwordHash: newPasswordHash, tokenVersion: { increment: 1 } },
    });
  });

  await clearLoginFailures(user.email);

  await recordAudit({
    action: "PASSWORD_RESET_USED",
    resourceType: "user",
    resourceId: String(user.id),
    description: "Password reset code redeemed for this account.",
    userId: user.id,
    ip,
    userAgent,
  });

  return ok({ success: true });
});