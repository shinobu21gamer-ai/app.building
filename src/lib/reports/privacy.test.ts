import { describe, expect, it } from "vitest";

import {
  countBy,
  isOpenDsr,
  summarizeConsents,
  summarizeDsr,
  summarizeRetention,
  type DsrRow,
} from "@/lib/reports/privacy";

const NOW = new Date("2026-10-12T02:00:00Z");

function dsr(overrides: Partial<DsrRow> = {}): DsrRow {
  return {
    referenceCode: "DSR-2026-0001",
    type: "ACCESS",
    status: "RECEIVED",
    requestedAt: new Date("2026-10-01T01:00:00Z"),
    dueAt: new Date("2026-10-20T01:00:00Z"),
    resolvedAt: null,
    ...overrides,
  };
}

describe("isOpenDsr", () => {
  it("treats received and in-review as open", () => {
    expect(isOpenDsr("RECEIVED")).toBe(true);
    expect(isOpenDsr("IN_REVIEW")).toBe(true);
    expect(isOpenDsr("COMPLETED")).toBe(false);
    expect(isOpenDsr("REJECTED")).toBe(false);
  });
});

describe("summarizeDsr", () => {
  it("counts by type, keeping every statutory type in the table", () => {
    const summary = summarizeDsr(
      [dsr(), dsr({ referenceCode: "DSR-2026-0002", type: "ERASURE" })],
      NOW
    );
    expect(summary.received).toBe(2);
    expect(summary.byType).toHaveLength(6);
    expect(summary.byType.find((row) => row.type === "ACCESS")?.count).toBe(1);
    expect(summary.byType.find((row) => row.type === "COMPLAINT")?.count).toBe(0);
  });

  it("flags requests past the statutory deadline and measures the lateness", () => {
    const summary = summarizeDsr(
      [
        dsr({ dueAt: new Date("2026-10-05T01:00:00Z") }),
        dsr({ referenceCode: "DSR-2026-0002", dueAt: new Date("2026-11-01T01:00:00Z") }),
      ],
      NOW
    );
    expect(summary.overdue).toBe(1);
    expect(summary.queue).toHaveLength(1);
    expect(summary.queue[0].referenceCode).toBe("DSR-2026-0001");
    // 5 Oct (Mon) → 12 Oct (Mon) is five working days.
    expect(summary.queue[0].workingDaysLate).toBe(5);
  });

  it("does not chase a request that was already answered", () => {
    const summary = summarizeDsr(
      [
        dsr({
          status: "COMPLETED",
          dueAt: new Date("2026-10-05T01:00:00Z"),
          resolvedAt: new Date("2026-10-04T01:00:00Z"),
        }),
      ],
      NOW
    );
    expect(summary.overdue).toBe(0);
    expect(summary.completed).toBe(1);
    // Thursday → Sunday is one working day: `workingDaysBetween` does not count
    // the day it starts on (Monday → Friday is 4, per its own tests).
    expect(summary.averageHandlingDays).toBe(1);
  });

  it("averages handling time in working days and ignores negatives", () => {
    const summary = summarizeDsr(
      [
        dsr({
          status: "COMPLETED",
          requestedAt: new Date("2026-10-01T01:00:00Z"),
          resolvedAt: new Date("2026-10-05T01:00:00Z"),
        }),
        dsr({
          referenceCode: "DSR-2026-0002",
          status: "REJECTED",
          requestedAt: new Date("2026-10-06T01:00:00Z"),
          resolvedAt: new Date("2026-10-07T01:00:00Z"),
        }),
        dsr({
          referenceCode: "DSR-2026-0003",
          status: "COMPLETED",
          // Resolved before it was requested — bad data, must not skew the mean.
          requestedAt: new Date("2026-10-09T01:00:00Z"),
          resolvedAt: new Date("2026-10-08T01:00:00Z"),
        }),
      ],
      NOW
    );
    // 2 and 1 working days → 1.5.
    expect(summary.averageHandlingDays).toBe(1.5);
  });

  it("reports null rather than NaN when nothing has been handled yet", () => {
    expect(summarizeDsr([dsr()], NOW).averageHandlingDays).toBeNull();
  });

  it("keeps unknown request types in their own row", () => {
    const summary = summarizeDsr([dsr({ type: "SOMETHING_NEW" })], NOW);
    const unknown = summary.byType.find((row) => row.type === "SOMETHING_NEW");
    expect(unknown?.label).toBe("SOMETHING_NEW");
  });

  it("sorts the overdue queue by how late it is", () => {
    const summary = summarizeDsr(
      [
        dsr({ referenceCode: "A", dueAt: new Date("2026-10-08T01:00:00Z") }),
        dsr({ referenceCode: "B", dueAt: new Date("2026-09-01T01:00:00Z") }),
      ],
      NOW
    );
    expect(summary.queue.map((row) => row.referenceCode)).toEqual(["B", "A"]);
  });
});

