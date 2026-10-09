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
  notifyFeedbackRequested,
  notifyResolutionRecorded,
  notifyStatusChanged,
} from "@/lib/notifications/service";
import {
  allowedTransitions,
  canManageConcern,
  canTransition,
  PROOF_REQUIRED_MESSAGE,
  type ResolutionType,
  type WorkflowActor,
  type WorkflowTargetStatus,
} from "@/lib/cases/workflow";

type Tx = Prisma.TransactionClient;

type ConcernForWorkflow = {
  id: number;
  caseNumber: string;
  userId: number;
  status: string;
  assignedOfficeId: number | null;
  submittedAt: Date;
  resolutionId: number | null;
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
};

export type StatusChangeOutcome = {
  concernId: number;
  caseNumber: string;
  fromStatus: string;
  status: string;
  // Calendar day (YYYY-MM-DD) recorded for the change.
  actionDate: string;
  notifiedResident: boolean;
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
 * Advances a concern through the lifecycle. Every change appends an immutable
 * `CaseStatusHistory` row capturing the previous status, new status, acting
 * user, remarks, proof photo, action date and record time. Resolving also
 * records the `ResolutionRecord`.
 *
 * Nothing is written unless every check passes, so a missing proof photo or an
 * invalid date leaves the case exactly as it was.
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

  const requested = requestedStatusDay(input);
  const bounds = await timelineBounds(tx, concern);
  const actionDay = resolveActionDay(requested.day, bounds, {
    statusChange: true,
    label: requested.label,
  });
  const actionDate = actionDateForDay(actionDay);

  const now = new Date();
  const data: Prisma.ConcernUpdateInput = { status: input.status };
  if (input.status === "RESOLVED") data.resolvedAt = now;
  if (input.status === "CLOSED") data.closedAt = now;

  await tx.concern.update({ where: { id: concern.id }, data });

  const entryType =
    input.status === "RESOLVED"
      ? "RESOLUTION"
      : input.status === "CLOSED"
        ? "CLOSE"
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

  return {
    concernId: concern.id,
    caseNumber: concern.caseNumber,
    fromStatus: concern.status,
    status: input.status,
    actionDate: actionDay,
    notifiedResident: true,
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
