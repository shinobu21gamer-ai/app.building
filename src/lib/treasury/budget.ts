// Treasury budget layer: appropriations, earmarks, the append-only ledger and
// the live balances. Every write goes through `writeLedgerEntry`, which stamps
// the running reserved/disbursed/available figures onto a new row — ledger
// entries are never updated or deleted.
//
// Money is handled as numbers through the pure helpers in `ledger.ts`; a
// Prisma `Decimal` is converted with `toMoney` before any arithmetic and
// written back as a rounded number.

import type { Prisma } from "@prisma/client";
import { createApiError } from "@/lib/api";
import {
  notifyEarmarkApproved,
  notifyEarmarkCancelled,
  notifyEarmarkProposed,
} from "@/lib/notifications/service";
import { codeUsable } from "@/lib/treasury/coa";
import {
  checkAvailability,
  earmarkCode,
  roundMoney,
  snapshotFromEntries,
  toMoney,
  type LedgerEntryType,
} from "@/lib/treasury/ledger";

type Tx = Prisma.TransactionClient;

export type Actor = {
  id: number;
  roleKey: string;
  officeId: number | null;
};

/** Roles that see the whole barangay's budget rather than one office's. */
const BUDGET_WIDE_ROLES = ["TREASURER", "CAPTAIN", "ADMIN"];

export function seesWholeBudget(actor: Actor): boolean {
  return BUDGET_WIDE_ROLES.includes(actor.roleKey);
}

export type AllocationBalance = {
  allocationId: number;
  appropriated: number;
  reserved: number;
  disbursed: number;
  available: number;
  entryCount: number;
  /** Recomputed from the deltas; must equal the live figures. */
  recomputedAvailable: number;
  consistent: boolean;
};

/**
 * The live balance of an allocation: the newest ledger entry is authoritative,
 * and the deltas are re-added as an independent check. A mismatch means rows
 * were tampered with outside the ledger path, which the caller surfaces.
 */
/**
 * Serialises every reserve/disburse decision on one allocation. Call it inside
 * the transaction, BEFORE reading the balance: two approvals that both read the
 * same remaining funds would otherwise both reserve them (a classic lost update).
 * The lock is held until the transaction commits.
 */
export async function lockAllocation(tx: Tx, allocationId: number): Promise<void> {
  await tx.$queryRaw`
    SELECT "id" FROM "BudgetAllocation"
    WHERE "id" = ${allocationId}
    FOR UPDATE`;
}

export async function allocationBalance(
  tx: Tx,
  allocationId: number
): Promise<AllocationBalance> {
  const allocation = await tx.budgetAllocation.findUnique({
    where: { id: allocationId },
    select: { id: true, appropriation: true },
  });
  if (!allocation) throw createApiError.notFound("Allocation not found.");

  const entries = (await tx.budgetLedgerEntry.findMany({
    where: { allocationId },
    orderBy: { id: "asc" },
    select: {
      reservedDelta: true,
      disbursedDelta: true,
      reservedAfter: true,
      disbursedAfter: true,
      availableAfter: true,
    },
  })) as Array<{
    reservedDelta: unknown;
    disbursedDelta: unknown;
    reservedAfter: unknown;
    disbursedAfter: unknown;
    availableAfter: unknown;
  }>;

  const snapshot = snapshotFromEntries(allocation.appropriation, entries);
  return {
    allocationId,
    appropriated: snapshot.appropriated,
    reserved: snapshot.reserved,
    disbursed: snapshot.disbursed,
    available: snapshot.available,
    entryCount: snapshot.entryCount,
    recomputedAvailable: snapshot.recomputed.available,
    consistent: roundMoney(snapshot.available) === roundMoney(snapshot.recomputed.available),
  };
}

export async function allocationBalances(
  tx: Tx,
  allocationIds: readonly number[]
): Promise<Map<number, AllocationBalance>> {
  const result = new Map<number, AllocationBalance>();
  for (const id of allocationIds) {
    result.set(id, await allocationBalance(tx, id));
  }
  return result;
}

