import { db } from "@/lib/db";
import { assertSameOrigin, createApiError, ok, withErrorBoundary } from "@/lib/api";
import { requireApiRole } from "@/lib/auth/session";
import { recordAudit, requestMeta } from "@/lib/audit";

export const runtime = "nodejs";

type Context = { params: Promise<{ id: string }> };

export const DELETE = withErrorBoundary<[Request, Context]>(async (req, ctx) => {
  assertSameOrigin(req);
  const admin = await requireApiRole(["ADMIN"]);
  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id) || id <= 0) {
    throw createApiError.notFound("Alert not found.");
  }

  const alert = await db.systemAlert.findUnique({
    where: { id },
    select: { id: true, title: true },
  });
  if (!alert) throw createApiError.notFound("Alert not found.");

  const deleted = await db.systemAlert.deleteMany({ where: { id } });
  if (deleted.count === 0) throw createApiError.notFound("Alert not found.");

  await recordAudit({
    action: "SYSTEM_ALERT_REMOVED",
    resourceType: "system_alert",
    resourceId: String(id),
    description: `Removed system alert: ${alert.title}.`,
    userId: admin.id,
    ...requestMeta(req),
  });

  return ok({ deleted: true });
});
