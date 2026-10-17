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
import { crewAssignmentSchema, crewReleaseSchema } from "@/lib/validations/crew";
import {
  assignCrew,
  crewProgress,
  listCrewAssignments,
  listCrewRoster,
  releaseCrew,
} from "@/lib/cases/crew";

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
 * GET /api/v1/concerns/[id]/crew
 * The crew booked on the case, the plan's progress ("2 of 3 assigned") and the
 * roster to pick from.
 *
 * The roster leads with the case office's own crew and then carries profiled
 * crew from other offices, flagged with `otherOffice`. A case routed to an
 * office that has no crew of its own can still be staffed.
 */
export const GET = withErrorBoundary<[Request, RouteContext]>(
  async (_req, ctx) => {
    const user = await requireApiPermission("case.crew.assign");
    const { id } = await ctx.params;
    const concernId = concernIdFrom(id);

    const concern = await db.concern.findUnique({
      where: { id: concernId },
      select: { id: true, assignedOfficeId: true, status: true },
    });
    if (!concern) throw createApiError.notFound("Concern not found.");
    if (
      user.role.key === "OFFICIAL" &&
      (user.officeId === null || concern.assignedOfficeId !== user.officeId)
    ) {
      throw createApiError.forbidden("This concern is assigned to another office.");
    }

    const [rows, progress, roster] = await Promise.all([
      listCrewAssignments(db, concernId),
      crewProgress(db, concernId),
      listCrewRoster(db, {
        officeId:
          user.role.key === "ADMIN" ? (concern.assignedOfficeId ?? null) : user.officeId,
        includeOtherOffices: true,
      }),
    ]);

    return ok({
      concernId,
      status: concern.status,
      workersNeeded: progress.required,
      progress: {
        assigned: progress.assigned,
        required: progress.required,
        satisfied: progress.satisfied,
        shortfall: progress.shortfall,
        label: progress.label,
      },
      assignments: rows.map((row) => ({
        id: row.id,
        crewId: row.crew.id,
        name: `${row.crew.firstName} ${row.crew.lastName}`,
        email: row.crew.email,
        trade: row.crew.crewProfile?.trade ?? null,
        availability: row.crew.crewProfile?.availability ?? null,
        isActive: row.isActive,
        assignedAt: row.assignedAt.toISOString(),
        releasedAt: row.releasedAt?.toISOString() ?? null,
        releaseReason: row.releaseReason,
        taskNote: row.taskNote,
      })),
      roster,
    });
  }
);

/**
 * POST /api/v1/concerns/[id]/crew
 * Assigns named crew (never more than the plan needs). A crew member may be
 * assigned to multiple open cases at once; the roster shows their open-case
 * count but does not use it to refuse an assignment.
 */
export const POST = withErrorBoundary<[Request, RouteContext]>(
  async (req, ctx) => {
    assertSameOrigin(req);
    const user = await requireApiPermission("case.crew.assign");

    const { id } = await ctx.params;
    const concernId = concernIdFrom(id);
    const body = await parseBody(req, crewAssignmentSchema);

    const outcome = await db.$transaction((tx) =>
      assignCrew(tx, {
        concernId,
        actor: {
          id: user.id,
          roleKey: user.role.key,
          officeId: user.officeId ?? null,
        },
        crewIds: body.crewIds,
        taskNote: body.taskNote ?? null,
        scheduledStartAt: body.scheduledStartAt ?? null,
        scheduledEndAt: body.scheduledEndAt ?? null,
      })
    );

    const meta = requestMeta(req);
    await recordAudit({
      action: "CREW_ASSIGNED",
      resourceType: "concern",
      resourceId: String(outcome.concernId),
      description: `${outcome.caseNumber}: crew assigned — ${outcome.progress.label}.`,
      userId: user.id,
      ...meta,
    });

    return ok({
      concernId: outcome.concernId,
      caseNumber: outcome.caseNumber,
      assigned: outcome.assigned.map((member) => member.name),
      progress: outcome.progress,
    });
  }
);

/**
 * DELETE /api/v1/concerns/[id]/crew
 * Releases one crew member. The reason is mandatory and the row is kept, so the
 * case keeps a full staffing history.
 */
export const DELETE = withErrorBoundary<[Request, RouteContext]>(
  async (req, ctx) => {
    assertSameOrigin(req);
    const user = await requireApiPermission("case.crew.assign");

    const { id } = await ctx.params;
    const concernId = concernIdFrom(id);
    const body = await parseBody(req, crewReleaseSchema);

    const outcome = await db.$transaction((tx) =>
      releaseCrew(tx, {
        concernId,
        actor: {
          id: user.id,
          roleKey: user.role.key,
          officeId: user.officeId ?? null,
        },
        crewId: body.crewId,
        reason: body.reason,
      })
    );

    const meta = requestMeta(req);
    await recordAudit({
      action: "CREW_RELEASED",
      resourceType: "concern",
      resourceId: String(outcome.concernId),
      description: `${outcome.caseNumber}: crew #${body.crewId} released — ${body.reason}`,
      userId: user.id,
      ...meta,
    });

    return ok({
      concernId: outcome.concernId,
      caseNumber: outcome.caseNumber,
      progress: outcome.progress,
    });
  }
);
