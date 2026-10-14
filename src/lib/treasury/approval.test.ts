import { describe, expect, it } from "vitest";
import {
  briefForEarmarkRow,
  covers,
  earmarkApprovalBrief,
  earmarkQueueRank,
  isAwaitingDecision,
  setAsideBeforeThis,
  type EarmarkApprovalInput,
} from "@/lib/treasury/approval";

// The treasurer proposes (id 10); the Captain approves (id 20). An administrator
// (id 1) holds both permissions, which is exactly the combination that used to
// strand a case in AWAITING_BUDGET.
const TREASURER = 10;
const CAPTAIN = 20;
const ADMIN = 1;

function base(
  overrides: Partial<EarmarkApprovalInput> = {}
): EarmarkApprovalInput {
  return {
    amount: 12000,
    status: "PROPOSED",
    allocationAvailable: 50000,
    preparedById: TREASURER,
    actorId: CAPTAIN,
    canApprove: true,
    caseEstimate: 12000,
    caseSetAside: 0,
    caseStatus: "AWAITING_BUDGET",
    ...overrides,
  };
}

describe("covers", () => {
  it("tolerates rounding on an exact match", () => {
    expect(covers(5000, 5000)).toBe(true);
    expect(covers(5000, 4999.99)).toBe(false);
  });
});

describe("earmarkApprovalBrief — the money maths", () => {
  it("shows what is left on the allocation once the amount is reserved", () => {
    const brief = earmarkApprovalBrief(base());
    expect(brief.availableBefore).toBe(50000);
    expect(brief.availableAfter).toBe(38000);
    expect(brief.fits).toBe(true);
  });

  it("flags an amount the allocation cannot cover, and leaves the balance alone", () => {
    const brief = earmarkApprovalBrief(base({ allocationAvailable: 5000 }));
    expect(brief.fits).toBe(false);
    expect(brief.availableAfter).toBe(5000);
    expect(brief.blockReason).toBe("OVER_AVAILABLE");
    expect(brief.canDecide).toBe(false);
  });

  it("adds this earmark to what is already set aside for the case", () => {
    const brief = earmarkApprovalBrief(
      base({ caseEstimate: 20000, caseSetAside: 8000 })
    );
    expect(brief.setAsideBefore).toBe(8000);
    expect(brief.setAsideAfter).toBe(20000);
    expect(brief.shortfallAfter).toBe(0);
    expect(brief.coversEstimate).toBe(true);
    expect(brief.verdict).toBe("UNBLOCKS");
  });

  it("reports the shortfall when a top-up still leaves the case short", () => {
    const brief = earmarkApprovalBrief(
      base({ amount: 5000, caseEstimate: 20000, caseSetAside: 8000 })
    );
    expect(brief.setAsideAfter).toBe(13000);
    expect(brief.shortfallAfter).toBe(7000);
    expect(brief.coversEstimate).toBe(false);
    expect(brief.verdict).toBe("PART_FUNDS");
    expect(brief.canDecide).toBe(true);
  });

  it("reports an amount set aside beyond the estimate", () => {
    const brief = earmarkApprovalBrief(
      base({ amount: 15000, caseEstimate: 12000 })
    );
    expect(brief.excessOverEstimate).toBe(3000);
    expect(brief.verdict).toBe("OVER_FUNDS");
    // Over-funding is a judgement call, not an error: the reader may still decide.
    expect(brief.canDecide).toBe(true);
    expect(brief.blockReason).toBeNull();
  });

  it("treats a saved ₱0 estimate as an answer that needs nothing set aside", () => {
    const brief = earmarkApprovalBrief(
      base({ amount: 0.01, caseEstimate: 0, caseStatus: "AWAITING_BUDGET" })
    );
    expect(brief.coversEstimate).toBe(true);
    expect(brief.verdict).toBe("OVER_FUNDS");
  });
});

