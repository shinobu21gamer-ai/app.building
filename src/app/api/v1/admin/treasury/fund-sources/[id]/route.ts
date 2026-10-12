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
import { fundSourceVerifySchema } from "@/lib/validations/treasury";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * PATCH /api/v1/admin/treasury/fund-sources/[id]
 * Confirms a fund source against the appropriation ordinance (or deprecates
 * it). Until it is verified, no allocation may be built on it.
 */
export const PATCH = withErrorBoundary<[Request, RouteContext]>(
  async (req, ctx) => {
    assertSameOrigin(req);
    const user = await requireApiPermission("treasury.coa.verify");
    const { id } = await ctx.params;
    const fundSourceId = Number(id);
    if (!Number.isInteger(fundSourceId) || fundSourceId <= 0) {
      throw createApiError.notFound("Fund source not found.");
    }

    const body = await parseBody(req, fundSourceVerifySchema);
    const existing = await db.fundSource.findUnique({
      where: { id: fundSourceId },
      select: { id: true, code: true, verificationStatus: true },
    });
    if (!existing) throw createApiError.notFound("Fund source not found.");

    const fundSource = await db.fundSource.update({
      where: { id: fundSourceId },
      data: {
        verificationStatus: body.verificationStatus,
        verificationSource: body.verificationSource,
        verificationNotes: body.verificationNotes ?? null,
        verifiedAt: body.verificationStatus === "VERIFIED" ? new Date() : null,
        verifiedById: body.verificationStatus === "VERIFIED" ? user.id : null,
      },
      select: {
        id: true,
        code: true,
        name: true,
        verificationStatus: true,
        verificationSource: true,
        verifiedAt: true,
      },
    });

    const meta = requestMeta(req);
    await recordAudit({
      action: "TREASURY_FUND_SOURCE_VERIFIED",
      resourceType: "fund_source",
      resourceId: String(fundSourceId),
      description: `${existing.code}: ${existing.verificationStatus} → ${body.verificationStatus} against ${body.verificationSource}.`,
      userId: user.id,
      ...meta,
    });

    return ok({ fundSource });
  }
);
