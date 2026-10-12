import {
  ok,
  withErrorBoundary,
  parseBody,
  assertSameOrigin,
} from "@/lib/api";
import { db } from "@/lib/db";
import { publicUser, requireApiUser } from "@/lib/auth/session";
import { updateProfileSchema } from "@/lib/validations/auth";
import { recordAudit, requestMeta } from "@/lib/audit";
import { buildPhoneFields } from "@/lib/privacy/phone-store";
import { assertPiiConfigured } from "@/lib/privacy/service";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/v1/auth/profile
 * Updates the signed-in user's own profile fields (their own record only).
 * A new phone number is encrypted; the legacy plaintext column is cleared.
 */
export const PATCH = withErrorBoundary(async (req: Request) => {
  assertSameOrigin(req);
  const { ip, userAgent } = requestMeta(req);
  const current = await requireApiUser();
  const data = await parseBody(req, updateProfileSchema);

  const phoneChanged = data.phone !== undefined;
  if (phoneChanged && data.phone !== null) assertPiiConfigured();
  const phoneFields = phoneChanged ? buildPhoneFields(data.phone) : null;

  const user = await db.user.update({
    where: { id: current.id },
    data: {
      ...(data.firstName !== undefined ? { firstName: data.firstName } : {}),
      ...(data.lastName !== undefined ? { lastName: data.lastName } : {}),
      ...(data.position !== undefined ? { position: data.position } : {}),
      ...(phoneChanged
        ? phoneFields
          ? { ...phoneFields, phone: null }
          : { phone: null, phoneEncrypted: null, phoneLast4: null, phoneHash: null }
        : {}),
      ...(data.address !== undefined ? { address: data.address } : {}),
    },
    include: { role: true, office: true },
  });

  await recordAudit({
    action: "PROFILE_UPDATED",
    resourceType: "user",
    resourceId: String(user.id),
    description: "User updated their own profile.",
    userId: user.id,
    ip,
    userAgent,
  });

  return ok({ user: publicUser(user) });
});