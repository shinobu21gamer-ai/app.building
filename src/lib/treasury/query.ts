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
  input: { actor: Actor; allocationId?: number | null; take?: number }
) {
  const rows = await tx.budgetLedgerEntry.findMany({
    where: {
      ...(input.allocationId ? { allocationId: input.allocationId } : {}),
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
  const [earmarks, voucherRows, gate] = await Promise.all([
    earmarksForConcern(tx, concernId),
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

  return { earmarks, disbursements, gate, paid, committed };
}
