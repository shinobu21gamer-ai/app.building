import { db } from "@/lib/db";
import { assertSameOrigin, createApiError, ok, parseBody, withErrorBoundary } from "@/lib/api";
import { requireApiUser } from "@/lib/auth/session";
import { acknowledgeAlertsSchema } from "@/lib/validations/alert";

export const runtime = "nodejs";

export const POST = withErrorBoundary(async (req: Request) => {
  assertSameOrigin(req);
  const user = await requireApiUser();
  const { alertIds } = await parseBody(req, acknowledgeAlertsSchema);

  await db.$transaction(async (transaction) => {
    const existingAlerts = await transaction.systemAlert.findMany({
      where: { id: { in: alertIds } },
      select: { id: true },
    });
    const existingIds = new Set(existingAlerts.map((alert) => alert.id));
    if (alertIds.some((id) => !existingIds.has(id))) {
      throw createApiError.notFound("One or more alerts could not be found.");
    }

    await transaction.systemAlertAcknowledgement.createMany({
      data: alertIds.map((alertId) => ({ alertId, userId: user.id })),
      skipDuplicates: true,
    });
  });

  return ok({ acknowledged: true, count: alertIds.length });
});
