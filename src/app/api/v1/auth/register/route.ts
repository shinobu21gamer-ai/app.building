import { Prisma } from "@prisma/client";
import {
  ok,
  withErrorBoundary,
  parseBody,
  assertSameOrigin,
  createApiError,
} from "@/lib/api";
import { db } from "@/lib/db";
import { hashPassword } from "@/lib/auth/password";
import {
  createSessionToken,
  publicUser,
  setSessionCookie,
} from "@/lib/auth/session";
import { registerSchema } from "@/lib/validations/auth";
import { recordAudit, requestMeta } from "@/lib/audit";
import {
  checkRegistrationAllowed,
  clearRegistrationFailures,
  recordRegistrationFailure,
} from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/auth/register
 * Creates a RESIDENT account and starts a session (auto-login).
 */
export const POST = withErrorBoundary(async (req: Request) => {
  assertSameOrigin(req);
  const data = await parseBody(req, registerSchema);
  const { ip, userAgent } = requestMeta(req);

  const decision = await checkRegistrationAllowed(ip);
  if (!decision.allowed) {
    await recordAudit({
      action: "REGISTER_RATE_LIMITED",
      resourceType: "auth",
      description: "Registration throttled from this network address.",
      ip,
      userAgent,
    });
    throw createApiError.tooManyRequests(
      `Too many registration attempts from this network. Try again in ${decision.retryAfterSeconds} seconds.`
    );
  }

  const existing = await db.user.findUnique({ where: { email: data.email } });
  if (existing) {
    await recordRegistrationFailure(ip);
    throw createApiError.conflict("An account with this email already exists.");
  }

  const residentRole = await db.role.findUnique({ where: { key: "RESIDENT" } });
  if (!residentRole) {
    throw createApiError.internal("The RESIDENT role is not configured.");
  }

  const passwordHash = await hashPassword(data.password);

  let user;
  try {
    user = await db.user.create({
      data: {
        email: data.email,
        passwordHash,
        firstName: data.firstName,
        lastName: data.lastName,
        phone: data.phone ?? null,
        address: data.address ?? null,
        roleId: residentRole.id,
      },
      include: { role: true, office: true },
    });
  } catch (error) {
    // Two concurrent submissions can pass the existence check above; the
    // unique email constraint is the source of truth. Surface the same
    // conflict rather than leaking a 500.
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      await recordRegistrationFailure(ip);
      throw createApiError.conflict(
        "An account with this email already exists."
      );
    }
    throw error;
  }

  await clearRegistrationFailures(ip);
  await recordAudit({
    action: "USER_REGISTERED",
    resourceType: "user",
    resourceId: String(user.id),
    description: `Resident registered with email ${user.email}.`,
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

  return ok({ user: publicUser(user), redirect: "/resident" }, { status: 201 });
});