/** Loads an allocation and applies office scoping. */
export async function loadAllocationForActor(
  tx: Tx,
  allocationId: number,
  actor: Actor
) {
  const allocation = await tx.budgetAllocation.findUnique({
    where: { id: allocationId },
    include: {
      coaAccount: true,
      fundSource: true,
      fiscalYear: true,
      office: { select: { id: true, name: true } },
    },
  });
  if (!allocation) throw createApiError.notFound("Allocation not found.");

  if (!seesWholeBudget(actor)) {
    if (actor.roleKey !== "OFFICIAL" || allocation.officeId === null) {
      throw createApiError.forbidden(
        "You do not have access to this allocation."
      );
    }
    if (allocation.officeId !== actor.officeId) {
      throw createApiError.forbidden(
        "This allocation belongs to another office."
      );
    }
  }
  return allocation;
}

export type LedgerWrite = {
  allocationId: number;
  entryType: LedgerEntryType;
  amount: number;
  reservedDelta?: number;
  disbursedDelta?: number;
  memo?: string | null;
  referenceType?: string | null;
  referenceId?: string | null;
  actorId?: number | null;
};

/**
 * Appends one ledger row. The after-figures are computed from the current live
 * balance, so the ledger stays a running statement instead of a set of deltas
 * someone has to add up later.
 */
export async function writeLedgerEntry(
  tx: Tx,
  input: LedgerWrite
): Promise<{ id: number; available: number; reserved: number; disbursed: number }> {
  const current = await allocationBalance(tx, input.allocationId);
  const next = {
    reserved: roundMoney(current.reserved + (input.reservedDelta ?? 0)),
    disbursed: roundMoney(current.disbursed + (input.disbursedDelta ?? 0)),
  };
  const available = roundMoney(current.appropriated - next.reserved - next.disbursed);

  const entry = await tx.budgetLedgerEntry.create({
    data: {
      allocationId: input.allocationId,
      entryType: input.entryType,
      referenceType: input.referenceType ?? null,
      referenceId: input.referenceId ?? null,
      memo: input.memo ?? null,
      amount: input.amount,
      reservedDelta: input.reservedDelta ?? 0,
      disbursedDelta: input.disbursedDelta ?? 0,
      reservedAfter: next.reserved,
      disbursedAfter: next.disbursed,
      availableAfter: available,
      actorId: input.actorId ?? null,
    },
    select: { id: true },
  });

  return { id: entry.id, available, ...next };
}

// ---------------------------------------------------------------------------
// Allocations
// ---------------------------------------------------------------------------

async function loadReferenceData(
  tx: Tx,
  input: { fundSourceId: number; coaAccountId: number; fiscalYearId: number }
) {
  const [fundSource, coaAccount, fiscalYear] = await Promise.all([
    tx.fundSource.findUnique({ where: { id: input.fundSourceId } }),
    tx.coaAccount.findUnique({ where: { id: input.coaAccountId } }),
    tx.fiscalYear.findUnique({ where: { id: input.fiscalYearId } }),
  ]);
  if (!fundSource) throw createApiError.badRequest("Pick an existing fund source.");
  if (!coaAccount) throw createApiError.badRequest("Pick an existing COA account.");
  if (!fiscalYear) throw createApiError.badRequest("Pick an existing fiscal year.");

  if (fiscalYear.isClosed) {
    throw createApiError.conflict(
      `Fiscal year ${fiscalYear.year} is closed. Budgets can no longer be moved against it.`
    );
  }

  const accountGate = codeUsable({
    code: coaAccount.code,
    verificationStatus: coaAccount.verificationStatus,
    isActive: coaAccount.isActive,
  });
  if (!accountGate.usable) throw createApiError.conflict(accountGate.reason!);

  if (fundSource.verificationStatus !== "VERIFIED" || !fundSource.isActive) {
    throw createApiError.conflict(
      `${fundSource.code} (${fundSource.name}) has not been verified against the barangay's appropriation ordinance yet. Verify the fund source first.`
    );
  }

  return { fundSource, coaAccount, fiscalYear };
}

