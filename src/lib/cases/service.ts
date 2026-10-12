import { Prisma } from "@prisma/client";
import { createApiError } from "@/lib/api";
import {
  actionDateForDay,
  actionDateProblem,
  lastStatusChangeDay,
  manilaDay,
  todayManila,
  type ActionDateBounds,
} from "@/lib/cases/action-date";
import {
  notifyCaseClosed,
  notifyConcernAssigned,
  notifyFeedbackRequested,
  notifyResidentAssigned,
  notifyResolutionRecorded,
  notifyStatusChanged,
} from "@/lib/notifications/service";
import {
  allowedTransitions,
  canManageConcern,
  canTransition,
  OVERRIDE_REASON_MIN,
  PROOF_REQUIRED_MESSAGE,
  requiresBudgetSkipOverride,
  type OverrideKind,
  type ResolutionType,
  type VerificationStatus,
  type WorkflowActor,
  type WorkflowTargetStatus,
} from "@/lib/cases/workflow";
import { assertCrewGate } from "@/lib/cases/crew";
import {
  armCaseStageClock,
  resolveEscalationsForCase,
} from "@/lib/sla/escalation";
import { isSlaOpenStage } from "@/lib/sla/policy";
import { syncPublicRecord } from "@/lib/cases/public-record";

type Tx = Prisma.TransactionClient;

type ConcernForWorkflow = {
  id: number;
  caseNumber: string;
  userId: number;
  status: string;
  assignedOfficeId: number | null;
  submittedAt: Date;
  resolutionId: number | null;
  typeRequiresBudget: boolean;
  workersNeeded: number | null;
};

async function loadConcernForWorkflow(
  tx: Tx,
  concernId: number,
  actor: WorkflowActor
): Promise<ConcernForWorkflow> {
  const concern = await tx.concern.findUnique({
    where: { id: concernId },
    select: {
      id: true,
      caseNumber: true,
      userId: true,
      status: true,
      assignedOfficeId: true,
      submittedAt: true,
      resolutions: { select: { id: true }, take: 1 },
      type: { select: { requiresBudget: true } },
      caseAssessment: { select: { workersNeeded: true } },
    },
  });
  if (!concern) throw createApiError.notFound("Concern not found.");

  if (!canManageConcern(actor, concern)) {
    throw createApiError.forbidden(
      "This concern is assigned to another office."
    );
  }

  return {
    id: concern.id,
    caseNumber: concern.caseNumber,
    userId: concern.userId,
    status: concern.status,
    assignedOfficeId: concern.assignedOfficeId,
    submittedAt: concern.submittedAt,
    resolutionId: concern.resolutions[0]?.id ?? null,
    typeRequiresBudget: concern.type?.requiresBudget ?? false,
    workersNeeded: concern.caseAssessment?.workersNeeded ?? null,
  };
}

/**
 * The calendar bounds for a new journal entry on this case: the day it was
 * submitted and the last day its status changed. Read inside the transaction so
 * the checks see the same timeline the entry is written into.
 */
async function timelineBounds(
  tx: Tx,
  concern: Pick<ConcernForWorkflow, "id" | "submittedAt">
): Promise<Omit<ActionDateBounds, "today">> {
  const entries = await tx.caseStatusHistory.findMany({
    where: { concernId: concern.id },
    select: {
      fromStatus: true,
      toStatus: true,
      occurredOn: true,
      createdAt: true,
    },
  });
  return {
    submittedDay: manilaDay(concern.submittedAt),
    lastStatusDay: lastStatusChangeDay(entries),
  };
}

/**
 * Checks a requested calendar day against the case timeline and returns the day
 * to record. A missing request means today (Asia/Manila).
 */
function resolveActionDay(
  requested: string | undefined,
  bounds: Omit<ActionDateBounds, "today">,
  options: { statusChange: boolean; label: "action date" | "resolution date" }
): string {
  const day = requested ?? todayManila();
  const problem = actionDateProblem(day, { ...bounds, today: todayManila() }, options);
  if (problem === "future") {
    throw createApiError.badRequest(`The ${options.label} cannot be in the future.`);
  }
  if (problem === "before-submission") {
    throw createApiError.badRequest(
      `The ${options.label} cannot be before the case was submitted (${bounds.submittedDay}).`
    );
  }
  if (problem === "before-last-status") {
    throw createApiError.badRequest(
      `The ${options.label} cannot be earlier than the last status change (${bounds.lastStatusDay}).`
    );
  }
  return day;
}

