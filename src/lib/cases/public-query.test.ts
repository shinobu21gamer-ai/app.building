import { describe, expect, it } from "vitest";

import {
  PUBLIC_PAGE_SIZE,
  PUBLIC_SELECT,
  clampPage,
  publicPageCount,
  publicWhere,
  summarizePublicCases,
} from "@/lib/cases/public-query";

describe("publicWhere", () => {
  it("always requires a published projection", () => {
    expect(publicWhere({})).toEqual({ published: true });
    expect(publicWhere({ typeKey: null, status: null, area: null })).toEqual({
      published: true,
    });
  });

  it("trims filters and ignores blanks", () => {
    expect(publicWhere({ typeKey: "  REPAIR  " })).toEqual({
      published: true,
      typeKey: "REPAIR",
    });
    expect(publicWhere({ area: "   " })).toEqual({ published: true });
  });

  it("only accepts a status the workflow knows", () => {
    expect(publicWhere({ status: "RESOLVED" })).toEqual({
      published: true,
      status: "RESOLVED",
    });
    // A crafted query string must not become an arbitrary column match.
    expect(publicWhere({ status: "'; drop table" })).toEqual({ published: true });
  });

  it("combines filters", () => {
    expect(
      publicWhere({ typeKey: "AYUDA", status: "CLOSED", area: "Purok 3" })
    ).toEqual({ published: true, typeKey: "AYUDA", status: "CLOSED", areaLabel: "Purok 3" });
  });
});

describe("pagination maths", () => {
  it("never reports zero pages", () => {
    expect(publicPageCount(0)).toBe(1);
    expect(publicPageCount(PUBLIC_PAGE_SIZE)).toBe(1);
    expect(publicPageCount(PUBLIC_PAGE_SIZE + 1)).toBe(2);
    expect(publicPageCount(438)).toBe(22);
  });

  it("clamps a page that does not exist", () => {
    expect(clampPage(undefined, 5)).toBe(1);
    expect(clampPage(0, 5)).toBe(1);
    expect(clampPage(-3, 5)).toBe(1);
    expect(clampPage(9, 5)).toBe(5);
    expect(clampPage(3, 5)).toBe(3);
    expect(clampPage(Number.NaN, 5)).toBe(1);
  });
});

describe("summarizePublicCases", () => {
  const row = (status: string, responseHours: number | null) => ({
    status,
    responseHours,
  });

  it("reports empty collections honestly", () => {
    expect(summarizePublicCases([])).toEqual({
      published: 0,
      resolved: 0,
      resolvedShare: 0,
      averageResponseHours: null,
    });
  });

  it("counts closed cases as resolved work", () => {
    const stats = summarizePublicCases([
      row("RESOLVED", 48),
      row("CLOSED", 72),
      row("IN_PROGRESS", null),
      row("SUBMITTED", null),
    ]);
    expect(stats.published).toBe(4);
    expect(stats.resolved).toBe(2);
    expect(stats.resolvedShare).toBeCloseTo(0.5, 6);
    expect(stats.averageResponseHours).toBe(60);
  });

  it("averages only the cases that recorded a time", () => {
    const stats = summarizePublicCases([
      row("RESOLVED", 10),
      row("RESOLVED", null),
      row("IN_PROGRESS", 5),
    ]);
    expect(stats.resolved).toBe(2);
    expect(stats.averageResponseHours).toBe(10);
  });

  it("ignores a negative time rather than skewing the average", () => {
    const stats = summarizePublicCases([row("RESOLVED", -4), row("RESOLVED", 20)]);
    expect(stats.averageResponseHours).toBe(20);
  });

  it("returns no average when nothing was measured", () => {
    expect(summarizePublicCases([row("RESOLVED", null)]).averageResponseHours).toBeNull();
  });
});

describe("PUBLIC_SELECT", () => {
  it("cannot reach a resident: no concern id, no user, no case number", () => {
    const columns = Object.keys(PUBLIC_SELECT);
    expect(columns).not.toContain("concernId");
    expect(columns).not.toContain("id");
    expect(columns).not.toContain("caseNumber");
    expect(columns).not.toContain("userId");
    expect(columns).not.toContain("concern");
  });
});
