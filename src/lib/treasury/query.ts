// Treasury read layer: registers, live balances, the dashboard and the
// funding view a case shows. No writes here, so the screens and the reports
// stage can share it.
//
// Balances are computed from the ledger in two queries (allocations, then all
// their entries) instead of one query per allocation.

import type { Prisma } from "@prisma/client";
import {
  allocationBalances,
  earmarksForConcern,
  fundingGateForConcern,
  seesWholeBudget,
  type Actor,
} from "@/lib/treasury/budget";
import { setAsideBeforeThis } from "@/lib/treasury/approval";
import {
  fundingQueueState,
  fundingQueueSummary,
  fundingShortfall,
  pendingTowardNeed,
  sortFundingQueue,
  uncommittedShortfall,
  type FundingCaseFacts,
  type FundingQueueState,
  type FundingQueueSummary,
} from "@/lib/treasury/funding-guide";
import {
  agingSummary,
  liquidationState,
  roundMoney,
  snapshotFromEntries,
  statusLabel,
  toMoney,
} from "@/lib/treasury/ledger";
import { summarizeUtilisation } from "@/lib/treasury/utilisation";

type Tx = Prisma.TransactionClient;

export type AllocationRow = {
  id: number;
  label: string;
  status: string;
  appropriation: number;
  reserved: number;
  disbursed: number;
  available: number;
  entryCount: number;
  consistent: boolean;
  coaCode: string;
  coaName: string;
  coaVerification: string;
  fundSourceCode: string;
  fundSourceName: string;
  officeId: number | null;
  officeName: string | null;
  fiscalYear: number;
  fiscalYearId: number;
  approvedAt: Date | null;
  notes: string | null;
};

function officeScope(actor: Actor): { officeId?: number } {
  if (seesWholeBudget(actor)) return {};
  return actor.officeId === null ? { officeId: -1 } : { officeId: actor.officeId };
}

export async function listAllocations(
  tx: Tx,
  input: {
    actor: Actor;
    fiscalYearId?: number | null;
    status?: string | null;
    search?: string | null;
    take?: number;
  }
): Promise<AllocationRow[]> {
  const rows = await tx.budgetAllocation.findMany({
    where: {
      ...(input.fiscalYearId ? { fiscalYearId: input.fiscalYearId } : {}),
      ...(input.status ? { status: input.status } : {}),
      ...(input.search
        ? {
            OR: [
              { label: { contains: input.search, mode: "insensitive" } },
              { coaAccount: { code: { contains: input.search } } },
              { coaAccount: { name: { contains: input.search, mode: "insensitive" } } },
            ],
          }
        : {}),
      ...officeScope(input.actor),
    },
    orderBy: [{ fiscalYearId: "desc" }, { label: "asc" }],
    take: input.take ?? 100,
    include: {
      coaAccount: { select: { code: true, name: true, verificationStatus: true } },
      fundSource: { select: { code: true, name: true } },
      office: { select: { id: true, name: true } },
      fiscalYear: { select: { id: true, year: true } },
    },
  });

  if (rows.length === 0) return [];

  const entries = (await tx.budgetLedgerEntry.findMany({
    where: { allocationId: { in: rows.map((row) => row.id) } },
    orderBy: { id: "asc" },
    select: {
      allocationId: true,
      reservedDelta: true,
      disbursedDelta: true,
      reservedAfter: true,
      disbursedAfter: true,
      availableAfter: true,
    },
  })) as Array<{
    allocationId: number;
    reservedDelta: unknown;
    disbursedDelta: unknown;
    reservedAfter: unknown;
    disbursedAfter: unknown;
    availableAfter: unknown;
  }>;

  const grouped = new Map<number, typeof entries>();
  for (const entry of entries) {
    const bucket = grouped.get(entry.allocationId);
    if (bucket) bucket.push(entry);
    else grouped.set(entry.allocationId, [entry]);
  }

  return rows.map((row) => {
    const snapshot = snapshotFromEntries(
      row.appropriation,
      grouped.get(row.id) ?? []
    );
    return {
      id: row.id,
      label: row.label,
      status: row.status,
      appropriation: snapshot.appropriated,
      reserved: snapshot.reserved,
      disbursed: snapshot.disbursed,
      available: snapshot.available,
      entryCount: snapshot.entryCount,
      consistent:
        roundMoney(snapshot.available) ===
        roundMoney(snapshot.recomputed.available),
      coaCode: row.coaAccount.code,
      coaName: row.coaAccount.name,
      coaVerification: row.coaAccount.verificationStatus,
      fundSourceCode: row.fundSource.code,
      fundSourceName: row.fundSource.name,
      officeId: row.office?.id ?? null,
      officeName: row.office?.name ?? null,
      fiscalYear: row.fiscalYear.year,
      fiscalYearId: row.fiscalYear.id,
      approvedAt: row.approvedAt,
      notes: row.notes,
    };
  });
}

