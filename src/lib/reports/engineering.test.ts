import { describe, expect, it } from "vitest";

import {
  REPORT_ROW_LIMIT,
  summarizeCrew,
  summarizeSla,
  summarizeTurnaround,
  summarizeVolume,
  workingDaysIn,
  type CrewAssignmentRow,
  type EngineeringCaseRow,
  type EscalationRow,
} from "@/lib/reports/engineering";

const DAY = 86_400_000;

function caseRow(overrides: Partial<EngineeringCaseRow> = {}): EngineeringCaseRow {
  return {
    id: 1,
    caseNumber: "BR-2026-0001",
    status: "SUBMITTED",
    priorityLevel: "MEDIUM",
    typeKey: "REPAIR",
    typeName: "Repair",
    categoryName: "Infrastructure",
    areaLabel: "Purok 1",
    submittedAt: new Date("2026-10-01T02:00:00Z"),
    resolvedAt: null,
    closedAt: null,
    slaDueAt: new Date("2026-10-03T02:00:00Z"),
    slaBreachedAt: null,
    workersNeeded: 2,
    estimatedHours: 8,
    ...overrides,
  };
}

function crewRow(overrides: Partial<CrewAssignmentRow> = {}): CrewAssignmentRow {
  return {
    crewId: 7,
    crewName: "Ana Cruz",
    trade: null,
    concernId: 100,
    isActive: true,
    scheduledStartAt: new Date("2026-10-05T01:00:00Z"),
    scheduledEndAt: new Date("2026-10-05T09:00:00Z"),
    plannedHours: 8,
    ...overrides,
  };
}

describe("summarizeVolume", () => {
  const months = ["2026-09", "2026-10"];

  it("counts every status, including the empty ones", () => {
    const summary = summarizeVolume(
      [
        caseRow({ status: "SUBMITTED" }),
        caseRow({
          id: 2,
          status: "RESOLVED",
          resolvedAt: new Date("2026-10-02T02:00:00Z"),
        }),
      ],
      months
    );
    expect(summary.total).toBe(2);
    expect(summary.open).toBe(1);
    expect(summary.byStatus).toHaveLength(7);
    expect(summary.byStatus.find((row) => row.status === "SUBMITTED")?.count).toBe(1);
    expect(summary.byStatus.find((row) => row.status === "SUBMITTED")?.share).toBe(50);
    expect(summary.byStatus.find((row) => row.status === "CLOSED")?.count).toBe(0);
  });

  it("groups by service type and falls back to the category", () => {
    const summary = summarizeVolume(
      [
        caseRow(),
        caseRow({ id: 2, typeKey: "REPAIR", typeName: "Repair" }),
        caseRow({ id: 3, typeKey: null, typeName: null, categoryName: "Welfare" }),
      ],
      months
    );
    expect(summary.byType.find((row) => row.key === "REPAIR")?.count).toBe(2);
    expect(summary.byType.find((row) => row.key === "UNCLASSIFIED")?.name).toBe(
      "Welfare"
    );
  });

  it("counts resolved share per type", () => {
    const summary = summarizeVolume(
      [
        caseRow({ status: "RESOLVED", resolvedAt: new Date("2026-10-02T02:00:00Z") }),
        caseRow({ id: 2, status: "IN_PROGRESS" }),
      ],
      months
    );
    expect(summary.byType[0]).toMatchObject({ count: 2, resolved: 1, resolvedShare: 50 });
  });

  it("buckets areas, with an em dash for a case with no purok", () => {
    const summary = summarizeVolume(
      [
        caseRow({ areaLabel: "Purok 1" }),
        caseRow({ id: 2, areaLabel: "Purok 1", status: "RESOLVED" }),
        caseRow({ id: 3, areaLabel: null }),
      ],
      months
    );
    expect(summary.byArea.find((row) => row.area === "Purok 1")).toEqual({
      area: "Purok 1",
      count: 2,
      open: 1,
    });
    expect(summary.byArea.some((row) => row.area === "—")).toBe(true);
  });

  it("buckets submissions and resolutions into the Manila month", () => {
    const summary = summarizeVolume(
      [
        // 2026-09-30T20:00Z is 1 October in Manila.
        caseRow({ submittedAt: new Date("2026-09-30T20:00:00Z") }),
        caseRow({
          id: 2,
          submittedAt: new Date("2026-10-01T02:00:00Z"),
          status: "RESOLVED",
          resolvedAt: new Date("2026-10-05T02:00:00Z"),
        }),
      ],
      months
    );
    expect(summary.byMonth.find((row) => row.month === "2026-09")?.submitted).toBe(0);
    const october = summary.byMonth.find((row) => row.month === "2026-10");
    expect(october?.submitted).toBe(2);
    expect(october?.resolved).toBe(1);
  });

  it("always returns a row for every requested month", () => {
    const summary = summarizeVolume([], months);
    expect(summary.byMonth.map((row) => row.month)).toEqual(months);
    expect(summary.byMonth.every((row) => row.submitted === 0)).toBe(true);
  });
});

