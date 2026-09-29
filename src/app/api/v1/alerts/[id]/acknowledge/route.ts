import { db } from "@/lib/db";
import { assertSameOrigin, createApiError, ok, withErrorBoundary } from "@/lib/api";
import { requireApiUser } from "@/lib/auth/session";

export const runtime = "nodejs";

type Context = { params: Promise<{ id: string }> };

export const POST = withErrorBoundary<[Request, Context]>(async (req, ctx) => {
  assertSameOrigin(req);
  const user = await requireApiUser();
  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id) || id <= 0) throw createApiError.notFound("Alert not found.");

  await db.systemAlertAcknowledgement.upsert({
    where: { alertId_userId: { alertId: id, userId: user.id } },
    create: { alertId: id, userId: user.id },
    update: {},
  });
  return ok({ acknowledged: true });
});