export async function createAllocation(
  tx: Tx,
  input: {
    actor: Actor;
    fiscalYearId: number;
    fundSourceId: number;
    coaAccountId: number;
    officeId: number | null;
    label: string;
    appropriation: number;
    notes?: string | null;
  }
) {
  const { coaAccount, fiscalYear } = await loadReferenceData(tx, input);
  const appropriation = roundMoney(input.appropriation);
  if (appropriation <= 0) {
    throw createApiError.badRequest("The appropriation must be more than zero.");
  }

  const existing = await tx.budgetAllocation.findFirst({
    where: {
      fiscalYearId: input.fiscalYearId,
      fundSourceId: input.fundSourceId,
      coaAccountId: input.coaAccountId,
      officeId: input.officeId,
    },
    select: { id: true },
  });
  if (existing) {
    throw createApiError.conflict(
      `An allocation for ${coaAccount.code} already exists for this fund source, office and fiscal year (allocation #${existing.id}). Adjust that allocation instead of adding a second one.`
    );
  }

  if (input.officeId !== null) {
    const office = await tx.office.findUnique({
      where: { id: input.officeId },
      select: { id: true },
    });
    if (!office) throw createApiError.badRequest("Pick an existing office.");
  }

  const allocation = await tx.budgetAllocation.create({
    data: {
      fiscalYearId: input.fiscalYearId,
      fundSourceId: input.fundSourceId,
      coaAccountId: input.coaAccountId,
      officeId: input.officeId,
      label: input.label,
      appropriation,
      status: "DRAFT",
      createdById: input.actor.id,
      notes: input.notes ?? null,
    },
    select: { id: true },
  });

  return {
    allocationId: allocation.id,
    fiscalYear: fiscalYear.year,
    coaCode: coaAccount.code,
    appropriation,
  };
}

/** Approving opens the appropriation on the ledger (the opening balance). */
export async function approveAllocation(
  tx: Tx,
  input: { actor: Actor; allocationId: number; notes?: string | null }
) {
  const allocation = await loadAllocationForActor(tx, input.allocationId, input.actor);
  if (allocation.status === "APPROVED") {
    throw createApiError.conflict("This allocation is already approved.");
  }
  if (allocation.status === "CLOSED") {
    throw createApiError.conflict("This allocation is closed.");
  }

  const balance = await allocationBalance(tx, input.allocationId);
  if (balance.entryCount > 0) {
    throw createApiError.conflict(
      "This allocation already has ledger entries. Record an adjustment instead of re-approving it."
    );
  }

  await tx.budgetAllocation.update({
    where: { id: allocation.id },
    data: {
      status: "APPROVED",
      approvedById: input.actor.id,
      approvedAt: new Date(),
      notes: input.notes ?? allocation.notes,
    },
  });

  const entry = await writeLedgerEntry(tx, {
    allocationId: allocation.id,
    entryType: "APPROPRIATION",
    amount: toMoney(allocation.appropriation),
    memo:
      input.notes ??
      `Appropriation opened for ${allocation.coaAccount.code.toString()}`,
    referenceType: "BUDGET_ALLOCATION",
    referenceId: String(allocation.id),
    actorId: input.actor.id,
  });

  return {
    allocationId: allocation.id,
    status: "APPROVED" as const,
    available: entry.available,
  };
}

/**
 * Adjustments are administrator-only and always carry a memo: the ledger is
 * append-only, so a correction is a new row, never an edit of history.
 */
