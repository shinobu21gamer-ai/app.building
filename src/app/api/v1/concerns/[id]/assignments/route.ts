import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";
import {
  assertSameOrigin,
  createApiError,
  ok,
  parseBody,
  withErrorBoundary,
} from "@/lib/api";
import { requireApiRole } from "@/lib/auth/session";
import { recordAudit, requestMeta } from "@/lib/audit";
import { reassignSchema } from "@/lib/validations/routing";
import { reassignConcern } from "@/lib/routing/service";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

function parseConcernId(id: string): number {
  const numeric = Number(id);
  if (!Number.isInteger(numeric) || numeric <= 0) {
    throw createApiError.notFound("Concern not found.");
  }
  return numeric;
}

export const GET = withErrorBoundary<[Request, RouteContext]>(
  async (_req, ctx) => {
    const user = await requireApiRole(["OFFICIAL", "ADMIN"]);
    const { id } = await ctx.params;
    const concernId = parseConcernId(id);

    const concern = await db.concern.findFirst({
      where:
        user.role.key === "ADMIN"
          ? { id: concernId }
          : { id: concernId, assignedOfficeId: user.officeId ?? -1 },
      select: { id: true },
    });
    if (!concern) throw createApiError.notFound("Concern not found.");

    const assignments = await db.caseAssignment.findMany({
      where: { concernId },
      include: {
        office: { select: { id: true, name: true, code: true } },
        official: { select: { id: true, firstName: true, lastName: true } },
        assignedBy: { select: { id: true, firstName: true, lastName: true } },
      },
      orderBy: { assignedAt: "asc" },
    });

    return ok({ assignments });
  }
);

export const POST = withErrorBoundary<[Request, RouteContext]>(
  async (req, ctx) => {
    assertSameOrigin(req);
    const user = await requireApiRole(["OFFICIAL", "ADMIN"]);
    const { id } = await ctx.params;
    const concernId = parseConcernId(id);
    const body = await parseBody(req, reassignSchema);

    let outcome;
    try {
      outcome = await db.$transaction((tx) =>
        reassignConcern(tx, {
          concernId,
          officeId: body.officeId,
          officialId: body.officialId ?? null,
          reason: body.reason,
          actor: {
            id: user.id,
            roleKey: user.role.key,
            officeId: user.officeId ?? null,
          },
        })
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw createApiError.conflict(
          "A reassignment was just recorded for this case. Refresh and retry."
        );
      }
      throw error;
    }

    const meta = requestMeta(req);
    await recordAudit({
      action: outcome.previousOfficeName
        ? "CONCERN_REASSIGNED"
        : "CONCERN_MANUALLY_ASSIGNED",
      resourceType: "concern",
      resourceId: String(concernId),
      description: outcome.previousOfficeName
        ? `Reassigned concern from ${outcome.previousOfficeName} to ${outcome.officeName}.`
        : `Assigned concern to ${outcome.officeName}.`,
      userId: user.id,
      ...meta,
    });

    return ok({
      assignment: {
        id: outcome.assignmentId,
        officeId: outcome.officeId,
        officeName: outcome.officeName,
        officialName: outcome.officialName,
        status: outcome.status,
      },
      previousOfficeName: outcome.previousOfficeName,
      notifiedOfficials: outcome.notifiedOfficials,
      redirect: `/official/concerns/${concernId}`,
    });
  }
);
