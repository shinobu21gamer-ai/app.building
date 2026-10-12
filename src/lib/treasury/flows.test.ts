import type { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import {
  adjustAllocation,
  approveEarmark,
  closeAllocation,
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

function makeTx(seed: { appropriation?: number; entries?: Row[]; earmarks?: Row[]; vouchers?: Row[] } = {}) {
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
    approvals: [] as Row[],
    nextId: 500,
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
    concern: { findUnique: async ({ where }: { where: { id: number } }) => ({ id: where.id }) },
    user: { findUnique: async ({ where }: { where: { id: number } }) => ({ id: where.id }) },
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
