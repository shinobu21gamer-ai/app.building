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
import { decideCrewPayments } from "@/lib/treasury/crew-payment-request";
import { crewPaymentRequestActionSchema } from "@/lib/validations/treasury";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

/** Applies selected crew Pay/Hold decisions; Pay only creates normal draft vouchers. */
export const POST = withErrorBoundary(async (req: Request, context: RouteContext) => {
  assertSameOrigin(req);
  const user = await requireApiPermission("treasury.disbursement.prepare");
  const { id } = await context.params;
  const requestId = Number(id);
  if (!Number.isInteger(requestId) || requestId <= 0) {
    throw createApiError.notFound("Crew payment request not found.");
  }

  const body = await parseBody(req, crewPaymentRequestActionSchema);
  let outcome: Awaited<ReturnType<typeof decideCrewPayments>>;
  try {
    outcome = await db.$transaction(
      (tx) =>
        decideCrewPayments(tx, {
          requestId,
          actor: {
            id: user.id,
            roleKey: user.role.key,
            officeId: user.officeId ?? null,
          },
          earmarkId: body.earmarkId ?? null,
          decisions: body.decisions,
        }),
      { isolationLevel: "Serializable" }
    );
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: unknown }).code === "P2034"
    ) {
      throw createApiError.conflict(
        "Another treasurer updated this crew request at the same time. Refresh the page and review the latest decisions."
      );
    }
    throw error;
  }

  const meta = requestMeta(req);
  for (const voucher of outcome.vouchers) {
    await recordAudit({
      action: "CREW_PAYMENT_VOUCHER_PREPARED",
      resourceType: "disbursement",
      resourceId: String(voucher.disbursementId),
      description: `${voucher.voucherNumber ?? `Voucher #${voucher.disbursementId}`} prepared from crew payment request #${requestId}.`,
      userId: user.id,
      ...meta,
    });
  }
  for (const decision of body.decisions.filter((line) => line.action === "HOLD")) {
    await recordAudit({
      action: "CREW_PAYMENT_HELD",
      resourceType: "crew_payment_request_line",
      resourceId: String(decision.lineId),
      description: `Crew payment request #${requestId} line held: ${decision.reason}`,
      userId: user.id,
      ...meta,
    });
  }

  return ok(outcome);
});