export async function adjustAllocation(
  tx: Tx,
  input: { actor: Actor; allocationId: number; amount: number; memo: string }
) {
  const allocation = await loadAllocationForActor(tx, input.allocationId, input.actor);
  if (allocation.status !== "APPROVED") {
    throw createApiError.conflict(
      "Only an approved allocation can be adjusted."
    );
  }
  const amount = roundMoney(input.amount);
  if (amount === 0) throw createApiError.badRequest("The adjustment must not be zero.");

  const balance = await allocationBalance(tx, input.allocationId);
  if (amount < 0) {
    const check = checkAvailability({
      available: balance.available,
      amount: Math.abs(amount),
      label: "This allocation",
    });
    if (!check.ok) throw createApiError.conflict(check.message!);
  }

  await tx.budgetAllocation.update({
    where: { id: allocation.id },
    data: { appropriation: roundMoney(balance.appropriated + amount) },
  });

  const entry = await writeLedgerEntry(tx, {
    allocationId: allocation.id,
    entryType: "ALLOCATION_ADJUSTMENT",
    amount,
    memo: input.memo,
    referenceType: "BUDGET_ALLOCATION",
    referenceId: String(allocation.id),
    actorId: input.actor.id,
  });

  return {
    allocationId: allocation.id,
    appropriated: roundMoney(balance.appropriated + amount),
    available: entry.available,
  };
}

export async function closeAllocation(
  tx: Tx,
  input: { actor: Actor; allocationId: number; notes?: string | null }
) {
  const allocation = await loadAllocationForActor(tx, input.allocationId, input.actor);
  const balance = await allocationBalance(tx, input.allocationId);

  if (balance.reserved > 0) {
    throw createApiError.conflict(
      `₱${balance.reserved.toFixed(2)} of this allocation is still reserved by open earmarks or vouchers. Cancel or release them before closing the allocation.`
    );
  }

  await tx.budgetAllocation.update({
    where: { id: allocation.id },
    data: { status: "CLOSED", notes: input.notes ?? allocation.notes },
  });

  return { allocationId: allocation.id, status: "CLOSED" as const };
}

// ---------------------------------------------------------------------------
// Earmarks
// ---------------------------------------------------------------------------

async function nextEarmarkCode(tx: Tx, year: number): Promise<string> {
  const count = await tx.budgetEarmark.count({
    where: { code: { startsWith: `EM-${year}-` } },
  });
  return earmarkCode(year, count + 1);
}

export async function proposeEarmark(
  tx: Tx,
  input: {
    actor: Actor;
    allocationId: number;
    concernId: number | null;
    purpose: string;
    amount: number;
    notes?: string | null;
  }
) {
  const allocation = await loadAllocationForActor(tx, input.allocationId, input.actor);
  if (allocation.status !== "APPROVED") {
    throw createApiError.conflict(
      "The allocation has to be approved before an earmark can be proposed against it."
    );
  }

  const accountGate = codeUsable({
    code: allocation.coaAccount.code,
    verificationStatus: allocation.coaAccount.verificationStatus,
    isActive: allocation.coaAccount.isActive,
  });
  if (!accountGate.usable) throw createApiError.conflict(accountGate.reason!);

  let caseNumber: string | null = null;
  if (input.concernId !== null) {
    const concern = await tx.concern.findUnique({
      where: { id: input.concernId },
      select: { id: true, caseNumber: true },
    });
    if (!concern) throw createApiError.badRequest("Pick an existing case.");
    caseNumber = concern.caseNumber;
  }

  const code = await nextEarmarkCode(tx, allocation.fiscalYear.year);

  const earmark = await tx.budgetEarmark.create({
    data: {
      allocationId: allocation.id,
      concernId: input.concernId,
      code,
      purpose: input.purpose,
      amount: roundMoney(input.amount),
      status: "PROPOSED",
      preparedById: input.actor.id,
      notes: input.notes ?? null,
    },
    select: { id: true, code: true, amount: true },
  });

  // Somebody else has to decide this, and segregation of duties means it is
  // not the proposer: without a notification the earmark waits on an approval
  // nobody was told to make, and the case waits in AWAITING_BUDGET with it.
  await notifyEarmarkProposed(tx, {
    earmarkId: earmark.id,
    earmarkCode: earmark.code,
    amount: toMoney(earmark.amount),
    purpose: input.purpose,
    preparedById: input.actor.id,
    concernId: input.concernId,
    caseNumber,
  });

  return {
    earmarkId: earmark.id,
    code: earmark.code,
    amount: toMoney(earmark.amount),
    status: "PROPOSED" as const,
  };
}