export type EarmarkRow = {
  id: number;
  code: string | null;
  purpose: string;
  status: string;
  amount: number;
  allocationId: number;
  coaCode: string;
  fundSourceCode: string;
  fiscalYear: number;
  officeName: string | null;
  concernId: number | null;
  caseNumber: string | null;
  caseTitle: string | null;
  preparedAt: Date;
  approvedAt: Date | null;
  releasedAt: Date | null;
  cancelledAt: Date | null;
  cancelReason: string | null;
  committed: number;
  notes: string | null;
  // ---- what an approver has to see before deciding ----
  // Always present: they are plain joins on rows the query already loads.
  /** The allocation's own label, e.g. "MOOE 2026 — Repairs — Engineering". */
  allocationLabel: string;
  coaName: string;
  fundSourceName: string;
  preparedById: number | null;
  preparedByName: string | null;
  preparedByRole: string | null;
  approvedByName: string | null;
  caseStatus: string | null;
  caseOfficeName: string | null;
  /** The case's saved cost estimate — the figure this earmark is measured against. */
  caseEstimate: number | null;
  // Only populated when `includeApprovalContext` is set: both need a second
  // pass (the live ledger balance per allocation, and the set-aside total per
  // case), which the registers and the reports do not ask for.
  /** Available on the source allocation right now; null when not requested. */
  allocationAvailable: number | null;
  /**
   * Approved/released earmarks already set aside for the same case, EXCLUDING
   * this row — the brief is about what approving this one *adds*. Null when not
   * requested.
   */
  caseSetAside: number | null;
};

