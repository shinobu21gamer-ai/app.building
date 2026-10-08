import { db } from "@/lib/db";
import { assertSameOrigin, ok, parseBody, withErrorBoundary } from "@/lib/api";
import { requireApiUser } from "@/lib/auth/session";
import { acknowledgeAlertsSchema } from "@/lib/validations/alert";

export const runtime = "nodejs";

export const POST = withErrorBoundary(async (req: Request) => {
  assertSameOrigin(req);
  const user = await requireApiUser();
  const { alertIds } = await parseBody(req, acknowledgeAlertsSchema);

  const acknowledgedCount = await db.$transaction(async (transaction) => {
    const existingAlerts = await transaction.systemAlert.findMany({
      where: { id: { in: alertIds } },
      select: { id: true },
    });
    const existingIds = existingAlerts.map((alert) => alert.id);

    // An administrator may remove an alert while this user's queue is open.
    // Treat that stale ID as already cleared and acknowledge any remaining
    // alerts instead of failing the entire batch.
    if (existingIds.length > 0) {
      await transaction.systemAlertAcknowledgement.createMany({
        data: existingIds.map((alertId) => ({ alertId, userId: user.id })),
        skipDuplicates: true,
      });
    }
    return existingIds.length;
  });

  return ok({ acknowledged: true, count: acknowledgedCount });
});