/**
 * Approval reserves the amount on the ledger. The check runs against the live
 * balance, which is what makes an overspend impossible rather than unlikely.
 */
export async function approveEarmark(
  tx: Tx,
  input: { actor: Actor; earmarkId: number; notes?: string | null }
) {
  const earmark = await tx.budgetEarmark.findUnique({
    where: { id: input.earmarkId },
    include: {
      allocation: { include: { coaAccount: true, fiscalYear: true } },
      concern: { select: { id: true, caseNumber: true, assignedOfficeId: true } },
    },
  });
  if (!earmark) throw createApiError.notFound("Earmark not found.");
  if (earmark.status === "APPROVED") {
    throw createApiError.conflict("This earmark is already approved.");
  }
  if (earmark.status !== "PROPOSED") {
    throw createApiError.conflict(
      `An earmark with status ${earmark.status} can no longer be approved.`
    );
  }
  if (earmark.allocation.status !== "APPROVED") {
    throw createApiError.conflict("The allocation behind this earmark is not approved.");
  }

  // Segregation of duties: whoever proposed the earmark may not approve it.
  // (Admin holds every treasury permission, so this rule must be enforced here.)
  if (earmark.preparedById !== null && earmark.preparedById === input.actor.id) {
    throw createApiError.conflict(
      "The person who proposed this earmark cannot approve it. Ask another approver."
    );
  }

  const amount = toMoney(earmark.amount);
  await lockAllocation(tx, earmark.allocationId);
  const balance = await allocationBalance(tx, earmark.allocationId);
  const check = checkAvailability({
    available: balance.available,
    amount,
    label: `${earmark.allocation.coaAccount.code}`,
  });
  if (!check.ok) throw createApiError.conflict(check.message!);

  await tx.budgetEarmark.update({
    where: { id: earmark.id },
    data: {
      status: "APPROVED",
      approvedById: input.actor.id,
      approvedAt: new Date(),
      notes: input.notes ?? earmark.notes,
    },
  });

  const entry = await writeLedgerEntry(tx, {
    allocationId: earmark.allocationId,
    entryType: "EARMARK_RESERVE",
    amount,
    reservedDelta: amount,
    memo: `${earmark.code ?? "Earmark"} reserved for ${earmark.purpose}`,
    referenceType: "BUDGET_EARMARK",
    referenceId: String(earmark.id),
    actorId: input.actor.id,
  });

  // The proposer learns the money landed, and so does the office holding the
  // case: an official watching a case sit in AWAITING_BUDGET has no other way
  // to find out the approval happened.
  await notifyEarmarkApproved(tx, {
    earmarkId: earmark.id,
    earmarkCode: earmark.code,
    amount,
    preparedById: earmark.preparedById,
    concernId: earmark.concern?.id ?? null,
    caseNumber: earmark.concern?.caseNumber ?? null,
    officeId: earmark.concern?.assignedOfficeId ?? null,
  });

  return {
    earmarkId: earmark.id,
    code: earmark.code,
    status: "APPROVED" as const,
    available: entry.available,
  };
}

