import { db } from "@/lib/db";
import { assertSameOrigin, createApiError, ok, parseBody, withErrorBoundary } from "@/lib/api";
import { requireApiUser } from "@/lib/auth/session";
import { sendAndroidPushTest } from "@/lib/push";
import { nativePushTestSchema } from "@/lib/validations/native-push";

export const runtime = "nodejs";
export const POST = withErrorBoundary(async (req: Request) => {
  assertSameOrigin(req);
  const user = await requireApiUser();
  const input = await parseBody(req, nativePushTestSchema);
  // Never accept somebody else's token or broadcast a test as a real emergency.
  const registration = await db.nativePushToken.findFirst({
    where: { userId: user.id, token: input.token, platform: "android", active: true },
    select: { id: true },
  });
  if (!registration) throw createApiError.badRequest("This phone is not registered to your account. Register it first.");
  // Durable per-account cooldown shared across serverless instances. Increment
  // atomically rather than using a process-local map.
  const now = new Date();
  const key = `push-test:${user.id}`;
  const claimed = await db.loginAttemptBucket.upsert({
    where: { key },
    create: { key, windowStart: now, failures: 1 },
    update: { failures: { increment: 1 } },
  });
  if (claimed.windowStart.getTime() > now.getTime() - 60_000 && claimed.failures > 1) {
    throw createApiError.tooManyRequests("Wait one minute before sending another test.", 60);
  }
  if (claimed.windowStart.getTime() <= now.getTime() - 60_000) {
    // Only one concurrent request can reset an expired bucket and claim it.
    const reset = await db.loginAttemptBucket.updateMany({
      where: { key, windowStart: claimed.windowStart },
      data: { windowStart: now, failures: 1 },
    });
    if (reset.count !== 1) throw createApiError.tooManyRequests("Wait one minute before sending another test.", 60);
  }
  const result = await sendAndroidPushTest(input.token);
  if (!result.accepted) {
    if (result.stale) await db.nativePushToken.update({ where: { id: registration.id }, data: { active: false } });
    throw createApiError.badRequest(result.message);
  }
  return ok(result);
});
