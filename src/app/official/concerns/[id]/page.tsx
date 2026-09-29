import type { Metadata } from "next";
import Image from "next/image";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth/session";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge, PriorityBadge, StatusBadge } from "@/components/ui/badge";
import { CaseTimeline } from "@/components/concern/case-timeline";
import {
  PriorityBreakdown,
  parseEvaluation,
} from "@/components/priority/priority-breakdown";
import { PriorityOverrideForm } from "@/components/priority/priority-override-form";
import { ReassignForm } from "@/components/routing/reassign-form";
import { CaseWorkflowForm } from "@/components/cases/case-workflow-form";
import { CaseNoteForm } from "@/components/cases/case-note-form";
import { ResolutionForm } from "@/components/cases/resolution-form";
import { loadPriorityConfig } from "@/lib/priority/config";
import { formatDate, formatDateTime } from "@/lib/format";
import {
  allowedTransitions,
  canManageConcern,
} from "@/lib/cases/workflow";

export const metadata: Metadata = {
  title: "Review Concern",
};

type PageProps = { params: Promise<{ id: string }> };

function userName(
  user: { firstName: string; lastName: string } | null | undefined
): string | null {
  return user ? `${user.firstName} ${user.lastName}` : null;
}

export default async function OfficialConcernDetailPage({
  params,
}: PageProps) {
  const user = await requireRole(["OFFICIAL", "ADMIN"]);
  const { id } = await params;
  const numericId = Number(id);
  if (!Number.isInteger(numericId) || numericId <= 0) notFound();

  const concern = await db.concern.findFirst({
    where:
      user.role.key === "ADMIN"
        ? { id: numericId }
        : { id: numericId, assignedOfficeId: user.officeId ?? -1 },
    include: {
      category: true,
      user: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          phone: true,
          address: true,
        },
      },
      assignedOffice: true,
      history: {
        include: { actor: { select: { firstName: true, lastName: true } } },
        orderBy: { createdAt: "asc" },
      },
      assessments: {
        include: {
          assessedBy: { select: { firstName: true, lastName: true } },
          overriddenBy: { select: { firstName: true, lastName: true } },
        },
        orderBy: { createdAt: "asc" },
      },
      assignments: {
        include: {
          office: { select: { id: true, name: true, code: true } },
          official: { select: { id: true, firstName: true, lastName: true } },
          assignedBy: { select: { id: true, firstName: true, lastName: true } },
        },
        orderBy: { assignedAt: "asc" },
      },
      resolutions: {
        include: {
          official: { select: { firstName: true, lastName: true } },
        },
      },
    },
  });
  if (!concern) notFound();

  const offices = await db.office.findMany({
    where: { isActive: true },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      code: true,
      users: {
        where: { isActive: true, role: { key: "OFFICIAL" } },
        select: { id: true, firstName: true, lastName: true },
        orderBy: { firstName: "asc" },
      },
    },
  });

  const reassignOffices = offices.map((office) => ({
    id: office.id,
    name: office.name,
    code: office.code,
    officials: office.users,
  }));

  const currentAssignment =
    concern.assignments.find((assignment) => assignment.isCurrent) ?? null;
  const canReassign =
    user.role.key === "ADMIN" ||
    concern.assignedOfficeId === user.officeId;
  const isFinalized = concern.status === "RESOLVED" || concern.status === "CLOSED";

  const actor = {
    id: user.id,
    roleKey: user.role.key,
    officeId: user.officeId ?? null,
  };
  const canManage = canManageConcern(actor, {
    assignedOfficeId: concern.assignedOfficeId,
  });
  const nextStatuses = allowedTransitions(concern.status);
  // Resolving has its own richer form (resolution date + attachment), so it is
  // excluded from the generic status form. ASSIGNED is reached through the
  // routing/reassignment services, not the workflow status endpoint.
  const workflowStatuses = nextStatuses.filter(
    (status) => status !== "RESOLVED" && status !== "ASSIGNED"
  );
  const canResolve = concern.status === "IN_PROGRESS";
  const resolution = concern.resolutions[0] ?? null;

  const { factors, thresholds } = await loadPriorityConfig();
  const activeFactors = factors.filter((f) => f.isActive !== false);
  const levels = thresholds
    .filter((t) => t.isActive !== false)
    .map((t) => t.level);

  const automated = concern.assessments.find((a) => !a.isOverride) ?? null;
  const overrides = concern.assessments.filter((a) => a.isOverride);
  const latest =
    concern.assessments.length > 0
      ? concern.assessments[concern.assessments.length - 1]
      : null;

  const minFor = (key: string, fallback: number) =>
    activeFactors.find((f) => f.key === key)?.minScore ?? fallback;

  const defaultScores = {
    urgencyScore: latest?.urgencyScore ?? minFor("URGENCY", 1),
    impactScore: latest?.impactScore ?? minFor("IMPACT", 1),
    affectedPopulationScore:
      latest?.affectedPopulationScore ?? minFor("AFFECTED_POPULATION", 1),
    safetyScore: latest?.safetyScore ?? minFor("SAFETY", 1),
  };

  return (
    <div className="space-y-6">
      <Button href="/official/concerns" variant="ghost" size="sm">
        ← Back to concerns
      </Button>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="font-mono text-xs text-slate-500">
            {concern.caseNumber}
          </p>
          <h1 className="mt-1 text-2xl font-bold text-slate-900">
            {concern.title}
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Submitted by {userName(concern.user)} ·{" "}
            {formatDateTime(concern.submittedAt)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={concern.status} />
          {concern.priorityLevel && (
            <PriorityBadge level={concern.priorityLevel} />
          )}
          {latest?.isOverride && <span className="text-xs text-amber-700">overridden</span>}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card title="Concern details">
            <dl className="space-y-4 text-sm">
              <div>
                <dt className="text-slate-500">Category</dt>
                <dd className="mt-0.5 font-medium text-slate-900">
                  {concern.category.name}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">Location</dt>
                <dd className="mt-0.5 font-medium text-slate-900">
                  {concern.locationAddress}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">Resident</dt>
                <dd className="mt-0.5 font-medium text-slate-900">
                  {userName(concern.user)} ({concern.user.email})
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">Description</dt>
                <dd className="mt-0.5 whitespace-pre-wrap text-slate-700">
                  {concern.description}
                </dd>
              </div>
            </dl>

            {concern.imageUrl && (
              <div className="mt-5 border-t border-slate-100 pt-5">
                <p className="mb-2 text-slate-500">Supporting image</p>
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
            title="Automated recommendation"
            description="Produced by the rule-based priority engine from the submitted factor scores."
          >
            {automated ? (
              <PriorityBreakdown
                level={automated.level}
                totalScore={automated.totalScore}
                evaluation={parseEvaluation(automated.calculationJson)}
                isOverride={false}
                createdAt={automated.createdAt}
              />
            ) : (
              <p className="text-sm text-slate-500">
                No automated assessment is on record for this concern.
              </p>
            )}
          </Card>

          {overrides.length > 0 && (
            <Card
              title="Override history"
              description="Official overrides are appended and the automated result is preserved."
            >
              <div className="space-y-5">
                {overrides.map((override) => (
                  <div
                    key={override.id}
                    className="rounded-lg border border-amber-200 bg-amber-50/40 p-4"
                  >
                    <PriorityBreakdown
                      level={override.level}
                      totalScore={override.totalScore}
                      evaluation={parseEvaluation(override.calculationJson)}
                      isOverride
                      overrideReason={override.overrideReason}
                      assessorName={
                        userName(override.overriddenBy) ??
                        userName(override.assessedBy)
                      }
                      createdAt={override.createdAt}
                    />
                  </div>
                ))}
              </div>
            </Card>
          )}

          {resolution && (
            <Card
              title="Resolution"
              description="Recorded when the case was marked resolved."
            >
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

          {concern.assignments.length > 0 && (
            <Card
              title="Assignment history"
              description="Every assignment and reassignment for this case."
            >
              <ol className="space-y-4">
                {concern.assignments.map((assignment) => (
                  <li
                    key={assignment.id}
                    className="rounded-lg border border-slate-200 p-3"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-sm font-medium text-slate-900">
                        {assignment.office.name}
                        {assignment.official
                          ? ` · ${assignment.official.firstName} ${assignment.official.lastName}`
                          : " · office pool"}
                      </span>
                      {assignment.isCurrent && (
                        <Badge tone="green">Current</Badge>
                      )}
                    </div>
                    <p className="mt-1 text-xs text-slate-500">
                      {assignment.assignedBy
                        ? `By ${assignment.assignedBy.firstName} ${assignment.assignedBy.lastName}`
                        : "Automatic routing"}{" "}
                      · {formatDateTime(assignment.assignedAt)}
                    </p>
                    {assignment.reason && (
                      <p className="mt-1 text-sm text-slate-600">
                        {assignment.reason}
                      </p>
                    )}
                  </li>
                ))}
              </ol>
            </Card>
          )}

          <Card
            title="Case timeline"
            description="Full activity journal for this concern."
          >
            <CaseTimeline
              entries={concern.history.map((entry) => ({
                id: entry.id,
                entryType: entry.entryType,
                fromStatus: entry.fromStatus,
                toStatus: entry.toStatus,
                remarks: entry.remarks,
                actorRole: entry.actorRole,
                createdAt: entry.createdAt,
              }))}
            />
          </Card>
        </div>

        <div className="space-y-6">
          <Card
            title="Case management"
            description="Move the case through its lifecycle, add progress remarks, and record actions taken. Every entry is journaled."
          >
            {canManage ? (
              <div className="space-y-6">
                {canResolve && !resolution && (
                  <div>
                    <p className="mb-3 text-sm font-medium text-slate-700">
                      Resolve the case
                    </p>
                    <ResolutionForm concernId={concern.id} />
                  </div>
                )}
                <div className={canResolve && !resolution ? "border-t border-slate-100 pt-5" : ""}>
                  <CaseWorkflowForm
                    concernId={concern.id}
                    currentStatus={concern.status}
                    allowedTransitions={workflowStatuses}
                  />
                </div>
                <div className="border-t border-slate-100 pt-5">
                  <p className="mb-3 text-sm font-medium text-slate-700">
                    Progress notes
                  </p>
                  <CaseNoteForm
                    concernId={concern.id}
                    disabled={concern.status === "CLOSED"}
                  />
                </div>
              </div>
            ) : (
              <p className="text-sm text-slate-500">
                This concern belongs to another office. Only that office&apos;s
                officials (or an administrator) can update its status.
              </p>
            )}
          </Card>

          <Card
            title="Office assignment"
            description="Determined by the configured routing rules. Officials may reassign."
          >
            {currentAssignment ? (
              <dl className="space-y-2 text-sm">
                <div className="flex justify-between gap-3">
                  <dt className="text-slate-500">Office</dt>
                  <dd className="font-medium text-slate-900">
                    {currentAssignment.office.name}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-slate-500">Official</dt>
                  <dd className="font-medium text-slate-900">
                    {currentAssignment.official
                      ? `${currentAssignment.official.firstName} ${currentAssignment.official.lastName}`
                      : "Office pool"}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-slate-500">Assigned</dt>
                  <dd className="text-slate-700">
                    {formatDateTime(currentAssignment.assignedAt)}
                  </dd>
                </div>
              </dl>
            ) : (
              <p className="text-sm text-amber-700">
                This concern has not been routed to an office yet.
              </p>
            )}

            {isFinalized ? (
              <p className="mt-4 border-t border-slate-100 pt-4 text-sm text-slate-500">
                This case is {concern.status === "RESOLVED" ? "resolved" : "closed"};
                it can no longer be reassigned.
              </p>
            ) : canReassign ? (
              <div className="mt-4 border-t border-slate-100 pt-4">
                <ReassignForm
                  concernId={concern.id}
                  offices={reassignOffices}
                  currentOfficeId={concern.assignedOfficeId}
                  currentOfficialId={concern.assignedOfficialId}
                />
              </div>
            ) : (
              <p className="mt-4 border-t border-slate-100 pt-4 text-sm text-slate-500">
                This concern belongs to another office. Only that office&apos;s
                officials (or an administrator) can reassign it.
              </p>
            )}
          </Card>

          <Card
            title="Override recommendation"
            description="Adjust the factor scores and/or set a level directly. The reason is required."
          >
            {isFinalized ? (
              <p className="text-sm text-slate-500">
                {concern.status === "RESOLVED"
                  ? "This case is resolved; its priority can no longer be overridden."
                  : "This case is closed; its priority can no longer be overridden."}
              </p>
            ) : canManage ? (
              <PriorityOverrideForm
                concernId={concern.id}
                factors={activeFactors.map((f) => ({
                  key: f.key,
                  label: f.label,
                  minScore: f.minScore,
                  maxScore: f.maxScore,
                  weight: f.weight,
                }))}
                levels={levels}
                defaultScores={defaultScores}
                currentLevel={concern.priorityLevel}
              />
            ) : (
              <p className="text-sm text-slate-500">
                This concern belongs to another office. Only that office&apos;s
                officials (or an administrator) can override its priority.
              </p>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
