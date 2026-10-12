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
import { coaAccountCreateSchema } from "@/lib/validations/treasury";
import { isMooeCode } from "@/lib/treasury/coa";

export const runtime = "nodejs";

/**
 * GET /api/v1/admin/treasury/accounts
 * The COA object-code catalogue with its verification state. The treasurer
 * holds `treasury.coa.verify` too, so the verification desk reads this.
 */
export const GET = withErrorBoundary<[Request]>(
  async (req) => {
    await requireApiPermission("treasury.coa.verify");
    const url = new URL(req.url);
    const search = url.searchParams.get("search");
    const status = url.searchParams.get("status");
    const groupCode = url.searchParams.get("groupCode");

    const accounts = await db.coaAccount.findMany({
      where: {
        ...(status && status !== "ALL" ? { verificationStatus: status } : {}),
        ...(groupCode ? { groupCode } : {}),
        ...(search
          ? {
              OR: [
                { code: { contains: search } },
                { name: { contains: search, mode: "insensitive" } },
              ],
            }
          : {}),
      },
      orderBy: { code: "asc" },
      take: 300,
      include: {
        verifiedBy: { select: { firstName: true, lastName: true } },
        _count: { select: { allocations: true } },
      },
    });

    return ok({ accounts });
  }
);

/**
 * POST /api/v1/admin/treasury/accounts
 * Adds a code that is missing from the shipped catalogue. It arrives
 * UNVERIFIED: a new code may not be spent against until someone records where
 * it was checked (see the [id] route).
 */
export const POST = withErrorBoundary<[Request]>(
  async (req) => {
    assertSameOrigin(req);
    const user = await requireApiPermission("treasury.coa.verify");
    const body = await parseBody(req, coaAccountCreateSchema);

    const existing = await db.coaAccount.findUnique({
      where: { code: body.code },
      select: { id: true },
    });
    if (existing) {
      throw createApiError.conflict(
        `${body.code} is already in the catalogue (account #${existing.id}).`
      );
    }

    const account = await db.coaAccount.create({
      data: {
        code: body.code,
        name: body.name,
        accountClass: body.accountClass,
        groupCode: body.groupCode ?? body.code.split("-")[2] ?? null,
        subObjectCodes: body.subObjectCodes ?? null,
        description: body.description ?? null,
        isMooe: body.isMooe ?? isMooeCode(body.code, body.accountClass),
        verificationStatus: "UNVERIFIED",
        isActive: body.isActive ?? true,
        createdById: user.id,
      },
      select: { id: true, code: true, name: true, verificationStatus: true },
    });

    const meta = requestMeta(req);
    await recordAudit({
      action: "TREASURY_COA_ACCOUNT_CREATED",
      resourceType: "coa_account",
      resourceId: String(account.id),
      description: `${account.code} — ${account.name} added, awaiting verification.`,
      userId: user.id,
      ...meta,
    });

    return ok({ account });
  }
);
