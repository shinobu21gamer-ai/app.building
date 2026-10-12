import { db } from "@/lib/db";
import { assertSameOrigin, createApiError, ok, parseBody, withErrorBoundary } from "@/lib/api";
import { requireApiPermission } from "@/lib/auth/session";
import { recordAudit, requestMeta } from "@/lib/audit";
import { reviewFieldCheck } from "@/lib/cases/field-check";
import { reviewFieldCheckSchema } from "@/lib/validations/field-check";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ checkId: string }> };

/** The admin approves a submitted finding, or sends it back for another look. */
export const POST = withErrorBoundary(async (req: Request, context: RouteContext) => {
  assertSameOrigin(req);
  const user = await requireApiPermission("case.fieldcheck.review");
  const { checkId } = await context.params;
  const id = Number(checkId);
  if (!Number.isInteger(id) || id <= 0) throw createApiError.badRequest("Invalid field check id.");

  const body = await parseBody(req, reviewFieldCheckSchema);
  const outcome = await db.$transaction((tx) =>
    reviewFieldCheck(tx, {
      checkId: id,
      decision: body.decision,
      note: body.note ?? null,
      actor: { id: user.id, roleKey: user.role.key, officeId: user.officeId ?? null },
    })
  );

  await recordAudit({
    action: "FIELD_CHECK_REVIEWED",
    resourceType: "field_check",
    resourceId: String(id),
    description: `Field check ${body.decision === "APPROVE" ? "approved" : "sent back for a re-check"}${
      outcome.kind === "CLOSED_UNFOUNDED" ? ", and the case was closed as unfounded" : ""
    }.`,
    userId: user.id,
    ...requestMeta(req),
  });
  return ok({ checkId: id, outcome: outcome.kind });
});
