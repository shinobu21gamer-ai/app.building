import { db } from "@/lib/db";
import {
  buildConcernWhere,
  listConcerns,
  type ConcernListFilters,
} from "@/lib/cases/query";
import {
  officeTallies,
  priorityTallies,
  resolveHours,
  roundHours,
  statusTallies,
  summarizeDurations,
} from "@/lib/cases/figures";

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
        select: { submittedAt: true, resolvedAt: true },
        orderBy: { resolvedAt: "desc" },
        take: 5000,
      }),
    ]);

  // The ordering, the bucket names and the duration arithmetic are shared with
  // the dashboards and the report library (`src/lib/cases/figures.ts`), so this
  // page cannot print a different "unresolved" or a different average from the
  // dashboards it sits beside.
  const statusCounts = new Map(
    statusRows.map((row) => [row.status, row._count._all])
  );
  const byStatus = statusTallies(statusCounts);

  const priorityCounts = new Map(
    priorityRows.map((row) => [row.priorityLevel, row._count._all])
  );
  const byPriority = priorityTallies(priorityCounts);

  const officeNames = new Map(offices.map((office) => [office.id, office.name]));
  const byOffice = officeTallies(
    officeRows.map((row) => ({
      officeId: row.assignedOfficeId,
      count: row._count._all,
    })),
    officeNames
  );

  const durations = summarizeDurations(resolveHours(resolvedRows));
  const processingTime = {
    sampleSize: durations.sampleSize,
    averageHours: roundHours(durations.averageHours),
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
