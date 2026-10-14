import type { Metadata } from "next";
import Image from "next/image";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireRole, userCan } from "@/lib/auth/session";
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
import {
  ProcessFlowPanel,
  type FlowStepView,
} from "@/components/cases/process-flow-panel";
import {
  caseProcessFlow,
  type ProcessStepKey,
} from "@/lib/cases/process-flow";
import { realityCheckState } from "@/lib/cases/field-check-rules";
import { ConcernMap } from "@/components/concern/concern-map";
import { CrewPanel } from "@/components/cases/crew-panel";
import { FieldCheckPanel } from "@/components/cases/field-check-panel";
import { listFieldChecks } from "@/lib/cases/field-check";
import { FundingPanel } from "@/components/treasury/funding-panel";
import { ValidationForm } from "@/components/cases/validation-form";
import { ResolutionVerifyForm } from "@/components/cases/resolution-verify-form";
import { ResolutionForm } from "@/components/cases/resolution-form";
import { PageHeader } from "@/components/ui/page-header";
import { loadPriorityConfig } from "@/lib/priority/config";
import { caseFundingView } from "@/lib/treasury/query";
import { formatDate, formatDateTime } from "@/lib/format";
import {
  earliestActionDay,
  lastStatusChangeDay,
  manilaDay,
  todayManila,
} from "@/lib/cases/action-date";
import { hasCoordinates, openStreetMapUrl } from "@/lib/maps";
import {
  STATUS_ORDER,
  canManageConcern,
  caseWorkflowFlags,
  type CaseStatus,
} from "@/lib/cases/workflow";
import { copy } from "@/lib/i18n";
import { getLocale } from "@/lib/locale";

export const metadata: Metadata = {
  title: "Review Concern",
};

type PageProps = { params: Promise<{ id: string }> };

function userName(
  user: { firstName: string; lastName: string } | null | undefined
): string | null {
  return user ? `${user.firstName} ${user.lastName}` : null;
}

/**
 * Who can be sent to look at the location.
 *
 * The case office's own officials and crew come first. Only when that office
 * has nobody who can go is the rest of the roster offered (flagged so the
 * picker says so) — the field-check service allows a cross-office pick in
 * exactly that case, which keeps a case routed to a crewless office workable.
 */
async function loadFieldCheckRoster(officeId: number | null) {
  const select = {
    id: true,
    firstName: true,
    lastName: true,
    role: { select: { key: true } },
    office: { select: { id: true, name: true } },
  } as const;

  const ownOffice = await db.user.findMany({
    where: {
      isActive: true,
      role: { key: { in: ["OFFICIAL", "CREW"] } },
      ...(officeId === null ? {} : { OR: [{ officeId: null }, { officeId }] }),
    },
    select,
    orderBy: { firstName: "asc" },
    take: 100,
  });
  if (ownOffice.length > 0 || officeId === null) {
    return ownOffice.map((person) => ({ ...person, otherOffice: false }));
  }

  const anyone = await db.user.findMany({
    where: { isActive: true, role: { key: { in: ["OFFICIAL", "CREW"] } } },
    select,
    orderBy: { firstName: "asc" },
    take: 100,
  });
  return anyone.map((person) => ({ ...person, otherOffice: true }));
}

