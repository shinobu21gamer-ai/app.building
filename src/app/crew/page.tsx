import type { Metadata } from "next";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth/session";
import { Card } from "@/components/ui/card";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { CrewJobForm } from "@/components/cases/crew-job-form";
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

  const jobs = await listCrewJobs(db, user.id);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">{t.jobTitle}</h1>
        <p className="mt-1 text-sm text-slate-600">{t.jobDesc}</p>
      </div>

      {jobs.length === 0 ? (
        <Card>
          <p className="text-sm text-slate-500">{t.jobEmpty}</p>
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
                      <dt className="text-slate-500">{t.geotagPurok}</dt>
                      <dd className="text-slate-900">
                        {job.concern.locationPurok ?? job.concern.locationAddress}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-slate-500">{t.jobSchedule}</dt>
                      <dd className="text-slate-900">
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
                        <dt className="text-slate-500">{t.jobEquipment}</dt>
                        <dd className="text-slate-900">{assessment.equipmentNotes}</dd>
                      </div>
                    )}
                    {job.taskNote && (
                      <div className="sm:col-span-2">
                        <dt className="text-slate-500">{t.crewProgress}</dt>
                        <dd className="text-slate-900">{job.taskNote}</dd>
                      </div>
                    )}
                  </dl>

                  <div className="border-t border-slate-100 pt-3">
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
