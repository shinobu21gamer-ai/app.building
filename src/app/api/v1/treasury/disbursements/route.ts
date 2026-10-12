import { db } from "@/lib/db";
import {
  assertSameOrigin,
  ok,
  parseBody,
  withErrorBoundary,
} from "@/lib/api";
import { requireApiPermission } from "@/lib/auth/session";
import { recordAudit, requestMeta } from "@/lib/audit";
import { disbursementCreateSchema } from "@/lib/validations/treasury";
import { createDisbursement } from "@/lib/treasury/disbursement";
import { listDisbursements } from "@/lib/treasury/query";

export const runtime = "nodejs";

function actorFrom(user: { id: number; role: { key: string }; officeId: number | null }) {
  return {
    id: user.id,
    roleKey: user.role.key,
    officeId: user.officeId ?? null,
  };
}

/**
 * GET /api/v1/treasury/disbursements
 * The voucher register, with the approvals already attached so a screen can
 * show where each voucher is in the certification → approval → release chain.
 */
export const GET = withErrorBoundary<[Request]>(
  async (req) => {
    const user = await requireApiPermission("treasury.balance.view");
    const url = new URL(req.url);
    const allocationId = Number(url.searchParams.get("allocationId") ?? "");
    const concernId = Number(url.searchParams.get("concernId") ?? "");
    const status = url.searchParams.get("status");
    const search = url.searchParams.get("search");

    const disbursements = await listDisbursements(db, {
      actor: actorFrom(user),
      allocationId:
        Number.isInteger(allocationId) && allocationId > 0 ? allocationId : null,
      concernId: Number.isInteger(concernId) && concernId > 0 ? concernId : null,
      status: status && status !== "ALL" ? status : null,
      search: search && search.trim() !== "" ? search.trim() : null,
    });

    return ok({ disbursements });
  }
);

/**
 * POST /api/v1/treasury/disbursements
 * Prepares a draft voucher. The amount is checked against the live balance of
 * the allocation (or the earmark that reserved it), so a draft can never be
 * written for money that is not there. Requires `treasury.disbursement.prepare`.
 */
export const POST = withErrorBoundary<[Request]>(
  async (req) => {
    assertSameOrigin(req);
    const user = await requireApiPermission("treasury.disbursement.prepare");
    const body = await parseBody(req, disbursementCreateSchema);
    const actor = actorFrom(user);

    const outcome = await db.$transaction((tx) =>
      createDisbursement(tx, {
        actor,
        allocationId: body.allocationId,
        earmarkId: body.earmarkId ?? null,
        concernId: body.concernId ?? null,
        payee: body.payee,
        payeeType: body.payeeType,
        payeeUserId: body.payeeUserId ?? null,
        amount: body.amount,
        particulars: body.particulars,
        modeOfPayment: body.modeOfPayment ?? null,
      })
    );

    const meta = requestMeta(req);
    await recordAudit({
      action: "TREASURY_DISBURSEMENT_PREPARED",
      resourceType: "disbursement",
      resourceId: String(outcome.disbursementId),
      description: `${outcome.voucherNumber} — ${body.payee}: ₱${body.amount.toFixed(2)} drafted (${body.particulars}).`,
      userId: user.id,
      ...meta,
    });

    return ok(outcome);
  }
);
