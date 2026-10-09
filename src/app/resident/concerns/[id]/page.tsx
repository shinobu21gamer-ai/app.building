import type { Metadata } from "next";
import Image from "next/image";
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
import { CaseStatusStepper } from "@/components/cases/case-status-stepper";
import { CASE_STATUSES, canSubmitFeedback } from "@/lib/cases/workflow";
import {
  PriorityBreakdown,
  parseEvaluation,
} from "@/components/priority/priority-breakdown";
import { FeedbackCard, type FeedbackView } from "@/components/cases/feedback-card";
import { isFeedbackResubmissionAllowed } from "@/lib/cases/settings";
import { formatDate, formatDateTime } from "@/lib/format";
import { copy } from "@/lib/i18n";
import { getLocale } from "@/lib/locale";
import { hasCoordinates, openStreetMapUrl } from "@/lib/maps";

export const metadata: Metadata = {
  title: "Case Details",
};

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ created?: string }>;
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
      history: {
        include: {
          actor: { select: { firstName: true, lastName: true } },
        },
        orderBy: { createdAt: "asc" },
      },
      resolutions: {
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
  const feedbackResubmissionAllowed =
    await isFeedbackResubmissionAllowed(db);

  const reachedAt = {
    SUBMITTED: concern.submittedAt,
    ASSIGNED: null as Date | null,
    IN_PROGRESS: null as Date | null,
    RESOLVED: concern.resolvedAt ?? null,
    CLOSED: concern.closedAt ?? null,
  };
  for (const entry of concern.history) {
    if (
      entry.toStatus &&
      (CASE_STATUSES as readonly string[]).includes(entry.toStatus)
    ) {
      if (entry.toStatus === "ASSIGNED" && !reachedAt.ASSIGNED) {
        reachedAt.ASSIGNED = entry.createdAt;
      }
      if (entry.toStatus === "IN_PROGRESS" && !reachedAt.IN_PROGRESS) {
        reachedAt.IN_PROGRESS = entry.createdAt;
      }
    }
  }
  if (!reachedAt.ASSIGNED && currentAssignment) {
    reachedAt.ASSIGNED = currentAssignment.assignedAt;
  }

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
        <CaseReceipt caseNumber={concern.caseNumber} concernId={concern.id} />
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-mono text-xs text-slate-500">
              {concern.caseNumber}
            </p>
            <CopyCaseNumber caseNumber={concern.caseNumber} />
            <Button
              href={`/resident/concerns/${concern.id}/print`}
              variant="outline"
              size="sm"
            >
              {t.print}
            </Button>
          </div>
          <h1 className="mt-1 text-2xl font-bold text-slate-900">
            {concern.title}
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {t.submitted} {formatDateTime(concern.submittedAt)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={concern.status} />
          {concern.priorityLevel ? (
            <PriorityBadge level={concern.priorityLevel} />
          ) : (
            <Badge tone="neutral">{t.pendingPriority}</Badge>
          )}
        </div>
      </div>

      <Card title={t.progress} description={t.progressDesc}>
        <CaseStatusStepper currentStatus={concern.status} reached={reachedAt} />
      </Card>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card title={t.details}>
            <dl className="space-y-4 text-sm">
              <div>
                <dt className="text-slate-500">{t.category}</dt>
                <dd className="mt-0.5 font-medium text-slate-900">
                  {concern.category.name}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">{t.location}</dt>
                <dd className="mt-0.5 font-medium text-slate-900">
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
                <dt className="text-slate-500">{t.description}</dt>
                <dd className="mt-0.5 whitespace-pre-wrap text-slate-700">
                  {concern.description}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">{t.office}</dt>
                <dd className="mt-0.5 font-medium text-slate-900">
                  {concern.assignedOffice ? (
                    <>
                      {concern.assignedOffice.name}
                      {currentAssignment && (
                        <span className="ml-2 text-xs font-normal text-slate-500">
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
            </dl>

            {concern.imageUrl && (
              <div className="mt-5 border-t border-slate-100 pt-5">
                <p className="mb-2 text-slate-500">{t.photo}</p>
                <Image
                  src={concern.imageUrl}
                  alt={`Supporting image for ${concern.caseNumber}`}
                  width={800}
                  height={600}
                  unoptimized
                  className="h-auto w-full max-w-md rounded-lg border border-slate-200"
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
              <p className="text-sm text-slate-500">
                This concern has not been assessed yet.
              </p>
            )}
          </Card>

          {resolution && (
            <Card title="Resolution">
              <dl className="space-y-3 text-sm">
                <div>
                  <dt className="text-slate-500">Summary</dt>
                  <dd className="mt-0.5 text-slate-700">
                    {resolution.summary}
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-500">Actions taken</dt>
                  <dd className="mt-0.5 whitespace-pre-wrap text-slate-700">
                    {resolution.actionsTaken}
                  </dd>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-slate-500">
                  <span>
                    Handled by {resolution.official.firstName}{" "}
                    {resolution.official.lastName}
                  </span>
                  <Badge tone="green">{resolution.resolutionType}</Badge>
                </div>
                <div className="flex flex-wrap gap-x-6 gap-y-1 text-slate-500">
                  <span>Resolved {formatDate(resolution.resolvedOn)}</span>
                  <span>Recorded {formatDateTime(resolution.resolvedAt)}</span>
                </div>
                {resolution.attachmentUrl && (
                  <div>
                    <dt className="text-slate-500">Attachment</dt>
                    <dd className="mt-2">
                      <Image
                        src={resolution.attachmentUrl}
                        alt={`Resolution attachment for ${concern.caseNumber}`}
                        width={800}
                        height={600}
                        unoptimized
                        className="h-auto w-full max-w-md rounded-lg border border-slate-200"
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
            entries={concern.history.map((entry) => ({
              id: entry.id,
              entryType: entry.entryType,
              fromStatus: entry.fromStatus,
              toStatus: entry.toStatus,
              remarks: entry.remarks,
              actorRole: entry.actorRole,
              createdAt: entry.createdAt,
            }))}
            resolution={resolutionInfo}
          />
        </Card>
      </div>
    </div>
  );
}