export async function listEarmarks(
  tx: Tx,
  input: {
    actor: Actor;
    allocationId?: number | null;
    concernId?: number | null;
    status?: string | null;
    take?: number;
    /**
     * Also load the live balance of each source allocation and how much is
     * already set aside per case. The approval screens need both; the register
     * and the reports do not, so they keep the cheaper query.
     */
    includeApprovalContext?: boolean;
  }
): Promise<EarmarkRow[]> {
  const rows = await tx.budgetEarmark.findMany({
    where: {
      ...(input.allocationId ? { allocationId: input.allocationId } : {}),
      ...(input.concernId ? { concernId: input.concernId } : {}),
      ...(input.status ? { status: input.status } : {}),
      allocation: officeScope(input.actor),
    },
    orderBy: { id: "desc" },
    take: input.take ?? 100,
    include: {
      allocation: {
        include: {
          coaAccount: { select: { code: true, name: true } },
          fundSource: { select: { code: true, name: true } },
          fiscalYear: { select: { year: true } },
          office: { select: { name: true } },
        },
      },
      // The case's own facts travel with the earmark: its status says whether a
      // resident is waiting on this money, and the saved estimate is the figure
      // the amount is measured against.
      concern: {
        select: {
          id: true,
          caseNumber: true,
          title: true,
          status: true,
          assignedOffice: { select: { name: true } },
          caseAssessment: { select: { totalCost: true } },
        },
      },
      preparedBy: {
        select: {
          firstName: true,
          lastName: true,
          role: { select: { key: true } },
        },
      },
      approvedBy: { select: { firstName: true, lastName: true } },
      disbursements: { select: { amount: true, status: true } },
    },
  });

  // Both passes are grouped, never one query per row.
  const balances = new Map<number, { available: number }>();
  const setAsideByConcern = new Map<number, number>();
  if (input.includeApprovalContext) {
    const allocationIds: number[] = [
      ...new Set<number>(rows.map((row) => row.allocationId)),
    ];
    const concernIds: number[] = [
      ...new Set<number>(
        rows
          .map((row) => row.concernId)
          .filter((concernId): concernId is number => concernId !== null)
      ),
    ];
    const [loadedBalances, loadedSetAside] = await Promise.all([
      allocationBalances(tx, allocationIds),
      fundedAmountsByConcern(tx, concernIds),
    ]);
    for (const [allocationId, balance] of loadedBalances) {
      balances.set(allocationId, { available: balance.available });
    }
    for (const [concernId, total] of loadedSetAside) {
      setAsideByConcern.set(concernId, total);
    }
  }

  return rows.map((row) => {
    const concernTotal =
      row.concernId === null ? 0 : (setAsideByConcern.get(row.concernId) ?? 0);

    return {
      id: row.id,
      code: row.code,
      purpose: row.purpose,
      status: row.status,
      amount: toMoney(row.amount),
      allocationId: row.allocationId,
      coaCode: row.allocation.coaAccount.code,
      fundSourceCode: row.allocation.fundSource.code,
      fiscalYear: row.allocation.fiscalYear.year,
      officeName: row.allocation.office?.name ?? null,
      concernId: row.concern?.id ?? null,
      caseNumber: row.concern?.caseNumber ?? null,
      caseTitle: row.concern?.title ?? null,
      preparedAt: row.preparedAt,
      approvedAt: row.approvedAt,
      releasedAt: row.releasedAt,
      cancelledAt: row.cancelledAt,
      cancelReason: row.cancelReason,
      committed: roundMoney(
        row.disbursements
          .filter((voucher) =>
            ["SUBMITTED", "CERTIFIED", "APPROVED", "RELEASED", "LIQUIDATED"].includes(
              voucher.status
            )
          )
          .reduce((sum, voucher) => sum + toMoney(voucher.amount), 0)
      ),
      notes: row.notes,
      allocationLabel: row.allocation.label,
      coaName: row.allocation.coaAccount.name,
      fundSourceName: row.allocation.fundSource.name,
      preparedById: row.preparedById,
      preparedByName: row.preparedBy
        ? `${row.preparedBy.firstName} ${row.preparedBy.lastName}`
        : null,
      preparedByRole: row.preparedBy?.role.key ?? null,
      approvedByName: row.approvedBy
        ? `${row.approvedBy.firstName} ${row.approvedBy.lastName}`
        : null,
      caseStatus: row.concern?.status ?? null,
      caseOfficeName: row.concern?.assignedOffice?.name ?? null,
      caseEstimate:
        row.concern?.caseAssessment?.totalCost === null ||
        row.concern?.caseAssessment?.totalCost === undefined
          ? null
          : toMoney(row.concern.caseAssessment.totalCost),
      allocationAvailable: input.includeApprovalContext
        ? (balances.get(row.allocationId)?.available ?? null)
        : null,
      caseSetAside:
        input.includeApprovalContext && row.concernId !== null
          ? setAsideBeforeThis({
              concernTotal,
              thisAmount: toMoney(row.amount),
              thisStatus: row.status,
            })
          : null,
    };
  });
}


/**
 * How many earmarks are in each status, for the register's filter tabs.
 *
 * Counted separately rather than derived from the fetched page: `listEarmarks`
 * is capped, so counting what came back would under-report the queue — and the
 * queue is exactly what a treasurer needs to be accurate about, because an
 * earmark nobody has looked at for a week is the one a case is stuck on.
 */
export async function earmarkStatusCounts(
  tx: Tx,
  input: { actor: Actor }
): Promise<Map<string, number>> {
  const rows = await tx.budgetEarmark.groupBy({
    by: ["status"],
    where: { allocation: officeScope(input.actor) },
    _count: { _all: true },
  });

  const counts = new Map<string, number>();
  for (const row of rows) {
    counts.set(row.status, row._count._all);
  }
  return counts;
}

export type DisbursementRow = {
  id: number;
  voucherNumber: string | null;
  status: string;
  statusLabel: string;
  amount: number;
  payee: string;
  payeeType: string;
  particulars: string;
  modeOfPayment: string | null;
  allocationId: number;
  coaCode: string;
  fundSourceCode: string;
  earmarkId: number | null;
  earmarkCode: string | null;
  concernId: number | null;
  caseNumber: string | null;
  preparedById: number | null;
  preparedAt: Date;
  submittedAt: Date | null;
  releasedAt: Date | null;
  liquidationDueAt: Date | null;
  liquidationStatus: string | null;
  liquidationState: string;
  approvals: Array<{
    level: number;
    decision: string;
    approverId: number;
    approverRole: string;
    remarks: string | null;
    decidedAt: Date;
  }>;
  rejectionReason: string | null;
  cancelReason: string | null;
  proofUrl: string | null;
};

