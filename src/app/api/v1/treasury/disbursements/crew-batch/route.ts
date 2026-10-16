import { db } from "@/lib/db";
import { assertSameOrigin, createApiError, ok, parseBody, withErrorBoundary } from "@/lib/api";
import { requireApiPermission } from "@/lib/auth/session";
import { recordAudit, requestMeta } from "@/lib/audit";
import { disbursementCrewBatchSchema } from "@/lib/validations/treasury";
import { createDisbursement } from "@/lib/treasury/disbursement";

export const runtime = "nodejs";

/** Prepares all crew vouchers as one transaction: either every selected worker gets a draft, or none do. */
export const POST = withErrorBoundary(async (req: Request) => {
  assertSameOrigin(req);
  const user = await requireApiPermission("treasury.disbursement.prepare");
  const body = await parseBody(req, disbursementCrewBatchSchema);
  const actor = {
    id: user.id,
    roleKey: user.role.key,
    officeId: user.officeId ?? null,
  };

  const vouchers = await db.$transaction(async (tx) => {
    const prepared: Array<{
      disbursementId: number;
      voucherNumber: string | null;
      status: "DRAFT";
    }> = [];
    for (const line of body.crew) {
      const crewMember = await tx.user.findUnique({
        where: { id: line.payeeUserId },
        select: {
          firstName: true,
          lastName: true,
          isActive: true,
          role: { select: { key: true } },
        },
      });
      if (!crewMember || !crewMember.isActive || crewMember.role.key !== "CREW") {
        throw createApiError.conflict(
          "One selected person is no longer an active crew account. Refresh the page and try again."
        );
      }

      prepared.push(await createDisbursement(tx, {
        actor,
        allocationId: body.allocationId,
        earmarkId: body.earmarkId,
        concernId: body.concernId,
        payee: `${crewMember.firstName} ${crewMember.lastName}`.trim(),
        payeeType: "CREW",
        payeeUserId: line.payeeUserId,
        amount: line.amount,
        particulars: body.particulars?.trim() || `Crew labour — ${crewMember.firstName} ${crewMember.lastName}`,
        modeOfPayment: body.modeOfPayment ?? null,
      }));
    }
    return prepared;
  });

  const meta = requestMeta(req);
  for (const voucher of vouchers) {
    await recordAudit({
      action: "TREASURY_DISBURSEMENT_PREPARED",
      resourceType: "disbursement",
      resourceId: String(voucher.disbursementId),
      description: `${voucher.voucherNumber}: crew payment draft prepared for case ${body.concernId}.`,
      userId: user.id,
      ...meta,
    });
  }

  return ok({ vouchers });
});