export async function cancelEarmark(
  tx: Tx,
  input: { actor: Actor; earmarkId: number; reason: string }
) {
  const earmark = await tx.budgetEarmark.findUnique({
    where: { id: input.earmarkId },
    include: {
      concern: { select: { id: true, caseNumber: true, assignedOfficeId: true } },
    },
  });
  if (!earmark) throw createApiError.notFound("Earmark not found.");
  if (earmark.status === "CANCELLED") {
    throw createApiError.conflict("This earmark is already cancelled.");
  }
  if (earmark.status === "RELEASED") {
    throw createApiError.conflict(
      "This earmark was already released and paid. Reverse it with a new earmark on the same allocation instead."
    );
  }

  const liveDisbursements = await tx.disbursement.count({
    where: {
      earmarkId: earmark.id,
      status: { in: ["SUBMITTED", "CERTIFIED", "APPROVED", "RELEASED", "LIQUIDATED"] },
    },
  });
  if (liveDisbursements > 0) {
    throw createApiError.conflict(
      "This earmark has live vouchers against it. Cancel or reject those vouchers first."
    );
  }

  await tx.budgetEarmark.update({
    where: { id: earmark.id },
    data: {
      status: "CANCELLED",
      cancelledAt: new Date(),
      cancelReason: input.reason,
    },
  });

  // A cancelled earmark quietly leaves the case short again, so the reason
  // travels with the notification to the proposer and the case's office.
  const notifyCancelled = async (available: number) => {
    await notifyEarmarkCancelled(tx, {
      earmarkId: earmark.id,
      earmarkCode: earmark.code,
      amount: toMoney(earmark.amount),
      reason: input.reason,
      preparedById: earmark.preparedById,
      concernId: earmark.concern?.id ?? null,
      caseNumber: earmark.concern?.caseNumber ?? null,
      officeId: earmark.concern?.assignedOfficeId ?? null,
    });
    return {
      earmarkId: earmark.id,
      status: "CANCELLED" as const,
      available,
    };
  };

  if (earmark.status === "APPROVED") {
    const amount = toMoney(earmark.amount);
    const entry = await writeLedgerEntry(tx, {
      allocationId: earmark.allocationId,
      entryType: "EARMARK_CANCEL",
      amount,
      reservedDelta: -amount,
      memo: `${earmark.code ?? "Earmark"} cancelled: ${input.reason}`,
      referenceType: "BUDGET_EARMARK",
      referenceId: String(earmark.id),
      actorId: input.actor.id,
    });
    return notifyCancelled(entry.available);
  }

  const balance = await allocationBalance(tx, earmark.allocationId);
  return notifyCancelled(balance.available);
}

/**
 * Converts an approved earmark into a payment: the reservation is released and
 * the same amount is recorded as disbursed, so the earmark and the voucher
 * together move the ledger exactly once.
 */
export async function settleEarmarkPayment(
  tx: Tx,
  input: {
    earmarkId: number;
    amount: number;
    voucherReference: string;
    actorId: number;
  }
) {
  const earmark = await tx.budgetEarmark.findUnique({
    where: { id: input.earmarkId },
  });
  if (!earmark) throw createApiError.notFound("Earmark not found.");
  if (earmark.status !== "APPROVED") {
    throw createApiError.conflict(
      `Earmark ${earmark.code ?? earmark.id} is ${earmark.status}, so it cannot pay a voucher.`
    );
  }

  const amount = roundMoney(input.amount);
  const earmarkAmount = toMoney(earmark.amount);
  if (amount > earmarkAmount) {
    throw createApiError.conflict(
      `The voucher (₱${amount.toFixed(2)}) is larger than earmark ${earmark.code ?? earmark.id} (₱${earmarkAmount.toFixed(2)}). Split the voucher or raise the earmark first.`
    );
  }

  await tx.budgetEarmark.update({
    where: { id: earmark.id },
    data: { status: "RELEASED", releasedAt: new Date() },
  });

  const entry = await writeLedgerEntry(tx, {
    allocationId: earmark.allocationId,
    entryType: "EARMARK_RELEASE",
    amount,
    reservedDelta: -amount,
    memo: `${earmark.code ?? "Earmark"} released to voucher ${input.voucherReference}`,
    referenceType: "BUDGET_EARMARK",
    referenceId: String(earmark.id),
    actorId: input.actorId,
  });

  return { earmarkId: earmark.id, available: entry.available };
}

// ---------------------------------------------------------------------------
// Case funding view
// ---------------------------------------------------------------------------

export type CaseFundingEarmark = {
  earmarkId: number;
  code: string | null;
  status: string;
  amount: number;
  purpose: string;
  allocationId: number;
  coaCode: string;
  fundSource: string;
  officeName: string | null;
  approvedAt: Date | null;
};