export async function listDisbursements(
  tx: Tx,
  input: {
    actor: Actor;
    status?: string | null;
    allocationId?: number | null;
    earmarkId?: number | null;
    concernId?: number | null;
    search?: string | null;
    take?: number;
    now?: Date;
  }
): Promise<DisbursementRow[]> {
  const rows = await tx.disbursement.findMany({
    where: {
      ...(input.status ? { status: input.status } : {}),
      ...(input.allocationId ? { allocationId: input.allocationId } : {}),
      ...(input.earmarkId ? { earmarkId: input.earmarkId } : {}),
      ...(input.concernId ? { concernId: input.concernId } : {}),
      ...(input.search
        ? {
            OR: [
              { payee: { contains: input.search, mode: "insensitive" } },
              { particulars: { contains: input.search, mode: "insensitive" } },
              { voucherNumber: { contains: input.search, mode: "insensitive" } },
            ],
          }
        : {}),
      allocation: officeScope(input.actor),
    },
    orderBy: { id: "desc" },
    take: input.take ?? 100,
    include: {
      allocation: {
        include: {
          coaAccount: { select: { code: true } },
          fundSource: { select: { code: true } },
        },
      },
      earmark: { select: { id: true, code: true } },
      concern: { select: { id: true, caseNumber: true } },
      approvals: { orderBy: { level: "asc" } },
    },
  });

  const now = input.now ?? new Date();
  return rows.map((row) => ({
    id: row.id,
    voucherNumber: row.voucherNumber,
    status: row.status,
    statusLabel: statusLabel(row.status),
    amount: toMoney(row.amount),
    payee: row.payee,
    payeeType: row.payeeType,
    particulars: row.particulars,
    modeOfPayment: row.modeOfPayment,
    allocationId: row.allocationId,
    coaCode: row.allocation.coaAccount.code,
    fundSourceCode: row.allocation.fundSource.code,
    earmarkId: row.earmark?.id ?? null,
    earmarkCode: row.earmark?.code ?? null,
    concernId: row.concern?.id ?? null,
    caseNumber: row.concern?.caseNumber ?? null,
    preparedById: row.preparedById,
    preparedAt: row.preparedAt,
    submittedAt: row.submittedAt,
    releasedAt: row.releasedAt,
    liquidationDueAt: row.liquidationDueAt,
    liquidationStatus: row.liquidationStatus,
    liquidationState: liquidationState(
      {
        status: row.status,
        liquidationDueAt: row.liquidationDueAt,
        liquidationStatus: row.liquidationStatus,
      },
      now
    ),
    approvals: row.approvals.map((approval) => ({
      level: approval.level,
      decision: approval.decision,
      approverId: approval.approverId,
      approverRole: approval.approverRole,
      remarks: approval.remarks,
      decidedAt: approval.decidedAt,
    })),
    rejectionReason: row.rejectionReason,
    cancelReason: row.cancelReason,
    proofUrl: row.proofUrl,
  }));
}

export type TreasuryDashboard = {
  totals: {
    appropriated: number;
    reserved: number;
    disbursed: number;
    available: number;
    allocations: number;
  };
  counts: {
    allocationsAwaitingApproval: number;
    earmarksAwaitingApproval: number;
    vouchersAwaitingCertification: number;
    vouchersAwaitingApproval: number;
    vouchersAwaitingRelease: number;
    vouchersAwaitingLiquidation: number;
    unverifiedCoaAccounts: number;
    unverifiedFundSources: number;
    /** Open cases sitting in AWAITING_BUDGET without approved money covering them. */
    casesAwaitingFunding: number;
  };
  /**
   * How much money the cases are waiting on. The count above says how many
   * cases are stuck; this says what finding their money costs — the total,
   * the part already proposed, the part still to propose, and the amount per
   * case.
   */
  funding: {
    summary: FundingQueueSummary;
    /** The cases money is holding up, queue order, with the amount each needs. */
    needs: FundingNeedRow[];
  };
  aging: ReturnType<typeof agingSummary>;
  recentLedger: Array<{
    id: number;
    allocationId: number;
    entryType: string;
    entryLabel: string;
    amount: number;
    availableAfter: number;
    memo: string | null;
    createdAt: Date;
    coaCode: string;
    actorName: string | null;
  }>;
};

