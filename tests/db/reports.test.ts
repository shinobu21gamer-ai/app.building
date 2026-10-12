import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import { copy } from "@/lib/i18n";
import { loadEngineeringReport } from "@/lib/reports/engineering";
import { loadPrivacyData } from "@/lib/reports/privacy";
import { loadTransparencyData } from "@/lib/reports/transparency";
import type { ReportPeriod } from "@/lib/reports/period";
import { daysBefore, requireDatabase, resetDatabase } from "./helpers";

/**
 * The report loaders against a real PostgreSQL database.
 *
 * The unit suite proves the arithmetic (percentiles, utilisation, aging) with
 * fixture objects; these tests prove the queries behind it: that the joins,
 * filters and period bounds issue valid SQL, return the rows the summarisers
 * expect, and respect office scoping.
 *
 * Treasury is deliberately absent: its loader goes through `listAllocations` /
 * `listDisbursements`, whose office scoping is covered by the unit suite, and
 * its arithmetic by `treasury.test.ts`.
 */
requireDatabase();

const NOW = new Date("2026-10-12T02:00:00.000Z");
const PERIOD_90D: ReportPeriod = {
  key: "custom",
  from: daysBefore(NOW, 90),
  to: NOW,
  days: 90,
};

let officeAId = 0;
let officeBId = 0;

