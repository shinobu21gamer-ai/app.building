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
import { fundSourceCreateSchema } from "@/lib/validations/treasury";

export const runtime = "nodejs";

/**
 * GET /api/v1/admin/treasury/fund-sources
 * The fund sources and whether each one has been confirmed against the
 * barangay's appropriation ordinance. They ship unverified on purpose.
 */
export const GET = withErrorBoundary<[Request]>(
  async () => {
    await requireApiPermission("treasury.coa.verify");

    const fundSources = await db.fundSource.findMany({
      orderBy: { code: "asc" },
      include: {
        verifiedBy: { select: { firstName: true, lastName: true } },
        _count: { select: { allocations: true } },
      },
    });

    return ok({ fundSources });
  }
);

/** POST /api/v1/admin/treasury/fund-sources — adds a fund source (unverified). */
export const POST = withErrorBoundary<[Request]>(
  async (req) => {
    assertSameOrigin(req);
    const user = await requireApiPermission("treasury.coa.verify");
    const body = await parseBody(req, fundSourceCreateSchema);

    const existing = await db.fundSource.findUnique({
      where: { code: body.code },
      select: { id: true },
    });
    if (existing) {
      throw createApiError.conflict(
        `${body.code} already exists as a fund source (#${existing.id}).`
      );
    }

    const fundSource = await db.fundSource.create({
      data: {
        code: body.code,
        name: body.name,
        description: body.description ?? null,
        verificationStatus: "UNVERIFIED",
        createdById: user.id,
      },
      select: { id: true, code: true, name: true, verificationStatus: true },
    });

    const meta = requestMeta(req);
    await recordAudit({
      action: "TREASURY_FUND_SOURCE_CREATED",
      resourceType: "fund_source",
      resourceId: String(fundSource.id),
      description: `${fundSource.code} — ${fundSource.name} added, awaiting verification against the appropriation ordinance.`,
      userId: user.id,
      ...meta,
    });

    return ok({ fundSource });
  }
);
