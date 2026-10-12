import { ok, withErrorBoundary } from "@/lib/api";
import { db } from "@/lib/db";
import {
  getEffectivePermissions,
  publicUser,
  requireApiUser,
} from "@/lib/auth/session";
import { identityView } from "@/lib/identity/verification";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/auth/me
 * Returns the currently signed-in user, or 401 when not authenticated.
 *
 * The response is additive over the original contract: `permissions` and
 * `identity` are new keys, every previously-returned field is still present
 * (with `phone` now masked instead of plaintext).
 */
export const GET = withErrorBoundary(async () => {
  const user = await requireApiUser();
  const [permissions, identityRow] = await Promise.all([
    getEffectivePermissions(user.role.key),
    db.identityVerification.findUnique({ where: { userId: user.id } }),
  ]);

  return ok({
    user: publicUser(user),
    permissions: [...permissions].sort(),
    identity: identityView(identityRow),
  });
});