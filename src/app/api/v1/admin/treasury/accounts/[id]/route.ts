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
import { coaAccountVerifySchema } from "@/lib/validations/treasury";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * PATCH /api/v1/admin/treasury/accounts/[id]
 * Records the verification (or retires a code). Verification always names the
 * source it was checked against — that provenance is what lets an earmark or a
 * voucher be defended in an audit.
 */
export const PATCH = withErrorBoundary<[Request, RouteContext]>(
  async (req, ctx) => {
    assertSameOrigin(req);
    const user = await requireApiPermission("treasury.coa.verify");
    const { id } = await ctx.params;
    const accountId = Number(id);
    if (!Number.isInteger(accountId) || accountId <= 0) {
      throw createApiError.notFound("Account not found.");
    }

    const body = await parseBody(req, coaAccountVerifySchema);
    const existing = await db.coaAccount.findUnique({
      where: { id: accountId },
      select: { id: true, code: true, verificationStatus: true },
    });
    if (!existing) throw createApiError.notFound("Account not found.");

    const account = await db.coaAccount.update({
      where: { id: accountId },
      data: {
        verificationStatus: body.verificationStatus,
        verificationSource: body.verificationSource,
        verificationUrl: body.verificationUrl ?? null,
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
      action: "TREASURY_COA_ACCOUNT_VERIFIED",
      resourceType: "coa_account",
      resourceId: String(accountId),
      description: `${existing.code}: ${existing.verificationStatus} → ${body.verificationStatus} against ${body.verificationSource}.`,
      userId: user.id,
      ...meta,
    });

    return ok({ account });
  }
);