/** A reasoned workflow override; the reason is mandatory and audited. */
async function recordOverride(
  tx: Tx,
  input: {
    concernId: number;
    actor: WorkflowActor;
    kind: OverrideKind;
    reason: string;
    details?: Record<string, unknown>;
  }
) {
  const reason = input.reason.trim();
  if (reason.length < OVERRIDE_REASON_MIN) {
    throw createApiError.badRequest(
      `A written reason of at least ${OVERRIDE_REASON_MIN} characters is required to override a workflow rule.`
    );
  }

  const override = await tx.caseWorkflowOverride.create({
    data: {
      concernId: input.concernId,
      kind: input.kind,
      reason,
      detailsJson: input.details ? JSON.stringify(input.details) : null,
      actorId: input.actor.id,
      actorRole: input.actor.roleKey,
    },
  });

  await tx.caseStatusHistory.create({
    data: {
      concernId: input.concernId,
      entryType: "OVERRIDE",
      remarks: `Workflow override (${input.kind}): ${reason}`,
      visibility: "RESIDENT_VISIBLE",
      metadataJson: JSON.stringify({ kind: input.kind, reason }),
      actorId: input.actor.id,
      actorRole: input.actor.roleKey,
    },
  });

  return override;
}

export type ResolutionInput = {
  summary: string;
  actionsTaken: string;
  resolutionType: ResolutionType;
  // Calendar day (YYYY-MM-DD) the issue was actually resolved. Defaults to today.
  resolvedOn?: string;
};

export type StatusChangeInput = {
  concernId: number;
  actor: WorkflowActor;
  status: WorkflowTargetStatus;
  remarks: string;
  // Calendar day (YYYY-MM-DD) the status change actually happened. Defaults to
  // today. Ignored for RESOLVED, which uses resolution.resolvedOn.
  occurredOn?: string;
  // Proof photo for this change (authenticated uploads path). Mandatory.
  proofUrl: string | null;
  resolution?: ResolutionInput;
  // Written reason for bypassing a workflow rule (crew shortfall, skipping the
  // budget stage, forcing a close). Stored as a CaseWorkflowOverride.
  overrideReason?: string;
};

export type StatusChangeOutcome = {
  concernId: number;
  caseNumber: string;
  fromStatus: string;
  status: string;
  // Calendar day (YYYY-MM-DD) recorded for the change.
  actionDate: string;
  notifiedResident: boolean;
  overrideKind: OverrideKind | null;
  crewProgressLabel: string | null;
  publicRecord: { publicRef: string | null; published: boolean } | null;
};

/**
 * RESOLVED takes its date from the resolution's "date resolved". If the caller
 * sends a separate action date as well, both must name the same day.
 */
function requestedStatusDay(input: StatusChangeInput): {
  day: string | undefined;
  label: "action date" | "resolution date";
} {
  if (input.status !== "RESOLVED") {
    return { day: input.occurredOn, label: "action date" };
  }
  const resolvedOn = input.resolution?.resolvedOn;
  if (resolvedOn && input.occurredOn && resolvedOn !== input.occurredOn) {
    throw createApiError.badRequest(
      "The resolution date and the action date must be the same day."
    );
  }
  return { day: resolvedOn ?? input.occurredOn, label: "resolution date" };
}

/**
 * Advances a concern through the seven-stage lifecycle. Every change appends an
 * immutable `CaseStatusHistory` row capturing the previous status, new status,
 * acting user, remarks, proof photo, action date and record time. Resolving also
 * records the `ResolutionRecord`; the public PII-free projection is refreshed on
 * every change.
 *
 * Gates enforced here (not only in the route):
 *   * IN_PROGRESS - the planned crew must be assigned, or an override given
 *   * skipping AWAITING_BUDGET on a funded case - override required
 *   * CLOSED - the resolution must be verified, or an override given
 */
