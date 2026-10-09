import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth/session";
import { Card } from "@/components/ui/card";
import { PriorityBadge, StatusBadge } from "@/components/ui/badge";
import { ConcernFilters } from "@/components/cases/concern-filters";
import { listConcerns, parseConcernFilters } from "@/lib/cases/query";
import { formatDate } from "@/lib/format";
import { firstParam } from "@/lib/utils";
import { copy } from "@/lib/i18n";
import { getLocale } from "@/lib/locale";

export const metadata: Metadata = {
  title: "Concerns",
};

type SearchParams = Record<string, string | string[] | undefined>;

export default async function OfficialConcernsPage({
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
  let scopeLabel: string;
  if (isOfficial) {
    if (user.officeId === null) {
      filters.officeId = -1;
      scopeLabel = t.noOffice;
    } else {
      filters.officeId = user.officeId;
      scopeLabel = t.casesAssigned.replace(
        "{office}",
        user.office?.name ?? t.unassigned
      );
    }
  } else {
    scopeLabel = filters.officeId ? t.showingOffice : t.allOffices;
  }

  const showOfficeScope = !isOfficial;

  const [categories, offices, result] = await Promise.all([
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
    listConcerns(filters),
  ]);

  const { concerns, total, truncated } = result;
  const now = Date.now();
  const hasFilters = [
    "q",
    "status",
    "priority",
    "categoryId",
    "officeId",
    "from",
    "to",
  ].some((key) => firstParam(params, key) !== "");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">{t.caseManagement}</h1>
        <p className="mt-1 text-sm text-slate-600">
          {scopeLabel} {isOfficial ? t.manageOnly : ""}
        </p>
      </div>

      <Card title={t.searchListTitle} description={t.searchListDesc}>
        <ConcernFilters
          action="/official/concerns"
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
          hasFilters
            ? total === 1
              ? t.matchingOne
              : t.matchingMany.replace("{count}", String(total))
            : total === 1
              ? t.casesOne
              : t.casesMany.replace("{count}", String(total))
        }
        description={
          truncated
            ? t.truncated.replace("{count}", String(concerns.length))
            : t.newest
        }
      >
        {concerns.length === 0 ? (
          <p className="py-10 text-center text-sm text-slate-600">
            {t.noMatch}
          </p>
        ) : (
          <>
            <ul className="divide-y divide-slate-100 md:hidden">
              {concerns.map((concern) => (
                <li key={concern.id}>
                  <Link
                    href={`/official/concerns/${concern.id}`}
                    className="block py-3 hover:bg-slate-50"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-medium text-slate-900">{concern.title}</p>
                      <StatusBadge status={concern.status} />
                    </div>
                    <p className="mt-1 font-mono text-xs text-slate-500">
                      {concern.caseNumber}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      {concern.category.name} · {concern.user.firstName}{" "}
                      {concern.user.lastName}
                      {showOfficeScope && concern.assignedOffice
                        ? ` · ${concern.assignedOffice.name}`
                        : ""}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      {concern.priorityLevel ? (
                        <PriorityBadge level={concern.priorityLevel} />
                      ) : null}
                      {concern.slaDueAt &&
                      concern.status !== "CLOSED" &&
                      concern.status !== "RESOLVED" ? (
                        new Date(concern.slaDueAt).getTime() < now ? (
                          <span className="text-xs font-semibold text-red-700">
                            {t.overdue}
                          </span>
                        ) : (
                          <span className="text-xs text-amber-700">
                            {t.due.replace("{date}", formatDate(concern.slaDueAt))}
                          </span>
                        )
                      ) : null}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
            <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[900px] text-left text-sm">
              <caption className="sr-only">Assigned concerns</caption>
              <thead>
                <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                  <th scope="col" className="py-2 pr-4 font-semibold">
                    {t.caseNo}
                  </th>
                  <th scope="col" className="py-2 pr-4 font-semibold">
                    {t.titleCol}
                  </th>
                  <th scope="col" className="py-2 pr-4 font-semibold">
                    {t.categoryCol}
                  </th>
                  <th scope="col" className="py-2 pr-4 font-semibold">
                    {t.residentCol}
                  </th>
                  <th scope="col" className="py-2 pr-4 font-semibold">
                    {t.priorityCol}
                  </th>
                  <th scope="col" className="py-2 pr-4 font-semibold">
                    {t.statusCol}
                  </th>
                  <th scope="col" className="py-2 pr-4 font-semibold">
                    {t.slaCol}
                  </th>
                  {showOfficeScope && (
                    <th scope="col" className="py-2 pr-4 font-semibold">
                      {t.officeCol}
                    </th>
                  )}
                  <th scope="col" className="py-2 pr-4 font-semibold">
                    {t.submittedCol}
                  </th>
                  <th scope="col" className="py-2 font-semibold">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {concerns.map((concern) => (
                  <tr key={concern.id} className="hover:bg-slate-50">
                    <td className="py-3 pr-4 font-mono text-xs text-slate-600">
                      {concern.caseNumber}
                    </td>
                    <td className="py-3 pr-4 font-medium text-slate-900">
                      {concern.title}
                    </td>
                    <td className="py-3 pr-4 text-slate-600">
                      {concern.category.name}
                    </td>
                    <td className="py-3 pr-4 text-slate-600">
                      {concern.user.firstName} {concern.user.lastName}
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
                    <td className="py-3 pr-4">
                      {concern.slaDueAt && concern.status !== "CLOSED" && concern.status !== "RESOLVED" ? (
                        new Date(concern.slaDueAt).getTime() < now ? (
                          <span className="font-semibold text-red-700">{t.overdue}</span>
                        ) : (
                          <span className="text-amber-700">
                            {t.due.replace("{date}", formatDate(concern.slaDueAt))}
                          </span>
                        )
                      ) : (
                        <span className="text-slate-400">{t.complete}</span>
                      )}
                    </td>
                    {showOfficeScope && (
                      <td className="py-3 pr-4 text-slate-600">
                        {concern.assignedOffice?.name ?? (
                          <span className="text-slate-400">{t.unassigned}</span>
                        )}
                      </td>
                    )}
                    <td className="py-3 pr-4 text-slate-600">
                      {formatDate(concern.createdAt)}
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
          </>
        )}
      </Card>
    </div>
  );
}
