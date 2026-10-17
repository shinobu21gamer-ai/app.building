import { describe, expect, it } from "vitest";
import { loginReportDueAt } from "./login-report-deadline";

function instant(manila: string) {
  return new Date(`${manila}+08:00`);
}

describe("loginReportDueAt", () => {
  it("counts one nine-hour Manila workday from within office hours", () => {
    expect(loginReportDueAt(instant("2026-10-19T09:00:00")).toISOString())
      .toBe("2026-10-20T01:00:00.000Z");
  });

  it("rolls the remaining work hours over a weekend", () => {
    expect(loginReportDueAt(instant("2026-10-16T16:00:00")).toISOString())
      .toBe("2026-10-19T08:00:00.000Z");
  });

  it("starts after hours on the next business day", () => {
    expect(loginReportDueAt(instant("2026-10-19T18:00:00")).toISOString())
      .toBe("2026-10-20T09:00:00.000Z");
  });

  it("skips PH regular holidays and published special non-working days", () => {
    expect(loginReportDueAt(instant("2026-12-29T16:00:00")).toISOString())
      .toBe("2027-01-04T08:00:00.000Z");
    expect(loginReportDueAt(instant("2026-08-20T16:00:00")).toISOString())
      .toBe("2026-08-24T08:00:00.000Z");
  });
});
