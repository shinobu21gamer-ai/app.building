import { ok, withErrorBoundary, assertSameOrigin } from "@/lib/api";
import {
  clearSessionCookie,
  getSessionToken,
  verifySessionToken,
} from "@/lib/auth/session";
import { recordAudit, requestMeta } from "@/lib/audit";
import { db } from "@/lib/db";
import { createHash } from "node:crypto";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/auth/logout
 * Ends the session by clearing the session cookie and revoking the token.
 */
export const POST = withErrorBoundary(async (req: Request) => {
  assertSameOrigin(req);
  const { ip, userAgent } = requestMeta(req);
  const token = await getSessionToken();
  const claims = token ? await verifySessionToken(token) : null;
  const userId = claims ? Number(claims.sub) : null;

  try {
    if (token && claims && userId !== null) {
      const tokenHash = createHash("sha256").update(token).digest("hex");
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

      await db.revokedToken.upsert({
        where: { tokenHash },
        create: { tokenHash, userId, expiresAt },
        update: {},
      });

      // Opportunistic sweep: revoked rows are only referenced while their
      // token may still be presented, so expired rows are safe to delete.
      await db.revokedToken.deleteMany({
        where: { expiresAt: { lt: new Date() } },
      });
    }

    await recordAudit({
      action: "LOGOUT",
      resourceType: "auth",
      resourceId: userId ? String(userId) : undefined,
      description: "User signed out.",
      userId,
      ip,
      userAgent,
    });
  } finally {
    await clearSessionCookie();
  }

  return ok({ success: true });
});