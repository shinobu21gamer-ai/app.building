import {
  ok,
  withErrorBoundary,
  parseBody,
  assertSameOrigin,
  createApiError,
} from "@/lib/api";
import { db } from "@/lib/db";
import { DUMMY_PASSWORD_HASH, verifyPassword } from "@/lib/auth/password";
import {
  createSessionToken,
  publicUser,
  roleHome,
  setSessionCookie,
} from "@/lib/auth/session";
import { loginSchema } from "@/lib/validations/auth";
import { recordAudit, requestMeta } from "@/lib/audit";
import {
  checkLoginAllowed,
  clearLoginFailures,
  recordLoginFailure,
} from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/auth/login
 * Authenticates a user and creates the session cookie.
 */
export const POST = withErrorBoundary(async (req: Request) => {
  assertSameOrigin(req);
  const data = await parseBody(req, loginSchema);
  const { ip, userAgent } = requestMeta(req);

  const decision = await checkLoginAllowed(data.email, ip);
  if (!decision.allowed) {
    await recordAudit({
      action: "LOGIN_RATE_LIMITED",
      resourceType: "auth",
      description: `Login throttled for email ${data.email}.`,
      ip,
      userAgent,
    });
    throw createApiError.tooManyRequests(
      `Too many failed login attempts. Try again in ${decision.retryAfterSeconds} seconds.`,
      decision.retryAfterSeconds ?? undefined
    );
  }

  const user = await db.user.findUnique({
    where: { email: data.email },
    include: { role: true, office: true },
  });

  // Always run a compare so the response time does not reveal whether the
  // email exists (prevents user enumeration via timing).
  const passwordValid = await verifyPassword(
    data.password,
    user ? user.passwordHash : DUMMY_PASSWORD_HASH
  );

  if (!user || !passwordValid) {
    await recordLoginFailure(data.email, ip);
    await recordAudit({
      action: "LOGIN_FAILED",
      resourceType: "auth",
      description: `Failed login attempt for email ${data.email}.`,
      ip,
      userAgent,
    });
    throw createApiError.unauthorized("Invalid email or password.");
  }

  if (!user.isActive) {
    await recordLoginFailure(data.email, ip);
    await recordAudit({
      action: "LOGIN_BLOCKED",
      resourceType: "user",
      resourceId: String(user.id),
      description: "Login blocked for deactivated account.",
      userId: user.id,
      ip,
      userAgent,
    });
    throw createApiError.forbidden("Your account has been deactivated.");
  }

  await clearLoginFailures(data.email);
  await recordAudit({
    action: "LOGIN_SUCCESS",
    resourceType: "user",
    resourceId: String(user.id),
    description: `User ${user.email} signed in.`,
    userId: user.id,
    ip,
    userAgent,
  });

  const token = await createSessionToken({
    sub: String(user.id),
    role: user.role.key,
    officeId: user.officeId,
    email: user.email,
    tv: user.tokenVersion,
  });
  await setSessionCookie(token);

  return ok({
    user: publicUser(user),
    redirect: roleHome(user.role.key),
  });
});