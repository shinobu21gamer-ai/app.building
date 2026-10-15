import { db } from "@/lib/db";
import {
  listConcerns,
  type ConcernListFilters,
} from "@/lib/cases/query";
import {
  HIGH_PRIORITY_LEVELS,
  PENDING_STATUSES,
} from "@/lib/cases/figures";
import { crewCoverage } from "@/lib/cases/manpower";

/**
 * Official (office-scoped) dashboard statistics.
 *
 * `officeId` restricts every figure to a single office. Officials always pass
 * their own office; administrators may pass `null` to see the whole system or
 * filter by an office through the search box. All values come from the
 * database on each request.
 *
 * The four figures are read from two grouped counts rather than four separate
 * `count()` queries, and the two buckets that have a name — "pending" and
 * "high priority" — are defined in `src/lib/cases/figures.ts`, so a desk and a
 * report cannot mean different things by them.
 */
export async function getOfficialDashboard(
  officeId: number | null,
  filters: ConcernListFilters
) {
  const effectiveOfficeId = officeId ?? filters.officeId;

  const scope =
    effectiveOfficeId === null ? {} : { assignedOfficeId: effectiveOfficeId };

  // The case list obeys the chosen office plus the search/filter controls.
  const scopedFilters: ConcernListFilters = {
    ...filters,
    officeId: effectiveOfficeId,
  };

  const [statusRows, priorityRows, recentlyResolved, cases] =
    await Promise.all([
      db.concern.groupBy({ by: ["status"], where: scope, _count: { _all: true } }),
      db.concern.groupBy({
        by: ["priorityLevel"],
        where: scope,
        _count: { _all: true },
      }),
      db.concern.findMany({
        where: { ...scope, status: { in: ["RESOLVED", "CLOSED"] } },
        select: {
          id: true,
          caseNumber: true,
          title: true,
          status: true,
          priorityLevel: true,
          resolvedAt: true,
          category: { select: { name: true } },
          user: { select: { firstName: true, lastName: true } },
          resolutions: {
            select: { resolutionType: true, resolvedOn: true },
            orderBy: { resolvedAt: "desc" },
            take: 1,
          },
        },
        orderBy: { resolvedAt: "desc" },
        take: 5,
      }),
      listConcerns(scopedFilters),
    ]);

  // Crew coverage per case ("2 of 3 assigned"), read in two grouped queries
  // for the whole page rather than one query per row.
  const caseIds = cases.concerns.map((concern) => concern.id);
  const [crewRows, plans] =
    caseIds.length === 0
      ? ([[], []] as [
          { concernId: number; _count: { _all: number } }[],
          { concernId: number; workersNeeded: number | null }[],
        ])
      : await Promise.all([
          db.crewAssignment.groupBy({
            by: ["concernId"],
            where: { concernId: { in: caseIds }, isActive: true },
            _count: { _all: true },
          }),
          db.caseAssessment.findMany({
            where: { concernId: { in: caseIds } },
            select: { concernId: true, workersNeeded: true },
          }),
        ]);
  const assignedByCase = new Map(
    crewRows.map((row) => [row.concernId, row._count._all])
  );
  const plannedByCase = new Map(
    plans.map((plan) => [plan.concernId, plan.workersNeeded])
  );
  const casesWithCrew = {
    ...cases,
    concerns: cases.concerns.map((concern) => {
      const required = plannedByCase.get(concern.id) ?? null;
      const coverage = crewCoverage({
        required,
        assigned: assignedByCase.get(concern.id) ?? 0,
      });
      // `required` travels with the coverage so the page can tell a planned
      // case (show "Crew: 1 of 3 assigned") from a legacy one (show nothing).
      return { ...concern, crew: { required, ...coverage } };
    }),
  };

  const statusCounts = new Map(
    statusRows.map((row) => [row.status, row._count._all])
  );
  const priorityCounts = new Map(
    priorityRows.map((row) => [row.priorityLevel, row._count._all])
  );

  const countOf = <T,>(names: readonly T[], source: ReadonlyMap<T, number>) =>
    names.reduce((sum, name) => sum + (source.get(name) ?? 0), 0);

  return {
    officeId: effectiveOfficeId,
    counts: {
      // Every case in scope, whatever its status.
      assigned: statusRows.reduce((sum, row) => sum + row._count._all, 0),
      pending: countOf(PENDING_STATUSES, statusCounts),
      highPriority: countOf(HIGH_PRIORITY_LEVELS, priorityCounts),
      underAssessment: statusCounts.get("UNDER_ASSESSMENT") ?? 0,
      awaitingBudget: statusCounts.get("AWAITING_BUDGET") ?? 0,
      inProgress: statusCounts.get("IN_PROGRESS") ?? 0,
    },
    recentlyResolved,
    cases: casesWithCrew,
  };
}
