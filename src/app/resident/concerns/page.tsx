import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth/session";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge, PriorityBadge, StatusBadge } from "@/components/ui/badge";
import { formatDate, formatDateTime } from "@/lib/format";

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
          <h1 className="text-2xl font-bold text-slate-900">My Concerns</h1>
          <p className="mt-1 text-sm text-slate-600">
            All concerns you have submitted, newest first.
          </p>
        </div>
        <Button href="/resident/concerns/new" size="sm">
          Submit concern
        </Button>
      </div>

      <Card>
        {concerns.length === 0 ? (
          <div className="py-10 text-center">
            <p className="text-sm text-slate-600">
              You have not submitted any concerns yet.
            </p>
            <Button href="/resident/concerns/new" className="mt-3" size="sm">
              Submit your first concern
            </Button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-left text-sm">
              <caption className="sr-only">My submitted concerns</caption>
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
                    <td className="py-3 pr-4">
                      {concern.priorityLevel ? (
                        <PriorityBadge level={concern.priorityLevel} />
                      ) : (
                        <Badge tone="neutral">Priority pending</Badge>
                      )}
                    </td>
                    <td className="py-3 pr-4 text-slate-600">
                      {concern.assignedOffice?.name ?? (
                        <span className="text-amber-700">Pending routing</span>
                      )}
                    </td>
                    <td className="py-3 pr-4 text-slate-600">
                      {formatDate(concern.createdAt)}
                    </td>
                    <td className="py-3 pr-4 text-slate-600">
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
                        View
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
