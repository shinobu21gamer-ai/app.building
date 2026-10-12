import { describe, expect, it } from "vitest";

import {
  buildTreasuryDocument,
  liquidationAging,
  summarizeRegister,
  summarizeUtilisation,
  utilisationOf,
} from "@/lib/reports/treasury";
import type { ReportPeriod } from "@/lib/reports/period";
import type { AllocationRow, DisbursementRow } from "@/lib/treasury/query";
import type { Actor } from "@/lib/treasury/budget";
import { copy } from "@/lib/i18n";

function allocation(overrides: Partial<AllocationRow> = {}): AllocationRow {
  return {
    id: 1,
    label: "Repairs - Purok 3",
    status: "APPROVED",
    appropriation: 100_000,
    reserved: 10_000,
    disbursed: 40_000,
    available: 50_000,
    entryCount: 3,
    consistent: true,
    coaCode: "5-02-13-040",
    coaName: "Repairs and Maintenance - Buildings and Other Structures",
    coaVerification: "VERIFIED",
    fundSourceCode: "BRGY-MOOE",
    fundSourceName: "Barangay MOOE",
    officeId: 2,
    officeName: "Maintenance Team",
    fiscalYear: 2026,
    fiscalYearId: 1,
    approvedAt: new Date("2026-01-05T00:00:00Z"),
    notes: null,
    ...overrides,
  };
}

function voucher(overrides: Partial<DisbursementRow> = {}): DisbursementRow {
  return {
    id: 1,
    voucherNumber: "DV-2026-10-0001",
    status: "RELEASED",
    statusLabel: "Released",
    amount: 5_000,
    payee: "Ana Cruz",
    payeeType: "CREW",
    particulars: "Labor for drainage repair",
    modeOfPayment: "CASH",
    allocationId: 1,
    coaCode: "5-02-13-040",
    fundSourceCode: "BRGY-MOOE",
    earmarkId: null,
    earmarkCode: null,
    concernId: 7,
    caseNumber: "BR-2026-0007",
    preparedById: 3,
    preparedAt: new Date("2026-10-01T01:00:00Z"),
    submittedAt: new Date("2026-10-01T02:00:00Z"),
    releasedAt: new Date("2026-10-02T01:00:00Z"),
    liquidationDueAt: new Date("2026-11-01T01:00:00Z"),
    liquidationStatus: null,
    liquidationState: "NOT_DUE",
    approvals: [],
    rejectionReason: null,
    cancelReason: null,
    proofUrl: null,
    ...overrides,
  };
}

const NINETY_DAYS: ReportPeriod = {
  key: "90d",
  from: new Date("2026-07-15T16:00:00Z"),
  to: new Date("2026-10-12T15:59:59.999Z"),
  days: 90,
};

const NOW = new Date("2026-10-12T02:00:00Z");

describe("utilisationOf", () => {
  it("is the disbursed share of the appropriation, to one decimal", () => {
    expect(utilisationOf(100_000, 40_000)).toBe(40);
    expect(utilisationOf(30_000, 10_000)).toBe(33.3);
  });

  it("returns null rather than dividing by zero", () => {
    expect(utilisationOf(0, 0)).toBeNull();
    expect(utilisationOf(0, 500)).toBeNull();
  });
});

describe("summarizeUtilisation", () => {
  it("totals only the live allocations, matching the dashboard rule", () => {
    const { totals, rows } = summarizeUtilisation([
      allocation(),
      allocation({ id: 2, status: "CLOSED", appropriation: 999_999, disbursed: 999_999 }),
    ]);
    expect(totals.allocations).toBe(1);
    expect(totals.appropriated).toBe(100_000);
    expect(totals.disbursed).toBe(40_000);
    expect(totals.utilisation).toBe(40);
    expect(rows).toHaveLength(2);
  });

  it("sorts the biggest appropriation first", () => {
    const { rows } = summarizeUtilisation([
      allocation({ id: 1, label: "Small", appropriation: 10_000 }),
      allocation({ id: 2, label: "Large", appropriation: 500_000 }),
    ]);
    expect(rows.map((row) => row.label)).toEqual(["Large", "Small"]);
  });

  it("handles an empty scope", () => {
    const { totals, rows } = summarizeUtilisation([]);
    expect(rows).toEqual([]);
    expect(totals.utilisation).toBeNull();
    expect(totals.allocations).toBe(0);
  });
});

