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
import { feedbackSchema } from "@/lib/validations/case";
import { submitFeedback } from "@/lib/cases/feedback";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

function concernIdFrom(params: Promise<{ id: string }>): Promise<number> {
  return params.then(({ id }) => {
    const value = Number(id);
    if (!Number.isInteger(value) || value <= 0) {
      throw createApiError.notFound("Concern not found.");
    }
    return value;
  });
}

/**
 * GET /api/v1/concerns/[id]/feedback
 * Returns the current resident's feedback for their own case (or null).
 */
export const GET = withErrorBoundary<[Request, RouteContext]>(
  async (_req, ctx) => {
    const user = await requireApiRole(["RESIDENT"]);
    const concernId = await concernIdFrom(ctx.params);

    const concern = await db.concern.findFirst({
      where: { id: concernId, userId: user.id },
      select: {
        feedback: {
          take: 1,
          orderBy: { updatedAt: "desc" },
        },
      },
    });
    if (!concern) {
      throw createApiError.notFound("Concern not found.");
    }
    const feedback = concern.feedback[0] ?? null;
    return ok({
      feedback: feedback
        ? {
            id: feedback.id,
            wasResolved: feedback.wasResolved,
            rating: feedback.rating,
            satisfaction: feedback.satisfaction,
            comment: feedback.comment,
            updatedAt: feedback.updatedAt,
          }
        : null,
    });
  }
);

/**
 * POST /api/v1/concerns/[id]/feedback
 * Resident rates their own resolved/closed case. One submission per case by
 * default; the administrator can allow revisions, which update the row in
 * place.
 */
export const POST = withErrorBoundary<[Request, RouteContext]>(
  async (req, ctx) => {
    assertSameOrigin(req);
    const user = await requireApiRole(["RESIDENT"]);
    const concernId = await concernIdFrom(ctx.params);
    const body = await parseBody(req, feedbackSchema);

    const outcome = await db.$transaction((tx) =>
      submitFeedback(tx, {
        concernId,
        actor: { id: user.id },
        wasResolved: body.wasResolved,
        rating: body.rating,
        comment: body.comment,
      })
    );

    const meta = requestMeta(req);
    await recordAudit({
      action: outcome.created ? "FEEDBACK_SUBMITTED" : "FEEDBACK_UPDATED",
      resourceType: "concern",
      resourceId: String(concernId),
      description: `${outcome.caseNumber}: resident feedback rating ${outcome.rating}/5 (${
        outcome.created ? "submitted" : "updated"
      }).`,
      userId: user.id,
      ...meta,
    });

    return ok(outcome);
  }
);