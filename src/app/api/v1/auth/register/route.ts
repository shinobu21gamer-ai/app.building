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
  roleHome,
  setSessionCookie,
} from "@/lib/auth/session";
import { registerSchema } from "@/lib/validations/auth";
import { recordAudit, requestMeta } from "@/lib/audit";
import {
  checkRegistrationAllowed,
  clearRegistrationFailures,
  recordRegistrationFailure,
} from "@/lib/rate-limit";
import { buildPhoneFields } from "@/lib/privacy/phone-store";
import { assertPiiConfigured } from "@/lib/privacy/service";
import {
  consentSummary,
  currentConsents,
  grantConsents,
} from "@/lib/privacy/consent";
import type { ConsentPurpose } from "@/lib/privacy/catalog";

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

  // The phone number is personal data: it is stored encrypted with a keyed
  // lookup hash and a readable last-four, never in the plaintext column.
  if (data.phone) assertPiiConfigured();
  const phoneFields = data.phone ? buildPhoneFields(data.phone) : null;

  let user;
  try {
    user = await db.user.create({
      data: {
        email: data.email,
        passwordHash,
        firstName: data.firstName,
        lastName: data.lastName,
        phone: null,
        ...(phoneFields ?? {}),
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

  const consentMeta = { method: "WEB" as const, ip, userAgent };
  const optionalConsents: ConsentPurpose[] = [];
  if (data.consentTransparencyPublication) {
    optionalConsents.push("TRANSPARENCY_PUBLICATION");
  }
  if (data.consentNotifications) optionalConsents.push("NOTIFICATIONS");
  if (data.consentSms) optionalConsents.push("SMS");

  // RA 10173: the two mandatory acknowledgements plus whatever the resident
  // opted into. Written as consent rows so the decision is provable later.
  const granted = await grantConsents(
    user.id,
    ["DATA_PROCESSING", "PRIVACY_NOTICE", ...optionalConsents],
    consentMeta
  );

  await clearRegistrationFailures(ip);
  await recordAudit({
    action: "USER_REGISTERED",
    resourceType: "user",
    resourceId: String(user.id),
    description: `Resident registered with email ${user.email}. Consents: ${granted
      .map((consent) => consent.purpose)
      .join(", ")}.`,
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

  return ok(
    {
      user: publicUser(user),
      consents: consentSummary(await currentConsents(user.id)),
      redirect: roleHome(user.role.key),
    },
    { status: 201 }
  );
});