export async function treasuryDashboard(
  tx: Tx,
  input: { actor: Actor; fiscalYearId?: number | null; now?: Date }
): Promise<TreasuryDashboard> {
  const now = input.now ?? new Date();
  const scope = officeScope(input.actor);

  const allocations = await listAllocations(tx, {
    actor: input.actor,
    fiscalYearId: input.fiscalYearId ?? null,
    take: 500,
  });

  // The same arithmetic the treasury report's utilisation table uses, from
  // `summarizeUtilisation` — one definition of "live allocation" and of how a
  // balance is rounded, so the dashboard and the report cannot drift apart.
  const live = summarizeUtilisation(allocations).totals;
  const totals = {
    appropriated: live.appropriated,
    reserved: live.reserved,
    disbursed: live.disbursed,
    available: live.available,
    allocations: live.allocations,
  };

  const [
    allocationsAwaitingApproval,
    earmarksAwaitingApproval,
    vouchersAwaitingCertification,
    vouchersAwaitingApproval,
    vouchersAwaitingRelease,
    vouchersAwaitingLiquidation,
    unverifiedCoaAccounts,
    unverifiedFundSources,
    pendingVouchers,
    recentLedgerRows,
  ] = await Promise.all([
    tx.budgetAllocation.count({ where: { status: "DRAFT", ...scope } }),
    tx.budgetEarmark.count({ where: { status: "PROPOSED", allocation: scope } }),
    tx.disbursement.count({
      where: { status: "SUBMITTED", allocation: scope },
    }),
    tx.disbursement.count({
      where: { status: "CERTIFIED", allocation: scope },
    }),
    tx.disbursement.count({ where: { status: "APPROVED", allocation: scope } }),
    tx.disbursement.count({
      where: { status: "RELEASED", allocation: scope },
    }),
    tx.coaAccount.count({
      where: { OR: [{ verificationStatus: "UNVERIFIED" }, { verificationStatus: "DEPRECATED" }] },
    }),
    tx.fundSource.count({ where: { verificationStatus: "UNVERIFIED" } }),
    tx.disbursement.findMany({
      where: {
        status: { in: ["SUBMITTED", "CERTIFIED", "APPROVED"] },
        allocation: scope,
      },
      select: { submittedAt: true, amount: true },
      take: 500,
    }),
    tx.budgetLedgerEntry.findMany({
      where: { allocation: scope },
      orderBy: { id: "desc" },
      take: 12,
      include: {
        allocation: { include: { coaAccount: { select: { code: true } } } },
        actor: { select: { firstName: true, lastName: true } },
      },
    }),
  ]);

  // Cases a resident is waiting on that the money has not unblocked yet —
  // the queue the guided funding flow works. The count and the pesos both
  // come from the same rows the funding page lists, so the dashboard's
  // figures and the page's queue can never disagree.
  const { summary: fundingSummary, needs: fundingNeeds } =
    await fundingQueue(tx);

  return {
    totals,
    counts: {
      allocationsAwaitingApproval,
      earmarksAwaitingApproval,
      vouchersAwaitingCertification,
      vouchersAwaitingApproval,
      vouchersAwaitingRelease,
      vouchersAwaitingLiquidation,
      unverifiedCoaAccounts,
      unverifiedFundSources,
      // The same helper that totals the money, so the count and the pesos are
      // never two different readings of the queue.
      casesAwaitingFunding: fundingSummary.cases,
    },
    funding: {
      summary: fundingSummary,
      needs: fundingNeeds,
    },
    aging: agingSummary(
      pendingVouchers.map((voucher) => ({
        submittedAt: voucher.submittedAt,
        amount: voucher.amount,
      })),
      now
    ),
    recentLedger: recentLedgerRows.map((row) => ({
      id: row.id,
      allocationId: row.allocationId,
      entryType: row.entryType,
      entryLabel: statusLabel(row.entryType),
      amount: toMoney(row.amount),
      availableAfter: toMoney(row.availableAfter),
      memo: row.memo,
      createdAt: row.createdAt,
      coaCode: row.allocation.coaAccount.code,
      actorName: row.actor
        ? `${row.actor.firstName} ${row.actor.lastName}`
        : null,
    })),
  };
}

