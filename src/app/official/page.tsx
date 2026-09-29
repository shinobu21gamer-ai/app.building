import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth/session";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PriorityBadge, StatusBadge } from "@/components/ui/badge";
import { StatCard } from "@/components/dashboard/stat-card";
import { ConcernFilters } from "@/components/cases/concern-filters";
import { parseConcernFilters } from "@/lib/cases/query";
import { getOfficialDashboard } from "@/lib/dashboards/official";
import { formatDate, formatDateTime } from "@/lib/format";
import { firstParam } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Official Dashboard",
};

type SearchParams = Record<string, string | string[] | undefined>;

export default async function OfficialPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const user = await requireRole(["OFFICIAL", "ADMIN"]);
  const params = await searchParams;
  const filters = parseConcernFilters(params);

  const isOfficial = user.role.key === "OFFICIAL";
  const showOfficeScope = !isOfficial;
  const officeId = isOfficial ? (user.officeId ?? -1) : null;

  const [categories, offices, dashboard] = await Promise.all([
    db.concernCategory.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    showOfficeScope
      ? db.office.findMany({
          where: { isActive: true },
          orderBy: { name: "asc" },
          select: { id: true, name: true },
        })
      : Promise.resolve([] as { id: number; name: string }[]),
    getOfficialDashboard(officeId, filters),
  ]);

  const { counts, recentlyResolved, cases } = dashboard;

  const scopeLabel = isOfficial
    ? user.office
      ? `${user.office.name} caseload`
      : "No office is assigned to your account."
    : filters.officeId
      ? "System view — filtered by office"
      : "System view — all offices";

  const stats = [
    { label: "Assigned cases", value: counts.assigned },
    { label: "Pending", value: counts.pending, hint: "Awaiting action" },
    { label: "High priority", value: counts.highPriority, hint: "High / critical" },
    { label: "In progress", value: counts.inProgress },
  ];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">
          Welcome, {user.firstName}
        </h1>
        <p className="mt-1 text-sm text-slate-600">{scopeLabel}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => (
          <StatCard
            key={stat.label}
            label={stat.label}
            value={stat.value}
            hint={stat.hint}
          />
        ))}
      </div>

      <Card
        title="Recently resolved"
        description="The five most recently resolved cases in scope."
      >
        {recentlyResolved.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-600">
            No cases have been resolved yet.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {recentlyResolved.map((concern) => (
              <li key={concern.id}>
                <Link
                  href={`/official/concerns/${concern.id}`}
                  className="flex flex-wrap items-center justify-between gap-2 py-3 hover:bg-slate-50"
                >
                  <div>
                    <p className="text-sm font-medium text-slate-900">
                      {concern.title}
                    </p>
                    <p className="text-xs text-slate-500">
                      {concern.caseNumber} · {concern.category.name} ·{" "}
                      {concern.user.firstName} {concern.user.lastName} ·{" "}
                      {concern.resolvedAt
                        ? formatDateTime(concern.resolvedAt)
                        : "—"}
                      {concern.resolutions[0]?.resolutionType
                        ? ` · ${concern.resolutions[0].resolutionType.replaceAll("_", " ").toLowerCase()}`
                        : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {concern.priorityLevel && (
                      <PriorityBadge level={concern.priorityLevel} />
                    )}
                    <StatusBadge status={concern.status} />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card
        title="Search and filter cases"
        description="Narrow your caseload by keyword, status, priority, category, office, or submission date."
      >
        <ConcernFilters
          action="/official"
          categories={categories}
          offices={offices}
          showOfficeScope={showOfficeScope}
          defaults={{
            q: firstParam(params, "q"),
            status: firstParam(params, "status"),
            priority: firstParam(params, "priority"),
            categoryId: firstParam(params, "categoryId"),
            officeId: firstParam(params, "officeId"),
            from: firstParam(params, "from"),
            to: firstParam(params, "to"),
          }}
        />
      </Card>

      <Card
        title={`${cases.total} case${cases.total === 1 ? "" : "s"}`}
        description={
          cases.truncated
            ? `Showing the most recent ${cases.concerns.length}. Refine your search to narrow the results.`
            : "Newest first."
        }
      >
        {cases.concerns.length === 0 ? (
          <p className="py-10 text-center text-sm text-slate-600">
            No cases match these criteria.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <caption className="sr-only">Cases requiring attention</caption>
              <thead>
                <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                  <th scope="col" className="py-2 pr-4 font-semibold">
                    Case no.
                  </th>
                  <th scope="col" className="py-2 pr-4 font-semibold">
                    Title
                  </th>
                  <th scope="col" className="py-2 pr-4 font-semibold">
                    Priority
                  </th>
                  <th scope="col" className="py-2 pr-4 font-semibold">
                    Status
                  </th>
                  <th scope="col" className="py-2 pr-4 font-semibold">
                    Updated
                  </th>
                  <th scope="col" className="py-2 font-semibold">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {cases.concerns.map((concern) => (
                  <tr key={concern.id} className="hover:bg-slate-50">
                    <td className="py-3 pr-4 font-mono text-xs text-slate-600">
                      {concern.caseNumber}
                    </td>
                    <td className="py-3 pr-4 font-medium text-slate-900">
                      {concern.title}
                    </td>
                    <td className="py-3 pr-4">
                      {concern.priorityLevel ? (
                        <PriorityBadge level={concern.priorityLevel} />
                      ) : (
                        <span className="text-slate-400">Not assessed</span>
                      )}
                    </td>
                    <td className="py-3 pr-4">
                      <StatusBadge status={concern.status} />
                    </td>
                    <td className="py-3 pr-4 text-slate-600">
                      {formatDate(concern.updatedAt)}
                    </td>
                    <td className="py-3 text-right">
                      <Link
                        href={`/official/concerns/${concern.id}`}
                        className="text-sm font-semibold text-brand-700 hover:text-brand-800"
                      >
                        Manage
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="mt-4 border-t border-slate-100 pt-4">
          <Button href="/official/concerns" variant="outline" size="sm">
            Open full case management
          </Button>
        </div>
      </Card>
    </div>
  );
}
