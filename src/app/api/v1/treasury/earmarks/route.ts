import { db } from "@/lib/db";
import {
  assertSameOrigin,
  ok,
  parseBody,
  withErrorBoundary,
} from "@/lib/api";
import { requireApiPermission } from "@/lib/auth/session";
import { recordAudit, requestMeta } from "@/lib/audit";
import { earmarkCreateSchema } from "@/lib/validations/treasury";
import { proposeEarmark } from "@/lib/treasury/budget";
import { listEarmarks } from "@/lib/treasury/query";

export const runtime = "nodejs";

function actorFrom(user: { id: number; role: { key: string }; officeId: number | null }) {
  return {
    id: user.id,
    roleKey: user.role.key,
    officeId: user.officeId ?? null,
  };
}

/**
 * GET /api/v1/treasury/earmarks
 * The earmark register. Filter by allocation, by case or by status.
 */
export const GET = withErrorBoundary<[Request]>(
  async (req) => {
    const user = await requireApiPermission("treasury.balance.view");
    const url = new URL(req.url);
    const allocationId = Number(url.searchParams.get("allocationId") ?? "");
    const concernId = Number(url.searchParams.get("concernId") ?? "");
    const status = url.searchParams.get("status");

    const earmarks = await listEarmarks(db, {
      actor: actorFrom(user),
      allocationId:
        Number.isInteger(allocationId) && allocationId > 0 ? allocationId : null,
      concernId: Number.isInteger(concernId) && concernId > 0 ? concernId : null,
      status: status && status !== "ALL" ? status : null,
    });

    return ok({ earmarks });
  }
);

/**
 * POST /api/v1/treasury/earmarks
 * Proposes an earmark: an amount set aside for a purpose, optionally for one
 * case. The amount is checked against the allocation when it is approved, not
 * here, so a proposal never quietly reserves money. Requires
 * `treasury.earmark.prepare`.
 */
export const POST = withErrorBoundary<[Request]>(
  async (req) => {
    assertSameOrigin(req);
    const user = await requireApiPermission("treasury.earmark.prepare");
    const body = await parseBody(req, earmarkCreateSchema);
    const actor = actorFrom(user);

    const outcome = await db.$transaction((tx) =>
      proposeEarmark(tx, {
        actor,
        allocationId: body.allocationId,
        concernId: body.concernId ?? null,
        purpose: body.purpose,
        amount: body.amount,
        notes: body.notes ?? null,
      })
    );

    const meta = requestMeta(req);
    await recordAudit({
      action: "TREASURY_EARMARK_PROPOSED",
      resourceType: "budget_earmark",
      resourceId: String(outcome.earmarkId),
      description: `${outcome.code} — ${body.purpose}: ₱${outcome.amount.toFixed(2)} proposed${
        body.concernId ? ` for case #${body.concernId}` : ""
      }.`,
      userId: user.id,
      ...meta,
    });

    return ok(outcome);
  }
);
