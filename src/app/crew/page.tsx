import type { Metadata } from "next";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth/session";
import { Card } from "@/components/ui/card";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { CrewJobForm } from "@/components/cases/crew-job-form";
import { StepGuide } from "@/components/cases/step-guide";
import { FieldCheckSubmitForm } from "@/components/cases/field-check-panel";
import { PageHeader } from "@/components/ui/page-header";
import { listCrewJobs } from "@/lib/cases/crew";
import { formatDateTime } from "@/lib/format";
import { copy } from "@/lib/i18n";
import { getLocale } from "@/lib/locale";

export const metadata: Metadata = {
  title: "My assignments",
};

export const dynamic = "force-dynamic";

/**
 * The crew portal: the signed-in crew member's own open assignments, with the
 * plan (how many people, how long, what equipment) and a way to report progress
 * back to the office.
 */
export default async function CrewHomePage() {
  const user = await requirePermission("crew.job.view.own");
  const locale = await getLocale();
  const t = copy[locale].revamp.workflow;

  const flowCopy = copy[locale].flow;
  const jobs = await listCrewJobs(db, user.id);
  const fieldChecks = await db.fieldCheck.findMany({
    where: { assigneeId: user.id, status: "PENDING" },
    include: { concern: { select: { caseNumber: true, title: true } } },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className="space-y-6">
      <PageHeader title={t.jobTitle} description={t.jobDesc} />

      {fieldChecks.length > 0 && (
        <Card title={t.fieldCheck.forYou} description={t.fieldCheck.forYouDesc}>
          <ul className="space-y-4">
            {fieldChecks.map((check) => (
              <li key={check.id} className="space-y-2 rounded-xl border border-line p-4">
                <p className="text-sm font-medium text-ink">
                  {t.fieldCheck.caseLabel} {check.concern.caseNumber} · {check.concern.title}
                </p>
                <p className="text-sm text-ink-subtle">{check.instructions}</p>
                <FieldCheckSubmitForm checkId={check.id} locale={locale} />
              </li>
            ))}
          </ul>
        </Card>
      )}

      {jobs.length === 0 ? (
        <Card>
          <p className="text-sm text-ink-subtle">{t.jobEmpty}</p>
        </Card>
      ) : (
        <ul className="space-y-4">
          {jobs.map((job) => {
            const assessment = job.concern.caseAssessment;
            return (
              <li key={job.id}>
                <Card
                  className="space-y-3"
                  title={`${job.concern.caseNumber} · ${job.concern.title}`}
                  description={job.concern.assignedOffice?.name ?? undefined}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge status={job.concern.status} />
                    {assessment?.workersNeeded ? (
                      <Badge tone="violet">
                        {t.jobWorkers}: {assessment.workersNeeded}
                      </Badge>
                    ) : null}
                    {assessment?.estimatedDurationMinutes ? (
                      <Badge tone="sky">
                        {assessment.estimatedDurationMinutes} min
                      </Badge>
                    ) : null}
                  </div>

                  <dl className="grid gap-2 text-sm sm:grid-cols-2">
                    <div>
                      <dt className="text-ink-subtle">{t.geotagPurok}</dt>
                      <dd className="text-ink">
                        {job.concern.locationPurok ?? job.concern.locationAddress}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-ink-subtle">{t.jobSchedule}</dt>
                      <dd className="text-ink">
                        {job.scheduledStartAt ?? assessment?.scheduledStartAt
                          ? formatDateTime(
                              job.scheduledStartAt ??
                                (assessment?.scheduledStartAt as Date)
                            )
                          : "—"}
                      </dd>
                    </div>
                    {assessment?.equipmentNotes && (
                      <div className="sm:col-span-2">
                        <dt className="text-ink-subtle">{t.jobEquipment}</dt>
                        <dd className="text-ink">{assessment.equipmentNotes}</dd>
                      </div>
                    )}
                    {job.taskNote && (
                      <div className="sm:col-span-2">
                        <dt className="text-ink-subtle">{t.crewProgress}</dt>
                        <dd className="text-ink">{job.taskNote}</dd>
                      </div>
                    )}
                  </dl>

                  <div className="border-t border-line pt-3">
                    <StepGuide
                      title={flowCopy.crew.title}
                      lead={flowCopy.crew.lead}
                      steps={flowCopy.crew.steps.map((step, index) => {
                        // Once the office starts the work, sending progress is
                        // the crew's job; before that, checking the plan is.
                        const current =
                          job.concern.status === "IN_PROGRESS" ? 2 : 0;
                        return {
                          title: step.title,
                          detail: step.detail,
                          highlight: index === current,
                          stateLabel:
                            index === current ? flowCopy.currentBadge : undefined,
                        };
                      })}
                    />
                  </div>

                  <div className="border-t border-line pt-3">
                    <CrewJobForm concernId={job.concern.id} locale={locale} />
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
