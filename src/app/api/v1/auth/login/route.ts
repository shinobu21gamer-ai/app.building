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
import { isNewLoginContext } from "@/lib/auth/login-alert";
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
    // Not a wrong-password failure: the password was correct. Recording it here
    // would let every login attempt throttle the throttling bucket for what is
    // really an admin action (reactivating the account).
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

  if (user.loginLockedAt) {
    await recordAudit({
      action: "LOGIN_SECURITY_LOCKED",
      resourceType: "user",
      resourceId: String(user.id),
      description: "Login blocked because the account is secured after an unrecognized sign-in report.",
      userId: user.id,
      ip,
      userAgent,
    });
    throw createApiError.forbidden(
      "This account was secured after an unrecognized sign-in. Contact a barangay administrator for a reset code, then reset your password to unlock it."
    );
  }

  const previousLogin = await db.audit.findFirst({
    where: {
      userId: user.id,
      action: "LOGIN_SUCCESS",
      createdAt: { gte: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000) },
    },
    orderBy: { createdAt: "desc" },
    select: { userAgent: true, ip: true },
  });
  const isNewContext = isNewLoginContext(previousLogin, { userAgent, ip });

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

  if (isNewContext) {
    try {
      const detectedAt = new Intl.DateTimeFormat("en-PH", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "Asia/Manila",
      }).format(new Date());
      await db.notification.create({
        data: {
          userId: user.id,
          concernId: null,
          type: "LOGIN_SECURITY_ALERT",
          title: "Was this sign-in you?",
          message: `A sign-in from a different browser, device, or network was detected on ${detectedAt}. If you do not recognize it, report it to barangay administrators for follow-up. This alert alone does not verify who signed in or change your sessions.`,
        },
      });
    } catch (error) {
      // A security inbox alert must never prevent a valid user from signing in.
      console.error("[auth] could not create new-browser login alert:", error);
    }
  }

  return ok({
    user: publicUser(user),
    redirect: roleHome(user.role.key),
  });
});