describe("summarizeConsents", () => {
  it("counts grants and withdrawals per purpose", () => {
    const summary = summarizeConsents([
      { purpose: "DATA_PROCESSING", status: "GRANTED", grantedAt: new Date(), withdrawnAt: null },
      { purpose: "DATA_PROCESSING", status: "WITHDRAWN", grantedAt: new Date(), withdrawnAt: new Date() },
      { purpose: "TRANSPARENCY", status: "GRANTED", grantedAt: new Date(), withdrawnAt: null },
    ]);
    expect(summary.granted).toBe(2);
    expect(summary.withdrawn).toBe(1);
    expect(summary.withdrawalShare).toBe(33.3);
    expect(summary.byPurpose[0]).toMatchObject({
      purpose: "DATA_PROCESSING",
      granted: 1,
      withdrawn: 1,
      grantedShare: 50,
    });
  });

  it("treats a row with a withdrawal date as withdrawn even if the status lags", () => {
    const summary = summarizeConsents([
      { purpose: "SMS", status: "GRANTED", grantedAt: new Date(), withdrawnAt: new Date() },
    ]);
    expect(summary.withdrawn).toBe(1);
  });

  it("handles an empty period", () => {
    const summary = summarizeConsents([]);
    expect(summary).toMatchObject({ granted: 0, withdrawn: 0, withdrawalShare: 0 });
    expect(summary.byPurpose).toEqual([]);
  });
});

describe("countBy", () => {
  it("counts by a key and orders the busiest first", () => {
    const rows = [{ f: "phone" }, { f: "phone" }, { f: "idNumber" }];
    expect(countBy(rows, (row) => row.f)).toEqual([
      { key: "phone", count: 2 },
      { key: "idNumber", count: 1 },
    ]);
  });

  it("breaks ties alphabetically so the table is stable", () => {
    const rows = [{ f: "b" }, { f: "a" }];
    expect(countBy(rows, (row) => row.f).map((row) => row.key)).toEqual(["a", "b"]);
  });
});

describe("summarizeRetention", () => {
  const policies = [
    {
      key: "pii.id_verification",
      dataCategory: "ID verification",
      action: "DELETE",
      retentionDays: 365,
      isActive: true,
      lastRunAt: null,
    },
    {
      key: "audit.entries",
      dataCategory: "Audit trail",
      action: "ARCHIVE",
      retentionDays: 3650,
      isActive: true,
      lastRunAt: new Date("2026-10-01T00:00:00Z"),
    },
  ];

  it("rolls the period's runs up per policy and keeps the latest status", () => {
    const summary = summarizeRetention(policies, [
      {
        policyKey: "pii.id_verification",
        job: "RETENTION",
        status: "SUCCESS",
        startedAt: new Date("2026-10-05T00:00:00Z"),
        scanned: 10,
        affected: 4,
      },
      {
        policyKey: "pii.id_verification",
        job: "RETENTION",
        status: "SUCCESS",
        startedAt: new Date("2026-10-06T00:00:00Z"),
        scanned: 12,
        affected: 3,
      },
    ]);
    const row = summary.rows.find((entry) => entry.key === "pii.id_verification");
    expect(row).toMatchObject({ scanned: 22, affected: 7, status: "SUCCESS" });
    expect(summary.affected).toBe(7);
    expect(summary.runs).toBe(2);
  });

  it("falls back to the policy's own last-run stamp when the period has no runs", () => {
    const summary = summarizeRetention(policies, []);
    const row = summary.rows.find((entry) => entry.key === "audit.entries");
    expect(row?.lastRunAt?.toISOString()).toBe("2026-10-01T00:00:00.000Z");
    expect(row?.status).toBe("—");
  });

  it("counts failed runs, because a silent retention failure is a compliance risk", () => {
    const summary = summarizeRetention(policies, [
      {
        policyKey: "audit.entries",
        job: "RETENTION",
        status: "FAILED",
        startedAt: new Date("2026-10-06T00:00:00Z"),
        scanned: 0,
        affected: 0,
      },
    ]);
    expect(summary.failures).toBe(1);
  });

  it("ignores runs whose policy row was deleted", () => {
    const summary = summarizeRetention(policies, [
      {
        policyKey: null,
        job: "RETENTION",
        status: "SUCCESS",
        startedAt: new Date("2026-10-06T00:00:00Z"),
        scanned: 5,
        affected: 5,
      },
    ]);
    expect(summary.rows.every((row) => row.scanned === 0)).toBe(true);
    expect(summary.runs).toBe(1);
  });
});
