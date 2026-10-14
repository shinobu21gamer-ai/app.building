import type { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import {
  FUNDING_NEED_ROWS,
  fundingQueue,
  treasuryDashboard,
} from "@/lib/treasury/query";
import type { Actor } from "@/lib/treasury/budget";

// The treasury read layer pulls in the audit module, which builds a
// PrismaClient at import time. Nothing here touches a database — every read
// goes through the in-memory `tx` below — so the singleton is stubbed out.
vi.mock("@/lib/db", () => ({ db: {} }));

// ---------------------------------------------------------------------------
// A tiny in-memory `tx` covering only the reads the funding queue and the
// dashboard make, so "how much money do the cases need?" can be checked end
// to end — real `fundingQueue`, real `treasuryDashboard`, no database.
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

const treasurer: Actor = { id: 10, roleKey: "TREASURER", officeId: null };

/** A case row shaped like the `select` in `listCasesAwaitingFunding`. */
function concern(seed: {
  id: number;
  status: string;
  caseNumber: string;
  submittedAt: Date;
  awaitingBudgetAt?: Date | null;
  /** `undefined` = no assessment row at all; `null` = assessed, no cost yet. */
  totalCost?: number | null;
  office?: { id: number; name: string } | null;
}): Row {
  return {
    id: seed.id,
    caseNumber: seed.caseNumber,
    title: `Case ${seed.id}`,
    status: seed.status,
    submittedAt: seed.submittedAt,
    awaitingBudgetAt: seed.awaitingBudgetAt ?? null,
    assignedOffice: seed.office ?? null,
    caseAssessment:
      seed.totalCost === undefined
        ? null
        : { totalCost: seed.totalCost },
  };
}

function earmark(seed: {
  concernId: number;
  amount: number;
  status: string;
}): Row {
  return { ...seed };
}

function makeTx(concerns: Row[], earmarks: Row[]) {
  function statusesOf(status: unknown): string[] {
    if (typeof status === "string") return [status];
    const list = (status as Row | undefined)?.in;
    return Array.isArray(list) ? (list as string[]) : [];
  }

  const tx = {
    concern: {
      findMany: async () => concerns,
    },
    budgetEarmark: {
      count: async () => 0,
      // Both grouped reads: set-aside money (APPROVED + RELEASED) and the
      // proposals still waiting on the Captain (PROPOSED).
      groupBy: async ({ where }: { where: Row }) => {
        const wanted = statusesOf(where.status);
        const ids = (where.concernId as Row).in as number[];
        const totals = new Map<number, number>();
        for (const row of earmarks) {
          if (!wanted.includes(String(row.status))) continue;
          if (!ids.includes(Number(row.concernId))) continue;
          const id = Number(row.concernId);
          totals.set(id, (totals.get(id) ?? 0) + Number(row.amount));
        }
        return [...totals.entries()].map(([concernId, amount]) => ({
          concernId,
          _sum: { amount },
        }));
      },
    },
    budgetAllocation: {
      findMany: async () => [],
      count: async () => 0,
    },
    budgetLedgerEntry: { findMany: async () => [] },
    disbursement: {
      findMany: async () => [],
      count: async () => 0,
    },
    coaAccount: { count: async () => 0 },
    fundSource: { count: async () => 0 },
  };

  return tx as unknown as Prisma.TransactionClient;
}

/**
 * A queue that mixes every funding state: two cases short of money, one whose
 * proposal already covers it, one assessed with no cost yet, one still being
 * assessed, and one whose money is fully set aside.
 */
function seededQueue() {
  const october = (day: number) => new Date(2026, 9, day);
  const works = { id: 5, name: "Works and Infrastructure" };

  const concerns = [
    // Seeded out of queue order on purpose: the queue has to reorder them.
    concern({
      id: 2,
      caseNumber: "BR-20261012-0002",
      status: "AWAITING_BUDGET",
      submittedAt: october(11),
      awaitingBudgetAt: october(12),
      totalCost: 40_000,
      office: works,
    }),
    concern({
      id: 4,
      caseNumber: "BR-20261005-0004",
      status: "UNDER_ASSESSMENT",
      submittedAt: october(5),
      totalCost: null,
      office: works,
    }),
    concern({
      id: 1,
      caseNumber: "BR-20261008-0001",
      status: "AWAITING_BUDGET",
      submittedAt: october(8),
      awaitingBudgetAt: october(10),
      totalCost: 18_500,
      office: works,
    }),
    concern({
      id: 3,
      caseNumber: "BR-20261009-0003",
      status: "AWAITING_BUDGET",
      submittedAt: october(9),
      awaitingBudgetAt: october(9),
      totalCost: 25_000,
    }),
    concern({
      id: 5,
      caseNumber: "BR-20261007-0005",
      status: "AWAITING_BUDGET",
      submittedAt: october(7),
      // In the money stage but never assessed: the need cannot be known. No
      // assessment row at all — see the ₱0 test below for the other case.
      office: works,
    }),
    concern({
      id: 7,
      caseNumber: "BR-20261003-0007",
      status: "AWAITING_BUDGET",
      submittedAt: october(3),
      awaitingBudgetAt: october(4),
      // Assessed, and the assessment says the work costs nothing.
      totalCost: null,
      office: works,
    }),
    concern({
      id: 6,
      caseNumber: "BR-20261001-0006",
      status: "IN_PROGRESS",
      submittedAt: october(1),
      awaitingBudgetAt: october(2),
      totalCost: 12_000,
      office: works,
    }),
  ];

  const earmarks = [
    earmark({ concernId: 2, amount: 10_000, status: "APPROVED" }),
    earmark({ concernId: 3, amount: 25_000, status: "PROPOSED" }),
    earmark({ concernId: 6, amount: 12_000, status: "RELEASED" }),
    // A cancelled earmark is not money set aside.
    earmark({ concernId: 1, amount: 5_000, status: "CANCELLED" }),
  ];

  return makeTx(concerns, earmarks);
}

describe("fundingQueue", () => {
  it("states what the cases need, split into proposed and still-to-propose", async () => {
    const queue = await fundingQueue(seededQueue());

    // 18,500 (case 1) + 30,000 (case 2, after its 10,000 set-aside) +
    // 25,000 (case 3, fully proposed).
    expect(queue.summary).toEqual({
      cases: 3,
      need: 73_500,
      pending: 25_000,
      toPropose: 48_500,
      unestimated: 1,
    });
    // The two halves of the need always add back up to it.
    expect(queue.summary.pending + queue.summary.toPropose).toBe(
      queue.summary.need
    );
  });

  it("gives the amount per case, in queue order", async () => {
    const queue = await fundingQueue(seededQueue());

    expect(queue.needs.map((row) => row.caseNumber)).toEqual([
      // AWAITING_BUDGET first, longest wait first.
      "BR-20261009-0003",
      "BR-20261008-0001",
      "BR-20261012-0002",
    ]);
    expect(queue.needs.map((row) => row.need)).toEqual([
      25_000, 18_500, 30_000,
    ]);
    expect(queue.needs.map((row) => row.toPropose)).toEqual([
      0, 18_500, 30_000,
    ]);
    // Case 3's proposal is waiting on the Captain; the others have none.
    expect(queue.needs.map((row) => row.pending)).toEqual([25_000, 0, 0]);
  });

  it("keeps a covered or unassessed case out of the money list", async () => {
    const queue = await fundingQueue(seededQueue());
    const listed = queue.needs.map((row) => row.concernId);

    expect(listed).not.toContain(4); // still being assessed
    expect(listed).not.toContain(5); // in the money stage, no estimate
    expect(listed).not.toContain(6); // fully set aside, work has started
    expect(listed).not.toContain(7); // assessed at ₱0: nothing to fund
  });

  it("counts a case with no estimate separately from one assessed at ₱0", async () => {
    const queue = await fundingQueue(seededQueue());

    // Case 5 was never assessed, so what it needs is unknown; case 7 was
    // assessed and the assessment says it costs nothing. Only the first is a
    // gap in the figures — reporting the second as "unknown" would hide a
    // finished assessment behind a warning.
    expect(queue.summary.unestimated).toBe(1);
    expect(queue.summary.cases).toBe(3);
  });

  it("sorts the whole queue: waiting on money first, then longest wait", async () => {
    const queue = await fundingQueue(seededQueue());

    expect(queue.rows.slice(0, 5).map((row) => row.concernId)).toEqual([
      7, 5, 3, 1, 2,
    ]);
    expect(queue.rows.slice(5).every((row) => !row.waitingForBudget)).toBe(true);
  });

  it("lists at most FUNDING_NEED_ROWS cases but totals every one", async () => {
    const october = (day: number) => new Date(2026, 9, day);
    const many = Array.from({ length: FUNDING_NEED_ROWS + 2 }, (_, index) =>
      concern({
        id: index + 1,
        caseNumber: `BR-20261001-${index + 1}`,
        status: "AWAITING_BUDGET",
        submittedAt: october(1),
        awaitingBudgetAt: october(2),
        totalCost: 1_000,
      })
    );
    const queue = await fundingQueue(makeTx(many, []));

    expect(queue.needs).toHaveLength(FUNDING_NEED_ROWS);
    expect(queue.summary.cases).toBe(FUNDING_NEED_ROWS + 2);
    expect(queue.summary.need).toBe((FUNDING_NEED_ROWS + 2) * 1_000);
  });

  it("reads an empty treasury as no need rather than a missing figure", async () => {
    const queue = await fundingQueue(makeTx([], []));

    expect(queue.summary).toEqual({
      cases: 0,
      need: 0,
      pending: 0,
      toPropose: 0,
      unestimated: 0,
    });
    expect(queue.needs).toEqual([]);
  });
});

describe("treasuryDashboard funding figures", () => {
  it("carries the money the cases need alongside the case count", async () => {
    const dashboard = await treasuryDashboard(seededQueue(), {
      actor: treasurer,
      now: new Date(2026, 9, 14),
    });

    expect(dashboard.funding.summary.need).toBe(73_500);
    expect(dashboard.funding.summary.pending).toBe(25_000);
    expect(dashboard.funding.summary.toPropose).toBe(48_500);
    expect(dashboard.funding.needs).toHaveLength(3);
  });

  it("counts the same cases the money is totalled from", async () => {
    const dashboard = await treasuryDashboard(seededQueue(), {
      actor: treasurer,
      now: new Date(2026, 9, 14),
    });

    // The queue count and the money come from one helper, so the number on the
    // dashboard cannot describe a different set of cases than the pesos do.
    expect(dashboard.counts.casesAwaitingFunding).toBe(
      dashboard.funding.summary.cases
    );
    expect(dashboard.counts.casesAwaitingFunding).toBe(3);
  });
});
