import { db } from "@/lib/db";
import {
  assertSameOrigin,
  ok,
  parseBody,
  withErrorBoundary,
} from "@/lib/api";
import { requireApiPermission } from "@/lib/auth/session";
import { recordAudit, requestMeta } from "@/lib/audit";
import { allocationCreateSchema } from "@/lib/validations/treasury";
import { createAllocation } from "@/lib/treasury/budget";
import { listAllocations } from "@/lib/treasury/query";

export const runtime = "nodejs";

/**
 * GET /api/v1/treasury/allocations
 * The appropriation register with live balances (reserved, disbursed,
 * available). Officials only see their own office's allocations.
 */
export const GET = withErrorBoundary<[Request]>(
  async (req) => {
    const user = await requireApiPermission("treasury.balance.view");
    const url = new URL(req.url);
    const fiscalYearId = Number(url.searchParams.get("fiscalYearId") ?? "");
    const status = url.searchParams.get("status");
    const search = url.searchParams.get("search");

    const allocations = await listAllocations(db, {
      actor: {
        id: user.id,
        roleKey: user.role.key,
        officeId: user.officeId ?? null,
      },
      fiscalYearId: Number.isInteger(fiscalYearId) && fiscalYearId > 0 ? fiscalYearId : null,
      status: status && status !== "ALL" ? status : null,
      search: search && search.trim() !== "" ? search.trim() : null,
    });

    return ok({ allocations });
  }
);

/**
 * POST /api/v1/treasury/allocations
 * Creates a draft appropriation against a verified COA account and fund
 * source. Requires `treasury.allocation.prepare`.
 */
export const POST = withErrorBoundary<[Request]>(
  async (req) => {
    assertSameOrigin(req);
    const user = await requireApiPermission("treasury.allocation.prepare");
    const body = await parseBody(req, allocationCreateSchema);

    const outcome = await db.$transaction((tx) =>
      createAllocation(tx, {
        actor: {
          id: user.id,
          roleKey: user.role.key,
          officeId: user.officeId ?? null,
        },
        fiscalYearId: body.fiscalYearId,
        fundSourceId: body.fundSourceId,
        coaAccountId: body.coaAccountId,
        officeId: body.officeId ?? null,
        label: body.label,
        appropriation: body.appropriation,
        notes: body.notes ?? null,
      })
    );

    const meta = requestMeta(req);
    await recordAudit({
      action: "TREASURY_ALLOCATION_CREATED",
      resourceType: "budget_allocation",
      resourceId: String(outcome.allocationId),
      description: `${outcome.coaCode} — ${body.label}: ₱${outcome.appropriation.toFixed(2)} appropriation prepared for FY ${outcome.fiscalYear}.`,
      userId: user.id,
      ...meta,
    });

    return ok({
      allocationId: outcome.allocationId,
      appropriation: outcome.appropriation,
      redirect: "/treasury/budgets",
    });
  }
);