export async function ledgerRegister(
  tx: Tx,
  input: {
    actor: Actor;
    allocationId?: number | null;
    take?: number;
    paidOut?: boolean;
  }
) {
  const rows = await tx.budgetLedgerEntry.findMany({
    where: {
      ...(input.allocationId ? { allocationId: input.allocationId } : {}),
      ...(input.paidOut ? { entryType: "DISBURSEMENT_RELEASE" } : {}),
      allocation: officeScope(input.actor),
    },
    orderBy: { id: "desc" },
    take: input.take ?? 100,
    include: {
      allocation: {
        include: {
          coaAccount: { select: { code: true, name: true } },
          fundSource: { select: { code: true } },
          fiscalYear: { select: { year: true } },
        },
      },
      actor: { select: { firstName: true, lastName: true } },
    },
  });

  return rows.map((row) => ({
    id: row.id,
    allocationId: row.allocationId,
    coaCode: row.allocation.coaAccount.code,
    fundSourceCode: row.allocation.fundSource.code,
    fiscalYear: row.allocation.fiscalYear.year,
    entryType: row.entryType,
    entryLabel: statusLabel(row.entryType),
    referenceType: row.referenceType,
    referenceId: row.referenceId,
    memo: row.memo,
    amount: toMoney(row.amount),
    reservedDelta: toMoney(row.reservedDelta),
    disbursedDelta: toMoney(row.disbursedDelta),
    reservedAfter: toMoney(row.reservedAfter),
    disbursedAfter: toMoney(row.disbursedAfter),
    availableAfter: toMoney(row.availableAfter),
    createdAt: row.createdAt,
    actorName: row.actor ? `${row.actor.firstName} ${row.actor.lastName}` : null,
  }));
}

/**
 * One open case as the funding desk sees it: the facts the funding guide runs
 * on, plus where the case is (`state`) and what it costs (`shortfall` is the
 * need, `uncommitted` is what a new proposal must cover).
 */
/** One saved materials line, as the funding cards show it. */
export type FundingMaterialRow = {
  name: string;
  quantity: number | null;
  unit: string | null;
  unitPrice: number | null;
  amount: number;
};

/** The treasurer's current "do not fund" decision, if any. */
export type FundingBudgetDecision = {
  reason: string;
  decidedByName: string | null;
  decidedAt: Date;
};

export type FundingCaseRow = FundingCaseFacts & {
  officeName: string | null;
  /** What the case is about: the resident's own words. */
  description: string;
  /** The estimate broken down; null until the assessment saves one. */
  breakdown: {
    labor: number;
    materials: number;
    equipment: number;
    other: number;
    total: number;
  } | null;
  /** The materials list behind the materials figure. */
  materials: FundingMaterialRow[];
  /** The treasurer's "do not fund" decision, if one is current. */
  budgetDecision: FundingBudgetDecision | null;
  waitingForBudget: boolean;
  awaitingBudgetAt: Date | null;
  submittedAt: Date;
  state: FundingQueueState;
  shortfall: number;
  uncommitted: number;
};

/**
 * The treasury's own view of the cases that may need money: the case numbers,
 * estimates and set-aside figures the guided funding flow runs on. The
 * treasurer cannot open the case pages themselves (`case.view.office` scopes
 * those to the case's office), so this — not a case screen — is where the
 * money side of "what does this case need?" is answered.
 *
 * Rows come back for every open case; callers filter on `state`
 * (`fundingQueueState`) — NEEDS_MONEY is the queue the funding form is for,
 * PROPOSED_PENDING is waiting on the Captain, NEEDS_ESTIMATE is waiting on
 * the case office, COVERED is waiting on nobody's money.
 */