describe("summarizeTurnaround", () => {
  it("measures submission to resolution and ignores unfinished cases", () => {
    const summary = summarizeTurnaround([
      caseRow({
        status: "RESOLVED",
        submittedAt: new Date("2026-10-01T00:00:00Z"),
        resolvedAt: new Date("2026-10-02T00:00:00Z"),
      }),
      caseRow({
        id: 2,
        status: "RESOLVED",
        submittedAt: new Date("2026-10-01T00:00:00Z"),
        resolvedAt: new Date("2026-10-04T00:00:00Z"),
      }),
      caseRow({ id: 3 }),
    ]);
    expect(summary.resolvedSample).toBe(2);
    // 24 h and 72 h → a 48 h mean; the median of two values is the lower one.
    expect(summary.averageHours).toBe(48);
    expect(summary.medianHours).toBe(24);
    expect(summary.p90Hours).toBe(72);
  });

  it("reports nulls rather than NaN when nothing has been resolved", () => {
    const summary = summarizeTurnaround([caseRow()]);
    expect(summary).toMatchObject({
      resolvedSample: 0,
      averageHours: null,
      medianHours: null,
      p90Hours: null,
      averageCloseHours: null,
    });
  });

  it("ignores negative durations from bad data", () => {
    const summary = summarizeTurnaround([
      caseRow({
        status: "RESOLVED",
        submittedAt: new Date("2026-10-05T00:00:00Z"),
        resolvedAt: new Date("2026-10-01T00:00:00Z"),
      }),
    ]);
    expect(summary.resolvedSample).toBe(0);
  });

  it("measures closing separately from resolving", () => {
    const summary = summarizeTurnaround([
      caseRow({
        status: "CLOSED",
        submittedAt: new Date("2026-10-01T00:00:00Z"),
        resolvedAt: new Date("2026-10-02T00:00:00Z"),
        closedAt: new Date("2026-10-06T00:00:00Z"),
      }),
    ]);
    expect(summary.averageHours).toBe(24);
    expect(summary.closedSample).toBe(1);
    expect(summary.averageCloseHours).toBe(120);
  });
});

describe("summarizeSla", () => {
  const now = new Date("2026-10-12T02:00:00Z");

  it("measures compliance over the cases that were resolved with a clock", () => {
    const summary = summarizeSla(
      [
        caseRow({
          status: "RESOLVED",
          submittedAt: new Date("2026-10-01T00:00:00Z"),
          resolvedAt: new Date("2026-10-02T00:00:00Z"),
          slaDueAt: new Date("2026-10-03T00:00:00Z"),
        }),
        caseRow({
          id: 2,
          status: "RESOLVED",
          submittedAt: new Date("2026-10-01T00:00:00Z"),
          resolvedAt: new Date("2026-10-05T00:00:00Z"),
          slaDueAt: new Date("2026-10-03T00:00:00Z"),
        }),
      ],
      [],
      now
    );
    expect(summary.resolvedMeasured).toBe(2);
    expect(summary.withinSla).toBe(1);
    expect(summary.complianceRate).toBe(50);
    expect(summary.breached).toBe(1);
  });

  it("counts an old unresolved case as overdue today", () => {
    const summary = summarizeSla(
      [
        caseRow({ id: 2, slaDueAt: new Date("2026-09-01T00:00:00Z") }),
        caseRow({ id: 3, slaDueAt: new Date("2026-12-01T00:00:00Z") }),
        caseRow({ id: 4, slaDueAt: null }),
      ],
      [],
      now
    );
    expect(summary.openCases).toBe(3);
    expect(summary.overdueNow).toBe(1);
    expect(summary.averageOverdueHours).toBeGreaterThan(900);
    expect(summary.complianceRate).toBeNull();
  });

  it("groups escalations by level and counts the ones still open", () => {
    const escalations: EscalationRow[] = [
      { level: 1, acknowledgedAt: null, resolvedAt: null },
      { level: 1, acknowledgedAt: new Date(), resolvedAt: new Date() },
      { level: 2, acknowledgedAt: new Date(), resolvedAt: null },
    ];
    const summary = summarizeSla([], escalations, now);
    expect(summary.escalations).toEqual([
      { level: 1, count: 2, open: 1 },
      { level: 2, count: 1, open: 1 },
    ]);
    expect(summary.escalationsOpen).toBe(2);
  });

  it("counts a case that broke its clock even after it was resolved", () => {
    const summary = summarizeSla(
      [
        caseRow({
          status: "RESOLVED",
          submittedAt: new Date("2026-10-01T00:00:00Z"),
          resolvedAt: new Date("2026-10-09T00:00:00Z"),
          slaDueAt: new Date("2026-10-03T00:00:00Z"),
          slaBreachedAt: new Date("2026-10-04T00:00:00Z"),
        }),
      ],
      [],
      now
    );
    expect(summary.breached).toBe(1);
    expect(summary.complianceRate).toBe(0);
  });

  it("leaves the compliance rate null rather than zero when nothing was measured", () => {
    expect(summarizeSla([caseRow()], [], now).complianceRate).toBeNull();
  });
});

