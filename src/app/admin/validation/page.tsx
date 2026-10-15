import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth/session";
import { Card } from "@/components/ui/card";
import { Badge, PriorityBadge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page-header";
import { StepGuide } from "@/components/cases/step-guide";
import { concernProcessFlow } from "@/lib/cases/process-flow";
import { fundedAmountsByConcern } from "@/lib/treasury/query";
import { formatDateTime } from "@/lib/format";
import { copy } from "@/lib/i18n";
import { getLocale } from "@/lib/locale";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Validation queue",
};

export const dynamic = "force-dynamic";

type View = "queue" | "done" | "all";

/**
 * Admin validation queue: submitted concerns that still need a confirmed
 * service type (or that are sitting in SUBMITTED), plus — behind the second tab
 * — the reports whose validation is finished.
 *
 * "How do I know a report is done?" is the question this desk exists to answer,
 * so each row carries the four checks validation consists of (type, category,
 * priority, routing) with the ones still missing, and the counts above the list
 * say how many are waiting against how many have moved on. The `done` tab is the
 * list of reports that are complete: they are with an office, not here.
 */
export default async function ValidationQueuePage({
  searchParams,
}: {
  searchParams: Promise<{ show?: string }>;
}) {
  await requirePermission("case.validate");
  const locale = await getLocale();
  const t = copy[locale].revamp.workflow;
  const flowCopy = copy[locale].flow;
  const params = await searchParams;
  const view: View =
    params.show === "done" ? "done" : params.show === "all" ? "all" : "queue";

  const [queue, done] = await Promise.all([
    db.concern.findMany({
      where: {
        OR: [{ typeId: null }, { status: "SUBMITTED" }],
        status: { notIn: ["RESOLVED", "CLOSED"] },
      },
      orderBy: { submittedAt: "asc" },
      take: 100,
      include: {
        category: { select: { name: true } },
        type: { select: { name: true } },
        assignedOffice: { select: { name: true } },
        user: { select: { firstName: true, lastName: true } },
        caseAssessment: { select: { workersNeeded: true, totalCost: true } },
        resolutions: {
          orderBy: { id: "desc" },
          take: 1,
          select: { verificationStatus: true },
        },
        crewAssignments: { where: { isActive: true }, select: { id: true } },
        fieldChecks: { select: { status: true, finding: true } },
      },
    }),
    db.concern.findMany({
      where: {
        typeId: { not: null },
        status: { notIn: ["SUBMITTED", "RESOLVED", "CLOSED"] },
      },
      orderBy: { validatedAt: "desc" },
      take: 100,
      include: {
        category: { select: { name: true } },
        type: { select: { name: true } },
        assignedOffice: { select: { name: true } },
        user: { select: { firstName: true, lastName: true } },
        caseAssessment: { select: { workersNeeded: true, totalCost: true } },
        resolutions: {
          orderBy: { id: "desc" },
          take: 1,
          select: { verificationStatus: true },
        },
        crewAssignments: { where: { isActive: true }, select: { id: true } },
        fieldChecks: { select: { status: true, finding: true } },
      },
    }),
  ]);

  const concerns = view === "queue" ? queue : view === "done" ? done : [...queue, ...done];
  const funded = await fundedAmountsByConcern(
    db,
    concerns.map((concern) => concern.id)
  );

  const tabs: Array<{ value: View; label: string }> = [
    { value: "queue", label: t.validationTabQueue },
    { value: "done", label: t.validationTabDone },
    { value: "all", label: t.validationTabAll },
  ];

  function checksFor(concern: (typeof concerns)[number]) {
    return [
      { label: t.validationCheckType, done: concern.typeId !== null },
      { label: t.validationCheckCategory, done: concern.categoryId !== null },
      { label: t.validationCheckPriority, done: concern.priorityConfirmedAt !== null },
      { label: t.validationCheckRoute, done: concern.assignedOfficeId !== null },
    ];
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={t.validationQueueTitle}
        description={t.validationQueueDesc}
      />

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
            ).map((step, index) => ({
              title: step.title,
              detail: step.lead,
              who: step.who,
              highlight: index === 0,
            }))}
        />
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav aria-label={t.validationQueueTitle} className="flex flex-wrap gap-2">
          {tabs.map((tab) => (
            <Link
              key={tab.value}
              href={tab.value === "queue" ? "/admin/validation" : `/admin/validation?show=${tab.value}`}
              aria-current={view === tab.value ? "page" : undefined}
              className={cn(
                "inline-flex h-9 items-center rounded-full border px-3 text-sm font-semibold transition-colors",
                view === tab.value
                  ? "border-brand-700 bg-brand-700 text-white"
                  : "border-line-strong bg-surface text-ink-muted hover:bg-surface-muted hover:text-ink"
              )}
            >
              {tab.label}
            </Link>
          ))}
        </nav>
        <p className="text-xs text-ink-subtle">
          {t.validationCounts
            .replace("{queue}", String(queue.length))
            .replace("{done}", String(done.length))}
        </p>
      </div>

      {concerns.length === 0 ? (
        <Card>
          <p className="text-sm text-ink-subtle">
            {view === "done" ? t.validationDoneEmpty : t.validationQueueEmpty}
          </p>
        </Card>
      ) : (
        <ul className="space-y-3">
          {concerns.map((concern) => {
            const flow = concernProcessFlow(concern, funded.get(concern.id) ?? 0);
            const current = flow.steps.find((step) => step.key === flow.currentKey);
            const checks = checksFor(concern);
            const doneCount = checks.filter((check) => check.done).length;
            const complete = doneCount === checks.length;
            return (
              <li key={concern.id}>
                <Card className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-ink">
                        {concern.caseNumber}
                      </span>
                      <Badge tone={concern.typeId === null ? "amber" : "sky"}>
                        {concern.typeId === null ? t.validationAwaitingType : concern.type?.name}
                      </Badge>
                      <PriorityBadge level={concern.priorityLevel ?? "LOW"} />
                      {complete ? (
                        <Badge tone="green">{t.validationComplete}</Badge>
                      ) : (
                        <Badge tone="gray">
                          {t.validationProgress
                            .replace("{done}", String(doneCount))
                            .replace("{total}", String(checks.length))}
                        </Badge>
                      )}
                    </div>
                    <p className="mt-1 text-sm text-ink-muted">{concern.title}</p>
                    <p className="mt-1 text-xs text-ink-subtle">
                      {concern.category.name} · {concern.assignedOffice?.name ?? "—"} ·{" "}
                      {formatDateTime(concern.submittedAt)}
                    </p>

                    {/* The four checks validation is made of. An unchecked line
                        is the answer to "what is still missing?" without having
                        to open the case. */}
                    <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                      {checks.map((check) => (
                        <li
                          key={check.label}
                          className={cn(
                            "inline-flex items-center gap-1.5",
                            check.done ? "text-emerald-700" : "text-ink-subtle"
                          )}
                        >
                          <span aria-hidden="true">{check.done ? "✓" : "○"}</span>
                          {check.label}
                        </li>
                      ))}
                    </ul>

                    {current && (
                      <p className="mt-1 text-xs font-medium text-brand-800">
                        {t.validationNext.replace(
                          "{step}",
                          `${flowCopy.stepOf
                            .replace("{current}", String(current.number))
                            .replace("{total}", String(flow.steps.length))} · ${
                            flowCopy.steps[current.key].title
                          }`
                        )}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      href={`/official/concerns/${concern.id}/print`}
                      className="no-print inline-flex items-center rounded-control border border-line-strong bg-surface px-3 py-2 text-xs font-semibold text-ink-muted transition-colors hover:bg-surface-muted hover:text-ink"
                    >
                      {t.validationPrint}
                    </Link>
                    <Link
                      href={`/official/concerns/${concern.id}`}
                      className="inline-flex items-center rounded-control bg-brand-700 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-brand-800"
                    >
                      {t.validationOpenCase}
                    </Link>
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