export async function changeConcernStatus(
  tx: Tx,
  input: StatusChangeInput
): Promise<StatusChangeOutcome> {
  const concern = await loadConcernForWorkflow(tx, input.concernId, input.actor);

  if (concern.status === "CLOSED") {
    throw createApiError.conflict("This case is already closed.");
  }
  if (input.status === concern.status) {
    throw createApiError.badRequest(
      `The case is already ${concern.status.replaceAll("_", " ").toLowerCase()}.`
    );
  }
  if (!canTransition(concern.status, input.status)) {
    const allowed = allowedTransitions(concern.status);
    throw createApiError.badRequest(
      `Cannot move a case from ${concern.status} to ${input.status}.` +
        (allowed.length > 0
          ? ` Allowed next status: ${allowed.join(", ")}.`
          : " This case is closed.")
    );
  }

  if (input.status === "RESOLVED") {
    if (concern.resolutionId !== null) {
      throw createApiError.conflict(
        "A resolution is already recorded for this case."
      );
    }
    if (!input.resolution) {
      throw createApiError.badRequest(
        "Resolution details are required when resolving a case."
      );
    }
  }

  // Every status change needs a proof photo. The routes check this before the
  // upload is saved; the service repeats the rule so no caller can skip it.
  if (!input.proofUrl) {
    throw createApiError.badRequest(PROOF_REQUIRED_MESSAGE);
  }

  const overrideReason = input.overrideReason?.trim();
  let overrideKind: OverrideKind | null = null;
  let crewProgressLabel: string | null = null;

  // ---- gate: starting work needs the planned crew on site -------------
  if (input.status === "IN_PROGRESS") {
    const progress = await assertCrewGate(tx, concern.id).catch((error: unknown) => {
      if (overrideReason && overrideReason.length >= OVERRIDE_REASON_MIN) {
        return null;
      }
      throw error;
    });
    if (progress) {
      crewProgressLabel = progress.label;
    } else {
      overrideKind = "CREW_SHORTFALL";
    }
  }

  // ---- gate: skipping the money stage on a funded case ----------------
  if (
    requiresBudgetSkipOverride({
      fromStatus: concern.status,
      toStatus: input.status,
      typeRequiresBudget: concern.typeRequiresBudget,
    })
  ) {
    if (!overrideReason || overrideReason.length < OVERRIDE_REASON_MIN) {
      throw createApiError.badRequest(
        "This case needs funds, so it must pass through AWAITING_BUDGET. Move it there, or record a budget-skip override with a reason."
      );
    }
    overrideKind = "BUDGET_STAGE_SKIP";
  }

  // ---- gate: a case may only close on a verified resolution -----------
  if (input.status === "CLOSED" && concern.resolutionId !== null) {
    const resolution = await tx.resolutionRecord.findUnique({
      where: { concernId: concern.id },
      select: { verifiedAt: true, verificationStatus: true },
    });
    const verified =
      resolution?.verifiedAt !== null &&
      resolution?.verifiedAt !== undefined &&
      resolution.verificationStatus !== "PENDING";
    if (!verified) {
      if (!overrideReason || overrideReason.length < OVERRIDE_REASON_MIN) {
        throw createApiError.badRequest(
          "Verify the resolution before closing the case, or record a status-force override with a reason."
        );
      }
      overrideKind = "STATUS_FORCE";
    }
  }

  const requested = requestedStatusDay(input);
  const bounds = await timelineBounds(tx, concern);
  const actionDay = resolveActionDay(requested.day, bounds, {
    statusChange: true,
    label: requested.label,
  });
  const actionDate = actionDateForDay(actionDay);
  const now = new Date();

  if (overrideKind) {
    await recordOverride(tx, {
      concernId: concern.id,
      actor: input.actor,
      kind: overrideKind,
      reason: overrideReason!,
      details: {
        fromStatus: concern.status,
        toStatus: input.status,
        workersNeeded: concern.workersNeeded,
      },
    });
  }

  const data: Prisma.ConcernUpdateInput = {
    status: input.status,
    stageEnteredAt: now,
  };
  if (input.status === "AWAITING_BUDGET") data.awaitingBudgetAt = now;
  if (concern.status === "AWAITING_BUDGET") data.awaitingBudgetResolvedAt = now;
  if (input.status === "UNDER_ASSESSMENT") data.assessmentCompletedAt = null;
  if (input.status === "IN_PROGRESS") data.assessmentCompletedAt = now;
  if (input.status === "RESOLVED") data.resolvedAt = now;
  if (input.status === "CLOSED") data.closedAt = now;

  await tx.concern.update({ where: { id: concern.id }, data });

  // The clock belongs to the stage the case is in: re-arm it (and store which
  // policy it is running against) every time the stage moves.
  if (isSlaOpenStage(input.status)) {
    await armCaseStageClock(tx, { concernId: concern.id, status: input.status, from: now });
  }
  // Work that is finished cannot stay in the escalation queue.
  if (input.status === "RESOLVED" || input.status === "CLOSED") {
    await resolveEscalationsForCase(tx, concern.id, now);
  }

  const entryType =
    input.status === "RESOLVED"
      ? "RESOLUTION"
      : input.status === "CLOSED"
        ? "CLOSE"
        : input.status === "AWAITING_BUDGET"
          ? "BUDGET"
          : "STATUS_CHANGE";

  await tx.caseStatusHistory.create({
    data: {
      concernId: concern.id,
      entryType,
      fromStatus: concern.status,
      toStatus: input.status,
      remarks: input.remarks,
      occurredOn: actionDate,
      attachmentUrl: input.proofUrl,
      actorId: input.actor.id,
      actorRole: input.actor.roleKey,
    },
  });

  if (input.status === "RESOLVED" && input.resolution) {
    await tx.resolutionRecord.create({
      data: {
        concernId: concern.id,
        officialId: input.actor.id,
        summary: input.resolution.summary,
        actionsTaken: input.resolution.actionsTaken,
        resolutionType: input.resolution.resolutionType,
        resolvedOn: actionDate,
        attachmentUrl: input.proofUrl,
        resolvedAt: now,
      },
    });
  }

  if (input.status === "RESOLVED") {
    await notifyResolutionRecorded(tx, {
      userId: concern.userId,
      concernId: concern.id,
      caseNumber: concern.caseNumber,
    });
    await notifyFeedbackRequested(tx, {
      userId: concern.userId,
      concernId: concern.id,
      caseNumber: concern.caseNumber,
    });
  } else if (input.status === "CLOSED") {
    await notifyCaseClosed(tx, {
      userId: concern.userId,
      concernId: concern.id,
      caseNumber: concern.caseNumber,
    });
  } else {
    await notifyStatusChanged(tx, {
      userId: concern.userId,
      concernId: concern.id,
      caseNumber: concern.caseNumber,
      status: input.status,
    });
  }

  const publicRecord = await syncPublicRecord(tx, concern.id);

  return {
    concernId: concern.id,
    caseNumber: concern.caseNumber,
    fromStatus: concern.status,
    status: input.status,
    actionDate: actionDay,
    notifiedResident: true,
    overrideKind,
    crewProgressLabel,
    publicRecord: {
      publicRef: publicRecord.publicRef,
      published: publicRecord.published,
    },
  };
}

