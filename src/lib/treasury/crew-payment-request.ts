import type { Prisma } from "@prisma/client";
import { createApiError } from "@/lib/api";
import { createDisbursement } from "@/lib/treasury/disbursement";
import { seesWholeBudget } from "@/lib/treasury/budget";
import { roundMoney, toMoney } from "@/lib/treasury/ledger";

type Tx = Prisma.TransactionClient;

export type ClosedCasePaymentRequest = {
  requestId: number;
  crewCount: number;
  created: boolean;
};

/** Creates one amount-free payment request for each unique crew member on close. */
export async function createCrewPaymentRequestOnClose(
  tx: Tx,
  concernId: number
): Promise<ClosedCasePaymentRequest | null> {
  const assignments = await tx.crewAssignment.findMany({
    where: { concernId },
    select: { crewId: true },
  });
  const crewIds = [...new Set(assignments.map((assignment) => assignment.crewId))];
  if (crewIds.length === 0) return null;

  const existing = await tx.crewPaymentRequest.findUnique({
    where: { concernId },
    select: { id: true, lines: { select: { id: true } } },
  });
  if (existing) {
    return {
      requestId: existing.id,
      crewCount: existing.lines.length,
      created: false,
    };
  }

  const request = await tx.crewPaymentRequest.create({
    data: {
      concernId,
      lines: { create: crewIds.map((crewId) => ({ crewId })) },
    },
    select: { id: true },
  });

  return { requestId: request.id, crewCount: crewIds.length, created: true };
}

export type CrewPaymentDecision =
  | { lineId: number; action: "PAY"; amount: number }
  | { lineId: number; action: "HOLD"; reason: string };

export type DecideCrewPaymentsInput = {
  requestId: number;
  actor: { id: number; roleKey: string; officeId: number | null };
  earmarkId: number | null;
  decisions: CrewPaymentDecision[];
};

/**
 * Applies selected Pay/Hold decisions as one transaction. PAY creates a DRAFT
 * voucher per crew member; the existing certification/approval/release process
 * remains in force. HOLD stores a reason and leaves the request open.
 */
export async function decideCrewPayments(
  tx: Tx,
  input: DecideCrewPaymentsInput
): Promise<{ vouchers: Array<{ lineId: number; disbursementId: number; voucherNumber: string | null }>; held: number }> {
  const request = await tx.crewPaymentRequest.findUnique({
    where: { id: input.requestId },
    include: {
      concern: { select: { id: true, caseNumber: true, status: true, assignedOfficeId: true } },
      lines: { include: { crew: { select: { id: true, firstName: true, lastName: true } }, disbursement: { select: { status: true } } } },
    },
  });
  if (!request) throw createApiError.notFound("Crew payment request not found.");
  if (
    !seesWholeBudget(input.actor) &&
    request.concern.assignedOfficeId !== input.actor.officeId
  ) {
    throw createApiError.notFound("Crew payment request not found.");
  }
  if (request.concern.status !== "CLOSED") {
    throw createApiError.conflict("Crew payment requests are available after the case is closed.");
  }
  const retryableVoucherExists = request.lines.some(
    (line) =>
      line.status === "VOUCHER_PREPARED" &&
      (line.disbursement?.status === "REJECTED" || line.disbursement?.status === "CANCELLED")
  );
  if (request.status === "VOUCHERS_PREPARED" && !retryableVoucherExists) {
    throw createApiError.conflict("All crew vouchers for this request have already been prepared.");
  }
  if (input.decisions.length === 0) {
    throw createApiError.badRequest("Choose Pay or Hold for at least one crew member.");
  }
  const decisionsByLine = new Map<number, CrewPaymentDecision>();
  for (const decision of input.decisions) {
    if (decisionsByLine.has(decision.lineId)) {
      throw createApiError.badRequest("Choose each crew member only once.");
    }
    decisionsByLine.set(decision.lineId, decision);
  }

  const payLines = input.decisions.filter((decision) => decision.action === "PAY");
  let allocationId: number | null = null;
  if (payLines.length > 0) {
    if (input.earmarkId === null) {
      throw createApiError.badRequest("Choose an approved earmark before preparing crew vouchers.");
    }
    const earmark = await tx.budgetEarmark.findUnique({
      where: { id: input.earmarkId },
      select: { allocationId: true },
    });
    if (!earmark) throw createApiError.badRequest("Pick an existing earmark.");
    allocationId = earmark.allocationId;
  }

  const now = new Date();
  const vouchers: Array<{ lineId: number; disbursementId: number; voucherNumber: string | null }> = [];
  let held = 0;

  for (const decision of input.decisions) {
    const line = request.lines.find((row) => row.id === decision.lineId);
    if (!line) throw createApiError.badRequest("That crew member is not on this request.");
    if (line.status === "VOUCHER_PREPARED" && line.disbursement?.status !== "REJECTED" && line.disbursement?.status !== "CANCELLED") {
      throw createApiError.conflict(`${line.crew.firstName} ${line.crew.lastName} already has a voucher for this request.`);
    }

    if (decision.action === "HOLD") {
      const reason = decision.reason.trim();
      if (reason.length < 5 || reason.length > 500) {
        throw createApiError.badRequest("A hold reason of 5 to 500 characters is required.");
      }
      await tx.crewPaymentRequestLine.update({
        where: { id: line.id },
        data: {
          status: "HELD",
          holdReason: reason,
          decidedById: input.actor.id,
          decidedAt: now,
        },
      });
      held += 1;
      continue;
    }

    const amount = roundMoney(toMoney(decision.amount));
    if (amount <= 0) throw createApiError.badRequest("Enter a payment amount greater than zero.");

    const voucher = await createDisbursement(tx, {
      actor: input.actor,
      allocationId: allocationId!,
      earmarkId: input.earmarkId,
      concernId: request.concern.id,
      payee: `${line.crew.firstName} ${line.crew.lastName}`.trim(),
      payeeType: "CREW",
      payeeUserId: line.crew.id,
      amount,
      particulars: `Crew labour — ${line.crew.firstName} ${line.crew.lastName}`,
    });

    await tx.crewPaymentRequestLine.update({
      where: { id: line.id },
      data: {
        status: "VOUCHER_PREPARED",
        holdReason: null,
        decidedById: input.actor.id,
        decidedAt: now,
        disbursementId: voucher.disbursementId,
      },
    });
    vouchers.push({
      lineId: line.id,
      disbursementId: voucher.disbursementId,
      voucherNumber: voucher.voucherNumber,
    });
  }

  const latestLines = await tx.crewPaymentRequestLine.findMany({
    where: { requestId: request.id },
    select: { status: true },
  });
  const complete = latestLines.every((line) => line.status === "VOUCHER_PREPARED");
  await tx.crewPaymentRequest.update({
    where: { id: request.id },
    data: { status: complete ? "VOUCHERS_PREPARED" : "OPEN" },
  });

  return { vouchers, held };
}
