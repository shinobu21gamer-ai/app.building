import type { Metadata } from "next";
import { UploadedPhoto } from "@/components/ui/uploaded-photo";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireRole, userCan } from "@/lib/auth/session";
import { CASE_SHEET_ROLES } from "@/lib/auth/roles";
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
  fundStepNeedsSending,
  roleActsOnProcessStep,
  type ProcessStepKey,
} from "@/lib/cases/process-flow";
import {
  assignedOfficialIsOther,
  flowStepTodo,
  flowStepWho,
  stepNamesOfficial,
} from "@/lib/cases/flow-copy";
import { uploadedPhotoSrc } from "@/lib/uploads";
import { planNeeds } from "@/lib/cases/plan-needs";
import { realityCheckState } from "@/lib/cases/field-check-rules";
import {
  verificationActorState,
  verificationAskNames,
} from "@/lib/cases/verification-rules";
import { ConcernMap } from "@/components/concern/concern-map";
import { CrewPanel } from "@/components/cases/crew-panel";
import { FieldCheckPanel } from "@/components/cases/field-check-panel";
import { listFieldChecks } from "@/lib/cases/field-check";
import { fieldCheckIdFromMetadata } from "@/lib/cases/field-check-reply-meta";
import { FundingPanel } from "@/components/treasury/funding-panel";
import { ValidationForm } from "@/components/cases/validation-form";
import {
  ResolutionVerifyForm,
  VerifyBlockedNotice,
} from "@/components/cases/resolution-verify-form";
import { ResolutionForm } from "@/components/cases/resolution-form";
import { PageHeader } from "@/components/ui/page-header";
import { CaseOwner } from "@/components/cases/case-owner";
import { loadPriorityConfig } from "@/lib/priority/config";
import { caseFundingView } from "@/lib/treasury/query";
import { fundingGateForConcern } from "@/lib/treasury/budget";
import { formatPeso } from "@/lib/cases/manpower";
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
  isCloseableVerification,
  type CaseStatus,
} from "@/lib/cases/workflow";
import { copy, type Locale } from "@/lib/i18n";
import { getLocale } from "@/lib/locale";
import { caseReturnHref } from "@/lib/cases/return-to";

export const metadata: Metadata = {
  title: "Review Concern",
};

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ returnTo?: string | string[] }>;
};

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

/**
 * The people the recorder may ask to verify the resolution, by name.
 *
 * The office's own officials can open this case (the sheet is scoped to the
 * case's office), so they come first. When that office has nobody else, the
 * Barangay Captain is named — they verify any case. Only asked for when the
 * blocked notice is going to be drawn.
 */
async function loadVerificationAskNames(
  officeId: number | null,
  colleagues: Array<{ id: number; firstName: string; lastName: string }>,
  recordedById: number | null
): Promise<string[]> {
  if (officeId !== null && colleagues.some((person) => person.id !== recordedById)) {
    return verificationAskNames({ colleagues, recordedById, captain: null });
  }

  const captains = await db.user.findMany({
    where: { isActive: true, role: { key: "CAPTAIN" } },
    select: { id: true, firstName: true, lastName: true },
    orderBy: { firstName: "asc" },
  });
  return verificationAskNames({
    colleagues,
    recordedById,
    captain: captains[0] ?? null,
  });
}

