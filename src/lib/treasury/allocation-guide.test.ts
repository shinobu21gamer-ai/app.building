import { describe, expect, it } from "vitest";

import {
  allocationBlockers,
  allocationLabel,
  allocationPrefill,
  appropriationValue,
  checkAppropriation,
  findExistingAllocation,
  MAX_APPROPRIATION,
  onlyOptionId,
  openFiscalYears,
  prefillIsEmpty,
  recommendFiscalYear,
  type RegisterLine,
} from "./allocation-guide";

const lines: RegisterLine[] = [
  {
    id: 7,
    label: "FY 2026 — GF — 5-02-13-030 — Repairs and Maintenance — Barangay-wide",
    status: "APPROVED",
    fiscalYearId: 2,
    fundSourceCode: "GF",
    coaCode: "5-02-13-030",
    officeId: null,
  },
  {
    id: 8,
    label: "FY 2026 — GF — 5-02-13-030 — Repairs and Maintenance — Engineering",
    status: "DRAFT",
    fiscalYearId: 2,
    fundSourceCode: "GF",
    coaCode: "5-02-13-030",
    officeId: 3,
  },
  {
    id: 9,
    label: "FY 2025 — DF20 — 5-02-13-030 — Repairs and Maintenance — Barangay-wide",
    status: "CLOSED",
    fiscalYearId: 1,
    fundSourceCode: "DF20",
    coaCode: "5-02-13-030",
    officeId: null,
  },
];

describe("openFiscalYears", () => {
  it("drops the closed years", () => {
    const years = [
      { id: 1, year: 2025, isClosed: true },
      { id: 2, year: 2026, isClosed: false },
    ];
    expect(openFiscalYears(years).map((year) => year.id)).toEqual([2]);
  });
});

describe("recommendFiscalYear", () => {
  it("suggests the newest open year, not the newest year", () => {
    const years = [
      { id: 3, year: 2027, isClosed: true },
      { id: 2, year: 2026, isClosed: false },
      { id: 1, year: 2025, isClosed: false },
    ];
    expect(recommendFiscalYear(years)?.id).toBe(2);
  });

  it("suggests nothing when every year is closed", () => {
    expect(
      recommendFiscalYear([{ id: 1, year: 2025, isClosed: true }])
    ).toBeNull();
  });

  it("suggests nothing when there are no years at all", () => {
    expect(recommendFiscalYear([])).toBeNull();
  });
});

describe("onlyOptionId", () => {
  it("returns the id when there is no choice to make", () => {
    expect(onlyOptionId([{ id: 4 }])).toBe(4);
  });

  it("returns nothing when the reader has a choice", () => {
    expect(onlyOptionId([{ id: 4 }, { id: 5 }])).toBeNull();
    expect(onlyOptionId([])).toBeNull();
  });
});

describe("allocationBlockers", () => {
  const year = [{ id: 1, year: 2026, isClosed: false }];

  it("is empty when everything a line needs exists", () => {
    expect(
      allocationBlockers({ fiscalYears: year, fundSources: [{}], coaAccounts: [{}] })
    ).toEqual([]);
  });

  it("names every missing piece, in the order they have to be fixed", () => {
    expect(
      allocationBlockers({ fiscalYears: [], fundSources: [], coaAccounts: [] })
    ).toEqual([
      "NO_OPEN_FISCAL_YEAR",
      "NO_VERIFIED_FUND_SOURCE",
      "NO_VERIFIED_COA_ACCOUNT",
    ]);
  });

  it("treats an all-closed register of years as no open year", () => {
    expect(
      allocationBlockers({
        fiscalYears: [{ id: 1, year: 2026, isClosed: true }],
        fundSources: [{}],
        coaAccounts: [{}],
      })
    ).toEqual(["NO_OPEN_FISCAL_YEAR"]);
  });
});

describe("allocationLabel", () => {
  it("builds the exact sentence the register stores", () => {
    expect(
      allocationLabel({
        fiscalYear: 2026,
        fundSourceCode: "GF",
        coaCode: "5-02-13-030",
        coaName: "Repairs and Maintenance",
        officeName: null,
        officeWideLabel: "Barangay-wide",
      })
    ).toBe(
      "FY 2026 — GF — 5-02-13-030 — Repairs and Maintenance — Barangay-wide"
    );
  });

  it("names the office when the line belongs to one", () => {
    expect(
      allocationLabel({
        fiscalYear: 2026,
        fundSourceCode: "GF",
        coaCode: "5-02-13-030",
        coaName: "Repairs and Maintenance",
        officeName: "Engineering",
        officeWideLabel: "Barangay-wide",
      })
    ).toContain("Engineering");
  });

  it("leaves out what is not chosen yet instead of writing 'undefined'", () => {
    expect(
      allocationLabel({
        fiscalYear: 2026,
        fundSourceCode: null,
        coaCode: null,
        coaName: null,
        officeName: null,
        officeWideLabel: "Barangay-wide",
      })
    ).toBe("FY 2026 — Barangay-wide");
  });

  it("stays within the 160 characters the schema allows", () => {
    const label = allocationLabel({
      fiscalYear: 2026,
      fundSourceCode: "GF",
      coaCode: "5-02-13-030",
      coaName: "x".repeat(400),
      officeName: null,
      officeWideLabel: "Barangay-wide",
    });
    expect(label.length).toBe(160);
  });
});