describe("summarizeCrew", () => {
  it("aggregates assignments, active work and planned hours per member", () => {
    const summary = summarizeCrew(
      [
        crewRow(),
        crewRow({ concernId: 101, isActive: false, plannedHours: 4 }),
        crewRow({ crewId: 8, crewName: "Ben Reyes", plannedHours: null, concernId: 102 }),
      ],
      90
    );
    const ana = summary.members.find((row) => row.crewId === 7);
    expect(ana?.assignments).toBe(2);
    expect(ana?.activeJobs).toBe(1);
    expect(ana?.plannedHours).toBe(12);
    expect(summary.totalPlannedHours).toBe(12);
  });

  it("expresses planned hours as a share of the period's working hours", () => {
    const summary = summarizeCrew([crewRow({ plannedHours: 8 })], 7);
    // 7 calendar days ≈ 5 working days ≈ 40 h, so 8 h is 20%.
    expect(summary.members[0].utilisation).toBe(20);
  });

  it("counts overlapping windows, and ignores assignments with no window", () => {
    const summary = summarizeCrew(
      [
        crewRow({ concernId: 1 }),
        crewRow({
          concernId: 2,
          scheduledStartAt: new Date("2026-10-05T05:00:00Z"),
          scheduledEndAt: new Date("2026-10-05T12:00:00Z"),
        }),
        crewRow({
          concernId: 3,
          scheduledStartAt: new Date("2026-10-06T01:00:00Z"),
          scheduledEndAt: new Date("2026-10-06T09:00:00Z"),
        }),
        crewRow({ concernId: 4, scheduledStartAt: null, scheduledEndAt: null }),
      ],
      90
    );
    expect(summary.members[0].overlaps).toBe(1);
    expect(summary.overlaps).toBe(1);
  });

  it("treats touching windows as consecutive shifts, not a conflict", () => {
    const summary = summarizeCrew(
      [
        crewRow({
          concernId: 1,
          scheduledStartAt: new Date("2026-10-05T01:00:00Z"),
          scheduledEndAt: new Date("2026-10-05T05:00:00Z"),
        }),
        crewRow({
          concernId: 2,
          scheduledStartAt: new Date("2026-10-05T05:00:00Z"),
          scheduledEndAt: new Date("2026-10-05T09:00:00Z"),
        }),
      ],
      30
    );
    expect(summary.overlaps).toBe(0);
  });

  it("sorts the busiest member first", () => {
    const summary = summarizeCrew(
      [
        crewRow({ crewId: 1, crewName: "One", isActive: false }),
        crewRow({ crewId: 2, crewName: "Two", isActive: true, concernId: 2 }),
        crewRow({ crewId: 2, crewName: "Two", isActive: true, concernId: 3 }),
      ],
      90
    );
    expect(summary.members[0].crewId).toBe(2);
  });

  it("reports no utilisation when nothing was planned", () => {
    const summary = summarizeCrew([crewRow({ plannedHours: null })], 30);
    expect(summary.members[0].plannedHours).toBeNull();
    expect(summary.members[0].utilisation).toBeNull();
  });

  it("handles an empty roster", () => {
    const summary = summarizeCrew([], 30);
    expect(summary.members).toEqual([]);
    expect(summary.overlaps).toBe(0);
  });
});

describe("workingDaysIn", () => {
  it("assumes five working days per calendar week", () => {
    expect(workingDaysIn(7)).toBe(5);
    expect(workingDaysIn(30)).toBe(21);
  });

  it("falls back to a quarter of a year for an unbounded period", () => {
    expect(workingDaysIn(null)).toBe(64);
  });

  it("never returns zero, so each member has a denominator", () => {
    expect(workingDaysIn(0)).toBe(1);
  });
});

describe("the report's row budget", () => {
  it("caps what a summary will read", () => {
    expect(REPORT_ROW_LIMIT).toBe(5000);
  });

  it("keeps the day constant honest for the fixtures above", () => {
    expect(DAY).toBe(86_400_000);
  });
});