beforeAll(async () => {
  await resetDatabase();

  officeAId = (
    await db.office.create({
      data: { code: "OPS-A", name: "Office A", contact: "0917 000 0001" },
      select: { id: true },
    })
  ).id;
  officeBId = (
    await db.office.create({
      data: { code: "OPS-B", name: "Office B", contact: "0917 000 0002" },
      select: { id: true },
    })
  ).id;

  const residentRole = await db.role.create({
    data: { key: "RESIDENT", name: "Resident" },
    select: { id: true },
  });
  const crewRole = await db.role.create({
    data: { key: "CREW", name: "Crew" },
    select: { id: true },
  });
  const residentId = (
    await db.user.create({
      data: {
        email: "reporter@example.test",
        passwordHash: "x",
        firstName: "Reporter",
        lastName: "Resident",
        roleId: residentRole.id,
      },
      select: { id: true },
    })
  ).id;
  const crewUserId = (
    await db.user.create({
      data: {
        email: "crew@example.test",
        passwordHash: "x",
        firstName: "Lito",
        lastName: "Cruz",
        roleId: crewRole.id,
        officeId: officeAId,
      },
      select: { id: true },
    })
  ).id;
  await db.crewProfile.create({
    data: { userId: crewUserId, trade: "MASONRY", officeId: officeAId },
  });

  const typeId = (
    await db.concernType.create({
      data: { key: "repair", name: "Repair" },
      select: { id: true },
    })
  ).id;
  const categoryId = (
    await db.concernCategory.create({
      data: { code: "repair-road", name: "Road repair", typeId },
      select: { id: true },
    })
  ).id;

  async function concern(input: {
    caseNumber: string;
    officeId: number;
    status: string;
    submittedDaysAgo: number;
    resolvedDaysAgo?: number;
    closedDaysAgo?: number;
    slaDueDaysAgo?: number;
    purok: string;
    assessment?: { workersNeeded: number; estimatedDurationMinutes: number };
  }): Promise<number> {
    const row = await db.concern.create({
      data: {
        caseNumber: input.caseNumber,
        userId: residentId,
        categoryId,
        typeId,
        title: input.caseNumber,
        description: "Reported by a resident.",
        locationAddress: input.purok,
        locationPurok: input.purok,
        status: input.status,
        priorityLevel: "HIGH",
        assignedOfficeId: input.officeId,
        submittedAt: daysBefore(NOW, input.submittedDaysAgo),
        ...(input.resolvedDaysAgo !== undefined
          ? { resolvedAt: daysBefore(NOW, input.resolvedDaysAgo) }
          : {}),
        ...(input.closedDaysAgo !== undefined
          ? { closedAt: daysBefore(NOW, input.closedDaysAgo) }
          : {}),
        ...(input.slaDueDaysAgo !== undefined
          ? { slaDueAt: daysBefore(NOW, input.slaDueDaysAgo) }
          : {}),
        ...(input.assessment ? { caseAssessment: { create: input.assessment } } : {}),
      },
      select: { id: true },
    });
    return row.id;
  }

  const closedId = await concern({
    caseNumber: "BR-2026-1001",
    officeId: officeAId,
    status: "CLOSED",
    submittedDaysAgo: 40,
    resolvedDaysAgo: 35,
    closedDaysAgo: 34,
    slaDueDaysAgo: -4,
    purok: "Purok 1",
    assessment: { workersNeeded: 3, estimatedDurationMinutes: 480 },
  });
  const openId = await concern({
    caseNumber: "BR-2026-1002",
    officeId: officeAId,
    status: "IN_PROGRESS",
    submittedDaysAgo: 10,
    slaDueDaysAgo: 2,
    purok: "Purok 2",
  });
  await concern({
    caseNumber: "BR-2026-1003",
    officeId: officeBId,
    status: "RESOLVED",
    submittedDaysAgo: 20,
    resolvedDaysAgo: 1,
    slaDueDaysAgo: 3,
    purok: "Purok 3",
  });
  await concern({
    caseNumber: "BR-2025-0999",
    officeId: officeBId,
    status: "CLOSED",
    submittedDaysAgo: 400,
    resolvedDaysAgo: 399,
    closedDaysAgo: 398,
    slaDueDaysAgo: 396,
    purok: "Purok 4",
  });

  await db.caseEscalation.create({
    data: {
      concernId: openId,
      stage: "SLA",
      level: 1,
      hoursOverdue: 24,
      escalatedToRole: "OFFICIAL",
      dedupeKey: "esc-open",
      createdAt: daysBefore(NOW, 1),
    },
  });
  await db.caseEscalation.create({
    data: {
      concernId: closedId,
      stage: "SLA",
      level: 1,
      hoursOverdue: 12,
      escalatedToRole: "OFFICIAL",
      dedupeKey: "esc-closed",
      resolvedAt: daysBefore(NOW, 30),
      createdAt: daysBefore(NOW, 36),
    },
  });

  await db.crewAssignment.create({
    data: {
      concernId: closedId,
      crewId: crewUserId,
      // The report reads assignments by their own date, so a booking made
      // "now" (the column default) would fall outside every period the tests
      // report on.
      assignedAt: daysBefore(NOW, 21),
      scheduledStartAt: daysBefore(NOW, 20),
      scheduledEndAt: daysBefore(NOW, 19),
    },
  });

  // `concernId` is unique on the projection, so the third row needs its own case:
  // the fixtures care about the published/unpublished split, not the link.
  const spareId = await concern({
    caseNumber: "BR-2026-1004",
    officeId: officeAId,
    status: "RESOLVED",
    submittedDaysAgo: 20,
    resolvedDaysAgo: 1,
    purok: "Purok 3",
  });
  await db.publicCaseRecord.create({
    data: {
      publicRef: "BR-PUB-0001",
      concernId: closedId,
      typeKey: "repair",
      areaLabel: "Purok 1",
      status: "CLOSED",
      submittedAt: daysBefore(NOW, 40),
      resolvedAt: daysBefore(NOW, 35),
      responseHours: 24,
      published: true,
    },
  });
  await db.publicCaseRecord.create({
    data: {
      publicRef: "BR-PUB-0002",
      concernId: openId,
      typeKey: "repair",
      areaLabel: "Purok 2",
      status: "IN_PROGRESS",
      submittedAt: daysBefore(NOW, 10),
      published: true,
    },
  });
  await db.publicCaseRecord.create({
    data: {
      publicRef: "BR-PUB-0003",
      concernId: spareId,
      typeKey: "repair",
      areaLabel: "Purok 3",
      status: "RESOLVED",
      submittedAt: daysBefore(NOW, 20),
      resolvedAt: daysBefore(NOW, 1),
      responseHours: 48,
      published: false,
    },
  });

  await db.dataSubjectRequest.create({
    data: {
      referenceCode: "DSR-2026-0001",
      userId: residentId,
      type: "ACCESS",
      status: "RECEIVED",
      requestedAt: daysBefore(NOW, 10),
      dueAt: daysBefore(NOW, 3),
    },
  });
  await db.dataSubjectRequest.create({
    data: {
      referenceCode: "DSR-2026-0002",
      userId: residentId,
      type: "ERASURE",
      status: "COMPLETED",
      requestedAt: daysBefore(NOW, 30),
      resolvedAt: daysBefore(NOW, 2),
    },
  });

  await db.consentRecord.create({
    data: {
      userId: residentId,
      purpose: "DATA_PROCESSING",
      policyVersion: "1.0",
      grantedAt: daysBefore(NOW, 60),
    },
  });
  await db.consentRecord.create({
    data: {
      userId: residentId,
      purpose: "TRANSPARENCY_PUBLICATION",
      policyVersion: "1.0",
      grantedAt: daysBefore(NOW, 60),
      status: "WITHDRAWN",
      withdrawnAt: daysBefore(NOW, 5),
    },
  });

  await db.piiAccessLog.create({
    data: {
      subjectUserId: residentId,
      field: "phone",
      purpose: "CASE_FOLLOW_UP",
      createdAt: daysBefore(NOW, 4),
    },
  });
  await db.piiAccessLog.create({
    data: {
      subjectUserId: residentId,
      field: "phone",
      purpose: "CASE_FOLLOW_UP",
      createdAt: daysBefore(NOW, 3),
    },
  });
  await db.piiAccessLog.create({
    data: {
      subjectUserId: residentId,
      field: "idNumber",
      purpose: "IDENTITY_REVIEW",
      createdAt: daysBefore(NOW, 2),
    },
  });

  const retentionPolicy = await db.retentionPolicy.create({
    data: {
      key: "case.records",
      dataCategory: "Case records",
      retentionDays: 1825,
      action: "ANONYMISE",
      lastRunAt: daysBefore(NOW, 5),
    },
    select: { id: true },
  });
  await db.retentionRun.create({
    data: {
      policyId: retentionPolicy.id,
      job: "RETENTION",
      status: "SUCCESS",
      startedAt: daysBefore(NOW, 5),
      finishedAt: daysBefore(NOW, 5),
      scanned: 7,
      affected: 2,
      summary: "2 closed case(s) anonymised",
    },
  });
});