export async function listCasesAwaitingFunding(
  tx: Tx
): Promise<FundingCaseRow[]> {
  const concerns = await tx.concern.findMany({
    where: { status: { notIn: ["RESOLVED", "CLOSED"] } },
    orderBy: { submittedAt: "asc" },
    take: 200,
    select: {
      id: true,
      caseNumber: true,
      title: true,
      description: true,
      status: true,
      submittedAt: true,
      awaitingBudgetAt: true,
      assignedOffice: { select: { id: true, name: true } },
      caseAssessment: {
        select: {
          laborCost: true,
          materialsCost: true,
          equipmentCost: true,
          otherCost: true,
          totalCost: true,
          materials: {
            orderBy: { sortOrder: "asc" },
            select: {
              name: true,
              quantity: true,
              unit: true,
              unitPrice: true,
              amount: true,
            },
          },
        },
      },
      budgetDecision: {
        select: {
          reason: true,
          decidedAt: true,
          decidedBy: { select: { firstName: true, lastName: true } },
        },
      },
    },
  });
  if (concerns.length === 0) return [];

  const ids = concerns.map((concern) => concern.id);
  const [setAsideMap, proposedRows] = await Promise.all([
    fundedAmountsByConcern(tx, ids),
    tx.budgetEarmark.groupBy({
      by: ["concernId"],
      where: { concernId: { in: ids }, status: "PROPOSED" },
      _sum: { amount: true },
    }),
  ]);
  const proposedMap = new Map<number, number>();
  for (const row of proposedRows) {
    if (row.concernId === null) continue;
    proposedMap.set(row.concernId, toMoney(row._sum.amount ?? 0));
  }

  return concerns.map((concern) => {
    const facts: FundingCaseFacts = {
      concernId: concern.id,
      caseNumber: concern.caseNumber,
      title: concern.title,
      status: concern.status,
      officeId: concern.assignedOffice?.id ?? null,
      estimate:
        concern.caseAssessment === null
          ? null
          : toMoney(concern.caseAssessment.totalCost ?? 0),
      setAside: setAsideMap.get(concern.id) ?? 0,
      proposed: proposedMap.get(concern.id) ?? 0,
    };
    const assessment = concern.caseAssessment;
    return {
      ...facts,
      officeName: concern.assignedOffice?.name ?? null,
      description: concern.description,
      breakdown:
        assessment === null
          ? null
          : {
              labor: toMoney(assessment.laborCost ?? 0),
              materials: toMoney(assessment.materialsCost ?? 0),
              equipment: toMoney(assessment.equipmentCost ?? 0),
              other: toMoney(assessment.otherCost ?? 0),
              total: toMoney(assessment.totalCost ?? 0),
            },
      materials: (assessment?.materials ?? []).map(
        (line: {
          name: string;
          quantity: unknown;
          unit: string | null;
          unitPrice: unknown;
          amount: unknown;
        }) => ({
          name: line.name,
          quantity: line.quantity === null ? null : Number(line.quantity),
          unit: line.unit,
          unitPrice:
            line.unitPrice === null ? null : Number(line.unitPrice),
          amount: Number(line.amount),
        })
      ),
      budgetDecision:
        concern.budgetDecision === null
          ? null
          : {
              reason: concern.budgetDecision.reason,
              decidedByName:
                concern.budgetDecision.decidedBy === null
                  ? null
                  : `${concern.budgetDecision.decidedBy.firstName} ${concern.budgetDecision.decidedBy.lastName}`.trim(),
              decidedAt: concern.budgetDecision.decidedAt,
            },
      waitingForBudget: concern.status === "AWAITING_BUDGET",
      awaitingBudgetAt: concern.awaitingBudgetAt,
      submittedAt: concern.submittedAt,
      state: fundingQueueState(facts),
      shortfall: fundingShortfall(facts),
      uncommitted: uncommittedShortfall(facts),
    };
  });
}

/**
 * One case's need as money, for the screens that have to say the amount rather
 * than the case count: what the case costs, how much of that is already
 * waiting on the Captain, and what a new proposal must still find.
 */
export type FundingNeedRow = {
  concernId: number;
  caseNumber: string;
  title: string;
  officeName: string | null;
  state: FundingQueueState;
  /** The saved cost estimate; null when the case has none yet. */
  estimate: number | null;
  setAside: number;
  /** Pending proposals, capped at what the case is missing. */
  pending: number;
  /** What the case still needs beyond the set-aside. */
  need: number;
  /** The part of the need no proposal has claimed yet. */
  toPropose: number;
  awaitingBudgetAt: Date | null;
  submittedAt: Date;
};

/** How many of the queue's cases the dashboard lists before "open the desk". */
export const FUNDING_NEED_ROWS = 12;

/** The funding queue as one answer: the cases, and what they cost. */
export type FundingQueue = {
  summary: FundingQueueSummary;
  /** Every open case, in queue order (AWAITING_BUDGET first, longest wait first). */
  rows: FundingCaseRow[];
  /**
   * The cases money is holding up, queue order, with the amount each one
   * needs — capped at {@link FUNDING_NEED_ROWS}, since the summary carries
   * the total and the funding page carries the rest.
   */
  needs: FundingNeedRow[];
};

/**
 * The funding queue and its money in one read.
 *
 * The dashboard's headline ("₱45,000 still to find across 3 cases") and the
 * funding page's cards are the same answer at two altitudes, so both are built
 * from these rows: `summary` for the total, `rows` for the queue, `needs` for
 * the per-case amounts. Computing the total anywhere else is how the count on
 * the dashboard and the money on the page drift apart.
 */
