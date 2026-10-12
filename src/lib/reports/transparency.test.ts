import { describe, expect, it } from "vitest";

import {
  isPublicResolved,
  summarizePublic,
  summarizePublicBreakdown,
  summarizePublicMonths,
  type PublicCaseRow,
} from "@/lib/reports/transparency";

function row(overrides: Partial<PublicCaseRow> = {}): PublicCaseRow {
  return {
    status: "RESOLVED",
    typeKey: "REPAIR",
    areaLabel: "Purok 1",
    submittedAt: new Date("2026-10-01T02:00:00Z"),
    resolvedAt: new Date("2026-10-03T02:00:00Z"),
    responseHours: 48,
    published: true,
    ...overrides,
  };
}

describe("summarizePublic", () => {
  it("counts only published rows", () => {
    const totals = summarizePublic([
      row(),
      row({ published: false }),
      row({ status: "IN_PROGRESS", resolvedAt: null, responseHours: null }),
    ]);
    expect(totals.published).toBe(2);
    expect(totals.resolved).toBe(1);
    expect(totals.resolvedShare).toBe(50);
  });

  it("averages response hours over the measured resolutions only", () => {
    const totals = summarizePublic([
      row({ responseHours: 24 }),
      row({ responseHours: 72 }),
      row({ status: "IN_PROGRESS", resolvedAt: null, responseHours: null }),
    ]);
    expect(totals.averageResponseHours).toBe(48);
    expect(totals.measured).toBe(2);
  });

  it("reports null rather than zero when nothing has been measured", () => {
    const totals = summarizePublic([row({ status: "IN_PROGRESS", responseHours: null })]);
    expect(totals.averageResponseHours).toBeNull();
  });

  it("handles an empty publication", () => {
    const totals = summarizePublic([]);
    expect(totals).toMatchObject({ published: 0, resolved: 0, resolvedShare: 0 });
    expect(totals.averageResponseHours).toBeNull();
  });

  it("treats CLOSED as resolved", () => {
    expect(isPublicResolved("CLOSED")).toBe(true);
    expect(isPublicResolved("AWAITING_BUDGET")).toBe(false);
  });
});

describe("summarizePublicMonths", () => {
  const months = ["2026-08", "2026-09", "2026-10"];

  it("counts publications by submission month and resolutions by resolution month", () => {
    const rows = summarizePublicMonths(
      [
        row({ submittedAt: new Date("2026-09-15T02:00:00Z"), resolvedAt: new Date("2026-10-02T02:00:00Z") }),
        row({ submittedAt: new Date("2026-10-01T02:00:00Z"), resolvedAt: null, status: "IN_PROGRESS" }),
      ],
      months
    );
    expect(rows.find((entry) => entry.month === "2026-09")).toMatchObject({
      published: 1,
      resolved: 0,
    });
    expect(rows.find((entry) => entry.month === "2026-10")).toMatchObject({
      published: 1,
      resolved: 1,
    });
  });

  it("returns a row for every month, even the quiet ones", () => {
    expect(summarizePublicMonths([], months).map((entry) => entry.month)).toEqual(months);
  });

  it("buckets by the Manila month", () => {
    const rows = summarizePublicMonths(
      [row({ submittedAt: new Date("2026-09-30T20:00:00Z"), resolvedAt: null, status: "SUBMITTED" })],
      months
    );
    expect(rows.find((entry) => entry.month === "2026-09")?.published).toBe(0);
    expect(rows.find((entry) => entry.month === "2026-10")?.published).toBe(1);
  });
});

describe("summarizePublicBreakdown", () => {
  it("groups by a key and computes the resolved share", () => {
    const rows = summarizePublicBreakdown(
      [
        row({ typeKey: "REPAIR" }),
        row({ typeKey: "REPAIR", status: "IN_PROGRESS", resolvedAt: null }),
        row({ typeKey: "AYUDA" }),
      ],
      (entry) => (entry.typeKey ? { key: entry.typeKey, name: entry.typeKey } : null)
    );
    expect(rows[0]).toMatchObject({ key: "REPAIR", count: 2, resolved: 1, resolvedShare: 50 });
  });

  it("drops rows the picker cannot name, instead of inventing a bucket", () => {
    const rows = summarizePublicBreakdown(
      [row({ areaLabel: null })],
      (entry) => (entry.areaLabel ? { key: entry.areaLabel, name: entry.areaLabel } : null)
    );
    expect(rows).toEqual([]);
  });

  it("ignores unpublished rows", () => {
    const rows = summarizePublicBreakdown(
      [row({ published: false })],
      (entry) => ({ key: entry.typeKey ?? "x", name: entry.typeKey ?? "x" })
    );
    expect(rows).toEqual([]);
  });

  it("caps the number of rows a caller asks for", () => {
    const many = Array.from({ length: 30 }, (_, index) =>
      row({ areaLabel: `Purok ${index}` })
    );
    const rows = summarizePublicBreakdown(
      many,
      (entry) => ({ key: entry.areaLabel ?? "x", name: entry.areaLabel ?? "x" }),
      5
    );
    expect(rows).toHaveLength(5);
  });

  it("sorts the busiest first, then alphabetically", () => {
    const rows = summarizePublicBreakdown(
      [
        row({ areaLabel: "B" }),
        row({ areaLabel: "A" }),
        row({ areaLabel: "C" }),
        row({ areaLabel: "C" }),
      ],
      (entry) => ({ key: entry.areaLabel ?? "x", name: entry.areaLabel ?? "x" })
    );
    expect(rows.map((entry) => entry.key)).toEqual(["C", "A", "B"]);
  });
});