describe("earmarkApprovalBrief — the case it belongs to", () => {
  it("says so when the earmark funds a purpose rather than a case", () => {
    const brief = earmarkApprovalBrief(
      base({ caseEstimate: null, caseSetAside: 0, caseStatus: null })
    );
    expect(brief.hasCase).toBe(false);
    expect(brief.verdict).toBe("NO_CASE");
    expect(brief.caseWaitingForBudget).toBe(false);
    expect(brief.canDecide).toBe(true);
  });

  it("says so when the case has no estimate to compare against", () => {
    const brief = earmarkApprovalBrief(
      base({ caseEstimate: null, caseStatus: "AWAITING_BUDGET" })
    );
    expect(brief.hasCase).toBe(true);
    expect(brief.verdict).toBe("NO_ESTIMATE");
    expect(brief.coversEstimate).toBe(false);
  });

  it("distinguishes unblocking a waiting case from covering one already moving", () => {
    expect(earmarkApprovalBrief(base()).verdict).toBe("UNBLOCKS");
    expect(
      earmarkApprovalBrief(base({ caseStatus: "IN_PROGRESS" })).verdict
    ).toBe("COVERS");
    expect(
      earmarkApprovalBrief(base({ caseStatus: "IN_PROGRESS" }))
        .caseWaitingForBudget
    ).toBe(false);
  });
});

describe("earmarkApprovalBrief — who may decide", () => {
  it("stops the preparer approving their own earmark, before the button is shown", () => {
    const brief = earmarkApprovalBrief(
      base({ preparedById: ADMIN, actorId: ADMIN })
    );
    expect(brief.selfPrepared).toBe(true);
    expect(brief.blockReason).toBe("SELF_PREPARED");
    expect(brief.canDecide).toBe(false);
  });

  it("lets the Captain decide on the treasurer's proposal", () => {
    const brief = earmarkApprovalBrief(base());
    expect(brief.selfPrepared).toBe(false);
    expect(brief.blockReason).toBeNull();
    expect(brief.canDecide).toBe(true);
  });

  it("keeps a legacy earmark with no recorded preparer approvable", () => {
    const brief = earmarkApprovalBrief(base({ preparedById: null }));
    expect(brief.selfPrepared).toBe(false);
    expect(brief.canDecide).toBe(true);
  });

  it("says a role without the approval permission cannot decide", () => {
    const brief = earmarkApprovalBrief(
      base({ actorId: TREASURER, canApprove: false })
    );
    expect(brief.blockReason).toBe("NO_PERMISSION");
    expect(brief.canDecide).toBe(false);
  });

  it("says an earmark that is already settled is not waiting on anyone", () => {
    expect(earmarkApprovalBrief(base({ status: "APPROVED" })).blockReason).toBe(
      "NOT_PROPOSED"
    );
    expect(
      earmarkApprovalBrief(base({ status: "CANCELLED" })).blockReason
    ).toBe("NOT_PROPOSED");
  });

  it("names segregation of duties ahead of a balance that will not cover it", () => {
    const brief = earmarkApprovalBrief(
      base({ preparedById: ADMIN, actorId: ADMIN, allocationAvailable: 10 })
    );
    expect(brief.blockReason).toBe("SELF_PREPARED");
    expect(brief.fits).toBe(false);
  });
});

describe("earmarkApprovalBrief — an unloaded balance", () => {
  it("refuses to claim the amount does not fit when the balance was never read", () => {
    const brief = earmarkApprovalBrief(base({ allocationAvailable: null }));
    expect(brief.balanceKnown).toBe(false);
    expect(brief.availableBefore).toBeNull();
    expect(brief.availableAfter).toBeNull();
    expect(brief.fits).toBe(true);
    expect(brief.blockReason).toBeNull();
    expect(brief.canDecide).toBe(true);
  });

  it("reports the balance when it was read", () => {
    expect(earmarkApprovalBrief(base()).balanceKnown).toBe(true);
  });
});

