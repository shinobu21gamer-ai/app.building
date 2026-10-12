import { db } from "@/lib/db";
import {
  officeTallies,
  priorityTallies,
  resolveHours,
  roundHours,
  statusTallies,
  summarizeDurations,
} from "@/lib/cases/figures";
import { crewCoverage } from "@/lib/cases/manpower";

// Cap the resolution-time sample so the dashboard query stays bounded; the
// aggregate is computed with a linear scan so it cannot stack-overflow.
const RESOLUTION_SAMPLE_LIMIT = 50_000;

// Cases still being worked: the ones a crew can be on right now.
const OPEN_CREW_STATUSES = [
  "ASSIGNED",
  "UNDER_ASSESSMENT",
  "AWAITING_BUDGET",
  "IN_PROGRESS",
] as const;

/**
 * Administrator dashboard aggregates. Every figure is a live database
 * calculation (counts and grouped counts), so it reflects record changes the
 * next time the dashboard is loaded.
 *
 * The arithmetic after the queries — status and priority order, office names,
 * and "how long does a case take" — comes from `src/lib/cases/figures.ts`, the
 * same module the report library uses, so the dashboard and the reports answer
 * those questions with one definition.
 */
export async function getAdminDashboard() {
  const [
    total,
    statusRows,
    priorityRows,
    categoryRows,
    officeRows,
    categories,
    offices,
    resolvedRows,
  ] = await Promise.all([
    db.concern.count(),
    db.concern.groupBy({ by: ["status"], _count: { _all: true } }),
    db.concern.groupBy({ by: ["priorityLevel"], _count: { _all: true } }),
    db.concern.groupBy({ by: ["categoryId"], _count: { _all: true } }),
    db.concern.groupBy({ by: ["assignedOfficeId"], _count: { _all: true } }),
    db.concernCategory.findMany({ select: { id: true, name: true } }),
    db.office.findMany({ select: { id: true, name: true } }),
    db.concern.findMany({
      where: { resolvedAt: { not: null } },
      select: { submittedAt: true, resolvedAt: true },
      orderBy: { resolvedAt: "desc" },
      take: RESOLUTION_SAMPLE_LIMIT,
    }),
  ]);

  const statusCounts = new Map(
    statusRows.map((row) => [row.status, row._count._all])
  );
  const byStatus = statusTallies(statusCounts);

  const priorityCounts = new Map(
    priorityRows.map((row) => [row.priorityLevel, row._count._all])
  );
  const byPriority = priorityTallies(priorityCounts);

  const categoryNames = new Map(categories.map((c) => [c.id, c.name]));
  const byCategory = categoryRows
    .map((row) => ({
      id: row.categoryId,
      name: categoryNames.get(row.categoryId) ?? "Unknown",
      count: row._count._all,
    }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

  const officeNames = new Map(offices.map((o) => [o.id, o.name]));
  const byOffice = officeTallies(
    officeRows.map((row) => ({
      officeId: row.assignedOfficeId,
      count: row._count._all,
    })),
    officeNames
  );

  const resolved =
    (statusCounts.get("RESOLVED") ?? 0) + (statusCounts.get("CLOSED") ?? 0);

  // Processing time is only meaningful where reliable timestamps exist: a case
  // must have both a submission time and a recorded resolution time. The clock
  // is the report library's — submission, not row creation — so the dashboard
  // and the engineering report measure the same span.
  const durations = summarizeDurations(resolveHours(resolvedRows));
  const processingTime = {
    sampleSize: durations.sampleSize,
    averageHours: roundHours(durations.averageHours),
    fastestHours: roundHours(durations.fastestHours),
    slowestHours: roundHours(durations.slowestHours),
  };

  const crew = await openCrewFigures();

  return {
    totals: { total, resolved, unresolved: total - resolved },
    byStatus,
    byPriority,
    byCategory,
    byOffice,
    processingTime,
    crew,
  };
}

/**
 * Crew coverage across open cases: how many people the plans call for, how many
 * are booked, and how many open cases are still short. Uses the same coverage
 * rule as the case page ("2 of 3 assigned"), so the two never disagree.
 */
export async function openCrewFigures() {
  const [plans, bookings] = await Promise.all([
    db.caseAssessment.findMany({
      where: { concern: { status: { in: [...OPEN_CREW_STATUSES] } } },
      select: { concernId: true, workersNeeded: true },
    }),
    db.crewAssignment.groupBy({
      by: ["concernId"],
      where: {
        isActive: true,
        concern: { status: { in: [...OPEN_CREW_STATUSES] } },
      },
      _count: { _all: true },
    }),
  ]);

  const bookedByCase = new Map(
    bookings.map((row) => [row.concernId, row._count._all])
  );

  let plannedCrew = 0;
  let shortfallCases = 0;
  let plannedCases = 0;
  for (const plan of plans) {
    if (plan.workersNeeded === null) continue;
    plannedCases += 1;
    plannedCrew += plan.workersNeeded;
    const coverage = crewCoverage({
      required: plan.workersNeeded,
      assigned: bookedByCase.get(plan.concernId) ?? 0,
    });
    if (!coverage.satisfied) shortfallCases += 1;
  }

  const crewDeployed = bookings.reduce((sum, row) => sum + row._count._all, 0);

  return { plannedCases, plannedCrew, crewDeployed, shortfallCases };
}
