import { describe, expect, it } from "vitest";

import {
  HIGH_PRIORITY_LEVELS,
  PENDING_STATUSES,
  average,
  closeHours,
  hoursBetween,
  isResolvedStatus,
  officeTallies,
  percentile,
  priorityTallies,
  resolveHours,
  roundHours,
  statusTallies,
  summarizeDurations,
} from "@/lib/cases/figures";
import { CASE_STATUSES, PRIORITY_LEVELS } from "@/lib/cases/workflow";

const HOUR = 3_600_000;
const at = (hoursFromStart: number) =>
  new Date(Date.UTC(2026, 9, 1) + hoursFromStart * HOUR);

describe("the shared case vocabulary", () => {
  it("calls resolved and closed finished, and everything else open", () => {
    expect(isResolvedStatus("RESOLVED")).toBe(true);
    expect(isResolvedStatus("CLOSED")).toBe(true);
    for (const status of ["SUBMITTED", "ASSIGNED", "UNDER_ASSESSMENT", "IN_PROGRESS"]) {
      expect(isResolvedStatus(status)).toBe(false);
    }
  });

  it("names only statuses and levels the workflow knows", () => {
    for (const status of PENDING_STATUSES) {
      expect(CASE_STATUSES).toContain(status);
    }
    for (const level of HIGH_PRIORITY_LEVELS) {
      expect(PRIORITY_LEVELS).toContain(level);
    }
  });
});

describe("hoursBetween", () => {
  it("measures forward spans and refuses the rest", () => {
    expect(hoursBetween(at(0), at(6))).toBe(6);
    expect(hoursBetween(at(0), null)).toBeNull();
    // Bad data: a resolution before the submission is not a duration.
    expect(hoursBetween(at(6), at(0))).toBeNull();
  });
});

describe("resolveHours and closeHours", () => {
  const rows = [
    { submittedAt: at(0), resolvedAt: at(24), closedAt: at(30) },
    { submittedAt: at(0), resolvedAt: null, closedAt: null },
    { submittedAt: at(48), resolvedAt: at(48), closedAt: at(72) },
  ];

  it("drops cases without a finish line and keeps the clock honest", () => {
    expect(resolveHours(rows)).toEqual([24, 0]);
    // Resolving is measured separately from closing.
    expect(closeHours(rows)).toEqual([30, 24]);
  });

  it("ignores negative durations from bad data", () => {
    expect(
      resolveHours([{ submittedAt: at(10), resolvedAt: at(0) }])
    ).toEqual([]);
  });
});

describe("percentile and average", () => {
  it("returns null for an empty sample", () => {
    expect(percentile([], 0.5)).toBeNull();
    expect(average([])).toBeNull();
  });

  it("uses nearest-rank for percentiles", () => {
    const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(percentile(values, 0.5)).toBe(5);
    expect(percentile(values, 0.9)).toBe(9);
    expect(percentile(values, 1)).toBe(10);
  });

  it("does not mutate the caller's array", () => {
    const values = [3, 1, 2];
    percentile(values, 0.5);
    expect(values).toEqual([3, 1, 2]);
  });
});

describe("summarizeDurations", () => {
  it("reports nulls rather than NaN when nothing finished", () => {
    expect(summarizeDurations([])).toEqual({
      sampleSize: 0,
      averageHours: null,
      medianHours: null,
      p90Hours: null,
      fastestHours: null,
      slowestHours: null,
    });
  });

  it("summarises a sample without rounding the measurement", () => {
    const summary = summarizeDurations([24, 72, 25.6]);
    expect(summary.sampleSize).toBe(3);
    expect(summary.averageHours).toBeCloseTo(40.5333, 3);
    // The median of three values is the middle one, not the mean.
    expect(summary.medianHours).toBe(25.6);
    expect(summary.fastestHours).toBe(24);
    expect(summary.slowestHours).toBe(72);
  });
});

describe("roundHours", () => {
  it("is the one place an hours figure is rounded for display", () => {
    expect(roundHours(40.53333)).toBe(40.5);
    expect(roundHours(null)).toBeNull();
  });
});

describe("statusTallies", () => {
  it("counts every status in workflow order, including the empty ones", () => {
    const tallies = statusTallies(new Map([["IN_PROGRESS", 3], ["SUBMITTED", 1]]));
    expect(tallies.map((entry) => entry.status)).toEqual([...CASE_STATUSES]);
    expect(tallies.find((entry) => entry.status === "IN_PROGRESS")?.count).toBe(3);
    expect(tallies.find((entry) => entry.status === "CLOSED")?.count).toBe(0);
    // A status the workflow does not know cannot invent a row.
    expect(statusTallies(new Map([["LEGACY", 9]]))).toHaveLength(
      CASE_STATUSES.length
    );
  });
});

describe("priorityTallies", () => {
  it("keeps the unassessed cases visible, last", () => {
    const tallies = priorityTallies(new Map([["HIGH", 2], [null, 4]]));
    expect(tallies.map((entry) => entry.level)).toEqual([
      ...PRIORITY_LEVELS,
      "UNASSESSED",
    ]);
    expect(tallies.find((entry) => entry.level === "HIGH")?.count).toBe(2);
    expect(tallies.find((entry) => entry.level === "UNASSESSED")?.count).toBe(4);
  });
});

describe("officeTallies", () => {
  const names = new Map([
    [1, "Engineering"],
    [2, "Social Services"],
  ]);

  it("names the office, busiest first, ties broken by name", () => {
    const tallies = officeTallies(
      [
        { officeId: 2, count: 5 },
        { officeId: 1, count: 5 },
        { officeId: null, count: 9 },
        { officeId: 99, count: 1 },
      ],
      names
    );
    expect(tallies.map((entry) => entry.name)).toEqual([
      "Unassigned",
      "Engineering",
      "Social Services",
      "Unknown",
    ]);
  });
});
