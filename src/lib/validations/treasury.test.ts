import { describe, expect, it } from "vitest";
import {
  crewPaymentRequestActionSchema,
  disbursementCrewBatchSchema,
  fiscalYearCreateSchema,
} from "./treasury";

describe("crewPaymentRequestActionSchema", () => {
  it("accepts per-person Pay amounts and Hold reasons in one request", () => {
    expect(crewPaymentRequestActionSchema.safeParse({
      earmarkId: 9,
      decisions: [
        { lineId: 31, action: "PAY", amount: 125.5 },
        { lineId: 32, action: "HOLD", reason: "Confirm hours." },
      ],
    }).success).toBe(true);
  });

  it("rejects repeated crew lines and a Hold without a meaningful reason", () => {
    expect(crewPaymentRequestActionSchema.safeParse({
      earmarkId: null,
      decisions: [
        { lineId: 31, action: "HOLD", reason: "Wait" },
        { lineId: 31, action: "PAY", amount: 125 },
      ],
    }).success).toBe(false);
  });
});

describe("disbursementCrewBatchSchema", () => {
  const batch = {
    allocationId: 7,
    earmarkId: 9,
    concernId: 12,
    crew: [
      { payeeUserId: 31, amount: 100 },
      { payeeUserId: 32, amount: 200 },
    ],
  };

  it("accepts distinct crew members for one case and earmark", () => {
    expect(disbursementCrewBatchSchema.safeParse(batch).success).toBe(true);
  });

  it("rejects duplicate crew members within a batch", () => {
    const result = disbursementCrewBatchSchema.safeParse({
      ...batch,
      crew: [batch.crew[0], { ...batch.crew[0], amount: 50 }],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path.join(".") === "crew.1.payeeUserId")).toBe(true);
    }
  });
});

// Far-future dates so these checks never go stale relative to "today" as the
// fiscal-year schema also refines startsOn/endsOn against todayManila().
describe("fiscalYearCreateSchema", () => {
  it("accepts a real calendar date range", () => {
    const result = fiscalYearCreateSchema.safeParse({
      year: 2031,
      startsOn: "2031-01-01",
      endsOn: "2031-12-31",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a date that does not exist instead of silently rolling it over", () => {
    // Without the calendar-validity check, "2031-02-30" would pass the shape
    // regex and then `new Date("2031-02-30T00:00:00Z")` would quietly roll
    // over to March 2 — the stored fiscal year would start on a different day
    // than the one typed in, with no error anywhere in the chain.
    const result = fiscalYearCreateSchema.safeParse({
      year: 2031,
      startsOn: "2031-02-30",
      endsOn: "2031-12-31",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path.includes("startsOn"))).toBe(true);
      expect(result.error.issues.some((issue) => /does not exist/.test(issue.message))).toBe(true);
    }
  });

  it("rejects an out-of-range month or day, not just a wrong day count", () => {
    expect(
      fiscalYearCreateSchema.safeParse({
        year: 2031,
        startsOn: "2031-13-01",
        endsOn: "2031-12-31",
      }).success
    ).toBe(false);

    expect(
      fiscalYearCreateSchema.safeParse({
        year: 2031,
        startsOn: "2031-01-01",
        endsOn: "2031-00-00",
      }).success
    ).toBe(false);
  });

  it("still enforces end-after-start and no-past-dates with valid calendar dates", () => {
    const reversed = fiscalYearCreateSchema.safeParse({
      year: 2031,
      startsOn: "2031-12-31",
      endsOn: "2031-01-01",
    });
    expect(reversed.success).toBe(false);

    const past = fiscalYearCreateSchema.safeParse({
      year: 2020,
      startsOn: "2020-01-01",
      endsOn: "2020-12-31",
    });
    expect(past.success).toBe(false);
  });
});
