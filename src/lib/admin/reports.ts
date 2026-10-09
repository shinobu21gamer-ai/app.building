import { db } from "@/lib/db";
import {
  buildConcernWhere,
  listConcerns,
  type ConcernListFilters,
} from "@/lib/cases/query";
import { CASE_STATUSES, PRIORITY_LEVELS } from "@/lib/cases/workflow";

const MS_PER_HOUR = 3_600_000;

function roundHours(ms: number): number {
  return Math.round((ms / MS_PER_HOUR) * 10) / 10;
}

export async function getConcernReport(filters: ConcernListFilters) {
  const where = buildConcernWhere(filters);
  const now = new Date();

  const [list, statusRows, priorityRows, officeRows, offices, overdue, resolvedRows] =
    await Promise.all([
      listConcerns(filters),
      db.concern.groupBy({
        by: ["status"],
        where,
        _count: { _all: true },
      }),
      db.concern.groupBy({
        by: ["priorityLevel"],
        where,
        _count: { _all: true },
      }),
      db.concern.groupBy({
        by: ["assignedOfficeId"],
        where,
        _count: { _all: true },
      }),
      db.office.findMany({ select: { id: true, name: true } }),
      db.concern.count({
        where: {
          AND: [
            where,
            { status: { notIn: ["RESOLVED", "CLOSED"] } },
            { slaDueAt: { not: null, lt: now } },
          ],
        },
      }),
      db.concern.findMany({
        where: { ...where, resolvedAt: { not: null } },
        select: { createdAt: true, resolvedAt: true },
        orderBy: { resolvedAt: "desc" },
        take: 5000,
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

  const officeNames = new Map(offices.map((office) => [office.id, office.name]));
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

  const durations = resolvedRows
    .filter((row) => row.resolvedAt !== null)
    .map((row) => row.resolvedAt!.getTime() - row.createdAt.getTime());

  const processingTime =
    durations.length === 0
      ? { sampleSize: 0, averageHours: null as number | null }
      : {
          sampleSize: durations.length,
          averageHours: roundHours(
            durations.reduce((sum, value) => sum + value, 0) / durations.length
          ),
        };

  const resolved =
    (statusCounts.get("RESOLVED") ?? 0) + (statusCounts.get("CLOSED") ?? 0);

  return {
    ...list,
    overdue,
    resolved,
    unresolved: list.total - resolved,
    byStatus,
    byPriority,
    byOffice,
    processingTime,
  };
}