export type NoteInput = {
  concernId: number;
  actor: WorkflowActor;
  kind: "REMARK" | "ACTION";
  remarks: string;
  // Calendar day (YYYY-MM-DD) the remark or action happened. Defaults to today.
  occurredOn?: string;
};

export type NoteOutcome = {
  concernId: number;
  caseNumber: string;
  historyId: number;
  kind: string;
  actionDate: string;
};

/**
 * Appends a progress remark or a record of actions taken. Does not change the
 * case status; it is an additive journal entry.
 */
export async function addConcernNote(
  tx: Tx,
  input: NoteInput
): Promise<NoteOutcome> {
  const concern = await loadConcernForWorkflow(tx, input.concernId, input.actor);

  if (concern.status === "CLOSED") {
    throw createApiError.conflict("Closed cases cannot be modified.");
  }

  const bounds = await timelineBounds(tx, concern);
  const actionDay = resolveActionDay(input.occurredOn, bounds, {
    statusChange: false,
    label: "action date",
  });

  const entry = await tx.caseStatusHistory.create({
    data: {
      concernId: concern.id,
      entryType: input.kind,
      fromStatus: concern.status,
      toStatus: concern.status,
      remarks: input.remarks,
      occurredOn: actionDateForDay(actionDay),
      actorId: input.actor.id,
      actorRole: input.actor.roleKey,
    },
  });

  return {
    concernId: concern.id,
    caseNumber: concern.caseNumber,
    historyId: entry.id,
    kind: input.kind,
    actionDate: actionDay,
  };
}

// ---------------------------------------------------------------- evaluation
// Admin validation: "this is a real, correctly categorized concern", with the
// service type, the priority confirmation and the office it belongs to.

