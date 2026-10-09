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
import { copy } from "@/lib/i18n";
import { getLocale } from "@/lib/locale";

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
  const locale = await getLocale();
  const t = copy[locale].official;
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
      ? t.caseload.replace("{office}", user.office.name)
      : t.noOffice
    : filters.officeId
      ? t.systemFiltered
      : t.systemAll;

  const stats = [
    { label: t.assigned, value: counts.assigned },
    { label: t.pending, value: counts.pending, hint: t.pendingHint },
    { label: t.highPriority, value: counts.highPriority, hint: t.highHint },
    { label: t.inProgress, value: counts.inProgress },
  ];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">
          {t.welcome.replace("{name}", user.firstName)}
        </h1>
        <p className="mt-1 text-sm text-slate-600">{scopeLabel}</p>
      </div>

      <div className="stagger grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => (
          <StatCard
            key={stat.label}
            label={stat.label}
            value={stat.value}
            hint={stat.hint}
          />
        ))}
      </div>

      <Card title={t.recentResolved} description={t.recentResolvedDesc}>
        {recentlyResolved.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-600">
            {t.noResolved}
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

      <Card title={t.searchTitle} description={t.searchDesc}>
        <ConcernFilters
          action="/official"
          locale={locale}
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
        title={
          cases.total === 1
            ? t.casesOne
            : t.casesMany.replace("{count}", String(cases.total))
        }
        description={
          cases.truncated
            ? t.truncated.replace("{count}", String(cases.concerns.length))
            : t.newest
        }
      >
        {cases.concerns.length === 0 ? (
          <p className="py-10 text-center text-sm text-slate-600">
            {t.noMatch}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <caption className="sr-only">Cases requiring attention</caption>
              <thead>
                <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                  <th scope="col" className="py-2 pr-4 font-semibold">
                    {t.caseNo}
                  </th>
                  <th scope="col" className="py-2 pr-4 font-semibold">
                    {t.titleCol}
                  </th>
                  <th scope="col" className="py-2 pr-4 font-semibold">
                    {t.priorityCol}
                  </th>
                  <th scope="col" className="py-2 pr-4 font-semibold">
                    {t.statusCol}
                  </th>
                  <th scope="col" className="py-2 pr-4 font-semibold">
                    {t.updatedCol}
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
                        <span className="text-slate-400">{t.notAssessed}</span>
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
                        {t.manage}
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
            {t.openFull}
          </Button>
        </div>
      </Card>
    </div>
  );
}
