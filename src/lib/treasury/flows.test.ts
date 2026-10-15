import type { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import {
  adjustAllocation,
  approveEarmark,
  cancelEarmark,
  closeAllocation,
  proposeEarmark,
  writeLedgerEntry,
  type Actor,
} from "@/lib/treasury/budget";
import { createDisbursement } from "@/lib/treasury/disbursement";

// ---------------------------------------------------------------------------
// A tiny in-memory `tx` so the treasury rules can be exercised without a
// database. Only the calls the treasury layer actually makes are implemented.
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

const treasurer: Actor = { id: 10, roleKey: "TREASURER", officeId: null };

const VERIFIED_COA = {
  id: 5,
  code: "5-02-13-030-00",
  name: "Repairs and Maintenance - Infrastructure Assets",
  verificationStatus: "VERIFIED",
  isActive: true,
};

function makeTx(seed: {
  appropriation?: number;
  entries?: Row[];
  earmarks?: Row[];
  vouchers?: Row[];
  /** "Do not fund" decisions that proposing money must supersede. */
  budgetDecisions?: Row[];
  /** Users the earmark notifications can find, as `{ id, roleKey, officeId, isActive }`. */
  users?: Row[];
} = {}) {
  const state = {
    allocation: {
      id: 1,
      label: "MOOE 2026",
      status: "APPROVED",
      officeId: null,
      appropriation: seed.appropriation ?? 100000,
      coaAccount: VERIFIED_COA,
      fundSource: { id: 2, code: "GF", name: "General Fund", verificationStatus: "VERIFIED", isActive: true },
      fiscalYear: { id: 1, year: 2026, isClosed: false },
      office: null,
    } as Row,
    entries: [...(seed.entries ?? [])] as Row[],
    earmarks: [...(seed.earmarks ?? [])] as Row[],
    vouchers: [...(seed.vouchers ?? [])] as Row[],
    budgetDecisions: [...(seed.budgetDecisions ?? [])] as Row[],
    approvals: [] as Row[],
    users: [...(seed.users ?? [])] as Row[],
    notifications: [] as Row[],
    nextId: 500,
    locks: 0,
  };

  const balance = () => {
    const last = state.entries[state.entries.length - 1];
    return last
      ? {
          reserved: Number(last.reservedAfter),
          disbursed: Number(last.disbursedAfter),
          available: Number(last.availableAfter),
        }
      : { reserved: 0, disbursed: 0, available: Number(state.allocation.appropriation) };
  };

  const round = (value: number) => Math.round(value * 100) / 100;

  const tx = {
    // `lockAllocation` takes a row lock (SELECT ... FOR UPDATE). An in-memory
    // fake has no concurrent writers, so the lock is recorded and then ignored.
    $queryRaw: async () => {
      state.locks += 1;
      return [];
    },
    budgetAllocation: {
      findUnique: async () => state.allocation,
      update: async ({ data }: { data: Row }) => {
        if (data.appropriation !== undefined) state.allocation.appropriation = data.appropriation;
        return state.allocation;
      },
      count: async () => 1,
    },
    budgetLedgerEntry: {
      findMany: async () => state.entries,
      create: async ({ data }: { data: Row }) => {
        const current = balance();
        const reserved = round(current.reserved + Number(data.reservedDelta ?? 0));
        const disbursed = round(current.disbursed + Number(data.disbursedDelta ?? 0));
        const entry: Row = {
          id: state.nextId++,
          reservedDelta: Number(data.reservedDelta ?? 0),
          disbursedDelta: Number(data.disbursedDelta ?? 0),
          reservedAfter: reserved,
          disbursedAfter: disbursed,
          availableAfter: round(Number(state.allocation.appropriation) - reserved - disbursed),
          ...data,
        };
        state.entries.push(entry);
        return entry;
      },
    },
    budgetEarmark: {
      findUnique: async ({ where }: { where: { id: number } }) => {
        const earmark = state.earmarks.find((row) => row.id === where.id);
        return earmark ? { ...earmark, allocation: state.allocation } : null;
      },
      count: async () => state.earmarks.length,
      create: async ({ data }: { data: Row }) => {
        const earmark: Row = { id: state.nextId++, ...data };
        state.earmarks.push(earmark);
        return earmark;
      },
      update: async ({ where, data }: { where: { id: number }; data: Row }) => {
        const earmark = state.earmarks.find((row) => row.id === where.id)!;
        Object.assign(earmark, data);
        return earmark;
      },
    },
    disbursement: {
      findUnique: async ({ where }: { where: { id: number } }) => {
        const voucher = state.vouchers.find((row) => row.id === where.id);
        if (!voucher) return null;
        return {
          ...voucher,
          allocation: state.allocation,
          earmark: voucher.earmarkId
            ? state.earmarks.find((row) => row.id === voucher.earmarkId) ?? null
            : null,
          approvals: state.approvals.filter((row) => row.disbursementId === voucher.id),
          concern: voucher.concernId ? { id: voucher.concernId, caseNumber: "BR-2026-0001", title: "Case" } : null,
        };
      },
      findMany: async ({ where }: { where?: Row } = {}) =>
        state.vouchers.filter((row) =>
          where?.earmarkId === undefined || row.earmarkId === where.earmarkId
        ),
      count: async () => state.vouchers.length,
      create: async ({ data }: { data: Row }) => {
        const voucher: Row = { id: state.nextId++, ...data };
        state.vouchers.push(voucher);
        return voucher;
      },
      update: async ({ where, data }: { where: { id: number }; data: Row }) => {
        const voucher = state.vouchers.find((row) => row.id === where.id)!;
        Object.assign(voucher, data);
        return voucher;
      },
    },
    disbursementApproval: {
      create: async ({ data }: { data: Row }) => {
        state.approvals.push({ id: state.nextId++, ...data });
        return data;
      },
    },
    fiscalYear: {
      findUnique: async () => state.allocation.fiscalYear,
      update: async () => state.allocation.fiscalYear,
    },
    concern: {
      findUnique: async ({ where }: { where: { id: number } }) => ({
        id: where.id,
        caseNumber: `BR-2026-${String(where.id).padStart(4, "0")}`,
      }),
    },
    // Proposing money for a case supersedes its "do not fund" decision.
    budgetDecision: {
      deleteMany: async ({ where }: { where: { concernId: number | null } }) => {
        const before = state.budgetDecisions.length;
        state.budgetDecisions = state.budgetDecisions.filter(
          (row) => row.concernId !== where.concernId
        );
        return { count: before - state.budgetDecisions.length };
      },
    },
    user: {
      findUnique: async ({ where }: { where: { id: number } }) => ({ id: where.id }),
      // The earmark notifications look approvers up by role (and the case's
      // office by role + officeId). Filtered just far enough for those lookups
      // to be exercised; the money rules under test never read users.
      findMany: async ({ where }: { where?: Row } = {}) => {
        const role = where?.role as Row | undefined;
        const key = role?.key;
        const wanted: string[] =
          typeof key === "string"
            ? [key]
            : Array.isArray((key as Row | undefined)?.in)
              ? ((key as Row).in as string[])
              : [];
        const excludedId = (where?.id as Row | undefined)?.not;
        return state.users.filter(
          (user) =>
            user.isActive !== false &&
            (wanted.length === 0 || wanted.includes(String(user.roleKey))) &&
            (where?.officeId === undefined || user.officeId === where.officeId) &&
            (excludedId === undefined || user.id !== excludedId)
        );
      },
    },
    notification: {
      create: async ({ data }: { data: Row }) => {
        const notification: Row = { id: state.nextId++, ...data };
        state.notifications.push(notification);
        return notification;
      },
    },
  };

  return { tx: tx as unknown as Prisma.TransactionClient, state, balance };
}

function reservedEntry(amount: number, appropriation = 1000): Row {
  return {
    id: 1,
    entryType: "EARMARK_RESERVE",
    reservedDelta: amount,
    disbursedDelta: 0,
    reservedAfter: amount,
    disbursedAfter: 0,
    availableAfter: appropriation - amount,
  };
}

// ---------------------------------------------------------------------------

describe("voucher preparation against a live balance", () => {
  it("refuses a voucher bigger than what is available", async () => {
    const { tx } = makeTx({ appropriation: 1000 });

    await expect(
      createDisbursement(tx, {
        actor: treasurer,
        allocationId: 1,
        earmarkId: null,
        concernId: null,
        payee: "Sunrise Hardware",
        payeeType: "SUPPLIER",
        payeeUserId: null,
        amount: 1500,
        particulars: "Cement and steel bars",
        modeOfPayment: "CHECK",
      })
    ).rejects.toThrow(/only has ₱1000\.00 available/);
  });

  it("numbers a draft voucher DV-YYYY-MM-0001 and leaves the balance alone", async () => {
    const { tx, state, balance } = makeTx({ appropriation: 1000 });

    const outcome = await createDisbursement(tx, {
      actor: treasurer,
      allocationId: 1,
      earmarkId: null,
      concernId: null,
      payee: "Sunrise Hardware",
      payeeType: "SUPPLIER",
      payeeUserId: null,
      amount: 600,
      particulars: "Cement and steel bars",
      modeOfPayment: "CHECK",
    });

    expect(outcome.voucherNumber).toMatch(/^DV-\d{4}-\d{2}-0001$/);
    expect(state.vouchers[0].status).toBe("DRAFT");
    // Drafting a voucher reserves nothing; the money moves on certification.
    expect(balance().available).toBe(1000);
  });

  it("refuses to draw on an earmark that is not approved", async () => {
    const { tx } = makeTx({
      appropriation: 5000,
      earmarks: [{ id: 7, code: "EM-2026-0001", status: "PROPOSED", amount: 2000, allocationId: 1, concernId: null }],
    });

    await expect(
      createDisbursement(tx, {
        actor: treasurer,
        allocationId: 1,
        earmarkId: 7,
        concernId: null,
        payee: "Sunrise Hardware",
        payeeType: "SUPPLIER",
        payeeUserId: null,
        amount: 500,
        particulars: "Materials",
        modeOfPayment: null,
      })
    ).rejects.toThrow(/PROPOSED/);
  });

  it("refuses to over-commit an approved earmark", async () => {
    const { tx } = makeTx({
      appropriation: 5000,
      earmarks: [{ id: 7, code: "EM-2026-0001", status: "APPROVED", amount: 1000, allocationId: 1, concernId: null }],
      vouchers: [
        { id: 3, earmarkId: 7, status: "CERTIFIED", amount: 900, allocationId: 1, preparedById: 99 },
      ],
    });

    await expect(
      createDisbursement(tx, {
        actor: treasurer,
        allocationId: 1,
        earmarkId: 7,
        concernId: null,
        payee: "Sunrise Hardware",
        payeeType: "SUPPLIER",
        payeeUserId: null,
        amount: 200,
        particulars: "Materials",
        modeOfPayment: null,
      })
    ).rejects.toThrow(/already committed/);
  });
});

describe("earmark approval reserves money", () => {
  it("writes an EARMARK_RESERVE entry and reports what is left", async () => {
    const { tx, state } = makeTx({
      appropriation: 1000,
      earmarks: [{ id: 7, code: "EM-2026-0001", status: "PROPOSED", amount: 400, allocationId: 1, concernId: null, purpose: "Repair materials" }],
    });

    const outcome = await approveEarmark(tx, { actor: treasurer, earmarkId: 7 });

    expect(outcome.available).toBe(600);
    expect(state.entries.at(-1)?.entryType).toBe("EARMARK_RESERVE");
    expect(state.earmarks[0].status).toBe("APPROVED");
  });

  it("refuses an earmark the balance cannot cover (no overspend)", async () => {
    const { tx } = makeTx({
      appropriation: 1000,
      earmarks: [{ id: 7, code: "EM-2026-0001", status: "PROPOSED", amount: 1500, allocationId: 1, concernId: null }],
    });

    await expect(approveEarmark(tx, { actor: treasurer, earmarkId: 7 })).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// The hand-off nobody used to be told about. A case cannot leave
// AWAITING_BUDGET until an earmark is approved, and the approver may not be the
// proposer — so without these notifications the proposal waits on a decision
// nobody was asked to make.
// ---------------------------------------------------------------------------

const captain: Actor = { id: 20, roleKey: "CAPTAIN", officeId: null };
const admin: Actor = { id: 1, roleKey: "ADMIN", officeId: null };

const HALL_USERS: Row[] = [
  { id: 10, roleKey: "TREASURER", officeId: null, isActive: true },
  { id: 20, roleKey: "CAPTAIN", officeId: null, isActive: true },
  { id: 1, roleKey: "ADMIN", officeId: null, isActive: true },
  { id: 30, roleKey: "OFFICIAL", officeId: 3, isActive: true },
  { id: 31, roleKey: "OFFICIAL", officeId: 4, isActive: true },
  { id: 32, roleKey: "OFFICIAL", officeId: 3, isActive: false },
];

describe("earmark hand-off notifications", () => {
  it("tells the approvers a proposal is waiting, and not the one who proposed it", async () => {
    const { tx, state } = makeTx({ appropriation: 1000, users: HALL_USERS });

    await proposeEarmark(tx, {
      actor: treasurer,
      allocationId: 1,
      concernId: null,
      purpose: "Repair materials",
      amount: 400,
    });

    const told = state.notifications.map((row) => row.userId);
    // The Captain and the Administrator both hold `treasury.earmark.approve`;
    // the treasurer proposed it and may not approve their own, so telling them
    // would be a bell they cannot answer.
    expect(told).toContain(20);
    expect(told).toContain(1);
    expect(told).not.toContain(10);
    expect(state.notifications[0].type).toBe("EARMARK_PROPOSED");
    expect(String(state.notifications[0].message)).toContain("₱400.00");
  });

  it("names the case an administrator proposed, so the Captain knows what it is for", async () => {
    const { tx, state } = makeTx({
      appropriation: 1000,
      users: HALL_USERS,
      // The case was refused before; the new proposal ends that refusal.
      budgetDecisions: [{ id: 900, concernId: 7, decision: "NOT_FUNDED", reason: "No budget this year." }],
    });

    await proposeEarmark(tx, {
      actor: admin,
      allocationId: 1,
      concernId: 7,
      purpose: "Drainage repair",
      amount: 400,
    });

    const captainNote = state.notifications.find((row) => row.userId === 20);
    expect(captainNote).toBeDefined();
    // The treasurer is an approver here only if the matrix says so; the admin
    // proposed it, so they must not be told to approve their own earmark.
    expect(state.notifications.map((row) => row.userId)).not.toContain(1);
    expect(captainNote?.concernId).toBe(7);
    // Proposing money supersedes the "do not fund" row: one call per case.
    expect(state.budgetDecisions).toEqual([]);
  });

  it("tells the proposer and the case's own office that the money is set aside", async () => {
    const { tx, state } = makeTx({
      appropriation: 1000,
      users: HALL_USERS,
      earmarks: [
        {
          id: 7,
          code: "EM-2026-0001",
          status: "PROPOSED",
          amount: 400,
          allocationId: 1,
          concernId: 5,
          purpose: "Repair materials",
          preparedById: 10,
          concern: { id: 5, caseNumber: "BR-2026-0005", assignedOfficeId: 3 },
        },
      ],
    });

    await approveEarmark(tx, { actor: captain, earmarkId: 7 });

    const told = state.notifications.map((row) => row.userId);
    expect(told).toContain(10); // the treasurer who proposed it
    expect(told).toContain(30); // an official of the case's office
    expect(told).not.toContain(31); // a different office is not told
    expect(told).not.toContain(32); // an inactive account is not told
    expect(state.notifications[0].type).toBe("EARMARK_APPROVED");
    expect(String(state.notifications[0].message)).toContain("Awaiting budget");
  });

  it("tells the case's office why a cancellation left them short again", async () => {
    const { tx, state } = makeTx({
      appropriation: 1000,
      users: HALL_USERS,
      earmarks: [
        {
          id: 7,
          code: "EM-2026-0001",
          status: "APPROVED",
          amount: 400,
          allocationId: 1,
          concernId: 5,
          preparedById: 10,
          concern: { id: 5, caseNumber: "BR-2026-0005", assignedOfficeId: 3 },
        },
      ],
      entries: [reservedEntry(400)],
    });

    await cancelEarmark(tx, {
      actor: treasurer,
      earmarkId: 7,
      reason: "The estimate was superseded by a new assessment.",
    });

    const told = state.notifications.map((row) => row.userId);
    expect(told).toContain(10);
    expect(told).toContain(30);
    expect(state.notifications[0].type).toBe("EARMARK_CANCELLED");
    expect(String(state.notifications[0].message)).toContain("superseded");
  });
});

describe("allocation adjustments and closing", () => {
  it("refuses to cut an appropriation below what is already reserved", async () => {
    const { tx } = makeTx({ appropriation: 1000, entries: [reservedEntry(400)] });

    await expect(
      adjustAllocation(tx, { actor: treasurer, allocationId: 1, amount: -700, memo: "Correction" })
    ).rejects.toThrow();

    const outcome = await adjustAllocation(tx, {
      actor: treasurer,
      allocationId: 1,
      amount: -600,
      memo: "Unused appropriation returned to the general fund",
    });
    expect(outcome.appropriated).toBe(400);
    // The 400 that is reserved still has to be covered.
    expect(outcome.available).toBe(0);
  });

  it("refuses to close an allocation with money still reserved", async () => {
    const { tx } = makeTx({ appropriation: 1000, entries: [reservedEntry(400)] });

    await expect(closeAllocation(tx, { actor: treasurer, allocationId: 1 })).rejects.toThrow(
      /still reserved/
    );
  });

  it("gives the money back when a reservation is released", async () => {
    const { tx } = makeTx({ appropriation: 1000, entries: [reservedEntry(400)] });
    const entry = await writeLedgerEntry(tx, {
      allocationId: 1,
      entryType: "EARMARK_RELEASE",
      amount: 400,
      reservedDelta: -400,
      memo: "Earmark cancelled",
      actorId: treasurer.id,
    });

    expect(entry.reserved).toBe(0);
    expect(entry.available).toBe(1000);
  });
});