describe("findExistingAllocation", () => {
  const key = {
    fiscalYearId: 2,
    fundSourceCode: "GF",
    coaCode: "5-02-13-030",
    officeId: null,
  };

  it("finds the barangay-wide line for the same year, fund and code", () => {
    expect(findExistingAllocation(lines, key)?.id).toBe(7);
  });

  it("keeps the office lines apart from the barangay-wide one", () => {
    expect(
      findExistingAllocation(lines, { ...key, officeId: 3 })?.id
    ).toBe(8);
  });

  it("counts a closed line too — the service refuses regardless of status", () => {
    expect(
      findExistingAllocation(lines, {
        fiscalYearId: 1,
        fundSourceCode: "DF20",
        coaCode: "5-02-13-030",
        officeId: null,
      })?.id
    ).toBe(9);
  });

  it("says nothing until the three choices that form the key are made", () => {
    expect(findExistingAllocation(lines, { ...key, fiscalYearId: null })).toBeNull();
    expect(findExistingAllocation(lines, { ...key, fundSourceCode: null })).toBeNull();
    expect(findExistingAllocation(lines, { ...key, coaCode: null })).toBeNull();
  });

  it("says nothing about a combination the register does not hold", () => {
    expect(findExistingAllocation(lines, { ...key, coaCode: "5-02-03-010" })).toBeNull();
    expect(findExistingAllocation(lines, { ...key, fiscalYearId: 5 })).toBeNull();
  });

  it("matches nothing against an empty register", () => {
    expect(findExistingAllocation([], key)).toBeNull();
  });
});

describe("checkAppropriation", () => {
  it("accepts what the server accepts", () => {
    expect(checkAppropriation("150000")).toBe("OK");
    expect(checkAppropriation(" 150000.50 ")).toBe("OK");
    expect(checkAppropriation(String(MAX_APPROPRIATION))).toBe("OK");
    expect(appropriationValue("150000.555")).toBe(150000.56);
  });

  it("names each way an amount can be wrong", () => {
    expect(checkAppropriation("")).toBe("EMPTY");
    expect(checkAppropriation("   ")).toBe("EMPTY");
    expect(checkAppropriation("abc")).toBe("NOT_A_NUMBER");
    expect(checkAppropriation("0")).toBe("NOT_POSITIVE");
    expect(checkAppropriation("-500")).toBe("NOT_POSITIVE");
    expect(checkAppropriation(String(MAX_APPROPRIATION + 1))).toBe("TOO_LARGE");
  });

  it("has no value to send unless the amount is usable", () => {
    expect(appropriationValue("")).toBeNull();
    expect(appropriationValue("0")).toBeNull();
    expect(appropriationValue("abc")).toBeNull();
  });
});

describe("allocationPrefill", () => {
  const officeIds = [3, 4];

  it("carries the amount, office and case a funding panel hands over", () => {
    const prefill = allocationPrefill(
      { amount: "18500", office: "3", case: "BR-20261014-0001" },
      { officeIds }
    );
    expect(prefill).toEqual({
      amount: 18500,
      officeId: 3,
      caseNumber: "BR-20261014-0001",
      concernId: null,
    });
    expect(prefillIsEmpty(prefill)).toBe(false);
  });

  it("rounds the money to centavos, the way the ledger stores it", () => {
    expect(
      allocationPrefill({ amount: "18500.555" }, { officeIds }).amount
    ).toBe(18500.56);
  });

  it("drops an office id that is not a real office", () => {
    expect(
      allocationPrefill({ amount: "100", office: "99" }, { officeIds }).officeId
    ).toBeNull();
    expect(
      allocationPrefill({ amount: "100", office: "abc" }, { officeIds }).officeId
    ).toBeNull();
  });

  it("drops an amount that is not money", () => {
    for (const amount of ["", "0", "-5", "abc", "NaN", "9999999999999"]) {
      expect(
        allocationPrefill({ amount }, { officeIds }).amount,
        `amount "${amount}" must be dropped`
      ).toBeNull();
    }
  });

  it("keeps a case number as a short label, never as the whole query", () => {
    const prefill = allocationPrefill(
      { case: `  ${"9".repeat(80)}  ` },
      { officeIds }
    );
    expect(prefill.caseNumber).toHaveLength(40);
  });

  it("carries the case's id so the reader can go back to it", () => {
    const prefill = allocationPrefill(
      { case: "BR-20261014-0001", concern: "42" },
      { officeIds }
    );
    expect(prefill.concernId).toBe(42);
    expect(prefillIsEmpty(prefill)).toBe(false);
  });

  it("drops a case id that is not one", () => {
    for (const concern of ["", "0", "-1", "abc", "3.5"]) {
      expect(
        allocationPrefill({ concern }, { officeIds }).concernId,
        `concern "${concern}" must be dropped`
      ).toBeNull();
    }
  });

  it("is empty when the link carries nothing usable", () => {
    expect(allocationPrefill({}, { officeIds })).toEqual({
      amount: null,
      officeId: null,
      caseNumber: null,
      concernId: null,
    });
    expect(prefillIsEmpty(allocationPrefill({}, { officeIds }))).toBe(true);
  });
});
