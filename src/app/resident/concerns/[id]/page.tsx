import type { Metadata } from "next";
import { UploadedPhoto } from "@/components/ui/uploaded-photo";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth/session";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge, PriorityBadge, StatusBadge } from "@/components/ui/badge";
import { CaseReceipt } from "@/components/cases/case-receipt";
import { CopyCaseNumber } from "@/components/cases/copy-case-number";
import {
  CaseTimeline,
  type ResolutionInfo,
} from "@/components/concern/case-timeline";
import {
  CaseStatusStepper,
  type ReachedAt,
} from "@/components/cases/case-status-stepper";
import {
  canSubmitFeedback,
  caseWorkflowFlags,
  isCaseStatus,
  type CaseStatus,
} from "@/lib/cases/workflow";
import { isStatusTransition } from "@/lib/cases/action-date";
import { concernProcessFlow } from "@/lib/cases/process-flow";
import { fundedAmountsByConcern } from "@/lib/treasury/query";
import { journalReachedAt, sortJournal } from "@/lib/cases/journal";
import { residentVisibleJournal } from "@/lib/cases/journal-visibility";
import {
  PriorityBreakdown,
  parseEvaluation,
} from "@/components/priority/priority-breakdown";
import { FeedbackCard, type FeedbackView } from "@/components/cases/feedback-card";
import { ResidentFieldCheckReply } from "@/components/cases/resident-field-check-reply";
import { isFeedbackResubmissionAllowed } from "@/lib/cases/settings";
import { formatDate, formatDateTime } from "@/lib/format";
import { copy } from "@/lib/i18n";
import { getLocale } from "@/lib/locale";
import { hasCoordinates, openStreetMapUrl } from "@/lib/maps";
import { ConcernMap } from "@/components/concern/concern-map";
import { PageHeader } from "@/components/ui/page-header";
import { CaseContactCard, CaseOwner } from "@/components/cases/case-owner";

export const metadata: Metadata = {
  title: "Case Details",
};

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ created?: string }>;
};

type ResidentHistoryEntry = {
  id: number;
  entryType: string;
  fromStatus: string | null;
  toStatus: string | null;
  remarks: string | null;
  actorRole: string | null;
  createdAt: Date;
  occurredOn: Date | null;
  attachmentUrl: string | null;
  visibility: string;
};

