import { Prisma } from "@prisma/client";
import { createApiError } from "@/lib/api";
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
  type ResolutionType,
  type WorkflowActor,
} from "@/lib/cases/workflow";

type Tx = Prisma.TransactionClient;

type ConcernForWorkflow = {
  id: number;
  caseNumber: string;
  userId: number;
  status: string;
  assignedOfficeId: number | null;
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
    resolutionId: concern.resolutions[0]?.id ?? null,
  };
}

export type ResolutionInput = {
  summary: string;
  actionsTaken: string;
  resolutionType: ResolutionType;
  // Calendar date the issue was actually resolved; defaults to the record time.
  resolvedOn?: Date;
  // Optional supporting image attachment (authenticated uploads path).
  attachmentUrl?: string | null;
};

export type StatusChangeInput = {
  concernId: number;
  actor: WorkflowActor;
  status: string;
  remarks: string;
  resolution?: ResolutionInput;
};

export type StatusChangeOutcome = {
  concernId: number;
  caseNumber: string;
  fromStatus: string;
  status: string;
  notifiedResident: boolean;
};

/**
 * Advances a concern through the lifecycle. Every change appends an immutable
 * `CaseStatusHistory` row capturing the previous status, new status, acting
 * user, remarks and timestamp. Resolving also records the `ResolutionRecord`.
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
      actorId: input.actor.id,
      actorRole: input.actor.roleKey,
    },
  });

  if (input.status === "RESOLVED") {
    await tx.resolutionRecord.create({
      data: {
        concernId: concern.id,
        officialId: input.actor.id,
        summary: input.resolution!.summary,
        actionsTaken: input.resolution!.actionsTaken,
        resolutionType: input.resolution!.resolutionType,
        resolvedOn: input.resolution!.resolvedOn ?? now,
        attachmentUrl: input.resolution!.attachmentUrl ?? null,
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
    notifiedResident: true,
  };
}

export type NoteInput = {
  concernId: number;
  actor: WorkflowActor;
  kind: "REMARK" | "ACTION";
  remarks: string;
};

export type NoteOutcome = {
  concernId: number;
  caseNumber: string;
  historyId: number;
  kind: string;
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

  const entry = await tx.caseStatusHistory.create({
    data: {
      concernId: concern.id,
      entryType: input.kind,
      fromStatus: concern.status,
      toStatus: concern.status,
      remarks: input.remarks,
      actorId: input.actor.id,
      actorRole: input.actor.roleKey,
    },
  });

  return {
    concernId: concern.id,
    caseNumber: concern.caseNumber,
    historyId: entry.id,
    kind: input.kind,
  };
}