export async function fundingQueue(tx: Tx): Promise<FundingQueue> {
  const rows = sortFundingQueue(await listCasesAwaitingFunding(tx));
  const needs = rows
    .filter(
      (row) =>
        row.waitingForBudget &&
        (row.state === "NEEDS_MONEY" || row.state === "PROPOSED_PENDING")
    )
    .slice(0, FUNDING_NEED_ROWS)
    .map((row) => {
      const need = row.shortfall;
      const pending = pendingTowardNeed(row);
      return {
        concernId: row.concernId,
        caseNumber: row.caseNumber,
        title: row.title,
        officeName: row.officeName,
        state: row.state,
        estimate: row.estimate,
        setAside: row.setAside,
        pending,
        need,
        toPropose: roundMoney(need - pending),
        awaitingBudgetAt: row.awaitingBudgetAt,
        submittedAt: row.submittedAt,
      };
    });

  return { summary: fundingQueueSummary(rows), rows, needs };
}

/**
 * How much the treasury has set aside per case, for the list screens that show
 * which flow step each case is on. One grouped query instead of one per row.
 */
export async function fundedAmountsByConcern(
  tx: Tx,
  concernIds: number[]
): Promise<Map<number, number>> {
  const totals = new Map<number, number>();
  if (concernIds.length === 0) return totals;

  const rows = await tx.budgetEarmark.groupBy({
    by: ["concernId"],
    where: {
      concernId: { in: concernIds },
      status: { in: ["APPROVED", "RELEASED"] },
    },
    _sum: { amount: true },
  });

  for (const row of rows) {
    if (row.concernId === null) continue;
    totals.set(row.concernId, toMoney(row._sum.amount ?? 0));
  }
  return totals;
}

/**
 * Everything the treasury knows about one case: the earmarks set aside for it,
 * the vouchers raised against it and whether the funds are certified. The case
 * screens and the funding gate both read this.
 */
export async function caseFundingView(tx: Tx, concernId: number) {
  const [earmarks, decision, voucherRows, gate] = await Promise.all([
    earmarksForConcern(tx, concernId),
    tx.budgetDecision.findUnique({
      where: { concernId },
      select: {
        reason: true,
        decidedAt: true,
        decidedBy: { select: { firstName: true, lastName: true } },
      },
    }),
    tx.disbursement.findMany({
      where: { concernId },
      orderBy: { id: "desc" },
      take: 50,
      include: {
        allocation: {
          include: {
            coaAccount: { select: { code: true } },
            fundSource: { select: { code: true } },
          },
        },
        earmark: { select: { id: true, code: true } },
        approvals: { orderBy: { level: "asc" } },
      },
    }),
    fundingGateForConcern(tx, concernId),
  ]);

  const disbursements = voucherRows.map((row) => ({
    id: row.id,
    voucherNumber: row.voucherNumber,
    status: row.status,
    statusLabel: statusLabel(row.status),
    amount: toMoney(row.amount),
    payee: row.payee,
    payeeType: row.payeeType,
    particulars: row.particulars,
    coaCode: row.allocation.coaAccount.code,
    fundSourceCode: row.allocation.fundSource.code,
    earmarkCode: row.earmark?.code ?? null,
    preparedAt: row.preparedAt,
    submittedAt: row.submittedAt,
    releasedAt: row.releasedAt,
    liquidationDueAt: row.liquidationDueAt,
    liquidationState: liquidationState(
      {
        status: row.status,
        liquidationDueAt: row.liquidationDueAt,
        liquidationStatus: row.liquidationStatus,
      },
      new Date()
    ),
    approvals: row.approvals.map((approval) => ({
      level: approval.level,
      decision: approval.decision,
      approverRole: approval.approverRole,
      remarks: approval.remarks,
      decidedAt: approval.decidedAt,
    })),
    rejectionReason: row.rejectionReason,
    cancelReason: row.cancelReason,
  }));

  const paid = roundMoney(
    disbursements
      .filter(
        (voucher) =>
          voucher.status === "RELEASED" || voucher.status === "LIQUIDATED"
      )
      .reduce((sum, voucher) => sum + voucher.amount, 0)
  );
  const committed = roundMoney(
    disbursements
      .filter((voucher) =>
        ["SUBMITTED", "CERTIFIED", "APPROVED"].includes(voucher.status)
      )
      .reduce((sum, voucher) => sum + voucher.amount, 0)
  );

  return {
    earmarks,
    disbursements,
    gate,
    paid,
    committed,
    budgetDecision:
      decision === null
        ? null
        : {
            reason: decision.reason,
            decidedAt: decision.decidedAt.toISOString(),
            decidedByName:
              decision.decidedBy === null
                ? null
                : `${decision.decidedBy.firstName} ${decision.decidedBy.lastName}`.trim(),
          },
  };
}
