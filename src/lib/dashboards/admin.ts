import { db } from "@/lib/db";
import { CASE_STATUSES, PRIORITY_LEVELS } from "@/lib/cases/workflow";

const MS_PER_HOUR = 3_600_000;

// Cap the resolution-time sample so the dashboard query stays bounded; the
// aggregate is computed with a linear scan so it cannot stack-overflow.
const RESOLUTION_SAMPLE_LIMIT = 50_000;

function roundHours(ms: number): number {
  return Math.round((ms / MS_PER_HOUR) * 10) / 10;
}

/**
 * Administrator dashboard aggregates. Every figure is a live database
 * calculation (counts and grouped counts), so it reflects record changes the
 * next time the dashboard is loaded.
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
      select: { createdAt: true, resolvedAt: true },
      orderBy: { resolvedAt: "desc" },
      take: RESOLUTION_SAMPLE_LIMIT,
    }),
  ]);

  const statusCounts = new Map(
    statusRows.map((row) => [row.status, row._count._all])
  );
  const byStatus = CASE_STATUSES.map((status) => ({
    status,
    count: statusCounts.get(status) ?? 0,
  }));

  const priorityCounts = new Map(
    priorityRows.map((row) => [row.priorityLevel, row._count._all])
  );
  const byPriority = [
    ...PRIORITY_LEVELS.map((level) => ({
      level,
      count: priorityCounts.get(level) ?? 0,
    })),
    { level: "UNASSESSED", count: priorityCounts.get(null) ?? 0 },
  ];

  const categoryNames = new Map(categories.map((c) => [c.id, c.name]));
  const byCategory = categoryRows
    .map((row) => ({
      id: row.categoryId,
      name: categoryNames.get(row.categoryId) ?? "Unknown",
      count: row._count._all,
    }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

  const officeNames = new Map(offices.map((o) => [o.id, o.name]));
  const byOffice = officeRows
    .map((row) => ({
      id: row.assignedOfficeId,
      name:
        row.assignedOfficeId === null
          ? "Unassigned"
          : officeNames.get(row.assignedOfficeId) ?? "Unknown",
      count: row._count._all,
    }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

  const resolved =
    (statusCounts.get("RESOLVED") ?? 0) + (statusCounts.get("CLOSED") ?? 0);

  // Processing time is only meaningful where reliable timestamps exist:
  // a case must have both a submission time and a recorded resolution time.
  const durations = resolvedRows
    .filter((row) => row.resolvedAt !== null)
    .map((row) => row.resolvedAt!.getTime() - row.createdAt.getTime());

  const processingTime =
    durations.length === 0
      ? { sampleSize: 0, averageHours: null, fastestHours: null, slowestHours: null }
      : {
          sampleSize: durations.length,
          averageHours: roundHours(
            durations.reduce((sum, value) => sum + value, 0) / durations.length
          ),
          fastestHours: roundHours(
            durations.reduce(
              (min, value) => Math.min(min, value),
              Number.POSITIVE_INFINITY
            )
          ),
          slowestHours: roundHours(
            durations.reduce(
              (max, value) => Math.max(max, value),
              Number.NEGATIVE_INFINITY
            )
          ),
        };

  return {
    totals: { total, resolved, unresolved: total - resolved },
    byStatus,
    byPriority,
    byCategory,
    byOffice,
    processingTime,
  };
}
