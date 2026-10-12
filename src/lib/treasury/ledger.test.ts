import { describe, expect, it } from "vitest";
import {
  actionAllowed,
  agingBucket,
  agingSummary,
  applyDeltas,
  approvalConflict,
  checkAvailability,
  disbursementActions,
  earmarkCode,
  emptySnapshot,
  holdsReservation,
  isPaid,
  liquidationDueFrom,
  liquidationState,
  nextApprovalLevel,
  projectCommitment,
  snapshotFromEntries,
  statusAfterAction,
  toMoney,
  voucherNumber,
} from "@/lib/treasury/ledger";

describe("money", () => {
  it("reads Prisma Decimals, strings and nulls", () => {
    expect(toMoney({ toNumber: () => 1234.567 })).toBe(1234.57);
    expect(toMoney("1500.5")).toBe(1500.5);
    expect(toMoney(null)).toBe(0);
    expect(toMoney("not a number")).toBe(0);
    expect(toMoney(undefined)).toBe(0);
  });
});

describe("append-only ledger snapshots", () => {
  it("starts at the appropriation", () => {
    expect(emptySnapshot(50000)).toEqual({
      appropriated: 50000,
      reserved: 0,
      disbursed: 0,
      available: 50000,
    });
  });

  it("applies reservations and payments in order", () => {
    let snapshot = emptySnapshot(10000);
    snapshot = applyDeltas(snapshot, { reservedDelta: 4000 });
    expect(snapshot.available).toBe(6000);
    snapshot = applyDeltas(snapshot, { reservedDelta: -4000, disbursedDelta: 4000 });
    expect(snapshot.reserved).toBe(0);
    expect(snapshot.disbursed).toBe(4000);
    expect(snapshot.available).toBe(6000);
  });

  it("reads the newest entry as the live balance and recomputes from deltas", () => {
    const entries = [
      { reservedDelta: 2000, disbursedDelta: 0, reservedAfter: 2000, disbursedAfter: 0, availableAfter: 8000 },
      { reservedDelta: -2000, disbursedDelta: 2000, reservedAfter: 0, disbursedAfter: 2000, availableAfter: 8000 },
    ];
    const live = snapshotFromEntries(10000, entries);
    expect(live.available).toBe(8000);
    expect(live.recomputed).toEqual({
      appropriated: 10000,
      reserved: 0,
      disbursed: 2000,
      available: 8000,
    });
    expect(live.entryCount).toBe(2);
  });

  it("shows an overdraw instead of hiding it", () => {
    const live = snapshotFromEntries(1000, [
      { reservedDelta: 1500, disbursedDelta: 0, reservedAfter: 1500, disbursedAfter: 0, availableAfter: -500 },
    ]);
    expect(live.available).toBe(-500);
  });

  it("projects what a commitment leaves behind", () => {
    const after = projectCommitment({
      appropriation: 50000,
      reserved: 10000,
      disbursed: 5000,
      reservedDelta: 7500,
    });
    expect(after.reserved).toBe(17500);
    expect(after.available).toBe(27500);
  });
});

describe("no overspend", () => {
  it("refuses an amount larger than the balance and states the shortfall", () => {
    const check = checkAvailability({ available: 4000, amount: 5500, label: "This allocation" });
    expect(check.ok).toBe(false);
    expect(check.shortfall).toBe(1500);
    expect(check.message).toContain("₱4000.00");
    expect(check.message).toContain("₱1500.00");
  });

  it("accepts an amount up to the balance", () => {
    expect(checkAvailability({ available: 4000, amount: 4000 }).ok).toBe(true);
  });

  it("refuses a non-positive amount", () => {
    const check = checkAvailability({ available: 4000, amount: 0 });
    expect(check.ok).toBe(false);
    expect(check.message).toContain("more than zero");
  });
});

describe("voucher lifecycle", () => {
  it("allows each action only from the right status", () => {
    expect(disbursementActions("DRAFT")).toEqual(["SUBMIT", "CANCEL"]);
    expect(disbursementActions("SUBMITTED")).toContain("CERTIFY");
    expect(disbursementActions("RELEASED")).toEqual(["LIQUIDATE"]);
    expect(disbursementActions("LIQUIDATED")).toEqual([]);
    expect(disbursementActions("CANCELLED")).toEqual([]);
    expect(actionAllowed("SUBMITTED", "SUBMIT")).toBe(false);
  });

  it("maps actions to the next status and refuses impossible ones", () => {
    expect(statusAfterAction("DRAFT", "SUBMIT")).toBe("SUBMITTED");
    expect(statusAfterAction("SUBMITTED", "CERTIFY")).toBe("CERTIFIED");
    expect(statusAfterAction("CERTIFIED", "APPROVE")).toBe("APPROVED");
    expect(statusAfterAction("APPROVED", "RELEASE")).toBe("RELEASED");
    expect(statusAfterAction("RELEASED", "LIQUIDATE")).toBe("LIQUIDATED");
    expect(statusAfterAction("SUBMITTED", "REJECT")).toBe("REJECTED");
    expect(statusAfterAction("APPROVED", "CANCEL")).toBe("CANCELLED");
    expect(statusAfterAction("RELEASED", "CANCEL")).toBeNull();
    expect(statusAfterAction("DRAFT", "APPROVE")).toBeNull();
  });

  it("knows which statuses still hold money and which have paid out", () => {
    expect(holdsReservation("CERTIFIED")).toBe(true);
    expect(holdsReservation("DRAFT")).toBe(false);
    expect(isPaid("RELEASED")).toBe(true);
    expect(isPaid("CANCELLED")).toBe(false);
  });
});

