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
import { resolutionVerificationSchema } from "@/lib/validations/case";
import { verifyResolution } from "@/lib/cases/service";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * POST /api/v1/concerns/[id]/resolutions/verify
 *
 * Step 5 of the workflow: the proof attached to a resolution is checked and
 * stamped before the case may be closed. The official who recorded the
 * resolution cannot verify it themselves.
 */
export const POST = withErrorBoundary<[Request, RouteContext]>(
  async (req, ctx) => {
    assertSameOrigin(req);
    const user = await requireApiPermission("case.resolution.verify");

    const { id } = await ctx.params;
    const concernId = Number(id);
    if (!Number.isInteger(concernId) || concernId <= 0) {
      throw createApiError.notFound("Concern not found.");
    }

    const body = await parseBody(req, resolutionVerificationSchema);

    const outcome = await db.$transaction((tx) =>
      verifyResolution(tx, {
        concernId,
        actor: {
          id: user.id,
          roleKey: user.role.key,
          officeId: user.officeId ?? null,
        },
        verificationStatus: body.verificationStatus,
        notes: body.notes,
      })
    );

    const meta = requestMeta(req);
    await recordAudit({
      action: "RESOLUTION_VERIFIED",
      resourceType: "concern",
      resourceId: String(outcome.concernId),
      description: `${outcome.caseNumber}: resolution verification ${outcome.verificationStatus}. ${body.notes}`,
      userId: user.id,
      ...meta,
    });

    return ok({
      concernId: outcome.concernId,
      caseNumber: outcome.caseNumber,
      verificationStatus: outcome.verificationStatus,
      verifiedAt: outcome.verifiedAt,
    });
  }
);
