import { describe, expect, it } from "vitest";
import {
  compareFundingQueue,
  coversInTotal,
  fundingMoneyTotals,
  fundingQueueState,
  fundingQueueSummary,
  fundingShortfall,
  pendingTowardNeed,
  rankFundingOptions,
  sortFundingQueue,
  uncommittedShortfall,
  type FundingAllocationOption,
  type FundingCaseFacts,
  type FundingQueueRow,
} from "./funding-guide";

function option(
  overrides: Partial<FundingAllocationOption> & { allocationId: number }
): FundingAllocationOption {
  return {
    label: `Allocation ${overrides.allocationId}`,
    coaCode: "5-02-13-030",
    coaName: "Repair and Maintenance",
    fundSourceCode: "GF",
    fundSourceName: "General Fund",
    fiscalYear: 2026,
    officeId: null,
    available: 100_000,
    ...overrides,
  };
}

function facts(
  overrides: Partial<FundingCaseFacts> = {}
): FundingCaseFacts {
  return {
    concernId: 1,
    caseNumber: "BR-20261014-0001",
    title: "Deep potholes on Purok 3 main road",
    status: "AWAITING_BUDGET",
    officeId: 5,
    estimate: 18_500,
    setAside: 0,
    proposed: 0,
    ...overrides,
  };
}

describe("fundingShortfall", () => {
  it("is the estimate minus what is set aside", () => {
    expect(fundingShortfall({ estimate: 18_500, setAside: 5_000 })).toBe(
      13_500
    );
  });

  it("never goes negative when the set-aside exceeds the estimate", () => {
    expect(fundingShortfall({ estimate: 10_000, setAside: 12_000 })).toBe(0);
  });

  it("is zero while there is no estimate to fund", () => {
    expect(fundingShortfall({ estimate: null, setAside: 0 })).toBe(0);
  });

  it("rounds to whole centavos", () => {
    expect(fundingShortfall({ estimate: 100.005, setAside: 0.004 })).toBe(100);
  });
});

describe("uncommittedShortfall", () => {
  it("excludes money already waiting on the Captain", () => {
    expect(
      uncommittedShortfall(facts({ estimate: 20_000, proposed: 8_000 }))
    ).toBe(12_000);
  });

  it("never counts the same pending proposal twice", () => {
    expect(
      uncommittedShortfall(facts({ estimate: 20_000, setAside: 3_000, proposed: 20_000 }))
    ).toBe(0);
  });

  it("is zero without an estimate", () => {
    expect(uncommittedShortfall(facts({ estimate: null }))).toBe(0);
  });
});

describe("fundingQueueState", () => {
  it("needs an estimate before anything can be funded", () => {
    expect(fundingQueueState(facts({ estimate: null }))).toBe("NEEDS_ESTIMATE");
  });

  it("a saved zero estimate is covered, not missing", () => {
    expect(fundingQueueState(facts({ estimate: 0 }))).toBe("COVERED");
  });

  it("is covered once the set-aside reaches the estimate", () => {
    expect(
      fundingQueueState(facts({ estimate: 18_500, setAside: 18_500 }))
    ).toBe("COVERED");
  });

  it("is pending when a proposal already covers the rest", () => {
    expect(
      fundingQueueState(facts({ estimate: 18_500, proposed: 18_500 }))
    ).toBe("PROPOSED_PENDING");
  });

  it("still needs money when set-aside and proposals leave a gap", () => {
    expect(
      fundingQueueState(facts({ estimate: 18_500, setAside: 2_000, proposed: 5_000 }))
    ).toBe("NEEDS_MONEY");
  });

  it("is pending only when the pending money actually covers the estimate", () => {
    expect(fundingQueueState(facts({ estimate: 18_500, proposed: 4_000 }))).toBe(
      "NEEDS_MONEY"
    );
  });
});