describe("briefForEarmarkRow", () => {
  it("reads a register row by shape, so screens never repeat the mapping", () => {
    const brief = briefForEarmarkRow(
      {
        amount: 7500,
        status: "PROPOSED",
        preparedById: TREASURER,
        allocationAvailable: 20000,
        caseEstimate: 15000,
        caseSetAside: 7500,
        caseStatus: "AWAITING_BUDGET",
      },
      { id: CAPTAIN, canApprove: true }
    );
    expect(brief.verdict).toBe("UNBLOCKS");
    expect(brief.shortfallAfter).toBe(0);
    expect(brief.availableAfter).toBe(12500);
    expect(brief.canDecide).toBe(true);
  });

  it("treats a null set-aside as nothing set aside yet", () => {
    const brief = briefForEarmarkRow(
      {
        amount: 5000,
        status: "PROPOSED",
        preparedById: null,
        allocationAvailable: null,
        caseEstimate: 20000,
        caseSetAside: null,
        caseStatus: "AWAITING_BUDGET",
      },
      { id: CAPTAIN, canApprove: true }
    );
    expect(brief.setAsideBefore).toBe(0);
    expect(brief.shortfallAfter).toBe(15000);
    expect(brief.verdict).toBe("PART_FUNDS");
  });
});

describe("setAsideBeforeThis", () => {
  it("subtracts an approved row from the case total, so it is not counted twice", () => {
    // The case has one approved earmark of ₱12,000: the grouped total already
    // contains it, so the brief for that very row must report ₱0 before it.
    expect(
      setAsideBeforeThis({
        concernTotal: 12000,
        thisAmount: 12000,
        thisStatus: "APPROVED",
      })
    ).toBe(0);
  });

  it("reports the other earmarks when a case is funded in two parts", () => {
    // ₱5,000 + ₱7,000 both approved: each row sees the other, not itself.
    expect(
      setAsideBeforeThis({
        concernTotal: 12000,
        thisAmount: 7000,
        thisStatus: "APPROVED",
      })
    ).toBe(5000);
    expect(
      setAsideBeforeThis({
        concernTotal: 12000,
        thisAmount: 5000,
        thisStatus: "RELEASED",
      })
    ).toBe(7000);
  });

  it("subtracts nothing for a proposal, which reserves no money yet", () => {
    expect(
      setAsideBeforeThis({
        concernTotal: 12000,
        thisAmount: 3000,
        thisStatus: "PROPOSED",
      })
    ).toBe(12000);
    expect(
      setAsideBeforeThis({
        concernTotal: 0,
        thisAmount: 3000,
        thisStatus: "PROPOSED",
      })
    ).toBe(0);
  });

  it("never reports a negative figure for a cancelled or amended row", () => {
    expect(
      setAsideBeforeThis({
        concernTotal: 0,
        thisAmount: 5000,
        thisStatus: "CANCELLED",
      })
    ).toBe(0);
  });
});

describe("the decision queue", () => {
  it("counts only PROPOSED earmarks as awaiting a decision", () => {
    expect(isAwaitingDecision("PROPOSED")).toBe(true);
    expect(isAwaitingDecision("APPROVED")).toBe(false);
    expect(isAwaitingDecision("RELEASED")).toBe(false);
    expect(isAwaitingDecision("CANCELLED")).toBe(false);
  });

  it("puts a decidable earmark for a waiting case at the top", () => {
    const decidable = earmarkQueueRank({
      status: "PROPOSED",
      canDecide: true,
      caseWaitingForBudget: true,
    });
    const waitingOnSomeoneElse = earmarkQueueRank({
      status: "PROPOSED",
      canDecide: false,
      caseWaitingForBudget: true,
    });
    const notWaiting = earmarkQueueRank({
      status: "PROPOSED",
      canDecide: true,
      caseWaitingForBudget: false,
    });
    const settled = earmarkQueueRank({
      status: "APPROVED",
      canDecide: false,
      caseWaitingForBudget: false,
    });

    expect(decidable).toBeLessThan(waitingOnSomeoneElse);
    expect(decidable).toBeLessThan(notWaiting);
    expect(waitingOnSomeoneElse).toBeLessThan(settled);
    expect(notWaiting).toBeLessThan(settled);
  });
});
