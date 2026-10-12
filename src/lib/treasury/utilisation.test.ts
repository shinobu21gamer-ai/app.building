import { describe, expect, it } from "vitest";

import {
  liveAllocations,
  summarizeUtilisation,
  utilisationOf,
  type UtilisableAllocation,
} from "@/lib/treasury/utilisation";

function allocation(
  overrides: Partial<UtilisableAllocation> = {}
): UtilisableAllocation {
  return {
    id: 1,
    label: "Repairs - Purok 3",
    status: "APPROVED",
    coaCode: "5-02-13-040",
    coaName: "Repairs and Maintenance - Buildings and Other Structures",
    appropriation: 100_000,
    reserved: 10_000,
    disbursed: 40_000,
    available: 50_000,
    ...overrides,
  };
}

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

describe("liveAllocations", () => {
  it("leaves closed allocations out of the live figures", () => {
    const rows = [
      allocation({ id: 1, status: "APPROVED" }),
      allocation({ id: 2, status: "CLOSED" }),
      allocation({ id: 3, status: "DRAFT" }),
    ];
    expect(liveAllocations(rows).map((row) => row.id)).toEqual([1, 3]);
  });
});

describe("summarizeUtilisation", () => {
  it("totals only the live allocations, matching the dashboard rule", () => {
    const { totals, rows } = summarizeUtilisation([
      allocation(),
      allocation({
        id: 2,
        status: "CLOSED",
        appropriation: 999_999,
        disbursed: 999_999,
      }),
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
