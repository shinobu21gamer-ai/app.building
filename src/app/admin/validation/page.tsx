import type { Metadata } from "next";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth/session";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge, PriorityBadge } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/format";
import { copy } from "@/lib/i18n";
import { getLocale } from "@/lib/locale";

export const metadata: Metadata = {
  title: "Validation queue",
};

export const dynamic = "force-dynamic";

/**
 * Admin validation queue: submitted concerns that still need a confirmed
 * service type (or that are sitting in SUBMITTED). Opening a case leads to the
 * validation form on the case page.
 */
export default async function ValidationQueuePage() {
  await requirePermission("case.validate");
  const locale = await getLocale();
  const t = copy[locale].revamp.workflow;

  const concerns = await db.concern.findMany({
    where: {
      OR: [{ typeId: null }, { status: "SUBMITTED" }],
      status: { notIn: ["RESOLVED", "CLOSED"] },
    },
    orderBy: { submittedAt: "asc" },
    take: 100,
    include: {
      category: { select: { name: true } },
      assignedOffice: { select: { name: true } },
      user: { select: { firstName: true, lastName: true } },
    },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">
          {t.validationQueueTitle}
        </h1>
        <p className="mt-1 text-sm text-slate-600">{t.validationQueueDesc}</p>
      </div>

      {concerns.length === 0 ? (
        <Card>
          <p className="text-sm text-slate-500">{t.validationQueueEmpty}</p>
        </Card>
      ) : (
        <ul className="space-y-3">
          {concerns.map((concern) => (
            <li key={concern.id}>
              <Card className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-slate-900">
                      {concern.caseNumber}
                    </span>
                    <Badge tone={concern.typeId === null ? "amber" : "sky"}>
                      {concern.typeId === null ? t.validationAwaitingType : "typed"}
                    </Badge>
                    <PriorityBadge level={concern.priorityLevel ?? "LOW"} />
                  </div>
                  <p className="mt-1 text-sm text-slate-700">{concern.title}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    {concern.category.name} ·{" "}
                    {concern.assignedOffice?.name ?? "—"} ·{" "}
                    {formatDateTime(concern.submittedAt)}
                  </p>
                </div>
                <Button
                  href={`/official/concerns/${concern.id}`}
                  size="sm"
                  variant="outline"
                >
                  {t.validationOpenCase}
                </Button>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
