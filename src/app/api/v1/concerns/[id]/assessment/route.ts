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
import { assessmentSchema } from "@/lib/validations/case";
import {
  assessmentView,
  saveAssessment,
} from "@/lib/cases/assessment";
import { crewProgress, listCrewAssignments } from "@/lib/cases/crew";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

function concernIdFrom(value: string): number {
  const concernId = Number(value);
  if (!Number.isInteger(concernId) || concernId <= 0) {
    throw createApiError.notFound("Concern not found.");
  }
  return concernId;
}

/**
 * GET /api/v1/concerns/[id]/assessment
 * The assessment, the manpower plan, the cost estimate and the crew booked so
 * far. Officials and admins only, scoped to their own office.
 */
export const GET = withErrorBoundary<[Request, RouteContext]>(
  async (_req, ctx) => {
    const user = await requireApiPermission("case.assess");
    const { id } = await ctx.params;
    const concernId = concernIdFrom(id);

    const concern = await db.concern.findUnique({
      where: { id: concernId },
      select: {
        id: true,
        caseNumber: true,
        status: true,
        title: true,
        assignedOfficeId: true,
        type: { select: { id: true, key: true, name: true, requiresCrew: true } },
        caseAssessment: {
          include: {
            materials: { orderBy: { sortOrder: "asc" } },
            equipment: { orderBy: { sortOrder: "asc" } },
          },
        },
      },
    });
    if (!concern) throw createApiError.notFound("Concern not found.");

    if (
      user.role.key === "OFFICIAL" &&
      (user.officeId === null || concern.assignedOfficeId !== user.officeId)
    ) {
      throw createApiError.forbidden("This concern is assigned to another office.");
    }

    const [progress, crew] = await Promise.all([
      crewProgress(db, concernId),
      listCrewAssignments(db, concernId),
    ]);

    return ok({
      concern: {
        id: concern.id,
        caseNumber: concern.caseNumber,
        status: concern.status,
        title: concern.title,
        type: concern.type
          ? {
              id: concern.type.id,
              key: concern.type.key,
              name: concern.type.name,
              requiresCrew: concern.type.requiresCrew,
            }
          : null,
      },
      assessment: concern.caseAssessment
        ? assessmentView(concern.caseAssessment)
        : null,
      crewProgress: progress,
      crew: crew.map((row) => ({
        id: row.id,
        crewId: row.crew.id,
        name: `${row.crew.firstName} ${row.crew.lastName}`,
        trade: row.crew.crewProfile?.trade ?? null,
        isActive: row.isActive,
        assignedAt: row.assignedAt.toISOString(),
        releasedAt: row.releasedAt?.toISOString() ?? null,
        releaseReason: row.releaseReason,
        taskNote: row.taskNote,
      })),
    });
  }
);

/**
 * POST /api/v1/concerns/[id]/assessment
 *
 * Saves the UNDER_ASSESSMENT record: the four checks (eligibility, inspection,
 * resources, approval) plus the mandatory manpower plan (workers needed,
 * estimated duration, equipment notes) and the labour-inclusive cost estimate.
 * The first save on an ASSIGNED case moves it to UNDER_ASSESSMENT.
 *
 * Two separate rights, because the record and the plan are two decisions: the
 * findings need `case.assess`, and the manpower plan (workers, duration,
 * equipment) together with the cost estimate that the budget gate is measured
 * against needs `case.manpower.plan`. A role may be trusted with one and not
 * the other.
 */
export const POST = withErrorBoundary<[Request, RouteContext]>(
  async (req, ctx) => {
    assertSameOrigin(req);
    const user = await requireApiPermission("case.assess");
    await requireApiPermission("case.manpower.plan");

    const { id } = await ctx.params;
    const concernId = concernIdFrom(id);
    const body = await parseBody(req, assessmentSchema);

    const outcome = await db.$transaction((tx) =>
      saveAssessment(tx, {
        concernId,
        actor: {
          id: user.id,
          roleKey: user.role.key,
          officeId: user.officeId ?? null,
        },
        values: {
          eligibilityChecked: body.eligibilityChecked,
          eligibilityNotes: body.eligibilityNotes ?? null,
          inspectionRequired: body.inspectionRequired,
          inspectionNotes: body.inspectionNotes ?? null,
          inspectionCompleted: body.inspectionCompleted,
          resourcesVerified: body.resourcesVerified,
          resourcesVerificationNotes: body.resourcesVerificationNotes ?? null,
          approvalRequired: body.approvalRequired,
          approvalNotes: body.approvalNotes ?? null,
          approved: body.approved,
          workersNeeded: body.workersNeeded,
          estimatedDurationMinutes: body.estimatedDurationMinutes,
          equipmentNotes: body.equipmentNotes,
          scheduledStartAt: body.scheduledStartAt ?? null,
          scheduledEndAt: body.scheduledEndAt ?? null,
          laborCost: body.laborCost ?? null,
          materialsCost: body.materialsCost ?? null,
          equipmentCost: body.equipmentCost ?? null,
          otherCost: body.otherCost ?? null,
          materials: body.materials
            ? body.materials.map((line) => ({
                name: line.name,
                quantity: line.quantity,
                unit: line.unit,
                unitPrice: line.unitPrice,
                amount: line.amount,
                note: line.note ?? null,
              }))
            : null,
          equipment: body.equipment
            ? body.equipment.map((line) => ({
                name: line.name,
                quantity: line.quantity,
                unit: line.unit,
                unitPrice: line.unitPrice,
                amount: line.amount,
                note: line.note ?? null,
              }))
            : null,
        },
      })
    );

    const meta = requestMeta(req);
    await recordAudit({
      action: "CASE_ASSESSED",
      resourceType: "concern",
      resourceId: String(outcome.concernId),
      description:
        `${outcome.caseNumber} assessed: ${outcome.workersNeeded} worker(s), ` +
        `total estimate PHP ${outcome.cost.totalCost.toFixed(2)} ` +
        `(labour PHP ${outcome.cost.laborCost.toFixed(2)}).`,
      userId: user.id,
      ...meta,
    });

    return ok({
      concernId: outcome.concernId,
      caseNumber: outcome.caseNumber,
      assessmentId: outcome.assessmentId,
      status: outcome.status,
      fromStatus: outcome.fromStatus,
      workersNeeded: outcome.workersNeeded,
      cost: outcome.cost,
      laborBasis: outcome.laborBasis,
    });
  }
);