afterAll(async () => {
  await db.$disconnect();
});

describe("the engineering report", () => {
  const t = copy.en.revamp.reports.engineering;

  function stat(document: Awaited<ReturnType<typeof loadEngineeringReport>>, label: string) {
    const found = document.stats.find((entry) => entry.label === label);
    expect(found, `no "${label}" stat`).toBeDefined();
    return found?.value;
  }

  it("counts only what the period and the office scope include", async () => {
    const wide = await loadEngineeringReport({ locale: "en", period: PERIOD_90D, now: NOW });
    // Four cases were submitted inside the window (including the spare the
    // public projection needed); the 400-day-old one is out.
    expect(stat(wide, t.cases)).toBe(4);
    expect(stat(wide, t.openNow)).toBe(1);

    const scoped = await loadEngineeringReport({
      locale: "en",
      period: PERIOD_90D,
      officeId: officeAId,
      now: NOW,
    });
    expect(stat(scoped, t.cases)).toBe(3);

    const other = await loadEngineeringReport({
      locale: "en",
      period: PERIOD_90D,
      officeId: officeBId,
      now: NOW,
    });
    expect(stat(other, t.cases)).toBe(1);
  });

  it("shows a crew member's trade, joined from the roster", async () => {
    const document = await loadEngineeringReport({
      locale: "en",
      period: PERIOD_90D,
      now: NOW,
    });
    const crew = document.sections.find((section) => section.key === "crew");
    expect(crew?.columns.map((column) => column.key)).toContain("trade");
    // The stored code is printed the way the crew screens print it.
    expect(crew?.rows[0]?.trade).toBe("Masonry");
  });

  it("builds every section the screen expects", async () => {
    const document = await loadEngineeringReport({ locale: "en", period: PERIOD_90D, now: NOW });
    const keys = document.sections.map((section) => section.key);
    expect(keys).toContain("turnaround");
    expect(keys).toContain("sla");
    expect(keys).toContain("crew");
    for (const section of document.sections) {
      expect(section.title.length).toBeGreaterThan(0);
      expect(Array.isArray(section.columns)).toBe(true);
    }
  });
});

describe("the transparency report", () => {
  it("reads the public projection only", async () => {
    const data = await loadTransparencyData({ locale: "en", period: PERIOD_90D });
    expect(data.rows).toHaveLength(3);
    expect(data.totals.published).toBe(2);
    expect(data.months.length).toBeGreaterThan(0);
    expect(data.truncated).toBe(false);
    expect(data.byType.length).toBeGreaterThan(0);
    expect(data.byArea.length).toBeGreaterThan(0);
  });
});

describe("the privacy report", () => {
  it("summarises requests, consents and unmasking", async () => {
    const data = await loadPrivacyData({ locale: "en", period: PERIOD_90D, now: NOW });

    expect(data.piiTotal).toBe(3);
    expect(data.piiByField.find((row) => row.key === "phone")?.count).toBe(2);
    expect(data.piiByField.find((row) => row.key === "idNumber")?.count).toBe(1);

    expect(data.dsr.byType.length).toBeGreaterThanOrEqual(1);
    expect(data.dsr.queue.length).toBeGreaterThanOrEqual(1);
    expect(data.consents.byPurpose.length).toBeGreaterThanOrEqual(1);

    expect(data.retention.rows).toHaveLength(1);
    expect(data.retention.affected).toBe(2);
    expect(data.retention.runs).toBe(1);
  });
});
