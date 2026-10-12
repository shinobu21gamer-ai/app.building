import { beforeEach, describe, expect, it, vi } from "vitest";

// Every model the report loaders touch returns whatever the test put in `data`.
// The calls are recorded so a test can check the take, the ordering and the
// filter that each query was given.
const data: Record<string, unknown[]> = {};
const calls: Record<string, unknown[]> = {};

vi.mock("@/lib/db", () => {
  const model = (name: string) => ({
    findMany: vi.fn(async (args: unknown) => {
      (calls[name] ??= []).push(args);
      return data[name] ?? [];
    }),
    count: vi.fn(async () => 0),
    groupBy: vi.fn(async () => []),
    aggregate: vi.fn(async () => ({})),
  });
  const cache = new Map<string, ReturnType<typeof model>>();
  return {
    db: new Proxy(
      {},
      {
        get: (_target, name: string) => {
          if (!cache.has(name)) cache.set(name, model(name));
          return cache.get(name);
        },
      }
    ),
  };
});

import {
  capRows,
  withRowLimitStat,
  type ReportDocument,
} from "@/lib/reports/document";
import { REPORT_ROW_LIMIT as PRIVACY_LIMIT, loadPrivacyData } from "@/lib/reports/privacy";
import { REPORT_ROW_LIMIT as ENGINEERING_LIMIT, loadEngineeringReport } from "@/lib/reports/engineering";
import { copy } from "@/lib/i18n";

const PERIOD = { key: "all", from: null, to: null } as never;
const NOW = new Date("2026-10-12T00:00:00Z");

function rows(count: number, extra: Record<string, unknown> = {}) {
  return Array.from({ length: count }, (_, i) => ({ id: i + 1, ...extra }));
}

beforeEach(() => {
  for (const key of Object.keys(data)) delete data[key];
  for (const key of Object.keys(calls)) delete calls[key];
});

describe("capRows", () => {
  it("keeps the limit and reports no truncation when the rows fit", () => {
    expect(capRows([1, 2, 3], 5)).toEqual({ rows: [1, 2, 3], truncated: false });
  });

  it("cuts to the limit and reports truncation when one row more was read", () => {
    expect(capRows([1, 2, 3, 4], 3)).toEqual({ rows: [1, 2, 3], truncated: true });
  });

  it("exactly at the limit is not truncated", () => {
    expect(capRows([1, 2, 3], 3)).toEqual({ rows: [1, 2, 3], truncated: false });
  });
});

describe("withRowLimitStat", () => {
  const doc: ReportDocument = {
    key: "x",
    title: "x",
    generatedAt: NOW.toISOString(),
    period: PERIOD,
    stats: [{ label: "a", value: 1 }],
    sections: [],
  };
  const labels = { rowLimitLabel: "Limit", rowLimitHint: "Newest {limit} only" };

  it("leaves the document alone when not truncated", () => {
    expect(withRowLimitStat(doc, false, labels, 5000)).toBe(doc);
  });

  it("adds a warning stat when truncated", () => {
    const out = withRowLimitStat(doc, true, labels, 5000);
    expect(out.stats).toHaveLength(2);
    expect(out.stats[1]).toMatchObject({
      label: "Limit",
      value: "5,000",
      hint: "Newest 5,000 only",
      tone: "warning",
    });
  });
});

describe("privacy loader row limits", () => {
  it("reads one row past the limit with newest-first ordering, and flags truncation", async () => {
    data.dataSubjectRequest = rows(PRIVACY_LIMIT + 1, {
      referenceCode: "DSR",
      type: "ACCESS",
      status: "RECEIVED",
      requestedAt: NOW,
      dueAt: NOW,
      resolvedAt: null,
    });
    const result = await loadPrivacyData({ locale: "en", period: PERIOD, now: NOW });

    const call = calls.dataSubjectRequest[0] as { take: number; orderBy: unknown };
    expect(call.take).toBe(PRIVACY_LIMIT + 1);
    expect(call.orderBy).toEqual({ requestedAt: "desc" });
    expect(result.truncated).toBe(true);
    expect(result.dsr.received).toBe(PRIVACY_LIMIT);
  });

  it("reports no truncation when every query is within the limit", async () => {
    data.piiAccessLog = rows(3, { field: "name", purpose: "CASE", createdAt: NOW });
    const result = await loadPrivacyData({ locale: "en", period: PERIOD, now: NOW });
    expect(result.truncated).toBe(false);
    expect(result.piiTotal).toBe(3);
  });

  it("the document carries the warning stat only when truncated", async () => {
    const { buildPrivacyDocument } = await import("@/lib/reports/privacy");
    const base = await loadPrivacyData({ locale: "en", period: PERIOD, now: NOW });
    const clean = buildPrivacyDocument(base, { locale: "en", period: PERIOD });
    const cut = buildPrivacyDocument({ ...base, truncated: true }, { locale: "en", period: PERIOD });
    expect(cut.stats.length).toBe(clean.stats.length + 1);
    expect(cut.stats.at(-1)?.tone).toBe("warning");
  });
});

describe("engineering loader row limits", () => {
  it("reads one row past the limit for the case list and flags truncation", async () => {
    data.concern = rows(ENGINEERING_LIMIT + 1, {
      caseNumber: "C",
      status: "RESOLVED",
      priorityLevel: "LOW",
      submittedAt: NOW,
      resolvedAt: NOW,
      closedAt: null,
      slaDueAt: null,
      slaBreachedAt: null,
      locationPurok: null,
      type: null,
      category: { name: "Road" },
      caseAssessment: null,
    });
    const doc = await loadEngineeringReport({ locale: "en", period: PERIOD, now: NOW });

    const first = calls.concern[0] as { take: number; orderBy: unknown };
    expect(first.take).toBe(ENGINEERING_LIMIT + 1);
    expect(first.orderBy).toEqual({ submittedAt: "desc" });
    expect(doc.stats.some((stat) => stat.tone === "warning")).toBe(true);
  });

  it("shows no warning when nothing was cut off", async () => {
    const doc = await loadEngineeringReport({ locale: "en", period: PERIOD, now: NOW });
    expect(doc.stats.some((stat) => stat.tone === "warning" && stat.label === copy.en.revamp.reports.rowLimitLabel)).toBe(false);
  });
});
