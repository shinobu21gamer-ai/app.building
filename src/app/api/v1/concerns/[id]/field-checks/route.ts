import { db } from "@/lib/db";
import { assertSameOrigin, createApiError, ok, parseBody, withErrorBoundary } from "@/lib/api";
import { requireApiPermission } from "@/lib/auth/session";
import { recordAudit, requestMeta } from "@/lib/audit";
import { requestFieldCheck } from "@/lib/cases/field-check";
import { requestFieldCheckSchema } from "@/lib/validations/field-check";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

/** Asks an official or crew member to confirm the concern is real on site. */
export const POST = withErrorBoundary(async (req: Request, context: RouteContext) => {
  assertSameOrigin(req);
  const user = await requireApiPermission("case.fieldcheck.request");
  const { id } = await context.params;
  const concernId = Number(id);
  if (!Number.isInteger(concernId) || concernId <= 0) {
    throw createApiError.badRequest("Invalid case id.");
  }

  const body = await parseBody(req, requestFieldCheckSchema);
  const outcome = await db.$transaction((tx) =>
    requestFieldCheck(tx, {
      concernId,
      assigneeId: body.assigneeId,
      instructions: body.instructions,
      actor: { id: user.id, roleKey: user.role.key, officeId: user.officeId ?? null },
    })
  );

  await recordAudit({
    action: "FIELD_CHECK_REQUESTED",
    resourceType: "field_check",
    resourceId: String(outcome.checkId),
    description: `Requested a field check on case ${concernId} from user ${body.assigneeId}.`,
    userId: user.id,
    ...requestMeta(req),
  });
  return ok({ checkId: outcome.checkId }, { status: 201 });
});
