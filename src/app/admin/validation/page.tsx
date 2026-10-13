import type { Metadata } from "next";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth/session";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge, PriorityBadge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page-header";
import { StepGuide } from "@/components/cases/step-guide";
import { concernProcessFlow } from "@/lib/cases/process-flow";
import { fundedAmountsByConcern } from "@/lib/treasury/query";
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
 *
 * The whole eight-step flow is printed above the queue, and every case says
 * which step it is on, so the admin desk can see where validation sits in the
 * work that follows it.
 */
export default async function ValidationQueuePage() {
  await requirePermission("case.validate");
  const locale = await getLocale();
  const t = copy[locale].revamp.workflow;
  const flowCopy = copy[locale].flow;

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
      // Enough of the case to place it on the flow (see concernProcessFlow).
      type: { select: { requiresBudget: true } },
      caseAssessment: { select: { workersNeeded: true, totalCost: true } },
      resolutions: {
        orderBy: { id: "desc" },
        take: 1,
        select: { verificationStatus: true },
      },
      crewAssignments: { where: { isActive: true }, select: { id: true } },
      fieldChecks: { select: { status: true, finding: true } },
    },
  });

  const funded = await fundedAmountsByConcern(
    db,
    concerns.map((concern) => concern.id)
  );

  return (
    <div className="space-y-6">
      <PageHeader title={t.validationQueueTitle} description={t.validationQueueDesc} />

      <Card title={flowCopy.guide.title} description={flowCopy.guide.lead}>
        <StepGuide
          steps={(
            [
              flowCopy.steps.VALIDATE,
              flowCopy.steps.ASSESS,
              flowCopy.steps.FUND,
              flowCopy.steps.CREW,
              flowCopy.steps.START,
              flowCopy.steps.WORK,
              flowCopy.steps.VERIFY,
              flowCopy.steps.CLOSE,
            ] as const
          ).map((step) => ({ title: step.title, detail: step.lead }))}
        />
      </Card>

      {concerns.length === 0 ? (
        <Card>
          <p className="text-sm text-ink-subtle">{t.validationQueueEmpty}</p>
        </Card>
      ) : (
        <ul className="space-y-3">
          {concerns.map((concern) => {
            const flow = concernProcessFlow(
              concern,
              funded.get(concern.id) ?? 0
            );
            const current = flow.steps.find(
              (step) => step.key === flow.currentKey
            );
            return (
              <li key={concern.id}>
                <Card className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-ink">
                        {concern.caseNumber}
                      </span>
                      <Badge tone={concern.typeId === null ? "amber" : "sky"}>
                        {concern.typeId === null ? t.validationAwaitingType : "typed"}
                      </Badge>
                      <PriorityBadge level={concern.priorityLevel ?? "LOW"} />
                    </div>
                    <p className="mt-1 text-sm text-ink-muted">{concern.title}</p>
                    <p className="mt-1 text-xs text-ink-subtle">
                      {concern.category.name} ·{" "}
                      {concern.assignedOffice?.name ?? "—"} ·{" "}
                      {formatDateTime(concern.submittedAt)}
                    </p>
                    {current && (
                      <p className="mt-1 text-xs font-medium text-brand-800">
                        {flowCopy.guide.nextLabel}:{" "}
                        {flowCopy.stepOf
                          .replace("{current}", String(current.number))
                          .replace("{total}", String(flow.steps.length))}{" "}
                        · {flowCopy.steps[current.key].title}
                      </p>
                    )}
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
            );
          })}
        </ul>
      )}
    </div>
  );
}
