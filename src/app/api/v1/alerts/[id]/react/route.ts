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

  const existingAlert = await db.systemAlert.findUnique({
    where: { id },
    select: { id: true },
  });
  if (!existingAlert) throw createApiError.notFound("Alert not found.");

  await db.systemAlertReaction.upsert({
    where: { alertId_userId: { alertId: id, userId: user.id } },
    create: { alertId: id, userId: user.id, reaction },
    update: { reaction },
  });

  // One reaction per user (upsert above); return the authoritative totals so
  // the client replaces its local counts instead of incrementing in place,
  // which would drift when a user changes their reaction.
  const rows = await db.systemAlertReaction.findMany({
    where: { alertId: id },
    select: { reaction: true },
  });
  const counts: Record<string, number> = { ACKNOWLEDGED: 0, HELPFUL: 0, NEED_HELP: 0 };
  for (const row of rows) counts[row.reaction] = (counts[row.reaction] ?? 0) + 1;

  return ok({ reaction, counts });
});
