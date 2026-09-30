import { db } from "@/lib/db";
import {
  assertSameOrigin,
  createApiError,
  ok,
  parseBody,
  withErrorBoundary,
} from "@/lib/api";
import { requireApiUser } from "@/lib/auth/session";
import { getPushPublicKey, isValidPushEndpoint } from "@/lib/push";
import { pushSubscriptionSchema } from "@/lib/validations/alert";

export const runtime = "nodejs";

export const GET = withErrorBoundary(async () => {
  await requireApiUser();
  return ok({ publicKey: getPushPublicKey() });
});

export const POST = withErrorBoundary(async (req: Request) => {
  assertSameOrigin(req);
  const user = await requireApiUser();
  const input = await parseBody(req, pushSubscriptionSchema);

  if (!isValidPushEndpoint(input.endpoint)) {
    throw createApiError.badRequest(
      "Only public HTTPS push endpoints are allowed."
    );
  }

  await db.$transaction(async (tx) => {
    const existing = await tx.pushSubscription.findUnique({
      where: { endpoint: input.endpoint },
      select: { id: true, userId: true },
    });
    if (existing && existing.userId !== user.id) {
      throw createApiError.conflict(
        "This push endpoint is already registered to another account."
      );
    }
    await tx.pushSubscription.upsert({
      where: { endpoint: input.endpoint },
      create: {
        userId: user.id,
        endpoint: input.endpoint,
        p256dh: input.keys.p256dh,
        auth: input.keys.auth,
      },
      update: { userId: user.id, p256dh: input.keys.p256dh, auth: input.keys.auth },
    });
  });

  return ok({ subscribed: true });
});

export const DELETE = withErrorBoundary(async (req: Request) => {
  assertSameOrigin(req);
  const user = await requireApiUser();
  const endpoint = new URL(req.url).searchParams.get("endpoint");

  if (!endpoint) {
    // Refuse a blanket wipe: a client that drops the endpoint argument must
    // never silently unsubscribe every device at once.
    return ok({ unsubscribed: false });
  }

  const deleted = await db.pushSubscription.deleteMany({
    where: { endpoint, userId: user.id },
  });
  return ok({ unsubscribed: deleted.count > 0 });
});