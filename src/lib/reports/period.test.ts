import { describe, expect, it } from "vitest";

import {
  DAY_MS,
  endOfManilaDay,
  monthKeyOf,
  monthKeysForPeriod,
  parseManilaDay,
  periodRange,
  resolveReportPeriod,
  startOfManilaDay,
  startOfManilaYear,
} from "@/lib/reports/period";

/** 2026-10-12T02:00:00Z is 10:00 in Manila on the 12th. */
const NOW = new Date("2026-10-12T02:00:00Z");

describe("Manila day boundaries", () => {
  it("starts a Manila day at 16:00 UTC the day before", () => {
    expect(startOfManilaDay(NOW).toISOString()).toBe("2026-10-11T16:00:00.000Z");
  });

  it("ends a Manila day one millisecond before the next start", () => {
    expect(endOfManilaDay(NOW).toISOString()).toBe("2026-10-12T15:59:59.999Z");
  });

  it("keeps a case submitted just before Manila midnight in the previous day", () => {
    const lateEvening = new Date("2026-10-12T15:30:00Z"); // 23:30 Manila
    expect(startOfManilaDay(lateEvening).toISOString()).toBe(
      "2026-10-11T16:00:00.000Z"
    );
  });

  it("starts the Manila year at 16:00 UTC on 31 December", () => {
    expect(startOfManilaYear(NOW).toISOString()).toBe("2025-12-31T16:00:00.000Z");
  });
});

describe("parseManilaDay", () => {
  it("parses a calendar day to the start of that Manila day", () => {
    expect(parseManilaDay("2026-10-12")?.toISOString()).toBe(
      "2026-10-11T16:00:00.000Z"
    );
  });

  it("rejects anything that is not YYYY-MM-DD", () => {
    expect(parseManilaDay("12/10/2026")).toBeNull();
    expect(parseManilaDay("2026-10")).toBeNull();
    expect(parseManilaDay("")).toBeNull();
    expect(parseManilaDay(null)).toBeNull();
  });

  it("rejects rollovers instead of silently shifting the window", () => {
    expect(parseManilaDay("2026-02-31")).toBeNull();
    expect(parseManilaDay("2026-13-01")).toBeNull();
  });

  it("tolerates surrounding whitespace", () => {
    expect(parseManilaDay("  2026-10-12  ")?.toISOString()).toBe(
      "2026-10-11T16:00:00.000Z"
    );
  });
});

describe("resolveReportPeriod", () => {
  it("defaults to 90 days when nothing is asked for", () => {
    const period = resolveReportPeriod({ now: NOW });
    expect(period.key).toBe("90d");
    expect(period.days).toBe(90);
    expect(period.to?.toISOString()).toBe("2026-10-12T15:59:59.999Z");
    // 90 days inclusive of today: from is 89 days before today's start.
    expect(period.from?.toISOString()).toBe(
      new Date(startOfManilaDay(NOW).getTime() - 89 * DAY_MS).toISOString()
    );
  });

  it("treats an unknown period key as the default, never as all time", () => {
    const period = resolveReportPeriod({ period: "since-forever", now: NOW });
    expect(period.key).toBe("90d");
    expect(period.from).not.toBeNull();
  });

  it("resolves 30 days, 12 months and all time", () => {
    expect(resolveReportPeriod({ period: "30d", now: NOW }).days).toBe(30);
    expect(resolveReportPeriod({ period: "12m", now: NOW }).days).toBe(365);
    const all = resolveReportPeriod({ period: "all", now: NOW });
    expect(all.from).toBeNull();
    expect(all.to).toBeNull();
    expect(all.days).toBeNull();
  });

  it("resolves year to date from 1 January in Manila", () => {
    const period = resolveReportPeriod({ period: "ytd", now: NOW });
    expect(period.from?.toISOString()).toBe("2025-12-31T16:00:00.000Z");
    expect(period.days).toBeGreaterThan(280);
  });

  it("resolves a custom range inclusively, ending at the end of the end day", () => {
    const period = resolveReportPeriod({
      period: "custom",
      from: "2026-01-01",
      to: "2026-01-31",
      now: NOW,
    });
    expect(period.key).toBe("custom");
    expect(period.from?.toISOString()).toBe("2025-12-31T16:00:00.000Z");
    expect(period.to?.toISOString()).toBe("2026-01-31T15:59:59.999Z");
    expect(period.days).toBe(31);
  });

  it("falls back to the default window when a custom range has no usable bounds", () => {
    const period = resolveReportPeriod({
      period: "custom",
      from: "not-a-date",
      to: "also-not",
      now: NOW,
    });
    expect(period.key).toBe("90d");
  });

  it("accepts a partially specified custom range", () => {
    const period = resolveReportPeriod({
      period: "custom",
      from: "2026-10-01",
      now: NOW,
    });
    expect(period.from?.toISOString()).toBe("2026-09-30T16:00:00.000Z");
    expect(period.to?.toISOString()).toBe("2026-10-12T15:59:59.999Z");
  });

  it("clamps a custom end date beyond today back onto today's Manila day", () => {
    const period = resolveReportPeriod({
      period: "custom",
      from: "2026-10-01",
      to: "2026-12-31",
      now: NOW,
    });
    expect(period.key).toBe("custom");
    expect(period.from?.toISOString()).toBe("2026-09-30T16:00:00.000Z");
    expect(period.to?.toISOString()).toBe("2026-10-12T15:59:59.999Z");
  });

  it("clamps a future start date down to today so the window is not empty in the future", () => {
    const period = resolveReportPeriod({
      period: "custom",
      from: "2027-01-01",
      to: "2027-02-01",
      now: NOW,
    });
    // Both bounds collapse onto today: 2026-10-12 00:00–23:59 Manila
    // (= 2026-10-11T16:00Z – 2026-10-12T15:59:59.999Z).
    expect(period.from?.toISOString()).toBe("2026-10-11T16:00:00.000Z");
    expect(period.to?.toISOString()).toBe("2026-10-12T15:59:59.999Z");
    expect(period.days).toBe(1);
  });
});

describe("periodRange", () => {
  it("returns undefined for an unbounded period", () => {
    expect(periodRange({ key: "all", from: null, to: null, days: null })).toBeUndefined();
  });

  it("returns gte/lte bounds for a bounded period", () => {
    const period = resolveReportPeriod({ period: "30d", now: NOW });
    const range = periodRange(period);
    expect(range?.lte?.toISOString()).toBe("2026-10-12T15:59:59.999Z");
    expect(range?.gte).toBeDefined();
  });
});

describe("month buckets", () => {
  it("keys an instant by its Manila month", () => {
    // 2026-10-31T18:00Z is 1 November in Manila.
    expect(monthKeyOf(new Date("2026-10-31T18:00:00Z"))).toBe("2026-11");
  });

  it("lists the months a period spans, oldest first", () => {
    const period = resolveReportPeriod({
      period: "custom",
      from: "2026-08-15",
      to: "2026-10-12",
      now: NOW,
    });
    expect(monthKeysForPeriod(period)).toEqual(["2026-08", "2026-09", "2026-10"]);
  });

  it("caps the number of buckets, so all-time cannot chart forever", () => {
    const keys = monthKeysForPeriod(
      { key: "all", from: null, to: NOW, days: null },
      6
    );
    expect(keys).toHaveLength(6);
  });
});
