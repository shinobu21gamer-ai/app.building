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
import { workflowOverrideSchema } from "@/lib/validations/case";
import {
  OVERRIDE_REASON_MIN,
  overrideLabel,
  type OverrideKind,
} from "@/lib/cases/workflow";
import { canManageConcern } from "@/lib/cases/workflow";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * The permission each override kind needs. Every kind is a documented exception
 * to a workflow rule, so each one has an owner.
 */
const OVERRIDE_PERMISSIONS: Record<
  OverrideKind,
  "case.override.crew_shortfall" | "case.override.countersign"
> = {
  CREW_SHORTFALL: "case.override.crew_shortfall",
  STATUS_FORCE: "case.override.countersign",
  SLA_EXTENSION: "case.override.countersign",
  VALIDATION_BYPASS: "case.override.countersign",
  ASSESSMENT_BYPASS: "case.override.countersign",
};

function concernIdFrom(value: string): number {
  const concernId = Number(value);
  if (!Number.isInteger(concernId) || concernId <= 0) {
    throw createApiError.notFound("Concern not found.");
  }
  return concernId;
}

/**
 * GET /api/v1/concerns/[id]/overrides
 * Every reasoned exception recorded on this case, newest first.
 */
export const GET = withErrorBoundary<[Request, RouteContext]>(
  async (_req, ctx) => {
    const user = await requireApiPermission("case.view.office");
    const { id } = await ctx.params;
    const concernId = concernIdFrom(id);

    const concern = await db.concern.findUnique({
      where: { id: concernId },
      select: { id: true, caseNumber: true, assignedOfficeId: true },
    });
    if (!concern) throw createApiError.notFound("Concern not found.");
    if (
      user.role.key === "OFFICIAL" &&
      (user.officeId === null || concern.assignedOfficeId !== user.officeId)
    ) {
      throw createApiError.forbidden("This concern is assigned to another office.");
    }

    const overrides = await db.caseWorkflowOverride.findMany({
      where: { concernId },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: {
        id: true,
        kind: true,
        reason: true,
        actorRole: true,
        approvedAt: true,
        createdAt: true,
        actor: { select: { id: true, firstName: true, lastName: true } },
        approvedBy: { select: { id: true, firstName: true, lastName: true } },
      },
    });

    return ok({
      concernId,
      caseNumber: concern.caseNumber,
      overrides: overrides.map((row) => ({
        id: row.id,
        kind: row.kind,
        label: overrideLabel(row.kind),
        reason: row.reason,
        actorRole: row.actorRole,
        actorName: `${row.actor.firstName} ${row.actor.lastName}`,
        approvedAt: row.approvedAt?.toISOString() ?? null,
        approvedByName: row.approvedBy
          ? `${row.approvedBy.firstName} ${row.approvedBy.lastName}`
          : null,
        createdAt: row.createdAt.toISOString(),
      })),
    });
  }
);

/**
 * POST /api/v1/concerns/[id]/overrides
 *
 * Records a reasoned exception to a workflow rule. The reason is mandatory
 * (minimum length enforced by the schema and again here) and the row is
 * append-only, so the exception can never be edited away.
 */
export const POST = withErrorBoundary<[Request, RouteContext]>(
  async (req, ctx) => {
    assertSameOrigin(req);
    const { id } = await ctx.params;
    const concernId = concernIdFrom(id);
    const body = await parseBody(req, workflowOverrideSchema);

    const user = await requireApiPermission(OVERRIDE_PERMISSIONS[body.kind]);

    const reason = body.reason.trim();
    if (reason.length < OVERRIDE_REASON_MIN) {
      throw createApiError.badRequest(
        `A reason of at least ${OVERRIDE_REASON_MIN} characters is required.`
      );
    }

    const concern = await db.concern.findUnique({
      where: { id: concernId },
      select: { id: true, caseNumber: true, status: true, assignedOfficeId: true },
    });
    if (!concern) throw createApiError.notFound("Concern not found.");
    if (concern.status === "CLOSED") {
      throw createApiError.conflict("Closed cases cannot be modified.");
    }
    if (
      !canManageConcern(
        { id: user.id, roleKey: user.role.key, officeId: user.officeId ?? null },
        concern
      ) &&
      user.role.key !== "CAPTAIN"
    ) {
      throw createApiError.forbidden("This concern is assigned to another office.");
    }

    const override = await db.$transaction(async (tx) => {
      const row = await tx.caseWorkflowOverride.create({
        data: {
          concernId,
          kind: body.kind,
          reason,
          detailsJson: body.details ? JSON.stringify(body.details) : null,
          actorId: user.id,
          actorRole: user.role.key,
        },
      });

      await tx.caseStatusHistory.create({
        data: {
          concernId,
          entryType: "OVERRIDE",
          fromStatus: concern.status,
          toStatus: concern.status,
          remarks: `Workflow override (${body.kind}): ${reason}`,
          visibility: "RESIDENT_VISIBLE",
          metadataJson: JSON.stringify({ kind: body.kind, reason }),
          actorId: user.id,
          actorRole: user.role.key,
        },
      });

      return row;
    });

    const meta = requestMeta(req);
    await recordAudit({
      action: "CASE_OVERRIDE_RECORDED",
      resourceType: "concern",
      resourceId: String(concernId),
      description: `${concern.caseNumber}: ${body.kind} override — ${reason}`,
      userId: user.id,
      ...meta,
    });

    return ok(
      {
        overrideId: override.id,
        concernId,
        kind: override.kind,
        label: overrideLabel(body.kind),
        reason: override.reason,
        createdAt: override.createdAt.toISOString(),
      },
      { status: 201 }
    );
  }
);