describe("liquidationAging", () => {
  it("buckets released money by age since release", () => {
    const naive = voucher({
      id: 1,
      releasedAt: new Date("2026-10-09T02:00:00Z"), // 3 days
    });
    const stale = voucher({ id: 2, releasedAt: new Date("2026-06-01T02:00:00Z") }); // 133 days
    const aging = liquidationAging([naive, stale], NOW);
    expect(aging.find((row) => row.bucket === "0-7")).toMatchObject({
      count: 1,
      amount: 5_000,
    });
    expect(aging.find((row) => row.bucket === "90+")).toMatchObject({
      count: 1,
      amount: 5_000,
    });
  });

  it("returns every bucket, including the empty ones, so the table is stable", () => {
    const aging = liquidationAging([], NOW);
    expect(aging.map((row) => row.bucket)).toEqual([
      "0-7",
      "8-30",
      "31-60",
      "61-90",
      "90+",
    ]);
    expect(aging.every((row) => row.count === 0)).toBe(true);
  });

  it("ignores money that never left: drafts, cancellations and liquidated vouchers", () => {
    const aging = liquidationAging(
      [
        voucher({ id: 1, status: "DRAFT", releasedAt: null }),
        voucher({ id: 2, status: "CANCELLED", releasedAt: null }),
        voucher({ id: 3, status: "LIQUIDATED", liquidationStatus: "LIQUIDATED" }),
        voucher({ id: 4, status: "RELEASED" }),
      ],
      NOW
    );
    expect(aging.reduce((sum, row) => sum + row.count, 0)).toBe(1);
  });

  it("falls back to the prepared date for rows migrated without a release date", () => {
    const aging = liquidationAging(
      [voucher({ releasedAt: null, preparedAt: new Date("2026-06-01T02:00:00Z") })],
      NOW
    );
    expect(aging.find((row) => row.bucket === "90+")?.count).toBe(1);
  });
});

describe("summarizeRegister", () => {
  it("keeps only the vouchers prepared inside the period", () => {
    const summary = summarizeRegister(
      [
        voucher({ id: 1, preparedAt: new Date("2026-10-01T01:00:00Z") }),
        voucher({ id: 2, preparedAt: new Date("2026-01-01T01:00:00Z") }),
      ],
      NINETY_DAYS,
      NOW
    );
    expect(summary.rows.map((row) => row.id)).toEqual([1]);
    expect(summary.total).toBe(5_000);
  });

  it("totals by status and counts what is still waiting for liquidation", () => {
    const summary = summarizeRegister(
      [
        voucher({ id: 1, status: "RELEASED", amount: 5_000 }),
        voucher({ id: 2, status: "RELEASED", amount: 2_500 }),
        voucher({
          id: 3,
          status: "LIQUIDATED",
          amount: 1_000,
          liquidationStatus: "LIQUIDATED",
        }),
      ],
      NINETY_DAYS,
      NOW
    );
    expect(summary.byStatus[0]).toEqual({ status: "RELEASED", count: 2, amount: 7_500 });
    expect(summary.awaitingLiquidation).toEqual({ count: 2, amount: 7_500 });
    expect(summary.total).toBe(8_500);
  });

  it("counts an unbounded period as everything", () => {
    const summary = summarizeRegister(
      [voucher({ preparedAt: new Date("2020-01-01T01:00:00Z") })],
      { key: "all", from: null, to: null, days: null },
      NOW
    );
    expect(summary.rows).toHaveLength(1);
  });
});

describe("the treasury report's liquidation figure", () => {
  const PERIOD: ReportPeriod = { key: "all", from: null, to: null, days: null };
  const ACTOR: Actor = { id: 1, roleKey: "TREASURER", officeId: null };
  const tt = copy.en.revamp.reports.treasury;

  function stat(vouchers: DisbursementRow[]) {
    const document = buildTreasuryDocument(
      {
        utilisation: summarizeUtilisation([allocation()]),
        register: summarizeRegister(vouchers, PERIOD, NOW),
        aging: liquidationAging(vouchers, NOW),
        allVouchers: vouchers,
      },
      { locale: "en", period: PERIOD, actor: ACTOR }
    );
    return document.stats.find((entry) => entry.label === tt.awaitingLiquidation);
  }

  it("flags money released more than ninety days ago", () => {
    const stale = voucher({ id: 2, releasedAt: new Date("2026-06-01T02:00:00Z") });
    expect(stat([stale])?.tone).toBe("danger");
    expect(stat([stale])?.hint).toBe("1");
  });

  it("leaves money that is merely recent uncoloured", () => {
    const fresh = voucher({ id: 3, releasedAt: new Date("2026-10-09T02:00:00Z") });
    expect(stat([fresh])?.tone).toBe("default");
  });
});