export type ValidationInput = {
  concernId: number;
  actor: WorkflowActor;
  typeId: number;
  categoryId?: number | null;
  priorityLevel?: string | null;
  notes: string;
  confirmPriority: boolean;
};

export type ValidationOutcome = {
  concernId: number;
  caseNumber: string;
  status: string;
  typeKey: string;
  routedOfficeName: string | null;
};

export async function validateConcern(
  tx: Tx,
  input: ValidationInput
): Promise<ValidationOutcome> {
  const concern = await tx.concern.findUnique({
    where: { id: input.concernId },
    select: {
      id: true,
      caseNumber: true,
      status: true,
      typeId: true,
      categoryId: true,
      priorityLevel: true,
      assignedOfficeId: true,
      userId: true,
    },
  });
  if (!concern) throw createApiError.notFound("Concern not found.");
  if (concern.status === "CLOSED" || concern.status === "RESOLVED") {
    throw createApiError.conflict(
      "Resolved or closed cases can no longer be validated."
    );
  }

  const type = await tx.concernType.findUnique({
    where: { id: input.typeId },
    select: { id: true, key: true, name: true, isActive: true, defaultOfficeId: true },
  });
  if (!type || !type.isActive) {
    throw createApiError.badRequest("Select an active concern type.");
  }

  if (input.categoryId) {
    const category = await tx.concernCategory.findUnique({
      where: { id: input.categoryId },
      select: { id: true, isActive: true },
    });
    if (!category || !category.isActive) {
      throw createApiError.badRequest("Select an active category.");
    }
  }

  const now = new Date();
  const priorityChanged =
    input.priorityLevel !== null &&
    input.priorityLevel !== undefined &&
    input.priorityLevel !== concern.priorityLevel;

  await tx.concern.update({
    where: { id: concern.id },
    data: {
      typeId: type.id,
      ...(input.categoryId ? { categoryId: input.categoryId } : {}),
      ...(input.priorityLevel ? { priorityLevel: input.priorityLevel } : {}),
      validatedById: input.actor.id,
      validatedAt: now,
      validationNotes: input.notes,
      ...(input.confirmPriority
        ? { priorityConfirmedById: input.actor.id, priorityConfirmedAt: now }
        : {}),
    },
  });

  // A validated case with no office yet gets the type's default office, so a
  // resident's uncategorized concern still lands somewhere real.
  let routedOfficeName: string | null = null;
  if (concern.assignedOfficeId === null && type.defaultOfficeId) {
    const office = await tx.office.findUnique({
      where: { id: type.defaultOfficeId },
      select: { id: true, name: true, isActive: true },
    });
    if (office?.isActive) {
      const previous = await tx.caseAssignment.findFirst({
        where: { concernId: concern.id, isCurrent: true },
        select: { id: true },
      });
      if (previous) {
        await tx.caseAssignment.update({
          where: { id: previous.id },
          data: { isCurrent: false },
        });
      }
      await tx.caseAssignment.create({
        data: {
          concernId: concern.id,
          officeId: office.id,
          officialId: null,
          assignedById: input.actor.id,
          prevAssignmentId: previous?.id ?? null,
          isCurrent: true,
          assignedAt: now,
          reason: `Validated and routed to the default office for ${type.name}.`,
        },
      });
      await tx.concern.update({
        where: { id: concern.id },
        data: {
          assignedOfficeId: office.id,
          status: concern.status === "SUBMITTED" ? "ASSIGNED" : concern.status,
          ...(concern.status === "SUBMITTED" ? { stageEnteredAt: now } : {}),
        },
      });
      if (concern.status === "SUBMITTED") {
        await armCaseStageClock(tx, { concernId: concern.id, status: "ASSIGNED", from: now });
      }
      routedOfficeName = office.name;

      // Same notifications as a direct routing: the office's officials and the resident.
      await notifyConcernAssigned(tx, {
        officeId: office.id,
        concernId: concern.id,
        caseNumber: concern.caseNumber,
        officeName: office.name,
      });
      await notifyResidentAssigned(tx, {
        userId: concern.userId,
        concernId: concern.id,
        caseNumber: concern.caseNumber,
        officeName: office.name,
        reassigned: false,
      });
    }
  }

  await tx.caseStatusHistory.create({
    data: {
      concernId: concern.id,
      entryType: "REMARK",
      fromStatus: concern.status,
      toStatus: routedOfficeName ? "ASSIGNED" : concern.status,
      remarks:
        `Admin validation: confirmed as ${type.name}.` +
        (routedOfficeName ? ` Routed to ${routedOfficeName}.` : "") +
        (input.notes ? ` Notes: ${input.notes}` : ""),
      visibility: "RESIDENT_VISIBLE",
      metadataJson: JSON.stringify({
        typeId: type.id,
        typeKey: type.key,
        confirmedPriority: input.confirmPriority,
        routedOfficeName,
      }),
      actorId: input.actor.id,
      actorRole: input.actor.roleKey,
    },
  });

  if (priorityChanged && input.priorityLevel) {
    await tx.priorityAssessment.create({
      data: {
        concernId: concern.id,
        urgencyScore: 0,
        impactScore: 0,
        affectedPopulationScore: 0,
        safetyScore: 0,
        totalScore: 0,
        level: input.priorityLevel,
        calculationJson: JSON.stringify({ source: "admin_validation" }),
        isOverride: true,
        assessedById: input.actor.id,
        overrideReason: input.notes,
      },
    });
    await tx.caseStatusHistory.create({
      data: {
        concernId: concern.id,
        entryType: "PRIORITY_OVERRIDE",
        fromStatus: concern.status,
        toStatus: concern.status,
        remarks: `Priority set to ${input.priorityLevel} during validation.`,
        actorId: input.actor.id,
        actorRole: input.actor.roleKey,
      },
    });
  }

  return {
    concernId: concern.id,
    caseNumber: concern.caseNumber,
    status: routedOfficeName ? "ASSIGNED" : concern.status,
    typeKey: type.key,
    routedOfficeName,
  };
}

