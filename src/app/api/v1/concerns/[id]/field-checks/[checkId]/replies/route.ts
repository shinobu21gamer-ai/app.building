import { db } from "@/lib/db";
import {
  assertSameOrigin,
  createApiError,
  ok,
  parseBody,
  withErrorBoundary,
} from "@/lib/api";
import { requireApiRole } from "@/lib/auth/session";
import { recordAudit, requestMeta } from "@/lib/audit";
import { replyToFieldCheck } from "@/lib/cases/field-check-reply";
import { residentFieldCheckReplySchema } from "@/lib/validations/field-check";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string; checkId: string }> };

/** Lets a resident add context to an open field check on their own case. */
export const POST = withErrorBoundary(async (req: Request, context: RouteContext) => {
  assertSameOrigin(req);
  const user = await requireApiRole(["RESIDENT"]);
  const { id, checkId } = await context.params;
  const concernId = Number(id);
  const fieldCheckId = Number(checkId);
  if (!Number.isInteger(concernId) || concernId <= 0 || !Number.isInteger(fieldCheckId) || fieldCheckId <= 0) {
    throw createApiError.notFound("Concern not found.");
  }

  const body = await parseBody(req, residentFieldCheckReplySchema);
  const outcome = await db.$transaction((tx) =>
    replyToFieldCheck(tx, {
      concernId,
      fieldCheckId,
      message: body.message,
      actor: { id: user.id },
    })
  );

  await recordAudit({
    action: "FIELD_CHECK_RESIDENT_REPLY",
    resourceType: "field_check",
    resourceId: String(fieldCheckId),
    description: `Resident added a reply to case ${outcome.caseNumber}'s open field check.`,
    userId: user.id,
    ...requestMeta(req),
  });

  return ok({ replyId: outcome.replyId }, { status: 201 });
});
