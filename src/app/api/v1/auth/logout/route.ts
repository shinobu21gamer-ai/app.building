import type { z } from "zod";
import { ok, withErrorBoundary, assertSameOrigin } from "@/lib/api";
import {
  clearSessionCookie,
  getSessionToken,
  verifySessionToken,
} from "@/lib/auth/session";
import { recordAudit, requestMeta } from "@/lib/audit";
import { db } from "@/lib/db";
import { createHash } from "node:crypto";
import { logoutDeviceSchema } from "@/lib/validations/alert";

export const dynamic = "force-dynamic";

/**
 * Reads the optional device hint a client sends so sign-out can unregister
 * only the device that asked, rather than every device on the account.
 *
 * The body may be absent (older clients, or `fetch` with no payload), and a
 * malformed hint must never block signing out — anything unexpected is treated
 * as "no hint".
 */
async function readDeviceHint(
  req: Request
): Promise<z.infer<typeof logoutDeviceSchema> | null> {
  let raw: string;
  try {
    raw = await req.text();
  } catch {
    return null;
  }
  if (!raw.trim()) return null;

  try {
    const parsed = logoutDeviceSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * Removes the signing-out device from alert delivery.
 *
 * Alert broadcasts select devices by `user.isActive`, which is still true after
 * a sign-out — so without this the device keeps receiving alerts indefinitely
 * (see `deliverWebPush` / `deliverNativePush` in `lib/push.ts`).
 *
 * Scoped to the single device that asked: other signed-in devices (a desktop
 * browser, a second phone) keep their registration.
 */
async function releaseDeviceFromAlerts(
  device: z.infer<typeof logoutDeviceSchema>,
  userId: number | null
): Promise<void> {
  // A push endpoint is a capability URL and a device token is issued only to
  // that device, so matching on them identifies the device even when the
  // session JWT has already expired and no userId can be resolved.
  const userScope = userId === null ? {} : { userId };

  if (device.endpoint) {
    await db.pushSubscription.deleteMany({
      where: { endpoint: device.endpoint, ...userScope },
    });
  }

  if (device.token) {
    await db.nativePushToken.updateMany({
      where: { token: device.token, ...userScope },
      data: { active: false },
    });
  }
}

/**
 * POST /api/v1/auth/logout
 * Ends the session by clearing the session cookie and revoking the token, and
 * unregisters this device from alert delivery while nobody is signed in.
 */
export const POST = withErrorBoundary(async (req: Request) => {
  assertSameOrigin(req);
  const { ip, userAgent } = requestMeta(req);
  const device = await readDeviceHint(req);
  const token = await getSessionToken();
  const claims = token ? await verifySessionToken(token) : null;
  const userId = claims ? Number(claims.sub) : null;

  try {
    if (device) {
      // Best effort: the session must end even if the push tables are unhappy.
      await releaseDeviceFromAlerts(device, userId).catch((error) => {
        console.error("[auth] could not unregister push device on logout:", error);
      });
    }

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
