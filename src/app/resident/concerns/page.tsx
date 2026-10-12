import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth/session";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge, PriorityBadge, StatusBadge } from "@/components/ui/badge";
import { formatDate, formatDateTime } from "@/lib/format";
import { copy } from "@/lib/i18n";
import { getLocale } from "@/lib/locale";

export const metadata: Metadata = {
  title: "My Concerns",
};

function lastUpdated(
  updatedAt: Date,
  latestHistory: { createdAt: Date } | null
): Date {
  if (!latestHistory) return updatedAt;
  return latestHistory.createdAt > updatedAt ? latestHistory.createdAt : updatedAt;
}

export default async function MyConcernsPage() {
  const user = await requireRole(["RESIDENT"]);
  const locale = await getLocale();
  const t = copy[locale].resident;

  const concerns = await db.concern.findMany({
    where: { userId: user.id },
    include: {
      category: true,
      assignedOffice: true,
      history: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { createdAt: true },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-title text-ink sm:text-display">{t.myTitle}</h1>
          <p className="mt-1 text-sm text-ink-muted">{t.myLead}</p>
        </div>
        <Button href="/resident/concerns/new" size="sm">
          {t.submit}
        </Button>
      </div>

      <Card>
        {concerns.length === 0 ? (
          <div className="py-10 text-center">
            <p className="text-sm text-ink-muted">{t.empty}</p>
            <Button href="/resident/concerns/new" className="mt-3" size="sm">
              {t.first}
            </Button>
          </div>
        ) : (
          <>
            <ul className="divide-y divide-line md:hidden">
              {concerns.map((concern) => (
                <li key={concern.id}>
                  <Link
                    href={`/resident/concerns/${concern.id}`}
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
                      {concern.category.name}
                      {concern.assignedOffice
                        ? ` · ${concern.assignedOffice.name}`
                        : ` · ${t.pendingRoute}`}
                      {" · "}
                      {formatDateTime(
                        lastUpdated(concern.updatedAt, concern.history[0] ?? null)
                      )}
                    </p>
                    <div className="mt-2">
                      {concern.priorityLevel ? (
                        <PriorityBadge level={concern.priorityLevel} />
                      ) : (
                        <Badge tone="neutral">{t.pendingPriority}</Badge>
                      )}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
            <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[900px] text-left text-sm">
              <caption className="sr-only">My submitted concerns</caption>
              <thead>
                <tr className="border-b border-line text-xs uppercase tracking-wide text-ink-subtle">
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
                    Priority
                  </th>
                  <th scope="col" className="py-2 pr-4 font-semibold">
                    Assigned office
                  </th>
                  <th scope="col" className="py-2 pr-4 font-semibold">
                    Submitted
                  </th>
                  <th scope="col" className="py-2 pr-4 font-semibold">
                    Last update
                  </th>
                  <th scope="col" className="py-2 pr-4 font-semibold">
                    Status
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
                    <td className="py-3 pr-4">
                      {concern.priorityLevel ? (
                        <PriorityBadge level={concern.priorityLevel} />
                      ) : (
                        <Badge tone="neutral">{t.pendingPriority}</Badge>
                      )}
                    </td>
                    <td className="py-3 pr-4 text-ink-muted">
                      {concern.assignedOffice?.name ?? (
                        <span className="text-amber-700">{t.pendingRoute}</span>
                      )}
                    </td>
                    <td className="py-3 pr-4 text-ink-muted">
                      {formatDate(concern.createdAt)}
                    </td>
                    <td className="py-3 pr-4 text-ink-muted">
                      {formatDateTime(
                        lastUpdated(concern.updatedAt, concern.history[0] ?? null)
                      )}
                    </td>
                    <td className="py-3 pr-4">
                      <StatusBadge status={concern.status} />
                    </td>
                    <td className="py-3 text-right">
                      <Link
                        href={`/resident/concerns/${concern.id}`}
                        className="text-sm font-semibold text-brand-700 hover:text-brand-800"
                      >
                        {t.view}
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
