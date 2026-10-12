import { describe, expect, it } from "vitest";
import {
  DSR_STATUTORY_WORKING_DAYS,
  DSR_WARNING_WORKING_DAYS,
  addWorkingDays,
  dsrDeadlineState,
  dsrWorkingDaysRemaining,
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

describe("dsrDeadlineState", () => {
  const at = (iso: string) => new Date(`${iso}T09:00:00Z`);

  it("warns three working days out, and only then", () => {
    expect(DSR_WARNING_WORKING_DAYS).toBe(3);
    // Monday → Thursday is three working days; Monday → Friday is four.
    expect(dsrDeadlineState({ dueAt: at("2026-10-15"), now: MONDAY })).toBe("due_soon");
    expect(dsrDeadlineState({ dueAt: at("2026-10-16"), now: MONDAY })).toBe("open");
  });

  it("treats the deadline day itself as due soon, not late", () => {
    expect(dsrDeadlineState({ dueAt: at("2026-10-12"), now: MONDAY })).toBe("due_soon");
    expect(dsrWorkingDaysRemaining(at("2026-10-12"), MONDAY)).toBe(0);
  });

  it("uses the deadline instant for lateness, so the card agrees with the counts", () => {
    // Due at 00:30 today, looked at at 09:00: the deadline has passed, so this
    // is late even though it is the same working day.
    expect(
      dsrDeadlineState({
        dueAt: new Date("2026-10-12T00:30:00Z"),
        now: MONDAY,
      })
    ).toBe("late");
  });

  it("is late the next working day, and skips the weekend counting", () => {
    // Due Friday, looked at on Monday: one working day late, not three.
    expect(
      dsrDeadlineState({ dueAt: at("2026-10-16"), now: at("2026-10-19") })
    ).toBe("late");
    expect(dsrWorkingDaysRemaining(at("2026-10-16"), at("2026-10-19"))).toBe(-1);
  });

  it("says nothing when there is no deadline or the request is decided", () => {
    expect(dsrDeadlineState({ dueAt: null, now: MONDAY })).toBe("none");
    expect(
      dsrDeadlineState({
        dueAt: at("2026-10-05"),
        resolvedAt: at("2026-10-04"),
        now: MONDAY,
      })
    ).toBe("none");
  });

  it("accepts a caller's own warning window and holiday list", () => {
    expect(
      dsrDeadlineState({ dueAt: at("2026-10-16"), now: MONDAY, warningWorkingDays: 4 })
    ).toBe("due_soon");
    expect(
      dsrDeadlineState({
        dueAt: at("2026-10-15"),
        now: MONDAY,
        warningWorkingDays: 0,
      })
    ).toBe("open");
    // A holiday inside the window shortens the remaining working days.
    expect(
      dsrWorkingDaysRemaining(at("2026-10-16"), MONDAY, ["2026-10-14"])
    ).toBe(3);
  });
});
