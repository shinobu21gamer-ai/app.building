import { db } from "@/lib/db";
import {
  assertSameOrigin,
  createApiError,
  ok,
  parseBody,
  withErrorBoundary,
} from "@/lib/api";
import { requireApiPermission } from "@/lib/auth/session";
import { recordAudit, requestMeta } from "@/lib/audit";
import { z } from "zod";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

const notFundDecisionSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(10, "Give a real reason (at least 10 characters).")
    .max(1000, "The reason is too long."),
});

function concernIdFrom(value: string): number {
  const concernId = Number(value);
  if (!Number.isInteger(concernId) || concernId <= 0) {
    throw createApiError.notFound("Concern not found.");
  }
  return concernId;
}

/**
 * POST /api/v1/treasury/concerns/[id]/budget-decision
 *
 * Records the treasurer's "do not fund" decision on a case: a required
 * reason, shown to the officials on the case so the refusal is an answer,
 * not a silence. The decision is current until money is proposed for the
 * case (proposing an earmark supersedes it) or a newer decision replaces
 * it — one row per case, so the case always says the latest call.
 *
 * Requires `treasury.earmark.prepare`, the same right that sets money
 * aside: both halves of the funding call belong to the same desk.
 */
export const POST = withErrorBoundary<[Request, RouteContext]>(
  async (req, ctx) => {
    assertSameOrigin(req);
    const user = await requireApiPermission("treasury.earmark.prepare");
    const { id } = await ctx.params;
    const concernId = concernIdFrom(id);
    const body = await parseBody(req, notFundDecisionSchema);

    const concern = await db.concern.findUnique({
      where: { id: concernId },
      select: { id: true, caseNumber: true, status: true },
    });
    if (!concern) throw createApiError.notFound("Concern not found.");
    if (concern.status === "RESOLVED" || concern.status === "CLOSED") {
      throw createApiError.conflict("This case is already finished.");
    }

    await db.budgetDecision.upsert({
      where: { concernId },
      create: {
        concernId,
        decision: "NOT_FUNDED",
        reason: body.reason,
        decidedById: user.id,
      },
      update: {
        decision: "NOT_FUNDED",
        reason: body.reason,
        decidedById: user.id,
        decidedAt: new Date(),
      },
    });

    const meta = requestMeta(req);
    await recordAudit({
      action: "BUDGET_DECISION",
      resourceType: "concern",
      resourceId: String(concernId),
      description: `${concern.caseNumber} budget decision: not funded. ${body.reason}`,
      userId: user.id,
      ...meta,
    });

    return ok({ concernId, decision: "NOT_FUNDED" });
  }
);