// ------------------------------------------------------ verification & closure

export type VerifyResolutionInput = {
  concernId: number;
  actor: WorkflowActor;
  verificationStatus: VerificationStatus;
  notes: string;
  // Proof photo for the verification entry (optional: the resolution already
  // carries its own).
  proofUrl?: string | null;
};

export type VerifyResolutionOutcome = {
  concernId: number;
  caseNumber: string;
  verificationStatus: string;
  verifiedAt: string;
};

/**
 * Step 5 of the workflow: confirm the work before the case is closed. The
 * recorded resolution is stamped with the verifier, the decision and the notes;
 * the closure itself stays a separate, deliberate status change.
 */
export async function verifyResolution(
  tx: Tx,
  input: VerifyResolutionInput
): Promise<VerifyResolutionOutcome> {
  const concern = await loadConcernForWorkflow(tx, input.concernId, input.actor);

  const resolution = await tx.resolutionRecord.findUnique({
    where: { concernId: concern.id },
    select: { id: true, officialId: true },
  });
  if (!resolution) {
    throw createApiError.badRequest(
      "There is nothing to verify yet: record the resolution first."
    );
  }
  if (concern.status !== "RESOLVED") {
    throw createApiError.badRequest(
      "Verification happens after the case is resolved."
    );
  }
  if (resolution.officialId === input.actor.id) {
    throw createApiError.forbidden(
      "The official who recorded the resolution cannot verify it. Ask a colleague or the approving official."
    );
  }

  const now = new Date();
  if (input.verificationStatus !== "PENDING") {
    await tx.resolutionRecord.update({
      where: { id: resolution.id },
      data: {
        verifiedById: input.actor.id,
        verifiedAt: now,
        verificationStatus: input.verificationStatus,
        verificationNotes: input.notes,
      },
    });
  } else {
    await tx.resolutionRecord.update({
      where: { id: resolution.id },
      data: { verificationStatus: input.verificationStatus, verificationNotes: input.notes },
    });
  }

  await tx.caseStatusHistory.create({
    data: {
      concernId: concern.id,
      entryType: "VERIFICATION",
      fromStatus: concern.status,
      toStatus: concern.status,
      remarks: `Resolution verification: ${input.verificationStatus.replaceAll(
        "_",
        " "
      ).toLowerCase()}. ${input.notes}`,
      visibility: "RESIDENT_VISIBLE",
      attachmentUrl: input.proofUrl ?? null,
      actorId: input.actor.id,
      actorRole: input.actor.roleKey,
    },
  });

  return {
    concernId: concern.id,
    caseNumber: concern.caseNumber,
    verificationStatus: input.verificationStatus,
    verifiedAt: now.toISOString(),
  };
}