describe("approval order and separation of duties", () => {
  it("waits for the treasurer certification before the AAO approval", () => {
    expect(nextApprovalLevel([])).toBe(1);
    expect(nextApprovalLevel([{ level: 1, approverId: 5, decision: "CERTIFIED" }])).toBe(2);
    expect(
      nextApprovalLevel([
        { level: 1, approverId: 5, decision: "CERTIFIED" },
        { level: 2, approverId: 9, decision: "APPROVED" },
      ])
    ).toBeNull();
  });

  it("treats a rejection as not counting towards the next level", () => {
    expect(nextApprovalLevel([{ level: 1, approverId: 5, decision: "REJECTED" }])).toBe(1);
  });

  it("refuses self-approval in the service layer, not only in the UI", () => {
    const message = approvalConflict({
      preparedById: 7,
      approverId: 7,
      approvals: [],
    });
    expect(message).toContain("cannot certify or approve");
  });

  it("refuses a second decision from the same person", () => {
    const message = approvalConflict({
      preparedById: 7,
      approverId: 9,
      approvals: [{ level: 1, approverId: 9, decision: "CERTIFIED" }],
    });
    expect(message).toContain("already decided");
  });

  it("allows the other approving role", () => {
    expect(
      approvalConflict({
        preparedById: 7,
        createdById: 7,
        approverId: 9,
        approvals: [],
      })
    ).toBeNull();
  });
});

describe("aging and liquidation", () => {
  const now = new Date("2026-10-12T00:00:00Z");
  const daysAgo = (days: number) =>
    new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

  it("buckets voucher age", () => {
    expect(agingBucket(daysAgo(0), now)).toBe("0-7");
    expect(agingBucket(daysAgo(7), now)).toBe("0-7");
    expect(agingBucket(daysAgo(8), now)).toBe("8-30");
    expect(agingBucket(daysAgo(30), now)).toBe("8-30");
    expect(agingBucket(daysAgo(31), now)).toBe("31-60");
    expect(agingBucket(daysAgo(61), now)).toBe("61-90");
    expect(agingBucket(daysAgo(91), now)).toBe("90+");
  });

  it("sums pending vouchers per bucket", () => {
    const summary = agingSummary(
      [
        { submittedAt: daysAgo(2), amount: 1000 },
        { submittedAt: daysAgo(45), amount: 2500 },
        { submittedAt: null, amount: 999 },
      ],
      now
    );
    expect(summary["0-7"]).toEqual({ count: 1, amount: 1000 });
    expect(summary["31-60"]).toEqual({ count: 1, amount: 2500 });
    expect(summary["90+"]).toEqual({ count: 0, amount: 0 });
  });

  it("gives a released voucher 30 days to be liquidated", () => {
    const released = new Date("2026-10-01T00:00:00Z");
    const due = liquidationDueFrom(released);
    expect(due.toISOString().slice(0, 10)).toBe("2026-10-31");
    expect(liquidationState({ status: "RELEASED", liquidationDueAt: due }, now)).toBe("NOT_DUE");
    expect(
      liquidationState(
        { status: "RELEASED", liquidationDueAt: daysAgo(1) },
        now
      )
    ).toBe("OVERDUE");
    expect(
      liquidationState(
        { status: "RELEASED", liquidationDueAt: new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000) },
        now
      )
    ).toBe("DUE_SOON");
    expect(liquidationState({ status: "DRAFT" }, now)).toBe("NOT_APPLICABLE");
    expect(
      liquidationState({ status: "LIQUIDATED", liquidationStatus: "LIQUIDATED" }, now)
    ).toBe("LIQUIDATED");
  });
});

describe("reference numbers", () => {
  it("numbers vouchers by year and month", () => {
    expect(voucherNumber(2026, 10, 7)).toBe("DV-2026-10-0007");
    expect(voucherNumber(2026, 10, 12345)).toBe("DV-2026-10-12345");
  });

  it("numbers earmarks by year", () => {
    expect(earmarkCode(2026, 7)).toBe("EM-2026-0007");
  });
});
