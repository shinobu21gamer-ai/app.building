import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth/session";
import { Card } from "@/components/ui/card";
import { PriorityBadge, StatusBadge } from "@/components/ui/badge";
import { ConcernFilters } from "@/components/cases/concern-filters";
import { PageHeader } from "@/components/ui/page-header";
import { listConcerns, parseConcernFilters } from "@/lib/cases/query";
import { concernProcessFlow } from "@/lib/cases/process-flow";
import { fundedAmountsByConcern } from "@/lib/treasury/query";
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
  // Which flow step each case is on. The step number and title come from the
  // same engine the case page uses, so the queue and the case agree.
  const flowCopy = copy[locale].flow;
  const funded = await fundedAmountsByConcern(
    db,
    concerns.map((concern) => concern.id)
  );
  const flowHints = new Map(
    concerns.map((concern) => {
      const flow = concernProcessFlow(concern, funded.get(concern.id) ?? 0);
      const current = flow.steps.find((step) => step.key === flow.currentKey);
      return [
        concern.id,
        current
          ? `${flowCopy.stepOf
              .replace("{current}", String(current.number))
              .replace("{total}", String(flow.steps.length))} · ${
              flowCopy.steps[current.key].title
            }`
          : flowCopy.closedNote,
      ];
    })
  );
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
      <PageHeader
        title={t.caseManagement}
        description={
          <>
            {scopeLabel}
            {isOfficial ? ` ${t.manageOnly}` : ""}
          </>
        }
      />

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
          <p className="py-10 text-center text-sm text-ink-muted">
            {t.noMatch}
          </p>
        ) : (
          <>
            <ul className="divide-y divide-line md:hidden">
              {concerns.map((concern) => (
                <li key={concern.id}>
                  <Link
                    href={`/official/concerns/${concern.id}`}
                    className="block py-3 hover:bg-surface-muted"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-medium text-ink">{concern.title}</p>
                      <StatusBadge status={concern.status} />
                    </div>
                    <p className="mt-1 font-mono text-xs text-ink-subtle">
                      {concern.caseNumber}
                    </p>
                    <p className="mt-1 text-xs text-ink-subtle">
                      {concern.category.name} · {concern.user.firstName}{" "}
                      {concern.user.lastName}
                      {showOfficeScope && concern.assignedOffice
                        ? ` · ${concern.assignedOffice.name}`
                        : ""}
                    </p>
                    <p className="mt-1 text-xs font-medium text-brand-800">
                      {flowHints.get(concern.id)}
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
                <tr className="border-b border-line text-xs uppercase tracking-wide text-ink-subtle">
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
              <tbody className="divide-y divide-line">
                {concerns.map((concern) => (
                  <tr key={concern.id} className="hover:bg-surface-muted">
                    <td className="py-3 pr-4 font-mono text-xs text-ink-muted">
                      {concern.caseNumber}
                    </td>
                    <td className="py-3 pr-4 font-medium text-ink">
                      {concern.title}
                    </td>
                    <td className="py-3 pr-4 text-ink-muted">
                      {concern.category.name}
                    </td>
                    <td className="py-3 pr-4 text-ink-muted">
                      {concern.user.firstName} {concern.user.lastName}
                    </td>
                    <td className="py-3 pr-4">
                      {concern.priorityLevel ? (
                        <PriorityBadge level={concern.priorityLevel} />
                      ) : (
                        <span className="text-ink-faint">{t.notAssessed}</span>
                      )}
                    </td>
                    <td className="py-3 pr-4">
                      <StatusBadge status={concern.status} />
                      <p className="mt-1 text-xs text-brand-800">
                        {flowHints.get(concern.id)}
                      </p>
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
                        <span className="text-ink-faint">{t.complete}</span>
                      )}
                    </td>
                    {showOfficeScope && (
                      <td className="py-3 pr-4 text-ink-muted">
                        {concern.assignedOffice?.name ?? (
                          <span className="text-ink-faint">{t.unassigned}</span>
                        )}
                      </td>
                    )}
                    <td className="py-3 pr-4 text-ink-muted">
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
