import { beforeEach, describe, expect, it, vi } from "vitest";

const { createDisbursement } = vi.hoisted(() => ({ createDisbursement: vi.fn() }));

vi.mock("@/lib/api", () => ({
  createApiError: {
    notFound: (message: string) => Object.assign(new Error(message), { status: 404 }),
    badRequest: (message: string) => Object.assign(new Error(message), { status: 400 }),
    conflict: (message: string) => Object.assign(new Error(message), { status: 409 }),
  },
}));
vi.mock("@/lib/treasury/disbursement", () => ({ createDisbursement }));

import {
  createCrewPaymentRequestOnClose,
  decideCrewPayments,
} from "./crew-payment-request";

function makeRequest(status = "OPEN") {
  const lines: Array<{
    id: number;
    crewId: number;
    status: string;
    holdReason: string | null;
    disbursementId: number | null;
    disbursement: { status: string } | null;
    crew: { id: number; firstName: string; lastName: string };
  }> = [
    { id: 101, crewId: 11, status: "PENDING", holdReason: null, disbursementId: null, disbursement: null, crew: { id: 11, firstName: "Ava", lastName: "Reyes" } },
    { id: 102, crewId: 12, status: "PENDING", holdReason: null, disbursementId: null, disbursement: null, crew: { id: 12, firstName: "Ben", lastName: "Cruz" } },
  ];
  const request = {
    id: 9,
    status,
    concern: { id: 44, caseNumber: "BR-44", status: "CLOSED", assignedOfficeId: 4 },
    lines,
  };
  const lineUpdate = vi.fn(async ({ where, data }: { where: { id: number }; data: Record<string, unknown> }) => {
    const line = lines.find((row) => row.id === where.id)!;
    Object.assign(line, data);
    if (data.disbursementId) line.disbursement = { status: "DRAFT" };
    return line;
  });
  const requestUpdate = vi.fn(async ({ data }: { data: Record<string, unknown> }) => Object.assign(request, data));
  const tx = {
    crewAssignment: { findMany: vi.fn().mockResolvedValue([{ crewId: 11 }, { crewId: 12 }, { crewId: 11 }]) },
    crewPaymentRequest: {
      findUnique: vi.fn().mockResolvedValue(request),
      create: vi.fn().mockResolvedValue({ id: 9 }),
      update: requestUpdate,
    },
    crewPaymentRequestLine: {
      update: lineUpdate,
      findMany: vi.fn(async () => lines.map((line) => ({ status: line.status }))),
    },
    budgetEarmark: { findUnique: vi.fn().mockResolvedValue({ allocationId: 3 }) },
  };
  return { tx: tx as never, request, lines, lineUpdate, requestUpdate };
}

const actor = { id: 5, roleKey: "TREASURER", officeId: null };

beforeEach(() => {
  createDisbursement.mockReset();
  createDisbursement.mockImplementation(async (_tx, input) => ({
    disbursementId: 500 + input.payeeUserId,
    voucherNumber: `DV-${input.payeeUserId}`,
    status: "DRAFT",
  }));
});

describe("createCrewPaymentRequestOnClose", () => {
  it("creates one amount-free line per unique assigned crew member", async () => {
    const requestCreate = vi.fn().mockResolvedValue({ id: 18 });
    const tx = {
      crewAssignment: { findMany: vi.fn().mockResolvedValue([{ crewId: 7 }, { crewId: 8 }, { crewId: 7 }]) },
      crewPaymentRequest: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: requestCreate,
      },
    };

    await expect(createCrewPaymentRequestOnClose(tx as never, 42)).resolves.toEqual({
      requestId: 18,
      crewCount: 2,
      created: true,
    });
    expect(requestCreate).toHaveBeenCalledWith({
      data: { concernId: 42, lines: { create: [{ crewId: 7 }, { crewId: 8 }] } },
      select: { id: true },
    });
  });

  it("does not create a ticket when no crew was assigned", async () => {
    const create = vi.fn();
    const tx = {
      crewAssignment: { findMany: vi.fn().mockResolvedValue([]) },
      crewPaymentRequest: { findUnique: vi.fn(), create },
    };
    await expect(createCrewPaymentRequestOnClose(tx as never, 42)).resolves.toBeNull();
    expect(create).not.toHaveBeenCalled();
  });
});