export default async function OfficialConcernDetailPage({
  params,
}: PageProps) {
  // The Captain (the approving official) closes cases and verifies resolutions
  // from this same case sheet, so they are let in here with their own
  // permissions deciding what they can do — see the `can*` flags below.
  const user = await requireRole(["OFFICIAL", "ADMIN", "CAPTAIN"]);
  const locale = await getLocale();
  const t = copy[locale].official;
  const desk = copy[locale].desk;
  const { id } = await params;
  const numericId = Number(id);
  if (!Number.isInteger(numericId) || numericId <= 0) notFound();

  const seesEveryCase = user.role.key !== "OFFICIAL";
  const concern = await db.concern.findFirst({
    where: seesEveryCase
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
      type: { select: { id: true, name: true, key: true } },
      caseAssessment: true,
    },
  });
  if (!concern) notFound();

  const coordinates = { lat: concern.locationLat, lng: concern.locationLng };

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
  // Resolving has its own richer form (resolution details + proof photo), and
  // ASSIGNED is reached through the routing/reassignment services. Every other
  // status change is offered inside the flow step that owns it (see `panels`),
  // so the reader only ever sees the transition the current step calls for.
  const canResolve = concern.status === "IN_PROGRESS";
  const resolution = concern.resolutions[0] ?? null;

  // Calendar bounds for the Case management forms. Status changes may not be
  // dated before the previous status change; notes only before submission.
  const today = todayManila();
  const submittedDay = manilaDay(concern.submittedAt);
  const lastStatusDay = lastStatusChangeDay(concern.history);
  const statusEarliestDay = earliestActionDay(
    { submittedDay, lastStatusDay },
    { statusChange: true }
  );
  const noteEarliestDay = earliestActionDay(
    { submittedDay, lastStatusDay },
    { statusChange: false }
  );

  // Permissions decide which desks this user sees on the case page.
  const [
    canValidate,
    canAssess,
    canAssignCrew,
    canVerifyResolution,
    canViewTreasury,
    canRequestFieldCheck,
    canReviewFieldCheck,
    canProgress,
    canClose,
    canPrepareEarmark,
  ] = await Promise.all([
    userCan(user.role.key, "case.validate"),
    userCan(user.role.key, "case.assess"),
    userCan(user.role.key, "case.crew.assign"),
    userCan(user.role.key, "case.resolution.verify"),
    userCan(user.role.key, "treasury.balance.view"),
    userCan(user.role.key, "case.fieldcheck.request"),
    userCan(user.role.key, "case.fieldcheck.review"),
    userCan(user.role.key, "case.status.progress"),
    userCan(user.role.key, "case.status.close"),
    // Lets the funding panel offer the shortcut that opens the treasury's
    // earmark form on this case with the shortfall already filled in.
    userCan(user.role.key, "treasury.earmark.prepare"),
  ]);

  // A live check is possible while the report is still in the inbox and while
  // it waits for assessment: step 1 of the flow.
  const canRequestNow =
    concern.status === "SUBMITTED" || concern.status === "ASSIGNED";
  const fieldChecks =
    canRequestFieldCheck || canReviewFieldCheck
      ? await listFieldChecks(db, numericId)
      : [];
  const fieldCheckRoster =
    canRequestFieldCheck && canRequestNow
      ? await loadFieldCheckRoster(concern.assignedOfficeId)
      : [];

  const funding = canViewTreasury
    ? await caseFundingView(db, numericId)
    : null;

  const [concernTypes, allCategories, crewSummary] = await Promise.all([
    canValidate
      ? db.concernType.findMany({
          where: { isActive: true },
          orderBy: { displayOrder: "asc" },
          select: { id: true, name: true },
        })
      : Promise.resolve([]),
    canValidate
      ? db.concernCategory.findMany({
          where: { isActive: true },
          orderBy: { name: "asc" },
          select: { id: true, name: true },
        })
      : Promise.resolve([]),
    db.crewAssignment.count({ where: { concernId: numericId, isActive: true } }),
  ]);

  const workflowFlags = caseWorkflowFlags({
    status: concern.status,
    workersNeeded: null,
    activeCrew: crewSummary,
  });

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

  // ---------------------------------------------------------------- the flow
  // Where the case is in the nine-step flow, what each step needs, and the form
  // that does the work of the step it is on. The flow is the page's spine: the
  // reader follows the numbered steps instead of hunting for the right form in a
  // column of panels. Step 1 is the reality check: is the report real?
  const flowCopy = copy[locale].flow;
  const stageIndex = STATUS_ORDER[concern.status as CaseStatus] ?? 0;
  // A case that was already past step 1 when the check became step 1 counts as
  // checked: the visit never happened, but the case was vetted the old way and
  // re-gating it would strand work that is under way.
  const realityCheck = realityCheckState(
    fieldChecks.map((check) => ({ status: check.status, finding: check.finding })),
    { legacyPassed: stageIndex >= STATUS_ORDER.UNDER_ASSESSMENT }
  );

  const flow = caseProcessFlow({
    status: concern.status,
    typeId: concern.typeId,
    hasAssessment: Boolean(concern.caseAssessment?.workersNeeded),
    workersNeeded: concern.caseAssessment?.workersNeeded ?? null,
    estimatedCost: concern.caseAssessment
      ? Number(concern.caseAssessment.totalCost ?? 0)
      : null,
    fundedAmount: funding?.gate.total ?? 0,
    activeCrew: crewSummary,
    hasResolution: Boolean(resolution),
    verificationStatus: resolution?.verificationStatus ?? null,
    realityCheck,
  });

  const stepState = (key: ProcessStepKey) =>
    flow.steps.find((step) => step.key === key) ?? null;

  // Who is expected to act on each step, and whether this reader is the one who
  // can. "You" beats the owning desk in the copy shown on the card.
  const officeDesk = concern.assignedOffice?.name ?? flowCopy.deskOfficial;
  const stepDesk: Record<ProcessStepKey, string> = {
    CHECK: flowCopy.deskCheck,
    VALIDATE: flowCopy.deskAdmin,
    ASSESS: officeDesk,
    // The treasurer prepares the earmark; the Captain's approval is what sets
    // the money aside, so both desks are named.
    FUND: flowCopy.deskFund,
    CREW: officeDesk,
    START: officeDesk,
    WORK: officeDesk,
    VERIFY: officeDesk,
    CLOSE: flowCopy.deskCaptain,
  };
  // The treasury's figure is read here, never written: this desk sends the case
  // to Awaiting budget, and the treasury office sets the money aside.
  const fundStep = stepState("FUND");
  const fundNeedsSending = fundStep?.block === "WAITING_BUDGET_STAGE";
  const canDoStep: Record<ProcessStepKey, boolean> = {
    CHECK: (canRequestFieldCheck || canReviewFieldCheck) && canManage,
    VALIDATE: canValidate,
    ASSESS: canAssess && canManage,
    FUND: fundNeedsSending && canProgress && canManage,
    CREW: canAssignCrew && canManage,
    START: canProgress && canManage,
    WORK: canProgress && canManage,
    VERIFY: canVerifyResolution,
    CLOSE: canClose && canManage,
  };

  const flowSteps: FlowStepView[] = flow.steps.map((step) => {
    const stepCopy = flowCopy.steps[step.key];
    return {
      key: step.key,
      number: step.number,
      state: step.state,
      title: stepCopy.title,
      lead: stepCopy.lead,
      todo: [...stepCopy.todo],
      desk: canDoStep[step.key] ? flowCopy.deskYou : stepDesk[step.key],
      block: step.block ? flowCopy.blocks[step.block] : null,
    };
  });

  // The form that does each step's work. A step with no panel explains itself
  // instead: either the earlier step has to finish first, or another desk owns it.
  const panels: Partial<Record<ProcessStepKey, React.ReactNode>> = {};

  // Step 1's form: the reality check. The same panel as before, moved onto the
  // step that owns it — a check can go out from the moment the report arrives,
  // so "who do I send to look?" is answered by the first step of the flow.
  const fieldCheckPanelElement =
    canRequestFieldCheck || canReviewFieldCheck ? (
      <FieldCheckPanel
        concernId={concern.id}
        locale={locale}
        caseStatus={concern.status}
        canRequest={canRequestFieldCheck}
        canReview={canReviewFieldCheck}
        currentUserId={user.id}
        checks={fieldChecks.map((check) => ({
          id: check.id,
          status: check.status,
          instructions: check.instructions,
          finding: check.finding,
          findingNotes: check.findingNotes,
          findingPhotoUrl: check.findingPhotoUrl,
          reviewNote: check.reviewNote,
          assigneeId: check.assigneeId,
          assigneeName: `${check.assignee.firstName} ${check.assignee.lastName}`,
          requestedByName: `${check.requestedBy.firstName} ${check.requestedBy.lastName}`,
        }))}
        location={{
          address: concern.locationAddress,
          purok: concern.locationPurok,
          lat: concern.locationLat,
          lng: concern.locationLng,
          mapUrl: hasCoordinates(coordinates)
            ? openStreetMapUrl(coordinates.lat, coordinates.lng)
            : null,
        }}
        roster={fieldCheckRoster.map((person) => ({
          id: person.id,
          name: `${person.firstName} ${person.lastName}`,
          roleLabel: person.role.key === "CREW" ? "Crew" : "Official",
          officeName: person.office?.name ?? null,
          otherOffice: person.otherOffice,
        }))}
      />
    ) : null;
  // While the case is open the panel sits on step 1; the record below keeps it
  // only when there is no step to put it on (closed cases, other desks).
  const fieldCheckOnStep =
    fieldCheckPanelElement !== null && canManage && !isFinalized;
  if (fieldCheckOnStep) panels.CHECK = fieldCheckPanelElement;

  if (canValidate && !isFinalized) {
    panels.VALIDATE = (
      <ValidationForm
        concernId={concern.id}
        locale={locale}
        types={concernTypes.map((type) => ({ id: type.id, label: type.name }))}
        categories={allCategories.map((category) => ({
          id: category.id,
          label: category.name,
        }))}
        currentTypeId={concern.typeId}
        currentCategoryId={concern.categoryId}
        currentPriority={concern.priorityLevel}
      />
    );
  }

  if (canAssess && canManage && !isFinalized) {
    panels.ASSESS = (
      <div className="space-y-4">
        {concern.caseAssessment ? (
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-ink-subtle">
                {copy[locale].revamp.workflow.workersNeeded}
              </dt>
              <dd className="font-medium text-ink">
                {concern.caseAssessment.workersNeeded ?? "—"}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-ink-subtle">{copy[locale].revamp.workflow.estimate}</dt>
              <dd className="font-medium tabular-nums text-ink">
                ₱{Number(concern.caseAssessment.totalCost ?? 0).toFixed(2)}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-ink-subtle">{copy[locale].revamp.workflow.duration}</dt>
              <dd className="font-medium text-ink">
                {concern.caseAssessment.estimatedDurationMinutes ?? 0} min
              </dd>
            </div>
          </dl>
        ) : (
          <p className="text-sm text-ink-muted">
            {copy[locale].revamp.workflow.assessmentRequired}
          </p>
        )}

        <Button
          href={`/official/concerns/${concern.id}/assessment`}
          size="sm"
          variant="outline"
        >
          {flowCopy.openAssessment}
        </Button>

        {concern.caseAssessment && stageIndex < 2 && canProgress ? (
          <div className="border-t border-line pt-4">
            <CaseWorkflowForm
              concernId={concern.id}
              currentStatus={concern.status}
              allowedTransitions={["UNDER_ASSESSMENT"]}
              locale={locale}
              today={today}
              earliestDay={statusEarliestDay}
            />
          </div>
        ) : null}
      </div>
    );
  }

  if (canViewTreasury && funding) {
    panels.FUND = (
      <div className="space-y-4">
        {fundNeedsSending && canProgress && canManage && stageIndex < 3 ? (
          <CaseWorkflowForm
            concernId={concern.id}
            currentStatus={concern.status}
            allowedTransitions={["AWAITING_BUDGET"]}
            locale={locale}
            today={today}
            earliestDay={statusEarliestDay}
          />
        ) : null}
        <FundingPanel
          funding={funding}
          concernId={concern.id}
          // Same expression the flow engine is fed above, so the panel and the
          // step card never disagree about what the case needs.
          estimate={
            concern.caseAssessment
              ? Number(concern.caseAssessment.totalCost ?? 0)
              : null
          }
          canPrepareEarmark={canPrepareEarmark}
          locale={locale}
        />
      </div>
    );
  }

  if (canAssignCrew && canManage && !isFinalized) {
    panels.CREW = (
      <div className="space-y-3">
        <p className="text-xs text-ink-subtle">
          {copy[locale].revamp.workflow.crewProgress}:{" "}
          {workflowFlags.crewProgressLabel}
        </p>
        <CrewPanel
          concernId={concern.id}
          locale={locale}
          canAssign={!isFinalized}
          canOverrideShortfall
        />
      </div>
    );
  }

  // Work may only start once the crew is complete and the funds are set aside.
  // Until then the step card says what is missing.
  const crewStepDone = stepState("CREW")?.state === "done";
  const fundStepDone = fundStep?.state === "done";
  const canStartNow =
    canProgress &&
    canManage &&
    stageIndex >= 2 &&
    stageIndex < 4 &&
    crewStepDone &&
    fundStepDone;

  if (canStartNow) {
    panels.START = (
      <CaseWorkflowForm
        concernId={concern.id}
        currentStatus={concern.status}
        allowedTransitions={["IN_PROGRESS"]}
        locale={locale}
        today={today}
        earliestDay={statusEarliestDay}
      />
    );
  }

  if ((canProgress || canResolve) && canManage) {
    panels.WORK = (
      <div className="space-y-5">
        <div>
          <p className="mb-2 text-sm font-medium text-ink-muted">
            {desk.progressNotes}
          </p>
          <CaseNoteForm
            concernId={concern.id}
            disabled={concern.status === "CLOSED"}
            locale={locale}
            today={today}
            earliestDay={noteEarliestDay}
          />
        </div>
        {canResolve && !resolution && canProgress ? (
          <div className="border-t border-line pt-5">
            <p className="mb-2 text-sm font-medium text-ink-muted">
              {desk.resolveCase}
            </p>
            <ResolutionForm
              concernId={concern.id}
              locale={locale}
              today={today}
              earliestDay={statusEarliestDay}
            />
          </div>
        ) : null}
      </div>
    );
  }

  if (canVerifyResolution && resolution && concern.status === "RESOLVED") {
    panels.VERIFY = (
      <ResolutionVerifyForm
        concernId={concern.id}
        locale={locale}
        recordedById={resolution.officialId}
      />
    );
  }

  if (canClose && canManage && concern.status === "RESOLVED") {
    panels.CLOSE = (
      <CaseWorkflowForm
        concernId={concern.id}
        currentStatus={concern.status}
        allowedTransitions={["CLOSED"]}
        locale={locale}
        today={today}
        earliestDay={statusEarliestDay}
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* The Captain reaches this sheet from their own desk, which is the one
          place that lists cases for them — send them back there. */}
      <Button
        href={user.role.key === "CAPTAIN" ? "/captain" : "/official/concerns"}
        variant="ghost"
        size="sm"
      >
        {desk.backConcerns}
      </Button>

      <PageHeader
        eyebrow={concern.caseNumber}
        title={concern.title}
        description={desk.submittedBy
          .replace("{name}", userName(concern.user) ?? "")
          .replace("{date}", formatDateTime(concern.submittedAt))}
        actions={
          <>
            {/* The printout is the office's paperwork and its page is scoped to
                officials and admins; the Captain reads the same sheet on screen
                instead of being sent to a route that would turn them away. */}
            {user.role.key !== "CAPTAIN" && (
              <Button
                href={`/official/concerns/${concern.id}/print`}
                variant="outline"
                size="sm"
                className="no-print"
              >
                {t.print}
              </Button>
            )}
            <StatusBadge status={concern.status} />
            {concern.priorityLevel && (
              <PriorityBadge level={concern.priorityLevel} />
            )}
            {latest?.isOverride && (
              <span className="text-xs text-amber-700">{desk.overridden}</span>
            )}
          </>
        }
      />

      {/* The flow first, full width: the numbered steps, the one being worked on,
          and only that step's form. Everything recorded about the case follows
          underneath, so the work is never buried in a side column. */}
      <ProcessFlowPanel
        locale={locale}
        steps={flowSteps}
        currentKey={flow.currentKey}
        doneCount={flow.doneCount}
        activeTotal={flow.activeTotal}
        percent={flow.percent}
        finished={flow.finished}
        unfounded={flow.closedUnfounded}
        panels={panels}
      />

      <section className="space-y-4">
        <div>
          <h2 className="text-subtitle text-ink">{flowCopy.recordTitle}</h2>
          <p className="mt-1 max-w-3xl text-sm leading-relaxed text-ink-subtle">
            {flowCopy.recordLead}
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card title={desk.detailsTitle} className="lg:col-span-2">
            <dl className="space-y-4 text-sm">
              <div>
                <dt className="text-ink-subtle">{desk.category}</dt>
                <dd className="mt-0.5 font-medium text-ink">
                  {concern.category.name}
                </dd>
              </div>
              <div>
                <dt className="text-ink-subtle">{desk.location}</dt>
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
                        {desk.openMap}
                      </a>
                    </>
                  ) : null}
                </dd>
              </div>
              <div>
                <dt className="text-ink-subtle">{desk.residentLabel}</dt>
                <dd className="mt-0.5 font-medium text-ink">
                  {userName(concern.user)} ({concern.user.email})
                </dd>
              </div>
              <div>
                <dt className="text-ink-subtle">{desk.description}</dt>
                <dd className="mt-0.5 max-w-3xl whitespace-pre-wrap text-ink-muted">
                  {concern.description}
                </dd>
              </div>
            </dl>

            {concern.imageUrl && (
              <div className="mt-5 border-t border-line pt-5">
                <p className="mb-2 text-ink-subtle">{desk.supportingImage}</p>
                <Image
                  src={concern.imageUrl}
                  alt={`Supporting image for ${concern.caseNumber}`}
                  width={800}
                  height={600}
                  unoptimized
                  className="h-auto w-full max-w-md rounded-control border border-line"
                />
              </div>
            )}
          </Card>

          <Card title={desk.automatedTitle} description={desk.automatedDesc}>
            {automated ? (
              <PriorityBreakdown
                level={automated.level}
                totalScore={automated.totalScore}
                evaluation={parseEvaluation(automated.calculationJson)}
                isOverride={false}
                createdAt={automated.createdAt}
                locale={locale}
              />
            ) : (
              <p className="text-sm text-ink-subtle">{desk.noAutomated}</p>
            )}
          </Card>

          {overrides.length > 0 && (
            <Card
              title={desk.overrideHistoryTitle}
              description={desk.overrideHistoryDesc}
            >
              <div className="space-y-5">
                {overrides.map((override) => (
                  <div
                    key={override.id}
                    className="rounded-control border border-amber-200 bg-amber-50/40 p-4"
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
                      locale={locale}
                    />
                  </div>
                ))}
              </div>
            </Card>
          )}

          {resolution && (
            <Card
              title={desk.resolutionTitle}
              description={desk.resolutionRecorded}
            >
              <dl className="space-y-3 text-sm">
                <div>
                  <dt className="text-ink-subtle">{desk.summary}</dt>
                  <dd className="mt-0.5 text-ink-muted">{resolution.summary}</dd>
                </div>
                <div>
                  <dt className="text-ink-subtle">{desk.actionsTaken}</dt>
                  <dd className="mt-0.5 max-w-3xl whitespace-pre-wrap text-ink-muted">
                    {resolution.actionsTaken}
                  </dd>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-ink-subtle">
                  <span>
                    {desk.handledBy.replace(
                      "{name}",
                      `${resolution.official.firstName} ${resolution.official.lastName}`
                    )}
                  </span>
                  <Badge tone="green">
                    {desk.types[resolution.resolutionType as keyof typeof desk.types] ??
                      resolution.resolutionType}
                  </Badge>
                </div>
                <div className="flex flex-wrap gap-x-6 gap-y-1 text-ink-subtle">
                  <span>
                    {desk.resolvedOn.replace(
                      "{date}",
                      formatDate(resolution.resolvedOn)
                    )}
                  </span>
                  <span>
                    {desk.recordedOn.replace(
                      "{date}",
                      formatDateTime(resolution.resolvedAt)
                    )}
                  </span>
                </div>
                {resolution.attachmentUrl && (
                  <div>
                    <dt className="text-ink-subtle">{desk.attachment}</dt>
                    <dd className="mt-2">
                      <Image
                        src={resolution.attachmentUrl}
                        alt={`Proof photo of the resolution for ${concern.caseNumber}`}
                        width={800}
                        height={600}
                        unoptimized
                        className="h-auto w-full max-w-md rounded-control border border-line"
                      />
                    </dd>
                  </div>
                )}
              </dl>
            </Card>
          )}

          {concern.assignments.length > 0 && (
            <Card
              title={desk.assignmentHistoryTitle}
              description={desk.assignmentHistoryDesc}
            >
              <ol className="space-y-4">
                {concern.assignments.map((assignment) => (
                  <li
                    key={assignment.id}
                    className="rounded-control border border-line p-3"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-sm font-medium text-ink">
                        {assignment.office.name}
                        {assignment.official
                          ? ` · ${assignment.official.firstName} ${assignment.official.lastName}`
                          : desk.officePoolSuffix}
                      </span>
                      {assignment.isCurrent && (
                        <Badge tone="green">{desk.currentBadge}</Badge>
                      )}
                    </div>
                    <p className="mt-1 text-xs text-ink-subtle">
                      {assignment.assignedBy
                        ? desk.byPerson.replace(
                            "{name}",
                            `${assignment.assignedBy.firstName} ${assignment.assignedBy.lastName}`
                          )
                        : desk.automaticRouting}{" "}
                      · {formatDateTime(assignment.assignedAt)}
                    </p>
                    {assignment.reason && (
                      <p className="mt-1 text-sm text-ink-muted">
                        {assignment.reason}
                      </p>
                    )}
                  </li>
                ))}
              </ol>
            </Card>
          )}

          <Card
            title={desk.location}
            description={copy[locale].revamp.workflow.geotagDesc}
          >
            <ConcernMap
              lat={concern.locationLat}
              lng={concern.locationLng}
              label={concern.locationAddress}
              purok={concern.locationPurok}
              title={desk.location}
              hint={copy[locale].revamp.workflow.geotagMapHint}
            />
          </Card>

          <Card title={desk.assignmentTitle} description={desk.assignmentDesc}>
            {currentAssignment ? (
              <dl className="space-y-2 text-sm">
                <div className="flex justify-between gap-3">
                  <dt className="text-ink-subtle">{t.officeCol}</dt>
                  <dd className="font-medium text-ink">
                    {currentAssignment.office.name}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-ink-subtle">{desk.official}</dt>
                  <dd className="font-medium text-ink">
                    {currentAssignment.official
                      ? `${currentAssignment.official.firstName} ${currentAssignment.official.lastName}`
                      : desk.officePool}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-ink-subtle">{desk.assigned}</dt>
                  <dd className="text-ink-muted">
                    {formatDateTime(currentAssignment.assignedAt)}
                  </dd>
                </div>
              </dl>
            ) : (
              <p className="text-sm text-amber-700">{desk.notRouted}</p>
            )}

            {isFinalized ? (
              <p className="mt-4 border-t border-line pt-4 text-sm text-ink-subtle">
                {concern.status === "RESOLVED"
                  ? desk.cannotReassignResolved
                  : desk.cannotReassignClosed}
              </p>
            ) : canReassign ? (
              <div className="mt-4 border-t border-line pt-4">
                <ReassignForm
                  concernId={concern.id}
                  offices={reassignOffices}
                  currentOfficeId={concern.assignedOfficeId}
                  currentOfficialId={concern.assignedOfficialId}
                  locale={locale}
                />
              </div>
            ) : (
              <p className="mt-4 border-t border-line pt-4 text-sm text-ink-subtle">
                {desk.otherOfficeReassign}
              </p>
            )}
          </Card>

          <Card title={desk.overrideTitle} description={desk.overrideDesc}>
            {isFinalized ? (
              <p className="text-sm text-ink-subtle">
                {concern.status === "RESOLVED"
                  ? desk.cannotOverrideResolved
                  : desk.cannotOverrideClosed}
              </p>
            ) : canAssess && canManage ? (
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
                locale={locale}
              />
            ) : (
              <p className="text-sm text-ink-subtle">{desk.otherOfficeOverride}</p>
            )}
          </Card>

          {fieldCheckPanelElement && !fieldCheckOnStep && (
            <Card
              className="lg:col-span-2"
              title={copy[locale].revamp.workflow.fieldCheck.title}
              description={copy[locale].revamp.workflow.fieldCheck.desc}
            >
              {fieldCheckPanelElement}
            </Card>
          )}

          <Card
            className="lg:col-span-2"
            title={desk.timelineTitle}
            description={desk.timelineDesc}
          >
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
                occurredOn: entry.occurredOn,
                attachmentUrl: entry.attachmentUrl,
              }))}
            />
          </Card>
        </div>
      </section>
    </div>
  );
}
