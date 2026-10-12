// Treasury disbursement layer: the voucher lifecycle
// (draft → submitted → funds certified → AAO approved → released → liquidated,
// with rejection and cancellation), the separation of duties around it and the
// ledger movements each step causes.
//
// The rules themselves live in `ledger.ts`; this module loads rows, applies
// those rules and writes the ledger.

import type { Prisma } from "@prisma/client";
import { createApiError } from "@/lib/api";
import type { PermissionKey } from "@/lib/auth/rbac";
import { codeUsable } from "@/lib/treasury/coa";
import { allocationBalance, loadAllocationForActor, settleEarmarkPayment, writeLedgerEntry, type Actor } from "@/lib/treasury/budget";
import {
  actionAllowed,
  approvalConflict,
  disbursementActions,
  decisionForAction,
  isPaid,
  levelForAction,
  liquidationDueFrom,
  nextApprovalLevel,
  roundMoney,
  statusAfterAction,
  toMoney,
  voucherNumber,
  type DisbursementAction,
} from "@/lib/treasury/ledger";

type Tx = Prisma.TransactionClient;

const WIDE_ROLES = ["TREASURER", "CAPTAIN", "ADMIN"];

/** Which permission each action needs. Rejecting needs the permission of the
 * level that is still pending, so a rejection cannot be pushed through by the
 * role that is supposed to approve next. */
export function permissionForAction(
  action: DisbursementAction,
  status: string
): PermissionKey {
  switch (action) {
    case "CERTIFY":
      return "treasury.disbursement.certify";
    case "APPROVE":
      return "treasury.disbursement.approve";
    case "REJECT":
      // Whoever is still pending rejects: the treasurer before certification,
      // the Captain (AAO) after it.
      return status === "SUBMITTED"
        ? "treasury.disbursement.certify"
        : "treasury.disbursement.approve";
    default:
      return "treasury.disbursement.prepare";
  }
}

async function nextVoucherNumber(tx: Tx, now: Date): Promise<string> {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1;
  const prefix = `DV-${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-`;
  const count = await tx.disbursement.count({
    where: { voucherNumber: { startsWith: prefix } },
  });
  return voucherNumber(year, month, count + 1);
}

export async function loadVoucherForActor(
  tx: Tx,
  disbursementId: number,
  actor: Actor
) {
  const voucher = await tx.disbursement.findUnique({
    where: { id: disbursementId },
    include: {
      allocation: {
        include: {
          coaAccount: true,
          fundSource: true,
          office: { select: { id: true, name: true } },
        },
      },
      earmark: { select: { id: true, code: true, status: true, amount: true } },
      approvals: { orderBy: { level: "asc" } },
      concern: { select: { id: true, caseNumber: true, title: true } },
    },
  });
  if (!voucher) throw createApiError.notFound("Voucher not found.");

  if (!WIDE_ROLES.includes(actor.roleKey)) {
    throw createApiError.forbidden(
      "Disbursement vouchers are handled by the treasurer, the Captain and the administrator."
    );
  }
  return voucher;
}

export type CreateVoucherInput = {
  actor: Actor;
  allocationId: number;
  earmarkId: number | null;
  concernId: number | null;
  payee: string;
  payeeType: string;
  payeeUserId: number | null;
  amount: number;
  particulars: string;
  modeOfPayment?: string | null;
};

/**
 * Creates a draft voucher. The amount is checked against what is actually
 * available on the allocation (or against the earmark that reserved it), so a
 * voucher can never be prepared for money that is not there.
 */
