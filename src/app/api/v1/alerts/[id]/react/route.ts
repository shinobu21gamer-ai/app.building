import { db } from "@/lib/db";
import { assertSameOrigin, createApiError, ok, parseBody, withErrorBoundary } from "@/lib/api";
import { requireApiUser } from "@/lib/auth/session";
import { alertReactionSchema } from "@/lib/validations/alert";

export const runtime = "nodejs";

type Context = { params: Promise<{ id: string }> };

export const POST = withErrorBoundary<[Request, Context]>(async (req, ctx) => {
  assertSameOrigin(req);
  const user = await requireApiUser();
  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id) || id <= 0) throw createApiError.notFound("Alert not found.");
  const { reaction } = await parseBody(req, alertReactionSchema);

  const saved = await db.systemAlertReaction.upsert({
    where: { alertId_userId: { alertId: id, userId: user.id } },
    create: { alertId: id, userId: user.id, reaction },
    update: { reaction },
  });
  return ok({ reaction: saved.reaction });
});
