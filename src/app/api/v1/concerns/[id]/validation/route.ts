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
import { concernValidationSchema } from "@/lib/validations/case";
import { validateConcern } from "@/lib/cases/service";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * POST /api/v1/concerns/[id]/validation
 *
 * Admin validation: confirm the concern is real, set the service type and the
 * category, confirm (or override) the priority, and route it to the office the
 * type belongs to. Requires `case.validate`.
 */
export const POST = withErrorBoundary<[Request, RouteContext]>(
  async (req, ctx) => {
    assertSameOrigin(req);
    const user = await requireApiPermission("case.validate");

    const { id } = await ctx.params;
    const concernId = Number(id);
    if (!Number.isInteger(concernId) || concernId <= 0) {
      throw createApiError.notFound("Concern not found.");
    }

    const body = await parseBody(req, concernValidationSchema);

    const outcome = await db.$transaction((tx) =>
      validateConcern(tx, {
        concernId,
        actor: {
          id: user.id,
          roleKey: user.role.key,
          officeId: user.officeId ?? null,
        },
        typeId: body.typeId,
        categoryId: body.categoryId,
        priorityLevel: body.priorityLevel ?? null,
        notes: body.notes,
        confirmPriority: body.confirmPriority,
      })
    );

    const meta = requestMeta(req);
    await recordAudit({
      action: "CONCERN_VALIDATED",
      resourceType: "concern",
      resourceId: String(outcome.concernId),
      description: `${outcome.caseNumber} validated as ${outcome.typeKey}${
        outcome.routedOfficeName ? ` and routed to ${outcome.routedOfficeName}` : ""
      }. ${body.notes}`,
      userId: user.id,
      ...meta,
    });

    return ok({
      concernId: outcome.concernId,
      caseNumber: outcome.caseNumber,
      status: outcome.status,
      typeKey: outcome.typeKey,
      routedOfficeName: outcome.routedOfficeName,
      redirect: `/official/concerns/${outcome.concernId}`,
    });
  }
);
