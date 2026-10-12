import { describe, expect, it } from "vitest";
import {
  DSR_STATUTORY_WORKING_DAYS,
  addWorkingDays,
  dsrReferencePrefix,
  formatDsrReference,
  isWeekend,
  manilaYear,
  workingDaysBetween,
} from "./dates";

// 2026-10-12 is a Monday.
const MONDAY = new Date(Date.UTC(2026, 9, 12, 9, 0, 0));

describe("addWorkingDays", () => {
  it("skips weekends", () => {
    // Monday + 5 working days = the following Monday.
    const result = addWorkingDays(MONDAY, 5);
    expect(result.toISOString().slice(0, 10)).toBe("2026-10-19");
    expect(isWeekend(result)).toBe(false);
  });

  it("crosses a weekend inside the window", () => {
    const friday = new Date(Date.UTC(2026, 9, 16, 9, 0, 0));
    // Friday + 1 working day lands on Monday, not Saturday.
    expect(addWorkingDays(friday, 1).toISOString().slice(0, 10)).toBe(
      "2026-10-19"
    );
  });

  it("honours a holiday list", () => {
    const result = addWorkingDays(MONDAY, 1, ["2026-10-13"]);
    expect(result.toISOString().slice(0, 10)).toBe("2026-10-14");
  });

  it("returns the same instant for zero days and never mutates its input", () => {
    const result = addWorkingDays(MONDAY, 0);
    expect(result.getTime()).toBe(MONDAY.getTime());
    addWorkingDays(MONDAY, 10);
    expect(MONDAY.toISOString()).toBe("2026-10-12T09:00:00.000Z");
  });

  it("gives the statutory deadline 15 working days out", () => {
    const due = addWorkingDays(MONDAY, DSR_STATUTORY_WORKING_DAYS);
    // Three calendar weeks exactly (15 working days, no holidays).
    expect(due.toISOString().slice(0, 10)).toBe("2026-11-02");
  });
});

describe("workingDaysBetween", () => {
  it("counts forward and backward", () => {
    const friday = new Date(Date.UTC(2026, 9, 16, 9, 0, 0));
    expect(workingDaysBetween(MONDAY, friday)).toBe(4);
    expect(workingDaysBetween(friday, MONDAY)).toBe(-4);
  });

  it("counts zero for the same day", () => {
    expect(workingDaysBetween(MONDAY, MONDAY)).toBe(0);
  });

  it("skips a holiday", () => {
    const friday = new Date(Date.UTC(2026, 9, 16, 9, 0, 0));
    expect(workingDaysBetween(MONDAY, friday, ["2026-10-14"])).toBe(3);
  });
});

describe("reference codes", () => {
  it("formats DSR-YYYY-NNNN", () => {
    expect(formatDsrReference(2026, 7)).toBe("DSR-2026-0007");
    expect(formatDsrReference(2026, 1234)).toBe("DSR-2026-1234");
    expect(dsrReferencePrefix(2026)).toBe("DSR-2026-");
  });

  it("never emits a zero sequence", () => {
    expect(formatDsrReference(2026, 0)).toBe("DSR-2026-0001");
  });

  it("reads the year in Asia/Manila", () => {
    // 2026-12-31T16:30Z is already 2027 in Manila (UTC+8).
    expect(manilaYear(new Date("2026-12-31T16:30:00Z"))).toBe(2027);
    expect(manilaYear(new Date("2026-12-31T15:30:00Z"))).toBe(2026);
  });
});
