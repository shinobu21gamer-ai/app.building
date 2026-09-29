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
  const params = await searchParams;

  const filters = parseConcernFilters(params);

  const isOfficial = user.role.key === "OFFICIAL";
  let scopeLabel: string;
  if (isOfficial) {
    if (user.officeId === null) {
      filters.officeId = -1;
      scopeLabel = "No office is assigned to your account.";
    } else {
      filters.officeId = user.officeId;
      scopeLabel = `Cases assigned to ${user.office?.name ?? "your office"}.`;
    }
  } else {
    scopeLabel = filters.officeId
      ? "Showing cases for the selected office."
      : "All cases across every office.";
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
        <h1 className="text-2xl font-bold text-slate-900">Case Management</h1>
        <p className="mt-1 text-sm text-slate-600">
          {scopeLabel} {isOfficial ? "You can only manage these cases." : ""}
        </p>
      </div>

      <Card
        title="Search and filter"
        description="Narrow the case list by keyword, status, priority, category, office, or submission date."
      >
        <ConcernFilters
          action="/official/concerns"
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
        title={`${total} case${total === 1 ? "" : "s"}${hasFilters ? " matching" : ""}`}
        description={
          truncated
            ? `Showing the most recent ${concerns.length}. Refine your search to narrow the results.`
            : "Newest first."
        }
      >
        {concerns.length === 0 ? (
          <p className="py-10 text-center text-sm text-slate-600">
            No cases match these criteria.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-left text-sm">
              <caption className="sr-only">Assigned concerns</caption>
              <thead>
                <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                  <th scope="col" className="py-2 pr-4 font-semibold">
                    Case no.
                  </th>
                  <th scope="col" className="py-2 pr-4 font-semibold">
                    Title
                  </th>
                  <th scope="col" className="py-2 pr-4 font-semibold">
                    Category
                  </th>
                  <th scope="col" className="py-2 pr-4 font-semibold">
                    Resident
                  </th>
                  <th scope="col" className="py-2 pr-4 font-semibold">
                    Priority
                  </th>
                  <th scope="col" className="py-2 pr-4 font-semibold">
                    Status
                  </th>
                  <th scope="col" className="py-2 pr-4 font-semibold">
                    SLA
                  </th>
                  {showOfficeScope && (
                    <th scope="col" className="py-2 pr-4 font-semibold">
                      Office
                    </th>
                  )}
                  <th scope="col" className="py-2 pr-4 font-semibold">
                    Submitted
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
                        <span className="text-slate-400">Not assessed</span>
                      )}
                    </td>
                    <td className="py-3 pr-4">
                      <StatusBadge status={concern.status} />
                    </td>
                    <td className="py-3 pr-4">
                      {concern.slaDueAt && concern.status !== "CLOSED" && concern.status !== "RESOLVED" ? (
                        new Date(concern.slaDueAt).getTime() < now ? (
                          <span className="font-semibold text-red-700">Overdue</span>
                        ) : (
                          <span className="text-amber-700">Due {formatDate(concern.slaDueAt)}</span>
                        )
                      ) : (
                        <span className="text-slate-400">Complete</span>
                      )}
                    </td>
                    {showOfficeScope && (
                      <td className="py-3 pr-4 text-slate-600">
                        {concern.assignedOffice?.name ?? (
                          <span className="text-slate-400">Unassigned</span>
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
                        Manage
                      </Link>
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