export async function createDisbursement(tx: Tx, input: CreateVoucherInput) {
  const allocation = await loadAllocationForActor(tx, input.allocationId, input.actor);
  if (allocation.status !== "APPROVED") {
    throw createApiError.conflict(
      "The allocation has to be approved before a voucher can be prepared against it."
    );
  }

  const gate = codeUsable({
    code: allocation.coaAccount.code,
    verificationStatus: allocation.coaAccount.verificationStatus,
    isActive: allocation.coaAccount.isActive,
  });
  if (!gate.usable) throw createApiError.conflict(gate.reason!);

  const amount = roundMoney(input.amount);
  if (amount <= 0) {
    throw createApiError.badRequest("The voucher amount must be more than zero.");
  }

  let earmarkId: number | null = null;
  if (input.earmarkId !== null) {
    const earmark = await tx.budgetEarmark.findUnique({
      where: { id: input.earmarkId },
    });
    if (!earmark) throw createApiError.badRequest("Pick an existing earmark.");
    if (earmark.allocationId !== allocation.id) {
      throw createApiError.badRequest(
        "That earmark belongs to a different allocation."
      );
    }
    if (earmark.status !== "APPROVED") {
      throw createApiError.conflict(
        `Earmark ${earmark.code ?? earmark.id} is ${earmark.status}, so it cannot pay a new voucher.`
      );
    }
    if (input.concernId !== null && earmark.concernId !== null && earmark.concernId !== input.concernId) {
      throw createApiError.conflict(
        "That earmark was set aside for a different case."
      );
    }

    const liveOnEarmark = await tx.disbursement.findMany({
      where: {
        earmarkId: earmark.id,
        status: { in: ["SUBMITTED", "CERTIFIED", "APPROVED", "RELEASED", "LIQUIDATED"] },
      },
      select: { amount: true },
    });
    const committed = liveOnEarmark.reduce(
      (sum, row) => sum + toMoney(row.amount),
      0
    );
    const earmarkAmount = toMoney(earmark.amount);
    if (roundMoney(committed + amount) > earmarkAmount) {
      throw createApiError.conflict(
        `Earmark ${earmark.code ?? earmark.id} holds ₱${earmarkAmount.toFixed(2)} and ₱${committed.toFixed(2)} of it is already committed. The most this voucher can be is ₱${roundMoney(earmarkAmount - committed).toFixed(2)}.`
      );
    }
    earmarkId = earmark.id;
  } else {
    const balance = await allocationBalance(tx, allocation.id);
    if (amount > balance.available) {
      throw createApiError.conflict(
        `${allocation.coaAccount.code} only has ₱${balance.available.toFixed(2)} available on this allocation. Set aside an earmark first, or reduce the voucher by ₱${roundMoney(amount - balance.available).toFixed(2)}.`
      );
    }
  }

  if (input.concernId !== null) {
    const concern = await tx.concern.findUnique({
      where: { id: input.concernId },
      select: { id: true },
    });
    if (!concern) throw createApiError.badRequest("Pick an existing case.");
  }
  if (input.payeeUserId !== null) {
    const payee = await tx.user.findUnique({
      where: { id: input.payeeUserId },
      select: { id: true },
    });
    if (!payee) throw createApiError.badRequest("Pick an existing resident.");
  }

  const number = await nextVoucherNumber(tx, new Date());
  const voucher = await tx.disbursement.create({
    data: {
      voucherNumber: number,
      allocationId: allocation.id,
      earmarkId,
      concernId: input.concernId,
      payee: input.payee,
      payeeType: input.payeeType,
      payeeUserId: input.payeeUserId,
      amount,
      particulars: input.particulars,
      modeOfPayment: input.modeOfPayment ?? null,
      status: "DRAFT",
      preparedById: input.actor.id,
    },
    select: { id: true, voucherNumber: true },
  });

  return {
    disbursementId: voucher.id,
    voucherNumber: voucher.voucherNumber,
    status: "DRAFT" as const,
  };
}

export type VoucherActionInput = {
  actor: Actor;
  disbursementId: number;
  action: DisbursementAction;
  remarks?: string | null;
  reason?: string | null;
  modeOfPayment?: string | null;
  proofUrl?: string | null;
  liquidationNotes?: string | null;
  liquidationStatus?: string | null;
};

/**
 * One entry point for every lifecycle step. The status machine, the approval
 * order, the separation of duties and the ledger movements are all enforced
 * here, in the same transaction as the status write.
 */
