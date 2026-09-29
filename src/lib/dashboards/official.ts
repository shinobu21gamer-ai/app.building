import { db } from "@/lib/db";
import {
  listConcerns,
  type ConcernListFilters,
} from "@/lib/cases/query";

/**
 * Official (office-scoped) dashboard statistics.
 *
 * `officeId` restricts every figure to a single office. Officials always pass
 * their own office; administrators may pass `null` to see the whole system or
 * filter by an office through the search box. All values come from the
 * database on each request.
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

  const [assigned, pending, highPriority, inProgress, recentlyResolved, cases] =
    await Promise.all([
      db.concern.count({ where: scope }),
      db.concern.count({
        where: { ...scope, status: { in: ["SUBMITTED", "ASSIGNED"] } },
      }),
      db.concern.count({
        where: { ...scope, priorityLevel: { in: ["HIGH", "CRITICAL"] } },
      }),
      db.concern.count({ where: { ...scope, status: "IN_PROGRESS" } }),
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

  return {
    officeId: effectiveOfficeId,
    counts: { assigned, pending, highPriority, inProgress },
    recentlyResolved,
    cases,
  };
}