describe("rankFundingOptions", () => {
  const need = { shortfall: 18_500, caseOfficeId: 5 };

  it("recommends the case office's own budget first", () => {
    const ranked = rankFundingOptions({
      ...need,
      allocations: [
        option({ allocationId: 1, officeId: null }),
        option({ allocationId: 2, officeId: 5 }),
        option({ allocationId: 3, officeId: 9 }),
      ],
    });
    expect(ranked[0].option.allocationId).toBe(2);
    expect(ranked[0].scope).toBe("CASE_OFFICE");
    expect(ranked[0].recommended).toBe(true);
    expect(ranked.filter((item) => item.recommended)).toHaveLength(1);
  });

  it("barangay-wide comes before another office's money", () => {
    const ranked = rankFundingOptions({
      ...need,
      allocations: [
        option({ allocationId: 1, officeId: 9 }),
        option({ allocationId: 2, officeId: null }),
      ],
    });
    expect(ranked.map((item) => item.option.allocationId)).toEqual([2, 1]);
    expect(ranked[0].scope).toBe("BARANGAY_WIDE");
    expect(ranked[1].scope).toBe("OTHER_OFFICE");
  });

  it("what covers the need outranks what does not, whatever the scope", () => {
    const ranked = rankFundingOptions({
      ...need,
      allocations: [
        option({ allocationId: 1, officeId: 5, available: 10_000 }),
        option({ allocationId: 2, officeId: null, available: 90_000 }),
      ],
    });
    expect(ranked.map((item) => item.option.allocationId)).toEqual([2, 1]);
    expect(ranked[0].covers).toBe(true);
    expect(ranked[1].covers).toBe(false);
    expect(ranked[1].recommended).toBe(false);
  });

  it("prefers the budget with the most headroom between equals", () => {
    const ranked = rankFundingOptions({
      ...need,
      allocations: [
        option({ allocationId: 1, available: 40_000 }),
        option({ allocationId: 2, available: 200_000 }),
      ],
    });
    expect(ranked.map((item) => item.option.allocationId)).toEqual([2, 1]);
  });

  it("states what remains on the budget after the reservation", () => {
    const ranked = rankFundingOptions({
      ...need,
      allocations: [option({ allocationId: 1, available: 50_000 })],
    });
    expect(ranked[0].remainingAfter).toBe(31_500);
  });

  it("keeps the unchanged figure when the budget cannot cover it", () => {
    const ranked = rankFundingOptions({
      ...need,
      allocations: [option({ allocationId: 1, available: 10_000 })],
    });
    expect(ranked[0].remainingAfter).toBe(10_000);
  });

  it("covers within the half-centavo tolerance", () => {
    const ranked = rankFundingOptions({
      ...need,
      allocations: [option({ allocationId: 1, available: 18_499.996 })],
    });
    expect(ranked[0].covers).toBe(true);
    expect(ranked[0].remainingAfter).toBe(0);
  });

  it("recommends nothing when no single budget covers the need", () => {
    const ranked = rankFundingOptions({
      ...need,
      allocations: [
        option({ allocationId: 1, available: 9_000 }),
        option({ allocationId: 2, available: 10_000 }),
      ],
    });
    expect(ranked.every((item) => !item.recommended)).toBe(true);
    expect(ranked.every((item) => !item.covers)).toBe(true);
  });

  it("ranks the largest partial budget first when nothing covers", () => {
    const ranked = rankFundingOptions({
      ...need,
      allocations: [
        option({ allocationId: 1, available: 9_000 }),
        option({ allocationId: 2, available: 17_000 }),
      ],
    });
    expect(ranked[0].option.allocationId).toBe(2);
  });
});

describe("coversInTotal", () => {
  it("is true when the pooled budgets could cover the need by splitting", () => {
    expect(
      coversInTotal({
        shortfall: 18_500,
        allocations: [
          option({ allocationId: 1, available: 10_000 }),
          option({ allocationId: 2, available: 9_000 }),
        ],
      })
    ).toBe(true);
  });

  it("is false when the money itself is finished", () => {
    expect(
      coversInTotal({
        shortfall: 18_500,
        allocations: [option({ allocationId: 1, available: 5_000 })],
      })
    ).toBe(false);
  });

  it("tolerates rounding on an exact pooled match", () => {
    expect(
      coversInTotal({
        shortfall: 18_500,
        allocations: [
          option({ allocationId: 1, available: 9_250 }),
          option({ allocationId: 2, available: 9_250.004 }),
        ],
      })
    ).toBe(true);
  });

  it("is true for a need of zero", () => {
    expect(coversInTotal({ shortfall: 0, allocations: [] })).toBe(true);
  });
});

describe("compareFundingQueue", () => {
  const day = (offset: number) => new Date(2026, 9, 12 + offset);

  it("puts a case waiting in the money stage ahead of one still being assessed", () => {
    expect(
      compareFundingQueue(
        { waitingForBudget: true, waitingSince: day(2) },
        { waitingForBudget: false, waitingSince: day(0) }
      )
    ).toBeLessThan(0);
  });

  it("breaks ties by the longest wait", () => {
    expect(
      compareFundingQueue(
        { waitingForBudget: true, waitingSince: day(0) },
        { waitingForBudget: true, waitingSince: day(3) }
      )
    ).toBeLessThan(0);
  });
});

// A queue row derived from facts, so the state under test is the one the
// funding guide itself assigns rather than one typed in by hand.
function queueRow(
  overrides: Partial<FundingCaseFacts> & { waitingForBudget?: boolean } = {}
): FundingQueueRow {
  const { waitingForBudget = true, ...factsOverrides } = overrides;
  const caseFacts = facts(factsOverrides);
  return {
    estimate: caseFacts.estimate,
    setAside: caseFacts.setAside,
    proposed: caseFacts.proposed,
    waitingForBudget,
    state: fundingQueueState(caseFacts),
  };
}