export async function actOnDisbursement(tx: Tx, input: VoucherActionInput) {
  const voucher = await loadVoucherForActor(tx, input.disbursementId, input.actor);
  const status = voucher.status;

  if (!actionAllowed(status, input.action)) {
    const allowed = disbursementActions(status);
    throw createApiError.conflict(
      allowed.length === 0
        ? `This voucher is ${status.toLowerCase()} and no further step is possible.`
        : `A ${status.toLowerCase()} voucher cannot do that. Allowed now: ${allowed.join(", ")}.`
    );
  }

  const next = statusAfterAction(status, input.action);
  if (!next) {
    throw createApiError.conflict(
      `That step is not possible from status ${status}.`
    );
  }

  const level = levelForAction(input.action);
  const decision = decisionForAction(input.action);
  if (level !== null && decision !== null) {
    const conflict = approvalConflict({
      preparedById: voucher.preparedById,
      createdById: null,
      approverId: input.actor.id,
      approvals: voucher.approvals.map((row) => ({
        level: row.level,
        approverId: row.approverId,
        decision: row.decision,
      })),
    });
    if (conflict) throw createApiError.forbidden(conflict);

    const pending = nextApprovalLevel(
      voucher.approvals.map((row) => ({
        level: row.level,
        approverId: row.approverId,
        decision: row.decision,
      }))
    );
    if (pending !== level) {
      throw createApiError.conflict(
        level === 1
          ? "This voucher is not waiting for a funds-availability certification."
          : "The treasurer has to certify that the funds are available before the voucher can be approved."
      );
    }
  }

  const amount = toMoney(voucher.amount);

  switch (input.action) {
    case "SUBMIT": {
      await tx.disbursement.update({
        where: { id: voucher.id },
        data: { status: "SUBMITTED", submittedAt: new Date() },
      });
      return { disbursementId: voucher.id, status: "SUBMITTED" as const, available: null };
    }

    case "CERTIFY": {
      // Reserving the money is what "funds are available" means. A voucher
      // that draws on an approved earmark is already reserved by that earmark.
      if (voucher.earmarkId === null) {
        const balance = await allocationBalance(tx, voucher.allocationId);
        if (amount > balance.available) {
          throw createApiError.conflict(
            `Funds are not available: ${voucher.allocation.coaAccount.code} has ₱${balance.available.toFixed(2)} left and this voucher is ₱${amount.toFixed(2)}.`
          );
        }
        await writeLedgerEntry(tx, {
          allocationId: voucher.allocationId,
          entryType: "DISBURSEMENT_RESERVE",
          amount,
          reservedDelta: amount,
          memo: `${voucher.voucherNumber ?? "Voucher"} reserved for ${voucher.payee}`,
          referenceType: "DISBURSEMENT",
          referenceId: String(voucher.id),
          actorId: input.actor.id,
        });
      } else if (voucher.earmark?.status !== "APPROVED") {
        throw createApiError.conflict(
          `The earmark behind this voucher is ${voucher.earmark?.status ?? "missing"}, so the funds are not reserved any more.`
        );
      }

      await tx.disbursementApproval.create({
        data: {
          disbursementId: voucher.id,
          approverId: input.actor.id,
          approverRole: input.actor.roleKey,
          level: 1,
          decision: "CERTIFIED",
          remarks: input.remarks ?? null,
        },
      });
      await tx.disbursement.update({
        where: { id: voucher.id },
        data: { status: "CERTIFIED" },
      });
      return { disbursementId: voucher.id, status: "CERTIFIED" as const, available: null };
    }

    case "APPROVE": {
      await tx.disbursementApproval.create({
        data: {
          disbursementId: voucher.id,
          approverId: input.actor.id,
          approverRole: input.actor.roleKey,
          level: 2,
          decision: "APPROVED",
          remarks: input.remarks ?? null,
        },
      });
      await tx.disbursement.update({
        where: { id: voucher.id },
        data: { status: "APPROVED" },
      });
      return { disbursementId: voucher.id, status: "APPROVED" as const, available: null };
    }

    case "REJECT": {
      await tx.disbursementApproval.create({
        data: {
          disbursementId: voucher.id,
          approverId: input.actor.id,
          approverRole: input.actor.roleKey,
          level: level ?? 1,
          decision: "REJECTED",
          remarks: input.reason ?? null,
        },
      });
      await tx.disbursement.update({
        where: { id: voucher.id },
        data: { status: "REJECTED", rejectionReason: input.reason ?? null },
      });

      // Give the reservation back. An earmark keeps its own reservation.
      if (status === "CERTIFIED" && voucher.earmarkId === null) {
        const entry = await writeLedgerEntry(tx, {
          allocationId: voucher.allocationId,
          entryType: "DISBURSEMENT_CANCEL",
          amount,
          reservedDelta: -amount,
          memo: `${voucher.voucherNumber ?? "Voucher"} rejected: ${input.reason ?? ""}`.trim(),
          referenceType: "DISBURSEMENT",
          referenceId: String(voucher.id),
          actorId: input.actor.id,
        });
        return { disbursementId: voucher.id, status: "REJECTED" as const, available: entry.available };
      }
      const balance = await allocationBalance(tx, voucher.allocationId);
      return {
        disbursementId: voucher.id,
        status: "REJECTED" as const,
        available: balance.available,
      };
    }

    case "RELEASE": {
      const releasedAt = new Date();
      const dueAt = liquidationDueFrom(releasedAt);

      if (voucher.earmarkId !== null) {
        // The earmark release frees the reservation...
        await settleEarmarkPayment(tx, {
          earmarkId: voucher.earmarkId,
          amount,
          voucherReference: voucher.voucherNumber ?? String(voucher.id),
          actorId: input.actor.id,
        });
        // ...and the payment itself is recorded as disbursed.
        await writeLedgerEntry(tx, {
          allocationId: voucher.allocationId,
          entryType: "DISBURSEMENT_RELEASE",
          amount,
          disbursedDelta: amount,
          memo: `${voucher.voucherNumber ?? "Voucher"} paid to ${voucher.payee}`,
          referenceType: "DISBURSEMENT",
          referenceId: String(voucher.id),
          actorId: input.actor.id,
        });
      } else {
        await writeLedgerEntry(tx, {
          allocationId: voucher.allocationId,
          entryType: "DISBURSEMENT_RELEASE",
          amount,
          reservedDelta: -amount,
          disbursedDelta: amount,
          memo: `${voucher.voucherNumber ?? "Voucher"} paid to ${voucher.payee}`,
          referenceType: "DISBURSEMENT",
          referenceId: String(voucher.id),
          actorId: input.actor.id,
        });
      }

      await tx.disbursement.update({
        where: { id: voucher.id },
        data: {
          status: "RELEASED",
          releasedAt,
          releasedById: input.actor.id,
          liquidationDueAt: dueAt,
          liquidationStatus: "PENDING",
          proofUrl: input.proofUrl ?? voucher.proofUrl,
          modeOfPayment: input.modeOfPayment ?? voucher.modeOfPayment,
        },
      });

      const balance = await allocationBalance(tx, voucher.allocationId);
      return {
        disbursementId: voucher.id,
        status: "RELEASED" as const,
        liquidationDueAt: dueAt.toISOString(),
        available: balance.available,
      };
    }

    case "LIQUIDATE": {
      const liquidationStatus =
        input.liquidationStatus === "PARTIAL" ? "PARTIAL" : "LIQUIDATED";
      await tx.disbursement.update({
        where: { id: voucher.id },
        data: {
          status: "LIQUIDATED",
          liquidationStatus,
          liquidationNotes: input.liquidationNotes ?? null,
          proofUrl: input.proofUrl ?? voucher.proofUrl,
        },
      });
      await writeLedgerEntry(tx, {
        allocationId: voucher.allocationId,
        entryType: "LIQUIDATION",
        amount: 0,
        memo: `${voucher.voucherNumber ?? "Voucher"} liquidated${
          liquidationStatus === "PARTIAL" ? " (partial)" : ""
        }: ${input.liquidationNotes ?? ""}`.trim(),
        referenceType: "DISBURSEMENT",
        referenceId: String(voucher.id),
        actorId: input.actor.id,
      });
      const balance = await allocationBalance(tx, voucher.allocationId);
      return {
        disbursementId: voucher.id,
        status: "LIQUIDATED" as const,
        available: balance.available,
      };
    }

    case "CANCEL": {
      await tx.disbursement.update({
        where: { id: voucher.id },
        data: {
          status: "CANCELLED",
          cancelledAt: new Date(),
          cancelReason: input.reason ?? null,
        },
      });

      if (status === "CERTIFIED" && voucher.earmarkId === null) {
        const entry = await writeLedgerEntry(tx, {
          allocationId: voucher.allocationId,
          entryType: "DISBURSEMENT_CANCEL",
          amount,
          reservedDelta: -amount,
          memo: `${voucher.voucherNumber ?? "Voucher"} cancelled: ${input.reason ?? ""}`.trim(),
          referenceType: "DISBURSEMENT",
          referenceId: String(voucher.id),
          actorId: input.actor.id,
        });
        return { disbursementId: voucher.id, status: "CANCELLED" as const, available: entry.available };
      }
      const balance = await allocationBalance(tx, voucher.allocationId);
      return {
        disbursementId: voucher.id,
        status: "CANCELLED" as const,
        available: balance.available,
      };
    }

    default:
      throw createApiError.badRequest("Unknown voucher action.");
  }
}