describe("decideCrewPayments", () => {
  it("creates draft vouchers for Pay lines and keeps Hold lines open with a reason", async () => {
    const { tx, lines, requestUpdate } = makeRequest();
    const outcome = await decideCrewPayments(tx, {
      requestId: 9,
      actor,
      earmarkId: 70,
      decisions: [
        { lineId: 101, action: "PAY", amount: 450 },
        { lineId: 102, action: "HOLD", reason: "Confirm work hours." },
      ],
    });

    expect(outcome).toEqual({
      vouchers: [{ lineId: 101, disbursementId: 511, voucherNumber: "DV-11" }],
      held: 1,
    });
    expect(lines[0].status).toBe("VOUCHER_PREPARED");
    expect(lines[1]).toMatchObject({ status: "HELD", holdReason: "Confirm work hours." });
    expect(createDisbursement).toHaveBeenCalledWith(tx, expect.objectContaining({
      allocationId: 3,
      earmarkId: 70,
      concernId: 44,
      payeeUserId: 11,
      amount: 450,
    }));
    expect(requestUpdate).toHaveBeenCalledWith({ where: { id: 9 }, data: { status: "OPEN" } });
  });

  it("marks the request complete only after every member has a draft voucher", async () => {
    const { tx, requestUpdate } = makeRequest();
    await decideCrewPayments(tx, {
      requestId: 9,
      actor,
      earmarkId: 70,
      decisions: [
        { lineId: 101, action: "PAY", amount: 450 },
        { lineId: 102, action: "PAY", amount: 500 },
      ],
    });
    expect(requestUpdate).toHaveBeenCalledWith({
      where: { id: 9 },
      data: { status: "VOUCHERS_PREPARED" },
    });
  });

  it("allows a returned or cancelled voucher line to be prepared again", async () => {
    const { tx, lines } = makeRequest("VOUCHERS_PREPARED");
    lines[0].status = "VOUCHER_PREPARED";
    lines[0].disbursementId = 601;
    lines[0].disbursement = { status: "REJECTED" };
    lines[1].status = "VOUCHER_PREPARED";
    lines[1].disbursementId = 602;
    lines[1].disbursement = { status: "DRAFT" };

    await decideCrewPayments(tx, {
      requestId: 9,
      actor,
      earmarkId: 70,
      decisions: [{ lineId: 101, action: "PAY", amount: 450 }],
    });
    expect(createDisbursement).toHaveBeenCalledTimes(1);
    expect(lines[0]).toMatchObject({ status: "VOUCHER_PREPARED", disbursementId: 511 });
  });

  it("rejects duplicate line decisions without creating vouchers", async () => {
    const { tx } = makeRequest();
    await expect(decideCrewPayments(tx, {
      requestId: 9,
      actor,
      earmarkId: 70,
      decisions: [
        { lineId: 101, action: "PAY", amount: 450 },
        { lineId: 101, action: "HOLD", reason: "Wait." },
      ],
    })).rejects.toMatchObject({ status: 400 });
    expect(createDisbursement).not.toHaveBeenCalled();
  });

  it("hides requests outside an office-scoped actor's assigned office", async () => {
    const { tx } = makeRequest();
    await expect(decideCrewPayments(tx, {
      requestId: 9,
      actor: { id: 6, roleKey: "OFFICE_STAFF", officeId: 3 },
      earmarkId: null,
      decisions: [{ lineId: 101, action: "HOLD", reason: "Confirm work." }],
    })).rejects.toMatchObject({ status: 404 });
    expect(createDisbursement).not.toHaveBeenCalled();
  });

  it("rejects a request before the case is closed", async () => {
    const { tx } = makeRequest();
    const request = (tx as { crewPaymentRequest: { findUnique: ReturnType<typeof vi.fn> } }).crewPaymentRequest;
    request.findUnique.mockResolvedValueOnce({
      id: 9,
      status: "OPEN",
      concern: { id: 44, caseNumber: "BR-44", status: "RESOLVED" },
      lines: [],
    });
    await expect(decideCrewPayments(tx, {
      requestId: 9,
      actor,
      earmarkId: null,
      decisions: [{ lineId: 101, action: "HOLD", reason: "Wait for closure." }],
    })).rejects.toMatchObject({ status: 409 });
  });
});