describe("pendingTowardNeed", () => {
  it("is the proposed money when it does not yet cover the need", () => {
    expect(
      pendingTowardNeed({ estimate: 20_000, setAside: 0, proposed: 5_000 })
    ).toBe(5_000);
  });

  it("stops at what the case is missing, so an over-proposal cannot inflate it", () => {
    expect(
      pendingTowardNeed({ estimate: 10_000, setAside: 2_000, proposed: 25_000 })
    ).toBe(8_000);
  });

  it("is zero while nothing is proposed or nothing is needed", () => {
    expect(pendingTowardNeed({ estimate: 10_000, setAside: 0, proposed: 0 })).toBe(0);
    expect(
      pendingTowardNeed({ estimate: 10_000, setAside: 10_000, proposed: 4_000 })
    ).toBe(0);
  });

  it("is zero without an estimate to measure against", () => {
    expect(
      pendingTowardNeed({ estimate: null, setAside: 0, proposed: 5_000 })
    ).toBe(0);
  });
});

describe("fundingMoneyTotals", () => {
  it("adds the need up and splits it into proposed and still-to-propose", () => {
    const totals = fundingMoneyTotals([
      { estimate: 18_500, setAside: 0, proposed: 0 },
      { estimate: 40_000, setAside: 10_000, proposed: 0 },
      { estimate: 25_000, setAside: 0, proposed: 25_000 },
    ]);

    expect(totals).toEqual({
      cases: 3,
      need: 73_500,
      pending: 25_000,
      toPropose: 48_500,
    });
    expect(totals.pending + totals.toPropose).toBe(totals.need);
  });

  it("reads no cases as no money", () => {
    expect(fundingMoneyTotals([])).toEqual({
      cases: 0,
      need: 0,
      pending: 0,
      toPropose: 0,
    });
  });
});

describe("fundingQueueSummary", () => {
  it("totals only the cases money is holding up", () => {
    const summary = fundingQueueSummary([
      queueRow({ concernId: 1, estimate: 18_500 }),
      queueRow({ concernId: 2, estimate: 40_000, setAside: 10_000 }),
      queueRow({ concernId: 3, estimate: 25_000, proposed: 25_000 }),
      // Fully set aside: waiting on its office, not on money.
      queueRow({ concernId: 4, estimate: 12_000, setAside: 12_000 }),
      // Not in AWAITING_BUDGET yet, so not waiting on money.
      queueRow({ concernId: 5, estimate: 9_000, waitingForBudget: false }),
    ]);

    expect(summary).toEqual({
      cases: 3,
      need: 73_500,
      pending: 25_000,
      toPropose: 48_500,
      unestimated: 0,
    });
  });

  it("counts an unestimated case instead of pricing it at zero", () => {
    const summary = fundingQueueSummary([
      queueRow({ concernId: 1, estimate: null }),
      queueRow({ concernId: 2, estimate: 18_500 }),
    ]);

    // Saying "₱18,500 needed" alone would hide a resident waiting on a case
    // whose cost nobody has worked out yet.
    expect(summary.unestimated).toBe(1);
    expect(summary.cases).toBe(1);
    expect(summary.need).toBe(18_500);
  });

  it("never counts the same pending proposal twice", () => {
    const summary = fundingQueueSummary([
      queueRow({ concernId: 1, estimate: 10_000, setAside: 2_000, proposed: 25_000 }),
    ]);

    expect(summary.need).toBe(8_000);
    expect(summary.pending).toBe(8_000);
    expect(summary.toPropose).toBe(0);
  });

  it("reads an empty queue as nothing needed", () => {
    expect(fundingQueueSummary([])).toEqual({
      cases: 0,
      need: 0,
      pending: 0,
      toPropose: 0,
      unestimated: 0,
    });
  });
});

describe("sortFundingQueue", () => {
  const row = (
    concernId: number,
    submittedAt: Date,
    awaitingBudgetAt: Date | null
  ) => ({ concernId, submittedAt, awaitingBudgetAt, waitingForBudget: awaitingBudgetAt !== null });

  it("puts the money stage first, then the longest wait, without mutating the input", () => {
    const input = [
      row(1, new Date(2026, 9, 5), null),
      row(2, new Date(2026, 9, 1), new Date(2026, 9, 12)),
      row(3, new Date(2026, 9, 2), new Date(2026, 9, 9)),
    ];

    expect(sortFundingQueue(input).map((entry) => entry.concernId)).toEqual([
      3, 2, 1,
    ]);
    expect(input.map((entry) => entry.concernId)).toEqual([1, 2, 3]);
  });

  it("falls back to the submission date for a case with no budget-stage timestamp", () => {
    const sorted = sortFundingQueue([
      { concernId: 1, submittedAt: new Date(2026, 9, 8), awaitingBudgetAt: null, waitingForBudget: true },
      { concernId: 2, submittedAt: new Date(2026, 9, 3), awaitingBudgetAt: new Date(2026, 9, 10), waitingForBudget: true },
    ]);

    // Case 1 has waited since it was submitted, longer than case 2 has waited
    // in the money stage itself.
    expect(sorted.map((entry) => entry.concernId)).toEqual([1, 2]);
  });
});