/** What the current status allows the signed-in actor to do, for the UI. */
export function voucherActionAvailability(input: {
  status: string;
  preparedById: number | null;
  approvals: Array<{ level: number; approverId: number; decision: string }>;
  actor: Actor;
  permissions: ReadonlySet<string>;
}): Array<{ action: DisbursementAction; allowed: boolean; reason: string | null }> {
  const { status, actor, permissions } = input;
  return disbursementActions(status).map((action) => {
    const permission = permissionForAction(action, status);
    if (!permissions.has(permission)) {
      return {
        action,
        allowed: false,
        reason: "Your role does not hold the permission for this step.",
      };
    }
    const level = levelForAction(action);
    if (level !== null) {
      const conflict = approvalConflict({
        preparedById: input.preparedById,
        createdById: null,
        approverId: actor.id,
        approvals: input.approvals,
      });
      if (conflict) return { action, allowed: false, reason: conflict };
      const pending = nextApprovalLevel(input.approvals);
      if (pending !== level) {
        return {
          action,
          allowed: false,
          reason:
            level === 1
              ? "This voucher is not waiting for a funds certification."
              : "The treasurer has to certify the funds first.",
        };
      }
    }
    return { action, allowed: true, reason: null };
  });
}

export function voucherIsPaid(status: string): boolean {
  return isPaid(status);
}
