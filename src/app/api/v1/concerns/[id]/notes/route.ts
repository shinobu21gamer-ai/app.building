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
import { caseNoteSchema } from "@/lib/validations/case";
import { addConcernNote } from "@/lib/cases/service";
import { sendConcernProgressEmail } from "@/lib/email";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * POST /api/v1/concerns/[id]/notes (JSON)
 *
 * Adds a progress remark or a record of actions taken. Optional `occurredOn`
 * (YYYY-MM-DD) records the day it happened; it defaults to today (Asia/Manila).
 * Notes are text only and do not change the case status.
 */
export const POST = withErrorBoundary<[Request, RouteContext]>(
  async (req, ctx) => {
    assertSameOrigin(req);
    const user = await requireApiRole(["OFFICIAL", "ADMIN"]);

    const { id } = await ctx.params;
    const concernId = Number(id);
    if (!Number.isInteger(concernId) || concernId <= 0) {
      throw createApiError.notFound("Concern not found.");
    }

    const body = await parseBody(req, caseNoteSchema);

    const outcome = await db.$transaction((tx) =>
      addConcernNote(tx, {
        concernId,
        actor: {
          id: user.id,
          roleKey: user.role.key,
          officeId: user.officeId ?? null,
        },
        kind: body.kind,
        remarks: body.remarks,
        occurredOn: body.occurredOn,
      })
    );

    const meta = requestMeta(req);
    await recordAudit({
      action: body.kind === "ACTION" ? "CONCERN_ACTION_RECORDED" : "CONCERN_REMARK_ADDED",
      resourceType: "concern",
      resourceId: String(concernId),
      description: `${outcome.caseNumber}: ${body.kind.toLowerCase()} recorded (action date ${outcome.actionDate}).`,
      userId: user.id,
      ...meta,
    });

    void sendConcernProgressEmail({
      concernId: outcome.concernId,
      caseNumber: outcome.caseNumber,
      status: "PROGRESS UPDATE",
      remarks: body.remarks,
    });

    return ok({
      concernId: outcome.concernId,
      caseNumber: outcome.caseNumber,
      historyId: outcome.historyId,
      kind: outcome.kind,
      actionDate: outcome.actionDate,
      redirect: `/official/concerns/${concernId}`,
    });
  }
);
