import {
  assertSameOrigin,
  createApiError,
  ok,
  parseBody,
  withErrorBoundary,
} from "@/lib/api";
import { requireApiPermission } from "@/lib/auth/session";
import { recordAudit, requestMeta } from "@/lib/audit";
import { identityView, reviewIdentity } from "@/lib/identity/verification";
import { identityReviewSchema } from "@/lib/validations/privacy";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

function parseUserId(raw: string): number {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) {
    throw createApiError.notFound("Resident not found.");
  }
  return id;
}

/**
 * PATCH /api/v1/admin/identity/[id]
 * Records the decision on a resident's identity submission, where `[id]` is
 * the resident's user id. A rejection requires a reason the resident can read
 * on /resident/verification.
 */
export const PATCH = withErrorBoundary<[Request, RouteContext]>(
  async (req, ctx) => {
    assertSameOrigin(req);
    const actor = await requireApiPermission("privacy.identity.review");
    const userId = parseUserId((await ctx.params).id);
    const body = await parseBody(req, identityReviewSchema);

    const row = await reviewIdentity({
      userId,
      actorId: actor.id,
      decision: body.decision,
      reason: body.reason ?? null,
      expiresAt: body.decision === "VERIFIED" ? (body.expiresAt ?? null) : null,
    });

    const meta = requestMeta(req);
    await recordAudit({
      action: `IDENTITY_${body.decision}`,
      resourceType: "identity_verification",
      resourceId: String(userId),
      description:
        body.decision === "VERIFIED"
          ? `Verified the identity document of user #${userId}.`
          : `Rejected the identity document of user #${userId}: ${body.reason}`,
      userId: actor.id,
      ...meta,
    });

    return ok({ identity: identityView(row) });
  }
);
