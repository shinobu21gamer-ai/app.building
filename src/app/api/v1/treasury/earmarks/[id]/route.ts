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
import { earmarkActionSchema } from "@/lib/validations/treasury";
import { approveEarmark, cancelEarmark } from "@/lib/treasury/budget";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

function earmarkIdFrom(value: string): number {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    throw createApiError.notFound("Earmark not found.");
  }
  return id;
}

/**
 * PATCH /api/v1/treasury/earmarks/[id]
 * APPROVE reserves the amount on the ledger (`treasury.earmark.approve` — the
 * Captain/AAO); CANCEL releases the reservation again
 * (`treasury.earmark.prepare`) and always carries a reason.
 */
export const PATCH = withErrorBoundary<[Request, RouteContext]>(
  async (req, ctx) => {
    assertSameOrigin(req);
    const { id } = await ctx.params;
    const earmarkId = earmarkIdFrom(id);
    const body = await parseBody(req, earmarkActionSchema);

    const user = await requireApiPermission(
      body.action === "APPROVE"
        ? "treasury.earmark.approve"
        : "treasury.earmark.prepare"
    );
    const actor = {
      id: user.id,
      roleKey: user.role.key,
      officeId: user.officeId ?? null,
    };
    const meta = requestMeta(req);

    if (body.action === "APPROVE") {
      const outcome = await db.$transaction((tx) =>
        approveEarmark(tx, { actor, earmarkId, notes: body.notes ?? null })
      );
      await recordAudit({
        action: "TREASURY_EARMARK_APPROVED",
        resourceType: "budget_earmark",
        resourceId: String(earmarkId),
        description: `${outcome.code ?? `Earmark #${earmarkId}`} approved; ₱${outcome.available.toFixed(2)} left available on the allocation.`,
        userId: user.id,
        ...meta,
      });
      return ok(outcome);
    }

    const outcome = await db.$transaction((tx) =>
      cancelEarmark(tx, { actor, earmarkId, reason: body.reason })
    );
    await recordAudit({
      action: "TREASURY_EARMARK_CANCELLED",
      resourceType: "budget_earmark",
      resourceId: String(earmarkId),
      description: `Earmark cancelled: ${body.reason}`,
      userId: user.id,
      ...meta,
    });
    return ok(outcome);
  }
);