export default async function OfficialConcernDetailPage({
  params,
  searchParams,
}: PageProps) {
  // The Captain (the approving official) closes cases and verifies resolutions
  // from this same case sheet, so they are let in here with their own
  // permissions deciding what they can do — see the `can*` flags below. The
  // list is the same one the route guard opens to (`CASE_SHEET_ROLES` in
  // `@/lib/auth/roles`), so the door and this page cannot drift apart.
  const user = await requireRole([...CASE_SHEET_ROLES]);
  const locale = await getLocale();
  const t = copy[locale].official;
  const desk = copy[locale].desk;
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const returnHref = caseReturnHref(user.role.key, query.returnTo);
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
          official: {
            select: { id: true, firstName: true, lastName: true, email: true },
          },
          assignedBy: { select: { id: true, firstName: true, lastName: true } },
        },
        orderBy: { assignedAt: "asc" },
      },
      resolutions: {
        include: {
          official: { select: { firstName: true, lastName: true } },
        },
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
      caseAssessment: {
        include: {
          materials: { orderBy: { sortOrder: "asc" } },
          equipment: { orderBy: { sortOrder: "asc" } },
        },
      },
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
    (user.role.key === "OFFICIAL" &&
      concern.assignedOfficeId === user.officeId);
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
    canPrepareVoucher,
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
    // Lets the work panel offer the "pay the crew" door straight to a
    // pre-aimed voucher.
    userCan(user.role.key, "treasury.disbursement.prepare"),
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

  // Resolve the photos the sheet displays (the resident's report photo and
  // each checker's site photo) on the server, like the case timeline does:
  // small photos are inlined as data URLs instead of depending on a second
  // cookie-authenticated fetch to /api/v1/uploads, which is the path that
  // showed reviewers "This photo could not be loaded". A photo whose bytes
  // are not on the server comes back missing so the panel can say so plainly.
  const supportingPhoto = await uploadedPhotoSrc(concern.imageUrl);
  // The resolution proof photo gets the same server-side resolution (it
  // was still fetched client-side, which is why the Resolution card could
  // show "This photo could not be loaded" while the same photo rendered
  // fine in the timeline below).
  const resolutionPhoto = await uploadedPhotoSrc(resolution?.attachmentUrl);
  const fieldCheckPhotos = new Map<
    number,
    { src: string | null; missing: boolean }
  >(
    await Promise.all(
      fieldChecks.map(
        async (check) =>
          [check.id, await uploadedPhotoSrc(check.findingPhotoUrl)] as const
      )
    )
  );

  // The full funding view (earmarks, vouchers, balances) is treasury-only.
  // The flow engine, though, only needs the funded total to know whether
  // step 4 is done — a single figure, not treasury detail — so read the
  // gate for every reader. Feeding officials 0 here stranded funded cases
  // on "Wait for the budget" forever and kept Start work locked.
  const funding = canViewTreasury
    ? await caseFundingView(db, numericId)
    : null;
  const fundedTotal = funding
    ? funding.gate.total
    : (await fundingGateForConcern(db, numericId)).total;

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
          select: { id: true, name: true, typeId: true },
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

  const needs = planNeeds({
    typeKey: concern.type?.key ?? null,
    categoryCode: concern.category?.code ?? null,
    requiresCrew: concern.type?.requiresCrew ?? null,
    requiresBudget: concern.type?.requiresBudget ?? null,
  });
  const flow = caseProcessFlow({
    status: concern.status,
    typeId: concern.typeId,
    validated:
      Boolean(concern.validatedAt) ||
      stageIndex >= STATUS_ORDER.UNDER_ASSESSMENT,
    hasAssessment: concern.caseAssessment != null,
    workersNeeded: concern.caseAssessment?.workersNeeded ?? null,
    estimatedCost: concern.caseAssessment
      ? Number(concern.caseAssessment.totalCost ?? 0)
      : null,
    fundedAmount: fundedTotal,
    activeCrew: crewSummary,
    hasResolution: Boolean(resolution),
    verificationStatus: resolution?.verificationStatus ?? null,
    realityCheck,
    needsCrew: needs.crew,
    needsBudget: needs.budget,
  });

  const stepState = (key: ProcessStepKey) =>
    flow.steps.find((step) => step.key === key) ?? null;

  // Who is expected to act on each step, and whether this reader is the one who
  // can. "You" beats the owning desk in the copy shown on the card.
  const officeDesk = concern.assignedOffice?.name ?? flowCopy.deskOfficial;
  // Step 8 is the one step the same person may not do twice: the official who
  // recorded the resolution is refused by the server. Deciding it here means
  // the step names the desk that can actually do it, and the panel below shows
  // no form for the recorder — instead of a header saying "You" above a button
  // that can only fail.
  const verifyState = verificationActorState({
    canVerify: canVerifyResolution,
    recordedById: resolution?.officialId ?? null,
    actorId: user.id,
  });
  // Only the recorder needs this: everybody else sees the form.
  const verifyAskNames =
    verifyState === "SELF_RECORDED"
      ? await loadVerificationAskNames(
          concern.assignedOfficeId,
          offices.find(
            (office: { id: number; users: Array<{ id: number; firstName: string; lastName: string }> }) =>
              office.id === concern.assignedOfficeId
          )?.users ?? [],
          resolution?.officialId ?? null
        )
      : [];
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
    VERIFY:
      verifyState === "SELF_RECORDED" ? flowCopy.deskVerifyOther : officeDesk,
    CLOSE: flowCopy.deskCaptain,
  };
  // The treasury's figure is read here, never written: this desk sends the case
  // to Awaiting budget, and the treasury office sets the money aside.
  const fundStep = stepState("FUND");
  const fundNeedsSending = fundStepNeedsSending({
    block: fundStep?.block,
    canProgress,
    canManage,
    stageIndex,
  });

  const holderName = currentAssignment?.official
    ? `${currentAssignment.official.firstName} ${currentAssignment.official.lastName}`
    : null;
  const holderEmail = currentAssignment?.official?.email ?? null;
  const verifySelf = verifyState === "SELF_RECORDED";
  const flowSteps: FlowStepView[] = flow.steps.map((step) => {
    const stepCopy = flowCopy.steps[step.key];
    const owns = roleActsOnProcessStep(user.role.key, step.key, {
      block: step.block,
      verifySelfRecorded: verifySelf,
    });
    const yours = step.state === "current" && owns;
    const namesOfficial = stepNamesOfficial(step.key);
    const assignedToOther = assignedOfficialIsOther({
      role: user.role.key,
      key: step.key,
      userId: user.id,
      assignedOfficialId: currentAssignment?.official?.id ?? null,
    });
    return {
      key: step.key,
      number: step.number,
      state: step.state,
      title: stepCopy.title,
      lead: stepCopy.lead,
      todo: flowStepTodo(flowCopy.steps, step.key, user.role.key),
      owner: stepCopy.owner,
      who: flowStepWho(flowCopy.steps, step.key, user.role.key),
      desk: stepDesk[step.key],
      ownsStep: owns,
      yourTurn: yours && !assignedToOther,
      assignedToOther,
      namesOfficial,
      waitingName: namesOfficial ? holderName : null,
      waitingEmail: namesOfficial ? holderEmail : null,
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
          residentReplies: concern.history
            .filter(
              (entry) =>
                entry.entryType === "RESIDENT_REPLY" &&
                entry.actorRole === "RESIDENT" &&
                entry.visibility === "RESIDENT_VISIBLE" &&
                fieldCheckIdFromMetadata(entry.metadataJson) === check.id
            )
            .map((entry) => ({
              id: entry.id,
              message: entry.remarks ?? "",
              authorName: userName(entry.actor) ?? desk.residentActor,
              createdAt: entry.createdAt.toISOString(),
            })),
          status: check.status,
          instructions: check.instructions,
          finding: check.finding,
          findingNotes: check.findingNotes,
          findingPhotoUrl:
            fieldCheckPhotos.get(check.id)?.src ?? check.findingPhotoUrl,
          findingPhotoMissing:
            fieldCheckPhotos.get(check.id)?.missing ?? false,
          reviewNote: check.reviewNote,
          assigneeId: check.assigneeId,
          assigneeName: `${check.assignee.firstName} ${check.assignee.lastName}`,
          requestedByName: `${check.requestedBy.firstName} ${check.requestedBy.lastName}`,
        }))}
        concernPhotoUrl={supportingPhoto.src}
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
        types={concernTypes.map((type: { id: number; name: string }) => ({
          id: type.id,
          label: type.name,
        }))}
        categories={allCategories.map((category: {
          id: number;
          name: string;
          typeId: number | null;
        }) => ({
          id: category.id,
          label: category.name,
          typeId: category.typeId,
        }))}
        currentTypeLabel={concern.type?.name ?? null}
        currentCategoryLabel={concern.category.name}
        currentPriority={concern.priorityLevel}
      />
    );
  }

  if (canAssess && canManage && !isFinalized) {
    panels.ASSESS = (
      <div className="space-y-4">
        {concern.caseAssessment ? (
          <div className="space-y-3">
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
            <dl className="space-y-2 text-sm">
              {(
                [
                  [copy[locale].revamp.workflow.labor, concern.caseAssessment.laborCost],
                  [copy[locale].revamp.workflow.materials, concern.caseAssessment.materialsCost],
                  [copy[locale].revamp.workflow.equipmentCost, concern.caseAssessment.equipmentCost],
                  [copy[locale].revamp.workflow.other, concern.caseAssessment.otherCost],
                ] as Array<[string, unknown]>
              ).map(([label, value]) => (
                <div
                  key={String(label)}
                  className="flex justify-between gap-3"
                >
                  <dt className="text-ink-subtle">{label}</dt>
                  <dd className="font-medium tabular-nums text-ink">
                    ₱{Number(value ?? 0).toFixed(2)}
                  </dd>
                </div>
              ))}
            </dl>
            {concern.caseAssessment.materials.length > 0 && (
              <div>
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-subtle">
                  {copy[locale].revamp.workflow.materialsListTitle}
                </p>
                <ul className="divide-y divide-line text-sm">
                  {concern.caseAssessment.materials.map(
                    (
                      line: {
                        name: string;
                        quantity: unknown;
                        unit: string | null;
                        amount: unknown;
                      },
                      index: number
                    ) => (
                    <li
                      key={index}
                      className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 py-1.5"
                    >
                      <span className="text-ink">
                        {line.name}
                        {line.quantity !== null && line.unit && (
                          <span className="text-ink-subtle">
                            {" "}
                            · {String(line.quantity)} {line.unit}
                          </span>
                        )}
                      </span>
                      <span className="font-medium tabular-nums text-ink">
                        ₱{Number(line.amount).toFixed(2)}
                      </span>
                    </li>
                  ))
                  }
                </ul>
              </div>
            )}
            {concern.caseAssessment.equipment.length > 0 && (
              <div>
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-subtle">
                  {copy[locale].revamp.workflow.equipmentListTitle}
                </p>
                <ul className="divide-y divide-line text-sm">
                  {concern.caseAssessment.equipment.map(
                    (
                      line: {
                        name: string;
                        quantity: unknown;
                        unit: string | null;
                        amount: unknown;
                      },
                      index: number
                    ) => (
                    <li
                      key={index}
                      className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 py-1.5"
                    >
                      <span className="text-ink">
                        {line.name}
                        {line.quantity !== null && line.unit && (
                          <span className="text-ink-subtle">
                            {" "}
                            · {String(line.quantity)} {line.unit}
                          </span>
                        )}
                      </span>
                      <span className="font-medium tabular-nums text-ink">
                        ₱{Number(line.amount).toFixed(2)}
                      </span>
                    </li>
                  ))
                  }
                </ul>
              </div>
            )}
          </div>
        ) : (
          <p className="text-sm text-ink-muted">
            {copy[locale].revamp.workflow.assessmentRequired}
          </p>
        )}        <Button
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

  // The send form is the official's half of this step and must render even
  // when the reader may not see treasury figures (a plain OFFICIAL has no
  // treasury.balance.view): hiding it behind the funding view left the step
  // saying "Your turn" with nothing to act on. The money panel itself stays
  // treasury-gated.
  if (fundNeedsSending || (canViewTreasury && funding)) {
    panels.FUND = (
      <div className="space-y-4">
        {fundNeedsSending ? (
          <CaseWorkflowForm
            concernId={concern.id}
            currentStatus={concern.status}
            allowedTransitions={["AWAITING_BUDGET"]}
            locale={locale}
            today={today}
            earliestDay={statusEarliestDay}
          />
        ) : null}
        {canViewTreasury && funding ? (
          <FundingPanel
            funding={funding}
            concernId={concern.id}
            // Same expression the flow engine is fed above, so the panel and
            // the step card never disagree about what the case needs.
            estimate={
              concern.caseAssessment
                ? Number(concern.caseAssessment.totalCost ?? 0)
                : null
            }
            canPrepareEarmark={canPrepareEarmark}
            locale={locale}
          />
        ) : null}
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

  // What work actually needs on the ground before the case may move to
  // IN_PROGRESS: the crew booked, and the materials money released. The
  // receipt on each released supplier voucher is the proof the materials
  // were really bought, so the official reads it here instead of guessing.
  const materialsFacts = funding
    ? (() => {
        const planned = concern.caseAssessment?.materialsCost
          ? Number(concern.caseAssessment.materialsCost)
          : 0;
        // The stubbed client types these rows as any; annotate so the
        // filter keeps the compiler honest on a real generation too.
        type SupplierVoucher = {
          payeeType: string;
          status: string;
          amount: number;
        };
        const supplierVouchers = funding.disbursements.filter(
          (voucher: SupplierVoucher) =>
            voucher.payeeType === "SUPPLIER" &&
            ["RELEASED", "LIQUIDATED"].includes(voucher.status)
        );
        const released = supplierVouchers.reduce(
          (sum: number, voucher: SupplierVoucher) => sum + voucher.amount,
          0
        );
        return { planned, released, count: supplierVouchers.length };
      })()
    : null;
  const crewNeeded = concern.caseAssessment?.workersNeeded ?? null;
  const crewFull =
    crewNeeded === null ? crewSummary > 0 : crewSummary >= crewNeeded;

  // The crew's own money: labour planned in the estimate vs. what the
  // treasurer has already released to crew members through vouchers.
  const crewPayFacts = funding
    ? (() => {
        const planned = concern.caseAssessment?.laborCost
          ? Number(concern.caseAssessment.laborCost)
          : 0;
        // Only CREW payee rows are the crew's money; supplier and
        // beneficiary vouchers are other people's receipts. RELEASED means
        // the money actually left the treasury.
        type CrewVoucher = { payeeType: string; status: string; amount: number };
        const crewVouchers = funding.disbursements.filter(
          (voucher: CrewVoucher) =>
            voucher.payeeType === "CREW" && voucher.status === "RELEASED"
        );
        const paid = crewVouchers.reduce(
          (sum: number, voucher: CrewVoucher) => sum + voucher.amount,
          0
        );
        return { planned, paid, count: crewVouchers.length };
      })()
    : null;

  if (canStartNow) {
    panels.START = (
      <div className="space-y-4">
        <div className="rounded-control border border-line bg-surface-sunken px-3 py-2.5">
          <p className="text-sm font-semibold text-ink">
            {desk.readyTitle}
          </p>
          <p className="mt-1 text-xs text-ink-subtle">
            {desk.readyTitleDesc}
          </p>
          <dl className="mt-2 space-y-1 text-sm">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4">
              <dt className="text-ink-muted">{desk.readyCrew}</dt>
              <dd className="text-ink">
                {crewNeeded !== null
                  ? desk.readyCrewBooked
                      .replace("{active}", String(crewSummary))
                      .replace("{needed}", String(crewNeeded))
                  : desk.readyCrewOnly.replace(
                      "{active}",
                      String(crewSummary)
                    )}
                {crewFull && (
                  <span className="text-emerald-700">
                    {" "}
                    · {desk.readyCrewFull}
                  </span>
                )}
              </dd>
            </div>
            <div className="flex flex-wrap items-baseline justify-between gap-x-4">
              <dt className="text-ink-muted">{desk.readyMaterials}</dt>
              <dd className="text-ink">
                {materialsFacts && materialsFacts.planned > 0 ? (
                  <>
                    {desk.readyMaterialsPlanned.replace(
                      "{planned}",
                      formatPeso(materialsFacts.planned)
                    )}
                    {" · "}
                    {materialsFacts.released > 0 ? (
                      <span className="text-emerald-700">
                        {desk.readyMaterialsReleased.replace(
                          "{released}",
                          formatPeso(materialsFacts.released)
                        )}
                        {materialsFacts.count > 0 &&
                          ` · ${desk.readyMaterialsReceipts}`}
                      </span>
                    ) : (
                      <span className="text-amber-700">
                        {desk.readyMaterialsNotYet}
                      </span>
                    )}
                  </>
                ) : (
                  desk.readyMaterialsNone
                )}
              </dd>
            </div>
          </dl>
        </div>
        <CaseWorkflowForm
          concernId={concern.id}
          currentStatus={concern.status}
          allowedTransitions={["IN_PROGRESS"]}
          locale={locale}
          today={today}
          earliestDay={statusEarliestDay}
        />
      </div>
    );
  }

  if ((canProgress || canResolve) && canManage) {
    panels.WORK = (
      <div className="space-y-5">
        {crewPayFacts && (
          <div className="rounded-control border border-line bg-surface-sunken px-3 py-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-semibold text-ink">
                {desk.crewPayTitle}
              </p>
              {canPrepareVoucher && (
                <Button
                  href={`/treasury/disbursements?concernId=${concern.id}&pay=CREW`}
                  size="sm"
                  variant="outline"
                >
                  {desk.payCrew}
                </Button>
              )}
            </div>
            <p className="mt-1 text-sm text-ink-muted">
              {crewPayFacts.planned > 0 && (
                <>
                  {desk.crewPayPlanned.replace(
                    "{planned}",
                    formatPeso(crewPayFacts.planned)
                  )}
                  {" · "}
                </>
              )}
              {crewPayFacts.paid > 0 ? (
                <span className="text-emerald-700">
                  {desk.crewPayPaid.replace(
                    "{paid}",
                    formatPeso(crewPayFacts.paid)
                  )}
                  {" · "}
                  {desk.crewPayVouchers.replace(
                    "{count}",
                    String(crewPayFacts.count)
                  )}
                </span>
              ) : (
                <span className="text-amber-700">{desk.crewPayUnpaid}</span>
              )}
            </p>
            <p className="mt-1 text-xs text-ink-subtle">
              {desk.crewPayWho}
            </p>
          </div>
        )}
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

  if (verifyState !== "NO_PERMISSION" && resolution && concern.status === "RESOLVED") {
    panels.VERIFY = (
      verifyState === "CAN_VERIFY" ? (
        <ResolutionVerifyForm concernId={concern.id} locale={locale} />
      ) : (
        <VerifyBlockedNotice
          locale={locale}
          officeName={concern.assignedOffice?.name ?? null}
          askNames={verifyAskNames}
          canSeeAllCases={user.role.key === "CAPTAIN" || user.role.key === "ADMIN"}
        />
      )
    );
  }

  if (canClose && canManage && concern.status === "RESOLVED") {
    // The close form is only offered once the fix is verified as fixed: the
    // server enforces the same rule, and a form that could only fail is just
    // noise on the sheet.
    const closeReady =
      resolution !== null &&
      resolution.verifiedAt !== null &&
      resolution.verifiedAt !== undefined &&
      isCloseableVerification(resolution.verificationStatus);
    panels.CLOSE = closeReady ? (
      <CaseWorkflowForm
        concernId={concern.id}
        currentStatus={concern.status}
        allowedTransitions={["CLOSED"]}
        locale={locale}
        today={today}
        earliestDay={statusEarliestDay}
      />
    ) : (
      <CloseBlockedNotice
        locale={locale}
        verificationStatus={resolution?.verificationStatus ?? null}
      />
    );
  }

  return (
    <div className="space-y-6">
      <Button href={returnHref} variant="ghost" size="sm">
        {user.role.key === "OFFICIAL" ? desk.backConcerns : desk.backToDesk}
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

      {/* Report first — who holds it and the photo — then the numbered steps.
          Putting the facts above the form stops people guessing the official
          and hunting for the picture under the flow. */}
      <Card title={desk.detailsTitle}>
        <dl className="space-y-4 text-sm">
          <div>
            <dt className="text-ink-subtle">{desk.official}</dt>
            <dd className="mt-0.5">
              <CaseOwner
                official={currentAssignment?.official}
                office={concern.assignedOffice}
                empty={desk.officePool}
              />
            </dd>
          </div>
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

        {supportingPhoto.missing ? (
          <div className="mt-5 border-t border-line pt-5">
            <p className="mb-2 text-ink-subtle">{desk.supportingImage}</p>
            <p className="text-sm text-ink-muted">{desk.photoMissing}</p>
          </div>
        ) : supportingPhoto.src ? (
          <div className="mt-5 border-t border-line pt-5">
            <p className="mb-2 text-ink-subtle">{desk.supportingImage}</p>
            <UploadedPhoto
              src={supportingPhoto.src}
              alt={`Supporting image for ${concern.caseNumber}`}
              locale={locale}
            />
          </div>
        ) : null}
      </Card>

      <ProcessFlowPanel
        locale={locale}
        steps={flowSteps}
        currentKey={flow.currentKey}
        doneCount={flow.doneCount}
        activeTotal={flow.activeTotal}
        percent={flow.percent}
        finished={flow.finished}
        unfounded={flow.closedUnfounded}
        leaveHref={
          user.role.key === "ADMIN"
            ? "/admin/validation"
            : user.role.key === "CAPTAIN"
              ? "/captain"
              : user.role.key === "TREASURER"
                ? "/treasury"
                : "/official/concerns"
        }
        leaveLabel={
          user.role.key === "ADMIN"
            ? flowCopy.guide.adminAction
            : flowCopy.leaveCase
        }
        panels={Object.fromEntries(
          (Object.entries(panels) as [ProcessStepKey, React.ReactNode][]).filter(
            ([key]) => {
              if (key === "VERIFY" && verifySelf) return true;
              return roleActsOnProcessStep(user.role.key, key, {
                block: stepState(key)?.block ?? null,
                verifySelfRecorded: verifySelf,
              });
            }
          )
        )}
      />

      <section className="space-y-4">
        <div>
          <h2 className="text-subtitle text-ink">{flowCopy.recordTitle}</h2>
          <p className="mt-1 max-w-3xl text-sm leading-relaxed text-ink-subtle">
            {flowCopy.recordLead}
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
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
                {resolutionPhoto.src ? (
                  <div>
                    <dt className="text-ink-subtle">{desk.attachment}</dt>
                    <dd className="mt-2">
                      <UploadedPhoto
                        src={resolutionPhoto.src}
                        alt={`Proof photo of the resolution for ${concern.caseNumber}`}
                        locale={locale}
                      />
                    </dd>
                  </div>
                ) : resolutionPhoto.missing ? (
                  <div>
                    <dt className="text-ink-subtle">{desk.attachment}</dt>
                    <dd className="mt-2 text-sm text-ink-subtle" role="status">
                      {desk.photoMissing}
                    </dd>
                  </div>
                ) : null}
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
                        {assignment.official ? (
                          <>
                            {" · "}
                            <CaseOwner official={assignment.official} empty="" compact />
                          </>
                        ) : (
                          desk.officePoolSuffix
                        )}
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
                  <dd className="text-right">
                    <CaseOwner
                      official={currentAssignment.official}
                      empty={desk.officePool}
                    />
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
                defaultAffectedPeople={
                  parseEvaluation(latest?.calculationJson ?? null)?.affectedPeople ??
                  null
                }
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

/**
 * Shown in the CLOSE step while a resolved case is not yet closable: its
 * resolution has not been verified as fully fixed, so the close form would
 * only fail on submit. The message names the current verification outcome.
 */
function CloseBlockedNotice({
  locale = "en",
  verificationStatus,
}: {
  locale?: Locale;
  verificationStatus: string | null;
}) {
  const t = copy[locale].revamp.workflow;
  const statusLabel =
    verificationStatus === "FIXED_VERIFIED"
      ? t.verifyFixed
      : verificationStatus === "PARTIALLY_VERIFIED"
        ? t.verifyPartial
        : verificationStatus === "FAILED"
          ? t.verifyFailed
          : verificationStatus === "PENDING_RESIDENT_CONFIRMATION"
            ? t.verifyResident
            : t.verifyNotYet;
  return (
    <div className="space-y-3">
      <div className="space-y-1 rounded-control border border-amber-200 bg-amber-50 px-3 py-2.5">
        <p className="text-sm font-semibold text-amber-900">
          {t.closeBlockedTitle}
        </p>
        <p className="text-sm leading-relaxed text-amber-800">
          {t.closeBlockedText.replace("{status}", statusLabel)}
        </p>
      </div>
      <p className="text-sm leading-relaxed text-ink-muted">
        {t.closeBlockedNext}
      </p>
    </div>
  );
}
