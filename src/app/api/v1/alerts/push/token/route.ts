import { db } from "@/lib/db";
import { z } from "zod";
import { assertSameOrigin, createApiError, ok, parseBody, withErrorBoundary } from "@/lib/api";
import { requireApiUser } from "@/lib/auth/session";
import { isNativePushConfigured } from "@/lib/push";

export const runtime = "nodejs";

const tokenSchema = z.object({
  token: z.string().min(10).max(500),
  platform: z.enum(["android", "ios"]).default("android"),
  deviceId: z.string().min(1).max(200).optional(),
  active: z.boolean().default(true),
});


export const GET = withErrorBoundary(async (req: Request) => {
  const user = await requireApiUser();
  const parsedPlatform = z.enum(["android", "ios"]).safeParse(
    new URL(req.url).searchParams.get("platform") ?? "android"
  );
  if (!parsedPlatform.success) {
    throw createApiError.badRequest("Unsupported push platform.");
  }

  const registration = await db.nativePushToken.findFirst({
    where: { userId: user.id, platform: parsedPlatform.data, active: true },
    select: { id: true },
  });

  // Registration and delivery fail independently, so the phone reports both:
  // "this device is registered" and "this server can actually send".
  return ok({
    registered: Boolean(registration),
    serverConfigured: await isNativePushConfigured(),
  });
});

export const POST = withErrorBoundary(async (req: Request) => {
  assertSameOrigin(req);
  const user = await requireApiUser();
  const input = await parseBody(req, tokenSchema);

  if (!input.active) {
    await db.nativePushToken.updateMany({
      where: { token: input.token, userId: user.id },
      data: { active: false },
    });
    return ok({ registered: false, removed: true });
  }

  // Defend against cross-account token takeover: a token row is keyed by the
  // device token itself, so without this check a second account registering the
  // same token would silently retarget the first account's push channel.
  //
  // Only a *live* registration on another account blocks this device. A row
  // deactivated by a sign-out belongs to a device nobody is signed in to, so
  // the account signing in now may claim it — otherwise signing out on a shared
  // phone would pin push to the previous account forever.
  const existing = await db.nativePushToken.findUnique({
    where: { token: input.token },
    select: { userId: true, active: true },
  });
  if (existing && existing.active && existing.userId !== user.id) {
    throw createApiError.conflict(
      "This device token is already registered to another account."
    );
  }

  await db.nativePushToken.upsert({
    where: { token: input.token },
    create: {
      userId: user.id,
      token: input.token,
      platform: input.platform,
      deviceId: input.deviceId ?? null,
    },
    update: {
      userId: user.id,
      active: true,
      platform: input.platform,
      deviceId: input.deviceId ?? null,
    },
  });

  // Replace a stale token only for the same device slot (same user, same
  // platform, same deviceId). Without a deviceId we must not retire anything:
  // the token may have been re-registered from an entirely different device,
  // and old tokens are pruned automatically when FCM/APNs reject them as
  // unregistered on the next broadcast.
  if (input.deviceId) {
    await db.nativePushToken.updateMany({
      where: {
        userId: user.id,
        platform: input.platform,
        deviceId: input.deviceId,
        active: true,
        token: { not: input.token },
      },
      data: { active: false },
    });
  }

  return ok({ registered: true });
});
