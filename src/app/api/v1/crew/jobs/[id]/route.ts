import {
  assertSameOrigin,
  createApiError,
  ok,
  parseBody,
  withErrorBoundary,
} from "@/lib/api";
import { db } from "@/lib/db";
import { requireApiPermission } from "@/lib/auth/session";
import { recordAudit, requestMeta } from "@/lib/audit";
import { notifyCrewProgressRecorded } from "@/lib/notifications/service";
import { crewJobUpdateSchema } from "@/lib/validations/crew";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * POST /api/v1/crew/jobs/[id]
 *
 * A crew member's own progress note on a case they are assigned to. It lands in
 * the case journal as a CREW_PROGRESS entry (internal, so the resident sees the
 * outcome — the office publishes it — but not the working chatter), and the
 * office sees it on the case page.
 */
export const POST = withErrorBoundary<[Request, RouteContext]>(
  async (req, ctx) => {
    assertSameOrigin(req);
    const user = await requireApiPermission("crew.job.update.own");

    const { id } = await ctx.params;
    const concernId = Number(id);
    if (!Number.isInteger(concernId) || concernId <= 0) {
      throw createApiError.notFound("Concern not found.");
    }

    const body = await parseBody(req, crewJobUpdateSchema);

    const assignment = await db.crewAssignment.findFirst({
      where: {
        concernId,
        crewId: user.id,
        isActive: true,
        concern: { status: { notIn: ["CLOSED", "RESOLVED"] } },
      },
      select: {
        id: true,
        concern: {
          select: {
            id: true,
            caseNumber: true,
            status: true,
            assignedOfficeId: true,
            assignedOfficialId: true,
          },
        },
      },
    });
    if (!assignment) {
      throw createApiError.forbidden(
        "You are not assigned to this case."
      );
    }

    const entry = await db.$transaction(async (tx) => {
      const history = await tx.caseStatusHistory.create({
        data: {
          concernId: assignment.concern.id,
          entryType: "CREW_PROGRESS",
          fromStatus: assignment.concern.status,
          toStatus: assignment.concern.status,
          remarks: `${body.kind === "COMPLETION" ? "Work completed" : body.kind === "PROBLEM" ? "Problem on site" : "Progress"} (crew): ${body.note}`,
          // Internal by default: the official decides what the resident is told.
          visibility: "INTERNAL",
          metadataJson: JSON.stringify({
            kind: body.kind,
            note: body.note,
            crewId: user.id,
          }),
          actorId: user.id,
          actorRole: user.role.key,
        },
      });
      await notifyCrewProgressRecorded(tx, {
        concernId: assignment.concern.id,
        caseNumber: assignment.concern.caseNumber,
        officeId: assignment.concern.assignedOfficeId,
        officialId: assignment.concern.assignedOfficialId,
        crewName: `${user.firstName} ${user.lastName}`.trim(),
        kind: body.kind,
      });
      return history;
    });

    const meta = requestMeta(req);
    await recordAudit({
      action: "CREW_JOB_UPDATED",
      resourceType: "concern",
      resourceId: String(assignment.concern.id),
      description: `${assignment.concern.caseNumber}: ${body.kind} — ${body.note}`,
      userId: user.id,
      ...meta,
    });

    return ok(
      {
        concernId: assignment.concern.id,
        caseNumber: assignment.concern.caseNumber,
        historyId: entry.id,
        kind: body.kind,
        at: entry.createdAt.toISOString(),
      },
      { status: 201 }
    );
  }
);
