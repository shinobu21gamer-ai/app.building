import type { Metadata } from "next";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth/session";
import { Card } from "@/components/ui/card";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { CrewJobForm } from "@/components/cases/crew-job-form";
import { StepGuide } from "@/components/cases/step-guide";
import { FieldCheckSubmitForm } from "@/components/cases/field-check-panel";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { DeskGuide } from "@/components/portals/desk-guide";
import { listCrewJobs } from "@/lib/cases/crew";
import { hasCoordinates, openStreetMapUrl } from "@/lib/maps";
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
  const howTo = copy[locale].revamp.howTo;
  // Mirrors the query below, with the amount widened to a plain number
  // (Prisma returns Decimals) and the nullable columns kept nullable.
  type CrewPaymentRow = {
    id: number;
    amount: number;
    voucherNumber: string | null;
    releasedAt: Date | null;
    concern: { caseNumber: string } | null;
  };
  const [jobs, paymentRows] = await Promise.all([
    listCrewJobs(db, user.id),
    // The money that has actually left the treasury for this member.
    db.disbursement.findMany({
      where: {
        payeeUserId: user.id,
        payeeType: "CREW",
        // RELEASED = the money actually left the treasury.
        status: "RELEASED",
      },
      select: {
        id: true,
        amount: true,
        voucherNumber: true,
        releasedAt: true,
        concern: { select: { caseNumber: true } },
      },
      orderBy: { id: "desc" },
      take: 20,
    }),
  ]);
  // Map (not cast) so the Decimal amount is widened to a plain number and the
  // result is genuinely CrewPaymentRow[], not an unchecked assertion.
  const payments: CrewPaymentRow[] = paymentRows.map((row) => ({
    id: row.id,
    amount: Number(row.amount),
    voucherNumber: row.voucherNumber,
    releasedAt: row.releasedAt,
    concern: row.concern,
  }));
  const paidTotal = payments.reduce((sum, row) => sum + row.amount, 0);
  const fieldChecks = await db.fieldCheck.findMany({
    where: { assigneeId: user.id, status: "PENDING" },
    include: {
      concern: {
        select: {
          caseNumber: true,
          title: true,
          // The resident's own location: the checker has to go to that spot.
          locationAddress: true,
          locationPurok: true,
          locationLat: true,
          locationLng: true,
        },
      },
    },
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
                {check.reviewNote && (
                  <p className="rounded-control border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                    {t.fieldCheck.reviewNote}: {check.reviewNote}
                  </p>
                )}
                <FieldCheckSubmitForm
                  checkId={check.id}
                  locale={locale}
                  location={{
                    address: check.concern.locationAddress,
                    purok: check.concern.locationPurok,
                    lat: check.concern.locationLat,
                    lng: check.concern.locationLng,
                    mapUrl: hasCoordinates({
                      lat: check.concern.locationLat,
                      lng: check.concern.locationLng,
                    })
                      ? openStreetMapUrl(
                          check.concern.locationLat as number,
                          check.concern.locationLng as number
                        )
                      : null,
                  }}
                />
              </li>
            ))}
          </ul>
        </Card>
      )}

      {jobs.length === 0 ? (
        <Card>
          <EmptyState title={t.jobEmpty} description={t.jobEmptyHint} />
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
                    <StatusBadge status={job.concern.status} locale={locale} />
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
                        const yours = index === current;
                        return {
                          title: step.title,
                          detail: step.detail,
                          highlight: yours,
                          yoursLabel: yours ? flowCopy.youDoThis : flowCopy.yoursLater,
                          stateLabel: yours ? flowCopy.yourTurn : flowCopy.laterBadge,
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

      <Card title={t.myPayments} description={t.myPaymentsDesc}>
        {payments.length === 0 ? (
          <p className="text-sm text-ink-subtle">{t.myPaymentsEmpty}</p>
        ) : (
          <>
            <dl className="divide-y divide-line">
              {payments.map((row) => (
                <div
                  key={row.id}
                  className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2 text-sm"
                >
                  <dt className="text-ink-muted">
                    {row.concern?.caseNumber ?? t.myPaymentsNoCase}
                    {row.voucherNumber ? ` · ${row.voucherNumber}` : ""}
                  </dt>
                  <dd className="font-medium tabular-nums text-ink">
                    ₱{Number(row.amount).toFixed(2)}
                  </dd>
                  {row.releasedAt && (
                    <dd className="w-full text-xs text-ink-subtle sm:w-auto">
                      {t.myPaymentsReleased}: {formatDateTime(row.releasedAt)}
                    </dd>
                  )}
                </div>
              ))}
              <div className="flex items-baseline justify-between gap-4 py-2 text-sm">
                <dt className="font-semibold text-ink">
                  {t.myPaymentsTotal}
                </dt>
                <dd className="font-semibold tabular-nums text-emerald-700">
                  ₱{paidTotal.toFixed(2)}
                </dd>
              </div>
            </dl>
          </>
        )}
      </Card>

      <DeskGuide
        title={t.howToTitle}
        lead={t.howToLead}
        steps={t.howToSteps}
        mistakesTitle={howTo.ifWrong}
        mistakes={t.howToIfWrong}
        helpLabel={howTo.help}
        hideLabel={howTo.hide}
        showLabel={howTo.show}
        storageKey="br-guide-crew"
        defaultOpen={jobs.length === 0 && fieldChecks.length === 0}
      />
    </div>
  );
}
