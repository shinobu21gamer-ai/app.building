import type { Metadata } from "next";
import Link from "next/link";
import { Download } from "lucide-react";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth/session";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge, PriorityBadge, StatusBadge } from "@/components/ui/badge";
import { StatCard } from "@/components/dashboard/stat-card";
import { ConcernFilters } from "@/components/cases/concern-filters";
import { PrintButton } from "@/components/ui/print-button";
import { parseConcernFilters } from "@/lib/cases/query";
import { getConcernReport } from "@/lib/admin/reports";
import { statusLabel } from "@/lib/cases/workflow";
import { formatDate, formatDateTime } from "@/lib/format";
import { firstParam } from "@/lib/utils";
import { copy } from "@/lib/i18n";
import { getLocale } from "@/lib/locale";

export const metadata: Metadata = {
  title: "Reports",
};

type SearchParams = Record<string, string | string[] | undefined>;

function formatHours(value: number | null): string {
  if (value === null) return "—";
  return `${value} h`;
}

export default async function AdminReportsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireRole(["ADMIN"]);
  const locale = await getLocale();
  const t = copy[locale].admin;
  const params = await searchParams;
  const filters = parseConcernFilters(params);

  const [categories, offices, report] = await Promise.all([
    db.concernCategory.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    db.office.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    getConcernReport(filters),
  ]);

  const csvQuery = new URLSearchParams();
  for (const key of ["q", "status", "priority", "categoryId", "officeId", "from", "to"]) {
    const value = firstParam(params, key);
    if (value) csvQuery.set(key, value);
  }
  const csvHref = csvQuery.toString()
    ? `/api/v1/admin/reports/concerns?${csvQuery.toString()}`
    : "/api/v1/admin/reports/concerns";

  const generatedAt = formatDateTime(new Date());

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{t.reportsTitle}</h1>
          <p className="mt-1 text-sm text-slate-600">
            {t.reportsLead.replace("{date}", generatedAt)}
          </p>
        </div>
        <div className="no-print flex flex-wrap gap-2">
          <PrintButton label={t.print} />
          <Button href={csvHref} variant="secondary" size="sm">
            <Download size={14} aria-hidden="true" />
            {t.csv}
          </Button>
        </div>
      </div>

      <div className="no-print">
        <Card title={t.filtersTitle} description={t.filtersDesc}>
          <ConcernFilters
            action="/admin/reports"
            locale={locale}
            categories={categories}
            offices={offices}
            showOfficeScope
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
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label={t.casesInView} value={report.total} />
        <StatCard label={t.unresolved} value={report.unresolved} />
        <StatCard
          label={t.slaOverdue}
          value={report.overdue}
          hint={t.slaHint}
        />
        <StatCard
          label={t.avgTime}
          value={formatHours(report.processingTime.averageHours)}
          hint={
            report.processingTime.sampleSize === 1
              ? t.resolvedOne
              : t.resolvedMany.replace(
                  "{count}",
                  String(report.processingTime.sampleSize)
                )
          }
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title={t.byStatus}>
          <ul className="divide-y divide-slate-100 text-sm">
            {report.byStatus.map((row) => (
              <li
                key={row.status}
                className="flex items-center justify-between py-2"
              >
                <StatusBadge status={row.status} />
                <span className="font-semibold text-slate-900">{row.count}</span>
              </li>
            ))}
          </ul>
        </Card>
        <Card title={t.byOffice}>
          {report.byOffice.length === 0 ? (
            <p className="py-4 text-sm text-slate-600">{t.noCases}</p>
          ) : (
            <ul className="divide-y divide-slate-100 text-sm">
              {report.byOffice.map((row) => (
                <li
                  key={row.id ?? "none"}
                  className="flex items-center justify-between py-2"
                >
                  <span className="text-slate-700">{row.name}</span>
                  <span className="font-semibold text-slate-900">{row.count}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card
        title={
          report.total === 1
            ? t.showingOfOne.replace("{shown}", String(report.concerns.length))
            : t.showingOf
                .replace("{shown}", String(report.concerns.length))
                .replace("{total}", String(report.total))
        }
        description={report.truncated ? t.truncated : t.newest}
      >
        {report.concerns.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-600">
            {t.noMatch}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <caption className="sr-only">{t.reportsTitle}</caption>
              <thead>
                <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                  <th scope="col" className="py-2 pr-3 font-semibold">
                    {t.caseCol}
                  </th>
                  <th scope="col" className="py-2 pr-3 font-semibold">
                    {t.titleCol}
                  </th>
                  <th scope="col" className="py-2 pr-3 font-semibold">
                    {t.officeCol}
                  </th>
                  <th scope="col" className="py-2 pr-3 font-semibold">
                    {t.priorityCol}
                  </th>
                  <th scope="col" className="py-2 pr-3 font-semibold">
                    {t.statusCol}
                  </th>
                  <th scope="col" className="py-2 font-semibold">
                    {t.submittedCol}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {report.concerns.map((concern) => (
                  <tr key={concern.id}>
                    <td className="py-2 pr-3 font-mono text-xs">
                      <Link
                        href={`/official/concerns/${concern.id}`}
                        className="font-semibold text-brand-700 hover:text-brand-800"
                      >
                        {concern.caseNumber}
                      </Link>
                    </td>
                    <td className="py-2 pr-3 text-slate-900">{concern.title}</td>
                    <td className="py-2 pr-3 text-slate-600">
                      {concern.assignedOffice?.name ?? t.unassigned}
                    </td>
                    <td className="py-2 pr-3">
                      {concern.priorityLevel ? (
                        <PriorityBadge level={concern.priorityLevel} />
                      ) : (
                        <Badge tone="neutral">{statusLabel("UNASSESSED")}</Badge>
                      )}
                    </td>
                    <td className="py-2 pr-3">
                      <StatusBadge status={concern.status} />
                    </td>
                    <td className="py-2 text-slate-600">
                      {formatDate(concern.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