export default async function ConcernDetailPage({
  params,
  searchParams,
}: PageProps) {
  const user = await requireRole(["RESIDENT"]);
  const locale = await getLocale();
  const t = copy[locale].resident;
  const { id } = await params;
  const { created } = await searchParams;

  const numericId = Number(id);
  if (!Number.isInteger(numericId) || numericId <= 0) notFound();

  const concern = await db.concern.findFirst({
    where: { id: numericId, userId: user.id },
    include: {
      category: true,
      assignedOffice: true,
      assignedOfficial: {
        select: { firstName: true, lastName: true, email: true },
      },
      history: {
        include: {
          actor: { select: { firstName: true, lastName: true } },
        },
        orderBy: { createdAt: "asc" },
      },
      resolutions: {
        orderBy: { id: "desc" },
        include: {
          official: { select: { firstName: true, lastName: true } },
        },
      },
      assessments: {
        include: {
          assessedBy: { select: { firstName: true, lastName: true } },
          overriddenBy: { select: { firstName: true, lastName: true } },
        },
        orderBy: { createdAt: "asc" },
      },
      assignments: {
        where: { isCurrent: true },
        orderBy: { assignedAt: "desc" },
        take: 1,
      },
      type: {
        select: {
          id: true,
          name: true,
          key: true,
          requiresCrew: true,
          requiresBudget: true,
        },
      },
      caseAssessment: { select: { workersNeeded: true, equipmentNotes: true, totalCost: true } },
      crewAssignments: { where: { isActive: true }, select: { id: true } },
      fieldChecks: {
        orderBy: { createdAt: "desc" },
        select: { id: true, status: true, finding: true },
      },
      feedback: {
        take: 1,
        orderBy: { updatedAt: "desc" },
      },
    },
  });

  if (!concern) notFound();

  const coordinates = { lat: concern.locationLat, lng: concern.locationLng };
  const resolution = concern.resolutions[0] ?? null;
  const currentAssignment = concern.assignments[0] ?? null;
  const latestAssessment =
    concern.assessments.length > 0
      ? concern.assessments[concern.assessments.length - 1]
      : null;

  const existingFeedback: FeedbackView | null = concern.feedback[0]
    ? {
        wasResolved: concern.feedback[0].wasResolved,
        rating: concern.feedback[0].rating,
        comment: concern.feedback[0].comment,
        updatedAt: concern.feedback[0].updatedAt.toISOString(),
      }
    : null;
  const [feedbackResubmissionAllowed, fundedAmounts] = await Promise.all([
    isFeedbackResubmissionAllowed(db),
    fundedAmountsByConcern(db, [concern.id]),
  ]);
  const processFlow = concernProcessFlow(
    concern,
    fundedAmounts.get(concern.id) ?? 0
  );
  const nextStep = processFlow.currentKey
    ? processFlow.steps.find((step) => step.key === processFlow.currentKey) ?? null
    : null;
  const nextActionCopy = copy[locale].resident.nextAction;
  const openFieldCheck = concern.fieldChecks.find((check) =>
    check.status === "PENDING" || check.status === "SUBMITTED"
  );
  const nextStepCopy = nextStep
    ? nextActionCopy.steps[nextStep.key]
    : null;

  // A step is dated by the first journal entry that moved the case into it,
  // using the action date when the official recorded one (shown as a day).
  // Only real status transitions count, so a remark never marks a step.
  const reachedAt: Partial<Record<CaseStatus, ReachedAt | null>> = {
    SUBMITTED: { at: concern.submittedAt, dateOnly: false },
  };
  for (const entry of sortJournal<ResidentHistoryEntry>(concern.history)) {
    const target: string | null = entry.toStatus ?? null;
    if (!isStatusTransition(entry) || !target) continue;
    if (!isCaseStatus(target) || reachedAt[target]) continue;
    reachedAt[target] = journalReachedAt(entry);
  }
  if (!reachedAt.ASSIGNED && currentAssignment) {
    reachedAt.ASSIGNED = {
      at: currentAssignment.assignedAt,
      dateOnly: false,
    };
  }
  if (!reachedAt.RESOLVED && concern.resolvedAt) {
    reachedAt.RESOLVED = { at: concern.resolvedAt, dateOnly: false };
  }
  if (!reachedAt.CLOSED && concern.closedAt) {
    reachedAt.CLOSED = { at: concern.closedAt, dateOnly: false };
  }

  const crewFlags = caseWorkflowFlags({
    status: concern.status,
    workersNeeded: concern.caseAssessment?.workersNeeded ?? null,
    activeCrew: concern.crewAssignments.length,
  });

  const resolutionInfo: ResolutionInfo | null = resolution
    ? {
        summary: resolution.summary,
        actionsTaken: resolution.actionsTaken,
        resolutionType: resolution.resolutionType,
      }
    : null;

  return (
    <div className="space-y-6">
      <div>
        <Button href="/resident/concerns" variant="ghost" size="sm">
          ← {t.back}
        </Button>
      </div>

      {created === "1" && (
        <CaseReceipt
          caseNumber={concern.caseNumber}
          concernId={concern.id}
          official={concern.assignedOfficial}
          office={concern.assignedOffice}
          locale={locale}
        />
      )}

      <PageHeader
        eyebrow={concern.caseNumber}
        title={concern.title}
        description={`${t.submitted} ${formatDateTime(concern.submittedAt)}`}
        actions={
          <>
            <CopyCaseNumber caseNumber={concern.caseNumber} />
            <Button
              href={`/resident/concerns/${concern.id}/print`}
              variant="outline"
              size="sm"
            >
              {t.print}
            </Button>
            <StatusBadge status={concern.status} locale={locale} />
            {concern.priorityLevel ? (
              <PriorityBadge level={concern.priorityLevel} />
            ) : (
              <Badge tone="neutral">{t.pendingPriority}</Badge>
            )}
          </>
        }
      />

      {created !== "1" && (
        <CaseContactCard
          official={concern.assignedOfficial}
          office={concern.assignedOffice}
          title={t.contactTitle}
          lead={t.contactLead}
          officialLabel={t.official}
          officeLabel={t.contactOffice}
          headLabel={t.contactHead}
          empty={t.officialEmpty}
        />
      )}

      <Card title={t.progress} description={t.progressDesc}>
        <CaseStatusStepper
          currentStatus={concern.status}
          reached={reachedAt}
          locale={locale}
        />
        {crewFlags.crewProgressLabel ? (
          <p className="mt-4 border-t border-line pt-3 text-xs text-ink-subtle">
            {copy[locale].revamp.workflow.crewProgress}:{" "}
            {crewFlags.crewProgressLabel}
          </p>
        ) : null}
      </Card>

      <Card title={nextActionCopy.title} description={nextActionCopy.lead}>
        {nextStepCopy ? (
          <div className="space-y-2">
            <p className="font-semibold text-ink">{nextStepCopy.title}</p>
            <p className="text-sm leading-relaxed text-ink-muted">
              {nextStepCopy.description}
            </p>
            <p className="text-sm text-ink-subtle">{nextActionCopy.checkBack}</p>
            {concern.slaDueAt ? (
              <p className="border-t border-line pt-2 text-sm text-ink-subtle">
                {concern.slaDueAt.getTime() < Date.now()
                  ? nextActionCopy.targetDatePassed.replace(
                      "{date}",
                      formatDate(concern.slaDueAt)
                    )
                  : nextActionCopy.targetDate.replace(
                      "{date}",
                      formatDate(concern.slaDueAt)
                    )}
              </p>
            ) : (
              <p className="border-t border-line pt-2 text-sm text-ink-subtle">
                {nextActionCopy.noTargetDate}
              </p>
            )}
          </div>
        ) : (
          <p className="text-sm leading-relaxed text-ink-muted">
            {processFlow.closedUnfounded
              ? nextActionCopy.unfounded
              : nextActionCopy.complete}
          </p>
        )}
      </Card>

      {openFieldCheck ? (
        <ResidentFieldCheckReply
          concernId={concern.id}
          fieldCheckId={openFieldCheck.id}
          locale={locale}
        />
      ) : null}

      <Card
        title={t.location}
        description={copy[locale].revamp.workflow.geotagDesc}
      >
        <ConcernMap
          lat={concern.locationLat}
          lng={concern.locationLng}
          label={concern.locationAddress}
          purok={concern.locationPurok}
          title={t.location}
          hint={copy[locale].revamp.workflow.geotagMapHint}
        />
      </Card>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card title={t.details}>
            <dl className="space-y-4 text-sm">
              <div>
                <dt className="text-ink-subtle">{t.category}</dt>
                <dd className="mt-0.5 font-medium text-ink">
                  {concern.category.name}
                </dd>
              </div>
              <div>
                <dt className="text-ink-subtle">{t.location}</dt>
                <dd className="mt-0.5 font-medium text-ink">
                  {concern.locationAddress}
                  {hasCoordinates(coordinates) ? (
                    <>
                      {" · "}
                      <a
                        href={openStreetMapUrl(
                          coordinates.lat,
                          coordinates.lng
                        )}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-semibold text-brand-700 hover:text-brand-800"
                      >
                        {t.map}
                      </a>
                    </>
                  ) : null}
                </dd>
              </div>
              <div>
                <dt className="text-ink-subtle">{t.description}</dt>
                <dd className="mt-0.5 max-w-3xl whitespace-pre-wrap text-ink-muted">
                  {concern.description}
                </dd>
              </div>
              <div>
                <dt className="text-ink-subtle">{t.office}</dt>
                <dd className="mt-0.5 font-medium text-ink">
                  {concern.assignedOffice ? (
                    <>
                      {concern.assignedOffice.name}
                      {currentAssignment && (
                        <span className="ml-2 text-xs font-normal text-ink-subtle">
                          on {formatDateTime(currentAssignment.assignedAt)}
                        </span>
                      )}
                    </>
                  ) : (
                    <span className="font-normal text-amber-700">
                      {t.awaiting}
                    </span>
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-ink-subtle">{t.official}</dt>
                <dd className="mt-0.5">
                  <CaseOwner
                    official={concern.assignedOfficial}
                    office={concern.assignedOffice}
                    empty={t.officialEmpty}
                  />
                </dd>
              </div>
            </dl>

            {concern.imageUrl && (
              <div className="mt-5 border-t border-line pt-5">
                <p className="mb-2 text-ink-subtle">{t.photo}</p>
                <UploadedPhoto
                  src={concern.imageUrl}
                  alt={`Supporting image for ${concern.caseNumber}`}
                  locale={locale}
                />
              </div>
            )}
          </Card>

          <Card
            title={copy[locale].desk.automatedTitle}
            description={copy[locale].desk.automatedDesc}
          >
            {latestAssessment ? (
              <PriorityBreakdown
                level={latestAssessment.level}
                totalScore={latestAssessment.totalScore}
                evaluation={parseEvaluation(latestAssessment.calculationJson)}
                isOverride={latestAssessment.isOverride}
                overrideReason={latestAssessment.overrideReason}
                assessorName={
                  latestAssessment.overriddenBy
                    ? `${latestAssessment.overriddenBy.firstName} ${latestAssessment.overriddenBy.lastName}`
                    : latestAssessment.assessedBy
                      ? `${latestAssessment.assessedBy.firstName} ${latestAssessment.assessedBy.lastName}`
                      : null
                }
                createdAt={latestAssessment.createdAt}
                locale={locale}
              />
            ) : (
              <p className="text-sm text-ink-subtle">
                This concern has not been assessed yet.
              </p>
            )}
          </Card>

          {resolution && (
            <Card title="Resolution">
              <dl className="space-y-3 text-sm">
                <div>
                  <dt className="text-ink-subtle">Summary</dt>
                  <dd className="mt-0.5 text-ink-muted">
                    {resolution.summary}
                  </dd>
                </div>
                <div>
                  <dt className="text-ink-subtle">Actions taken</dt>
                  <dd className="mt-0.5 max-w-3xl whitespace-pre-wrap text-ink-muted">
                    {resolution.actionsTaken}
                  </dd>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-ink-subtle">
                  <span>
                    Handled by {resolution.official.firstName}{" "}
                    {resolution.official.lastName}
                  </span>
                  <Badge tone="green">{resolution.resolutionType}</Badge>
                </div>
                <div className="flex flex-wrap gap-x-6 gap-y-1 text-ink-subtle">
                  <span>Resolved {formatDate(resolution.resolvedOn)}</span>
                  <span>Recorded {formatDateTime(resolution.resolvedAt)}</span>
                </div>
                {resolution.attachmentUrl && (
                  <div>
                    <dt className="text-ink-subtle">Proof photo</dt>
                    <dd className="mt-2">
                      <UploadedPhoto
                        src={resolution.attachmentUrl}
                        alt={`Proof photo of the resolution for ${concern.caseNumber}`}
                        locale={locale}
                      />
                    </dd>
                  </div>
                )}
              </dl>
            </Card>
          )}

          {canSubmitFeedback(concern.status) && (
            <Card
              title={copy[locale].feedback.title}
              description={copy[locale].feedback.lead}
            >
              <FeedbackCard
                concernId={concern.id}
                existing={existingFeedback}
                resubmissionAllowed={feedbackResubmissionAllowed}
                locale={locale}
              />
            </Card>
          )}
        </div>

        <Card title={copy[locale].desk.timelineTitle}>
          <CaseTimeline
            locale={locale}
            entries={residentVisibleJournal(concern.history).map((entry: ResidentHistoryEntry) => ({
              id: entry.id,
              entryType: entry.entryType,
              fromStatus: entry.fromStatus,
              toStatus: entry.toStatus,
              remarks: entry.remarks,
              actorRole: entry.actorRole,
              createdAt: entry.createdAt,
              occurredOn: entry.occurredOn,
              attachmentUrl: entry.attachmentUrl,
            }))}
            resolution={resolutionInfo}
          />
        </Card>
      </div>
    </div>
  );
}
