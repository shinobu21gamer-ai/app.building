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
import { allocationActionSchema } from "@/lib/validations/treasury";
import {
  adjustAllocation,
  allocationBalance,
  approveAllocation,
  closeAllocation,
  loadAllocationForActor,
} from "@/lib/treasury/budget";
import { ledgerRegister, listDisbursements, listEarmarks } from "@/lib/treasury/query";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

function allocationIdFrom(value: string): number {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    throw createApiError.notFound("Allocation not found.");
  }
  return id;
}

function actorFrom(user: { id: number; role: { key: string }; officeId: number | null }) {
  return {
    id: user.id,
    roleKey: user.role.key,
    officeId: user.officeId ?? null,
  };
}

/**
 * GET /api/v1/treasury/allocations/[id]
 * One appropriation with its live balance, its earmarks, its vouchers and the
 * tail of its ledger.
 */
export const GET = withErrorBoundary<[Request, RouteContext]>(
  async (_req, ctx) => {
    const user = await requireApiPermission("treasury.balance.view");
    const { id } = await ctx.params;
    const allocationId = allocationIdFrom(id);
    const actor = actorFrom(user);

    const allocation = await loadAllocationForActor(db, allocationId, actor);
    const [balance, earmarks, disbursements, ledger] = await Promise.all([
      allocationBalance(db, allocationId),
      listEarmarks(db, { actor, allocationId, take: 50 }),
      listDisbursements(db, { actor, allocationId, take: 50 }),
      ledgerRegister(db, { actor, allocationId, take: 50 }),
    ]);

    return ok({
      allocation: {
        id: allocation.id,
        label: allocation.label,
        status: allocation.status,
        appropriation: Number(allocation.appropriation),
        coaCode: allocation.coaAccount.code,
        coaName: allocation.coaAccount.name,
        coaVerification: allocation.coaAccount.verificationStatus,
        fundSource: allocation.fundSource.code,
        fiscalYear: allocation.fiscalYear.year,
        officeId: allocation.office?.id ?? null,
        officeName: allocation.office?.name ?? null,
        notes: allocation.notes,
        approvedAt: allocation.approvedAt,
      },
      balance,
      earmarks,
      disbursements,
      ledger,
    });
  }
);

/**
 * PATCH /api/v1/treasury/allocations/[id]
 * APPROVE opens the appropriation on the ledger (`treasury.allocation.approve`,
 * the Captain/AAO), ADJUST adds a memo-backed correction and is administrator
 * only, CLOSE retires an allocation that has nothing reserved.
 */
export const PATCH = withErrorBoundary<[Request, RouteContext]>(
  async (req, ctx) => {
    assertSameOrigin(req);
    const { id } = await ctx.params;
    const allocationId = allocationIdFrom(id);
    const body = await parseBody(req, allocationActionSchema);

    const permission =
      body.action === "APPROVE" || body.action === "CLOSE"
        ? "treasury.allocation.approve"
        : null;
    const user = await requireApiPermission(
      permission ?? "treasury.balance.view"
    );
    if (body.action === "ADJUST" && user.role.key !== "ADMIN") {
      throw createApiError.forbidden(
        "Only an administrator can adjust an appropriation. Ask the administrator to record the correction."
      );
    }

    const actor = actorFrom(user);
    const meta = requestMeta(req);

    if (body.action === "APPROVE") {
      const outcome = await db.$transaction((tx) =>
        approveAllocation(tx, {
          actor,
          allocationId,
          notes: body.notes ?? null,
        })
      );
      await recordAudit({
        action: "TREASURY_ALLOCATION_APPROVED",
        resourceType: "budget_allocation",
        resourceId: String(allocationId),
        description: `Appropriation opened; ₱${outcome.available.toFixed(2)} available.`,
        userId: user.id,
        ...meta,
      });
      return ok(outcome);
    }

    if (body.action === "ADJUST") {
      const outcome = await db.$transaction((tx) =>
        adjustAllocation(tx, {
          actor,
          allocationId,
          amount: body.amount,
          memo: body.memo,
        })
      );
      await recordAudit({
        action: "TREASURY_ALLOCATION_ADJUSTED",
        resourceType: "budget_allocation",
        resourceId: String(allocationId),
        description: `Appropriation adjusted by ₱${body.amount.toFixed(2)}: ${body.memo}`,
        userId: user.id,
        ...meta,
      });
      return ok(outcome);
    }

    const outcome = await db.$transaction((tx) =>
      closeAllocation(tx, { actor, allocationId, notes: body.notes ?? null })
    );
    await recordAudit({
      action: "TREASURY_ALLOCATION_CLOSED",
      resourceType: "budget_allocation",
      resourceId: String(allocationId),
      description: body.notes ?? "Allocation closed.",
      userId: user.id,
      ...meta,
    });
    return ok(outcome);
  }
);