/** Every earmark linked to a case, newest first (used on case screens). */
export async function earmarksForConcern(
  tx: Tx,
  concernId: number
): Promise<CaseFundingEarmark[]> {
  const rows = await tx.budgetEarmark.findMany({
    where: { concernId },
    orderBy: { id: "desc" },
    take: 20,
    include: {
      allocation: {
        include: {
          coaAccount: { select: { code: true } },
          fundSource: { select: { code: true } },
          office: { select: { name: true } },
        },
      },
    },
  });

  return rows.map((row) => ({
    earmarkId: row.id,
    code: row.code,
    status: row.status,
    amount: toMoney(row.amount),
    purpose: row.purpose,
    allocationId: row.allocationId,
    coaCode: row.allocation.coaAccount.code,
    fundSource: row.allocation.fundSource.code,
    officeName: row.allocation.office?.name ?? null,
    approvedAt: row.approvedAt,
  }));
}

export type FundingGate = {
  certified: boolean;
  total: number;
  earmarks: CaseFundingEarmark[];
  message: string;
};

/**
 * Whether the treasury has set money aside for a case. The workflow uses this
 * to decide whether a case may leave AWAITING_BUDGET.
 */
export async function fundingGateForConcern(
  tx: Tx,
  concernId: number
): Promise<FundingGate> {
  const earmarks = await earmarksForConcern(tx, concernId);
  const usable = earmarks.filter(
    (earmark) => earmark.status === "APPROVED" || earmark.status === "RELEASED"
  );
  const total = roundMoney(
    usable.reduce((sum, earmark) => sum + earmark.amount, 0)
  );

  if (usable.length === 0) {
    return {
      certified: false,
      total: 0,
      earmarks,
      message:
        "No approved earmark is set aside for this case yet. The treasurer has to approve an earmark before work can start.",
    };
  }

  return {
    certified: true,
    total,
    earmarks,
    message: `₱${total.toFixed(2)} set aside by the treasury${
      usable[0].code ? ` (${usable[0].code}${usable.length > 1 ? ` +${usable.length - 1}` : ""})` : ""
    }.`,
  };
}

// ---------------------------------------------------------------------------
// Fiscal years
// ---------------------------------------------------------------------------

export async function createFiscalYear(
  tx: Tx,
  input: { actor: Actor; year: number; name?: string | null; startsOn: string; endsOn: string }
) {
  const existing = await tx.fiscalYear.findUnique({ where: { year: input.year } });
  if (existing) {
    throw createApiError.conflict(`Fiscal year ${input.year} already exists.`);
  }

  const year = await tx.fiscalYear.create({
    data: {
      year: input.year,
      name: input.name ?? `Fiscal year ${input.year}`,
      startsOn: new Date(`${input.startsOn}T00:00:00Z`),
      endsOn: new Date(`${input.endsOn}T00:00:00Z`),
    },
    select: { id: true, year: true },
  });

  return { fiscalYearId: year.id, year: year.year };
}

export async function closeFiscalYear(
  tx: Tx,
  input: { actor: Actor; fiscalYearId: number; notes?: string | null }
) {
  const fiscalYear = await tx.fiscalYear.findUnique({
    where: { id: input.fiscalYearId },
    select: { id: true, year: true, isClosed: true },
  });
  if (!fiscalYear) throw createApiError.notFound("Fiscal year not found.");
  if (fiscalYear.isClosed) {
    throw createApiError.conflict(`Fiscal year ${fiscalYear.year} is already closed.`);
  }

  const open = await tx.budgetAllocation.count({
    where: { fiscalYearId: fiscalYear.id, status: "APPROVED" },
  });
  if (open > 0) {
    throw createApiError.conflict(
      `${open} approved allocation${open === 1 ? "" : "s"} are still open in fiscal year ${fiscalYear.year}. Close them first, then close the year.`
    );
  }

  await tx.fiscalYear.update({
    where: { id: fiscalYear.id },
    data: { isClosed: true, closedAt: new Date(), closedById: input.actor.id },
  });

  return { fiscalYearId: fiscalYear.id, year: fiscalYear.year, isClosed: true };
}
