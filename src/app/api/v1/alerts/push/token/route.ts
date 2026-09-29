import { db } from "@/lib/db";
import { z } from "zod";
import { assertSameOrigin, ok, parseBody, withErrorBoundary } from "@/lib/api";
import { requireApiUser } from "@/lib/auth/session";

export const runtime = "nodejs";

const tokenSchema = z.object({
  token: z.string().min(10).max(500),
  platform: z.enum(["android", "ios"]).default("android"),
  deviceId: z.string().min(1).max(200).optional(),
  active: z.boolean().default(true),
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

  await db.nativePushToken.upsert({
    where: { token: input.token },
    create: {
      userId: user.id,
      token: input.token,
      platform: input.platform,
      deviceId: input.deviceId ?? null,
    },
    update: { active: true, platform: input.platform, deviceId: input.deviceId ?? null },
  });

  // One active device row per user+platform+device; retire stale rows for that device slot.
  await db.nativePushToken.updateMany({
    where: {
      userId: user.id,
      platform: input.platform,
      active: true,
      token: { not: input.token },
      ...(input.deviceId ? { deviceId: input.deviceId } : {}),
    },
    data: { active: false },
  });

  return ok({ registered: true });
});
