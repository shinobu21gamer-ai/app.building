import type { Prisma } from "@prisma/client";
import { createApiError } from "@/lib/api";
import {
  canRequestFieldCheck,
  FIELD_CHECK_ASSIGNEE_ROLES,
  findingProblem,
  OPEN_FIELD_CHECK_STATUSES,
  type FieldCheckFinding,
  type FieldCheckReviewDecision,
} from "@/lib/cases/field-check-rules";
import { syncPublicRecord } from "@/lib/cases/public-record";
import { canManageConcern, type WorkflowActor } from "@/lib/cases/workflow";
import { resolveEscalationsForCase } from "@/lib/sla/escalation";
import {
  notifyCaseClosed,
  notifyFieldCheckAssigned,
  notifyFieldCheckReviewed,
  notifyFieldCheckSubmitted,
} from "@/lib/notifications/service";

// Field verification service: the reality check that opens every case. An admin
// asks a person to confirm the report on site (the request is possible from the
// moment the report arrives, before the case is validated or routed); that person
// records a finding; an admin reviews it. Every step writes to the case history.
// Nothing here moves a case forward on its own, except a "not confirmed" finding
// approved by the admin, which closes the case as unfounded — the only path to a
// closed case that skips assessment, budget, crew and work.

type Tx = Prisma.TransactionClient;

export type FieldCheckOutcome =
  | { kind: "REQUESTED"; checkId: number }
  | { kind: "SUBMITTED"; checkId: number }
  | { kind: "APPROVED"; checkId: number }
  | { kind: "RECHECK_REQUESTED"; checkId: number }
  | { kind: "CLOSED_UNFOUNDED"; checkId: number; caseNumber: string };

async function loadCheck(tx: Tx, checkId: number) {
  const check = await tx.fieldCheck.findUnique({
    where: { id: checkId },
    include: {
      concern: {
        select: {
          id: true,
          caseNumber: true,
          status: true,
          userId: true,
          assignedOfficeId: true,
        },
      },
    },
  });
  if (!check) throw createApiError.notFound("Field check not found.");
  return check;
}

function historyEntry(
  tx: Tx,
  input: {
    concernId: number;
    status: string;
    remarks: string;
    actor: WorkflowActor;
    attachmentUrl?: string | null;
  }
) {
  return tx.caseStatusHistory.create({
    data: {
      concernId: input.concernId,
      entryType: "FIELD_CHECK",
      fromStatus: input.status,
      toStatus: input.status,
      remarks: input.remarks,
      occurredOn: new Date(),
      attachmentUrl: input.attachmentUrl ?? null,
      actorId: input.actor.id,
      actorRole: input.actor.roleKey,
    },
  });
}

/** Asks an official or crew member to confirm the concern on site. */
export async function requestFieldCheck(
  tx: Tx,
  input: { concernId: number; assigneeId: number; instructions: string; actor: WorkflowActor }
): Promise<FieldCheckOutcome> {
  const concern = await tx.concern.findUnique({
    where: { id: input.concernId },
    select: { id: true, caseNumber: true, status: true, assignedOfficeId: true },
  });
  if (!concern) throw createApiError.notFound("Concern not found.");
  if (!canManageConcern(input.actor, concern)) {
    throw createApiError.forbidden("This concern is assigned to another office.");
  }
  if (!canRequestFieldCheck(concern.status)) {
    throw createApiError.conflict(
      "A field check can only be requested while the case is SUBMITTED or ASSIGNED — the case has to be confirmed on site before assessment starts."
    );
  }

  const open = await tx.fieldCheck.findFirst({
    where: { concernId: concern.id, status: { in: [...OPEN_FIELD_CHECK_STATUSES] } },
    select: { id: true },
  });
  if (open) {
    throw createApiError.conflict("A field check is already open on this case. Wait for its review.");
  }

  const assignee = await tx.user.findUnique({
    where: { id: input.assigneeId },
    include: { role: true },
  });
  if (
    !assignee ||
    !assignee.isActive ||
    !(FIELD_CHECK_ASSIGNEE_ROLES as readonly string[]).includes(assignee.role.key)
  ) {
    throw createApiError.badRequest("Choose an active official or crew member.");
  }
  // The case office's own people come first. Another office's staff are only
  // sent when this office has nobody who can go, so a case routed to an office
  // without crew is not a dead end — and not a way to poach other staff either.
  if (
    assignee.officeId !== null &&
    concern.assignedOfficeId !== null &&
    assignee.officeId !== concern.assignedOfficeId
  ) {
    const ownOffice = await tx.user.count({
      where: {
        isActive: true,
        officeId: concern.assignedOfficeId,
        role: { key: { in: [...FIELD_CHECK_ASSIGNEE_ROLES] } },
      },
    });
    if (ownOffice > 0) {
      throw createApiError.badRequest(
        "That person belongs to another office, and this office has its own staff for the check."
      );
    }
  }

  const check = await tx.fieldCheck.create({
    data: {
      concernId: concern.id,
      assigneeId: assignee.id,
      requestedById: input.actor.id,
      instructions: input.instructions.trim(),
    },
  });
  await historyEntry(tx, {
    concernId: concern.id,
    status: concern.status,
    remarks: `Field check requested from ${assignee.firstName} ${assignee.lastName}.`,
    actor: input.actor,
  });
  await notifyFieldCheckAssigned(tx, {
    userId: assignee.id,
    concernId: concern.id,
    caseNumber: concern.caseNumber,
  });
  return { kind: "REQUESTED", checkId: check.id };
}

/** The assigned person records what they found. */
export async function submitFieldCheck(
  tx: Tx,
  input: {
    checkId: number;
    finding: FieldCheckFinding;
    notes: string | null;
    photoUrl: string | null;
    actor: WorkflowActor;
  }
): Promise<FieldCheckOutcome> {
  const check = await loadCheck(tx, input.checkId);
  if (check.assigneeId !== input.actor.id) {
    throw createApiError.forbidden("Only the person given this field check can record the finding.");
  }
  if (check.status !== "PENDING") {
    throw createApiError.conflict("This field check has already been submitted.");
  }
  // The case is SUBMITTED until an admin validates it, so both statuses are a
  // live check: the person sent out may report back before validation happens.
  if (!canRequestFieldCheck(check.concern.status)) {
    throw createApiError.conflict("This case is no longer waiting for a field check.");
  }
  const problem = findingProblem({
    finding: input.finding,
    notes: input.notes,
    hasPhoto: input.photoUrl !== null,
  });
  if (problem) throw createApiError.badRequest(problem);

  await tx.fieldCheck.update({
    where: { id: check.id },
    data: {
      status: "SUBMITTED",
      finding: input.finding,
      findingNotes: input.notes?.trim() || null,
      findingPhotoUrl: input.photoUrl,
      submittedAt: new Date(),
    },
  });
  await historyEntry(tx, {
    concernId: check.concernId,
    status: check.concern.status,
    remarks: `Field check submitted: ${input.finding.replaceAll("_", " ").toLowerCase()}.`,
    actor: input.actor,
    attachmentUrl: input.photoUrl,
  });
  await notifyFieldCheckSubmitted(tx, {
    concernId: check.concernId,
    caseNumber: check.concern.caseNumber,
    finding: input.finding,
  });
  return { kind: "SUBMITTED", checkId: check.id };
}

/**
 * The admin's answer to a submitted finding. Approving a confirmed finding lets
 * the case continue. Approving a "not confirmed" finding closes the case as
 * unfounded. Sending it back reopens the check for the same person.
 */
export async function reviewFieldCheck(
  tx: Tx,
  input: {
    checkId: number;
    decision: FieldCheckReviewDecision;
    note: string | null;
    actor: WorkflowActor;
  }
): Promise<FieldCheckOutcome> {
  const check = await loadCheck(tx, input.checkId);
  if (check.status !== "SUBMITTED") {
    throw createApiError.conflict("Only a submitted field check can be reviewed.");
  }
  if (!canRequestFieldCheck(check.concern.status)) {
    throw createApiError.conflict("This case is no longer waiting for a field check.");
  }
  const note = input.note?.trim() || null;
  const now = new Date();

  if (input.decision === "REQUEST_RECHECK") {
    await tx.fieldCheck.update({
      where: { id: check.id },
      data: {
        status: "PENDING",
        finding: null,
        findingNotes: null,
        findingPhotoUrl: null,
        submittedAt: null,
        reviewedById: input.actor.id,
        reviewedAt: now,
        reviewNote: note,
      },
    });
    await historyEntry(tx, {
      concernId: check.concernId,
      status: check.concern.status,
      remarks: `Field check sent back for another look: ${note}`,
      actor: input.actor,
    });
    await notifyFieldCheckReviewed(tx, {
      userId: check.assigneeId,
      concernId: check.concernId,
      caseNumber: check.concern.caseNumber,
      decision: input.decision,
    });
    return { kind: "RECHECK_REQUESTED", checkId: check.id };
  }

  await tx.fieldCheck.update({
    where: { id: check.id },
    data: {
      status: "APPROVED",
      reviewedById: input.actor.id,
      reviewedAt: now,
      reviewNote: note,
    },
  });

  if (check.finding === "NOT_CONFIRMED") {
    await closeAsUnfounded(tx, {
      concern: check.concern,
      actor: input.actor,
      reason: check.findingNotes ?? "",
      proofUrl: check.findingPhotoUrl,
      checkId: check.id,
    });
    return {
      kind: "CLOSED_UNFOUNDED",
      checkId: check.id,
      caseNumber: check.concern.caseNumber,
    };
  }

  await historyEntry(tx, {
    concernId: check.concernId,
    status: check.concern.status,
    remarks: `Field check approved: ${(check.finding ?? "").replaceAll("_", " ").toLowerCase()}.${note ? ` ${note}` : ""}`,
    actor: input.actor,
    attachmentUrl: check.findingPhotoUrl,
  });
  await notifyFieldCheckReviewed(tx, {
    userId: check.assigneeId,
    concernId: check.concernId,
    caseNumber: check.concern.caseNumber,
    decision: input.decision,
  });
  return { kind: "APPROVED", checkId: check.id };
}

async function closeAsUnfounded(
  tx: Tx,
  input: {
    concern: { id: number; caseNumber: string; userId: number; status: string };
    actor: WorkflowActor;
    reason: string;
    proofUrl: string | null;
    checkId: number;
  }
): Promise<void> {
  const now = new Date();
  await tx.concern.update({
    where: { id: input.concern.id },
    data: { status: "CLOSED", closedAt: now },
  });
  await tx.crewAssignment.updateMany({
    where: { concernId: input.concern.id, isActive: true },
    data: {
      isActive: false,
      releasedAt: now,
      releasedById: input.actor.id,
      releaseReason: "Case closed as unfounded after a field check.",
    },
  });
  await tx.caseStatusHistory.create({
    data: {
      concernId: input.concern.id,
      entryType: "CLOSE",
      // The check can be approved before the case is validated (still
      // SUBMITTED), so the entry names the status the case was closed from.
      fromStatus: input.concern.status,
      toStatus: "CLOSED",
      remarks: `Closed as unfounded after field check #${input.checkId}. ${input.reason}`,
      occurredOn: now,
      attachmentUrl: input.proofUrl,
      actorId: input.actor.id,
      actorRole: input.actor.roleKey,
    },
  });
  // Same closing steps as the normal close path: clear any SLA escalations and
  // refresh the public transparency record, so the case does not stay open there.
  await resolveEscalationsForCase(tx, input.concern.id, now);
  await syncPublicRecord(tx, input.concern.id);
  await notifyCaseClosed(tx, {
    userId: input.concern.userId,
    concernId: input.concern.id,
    caseNumber: input.concern.caseNumber,
    outcome:
      "The on-site check did not confirm the report, so the case was closed as unfounded. Open the case to read what the checker found.",
  });
}

/** Open and submitted field checks for a case, newest first (for the case page). */
export function listFieldChecks(tx: Tx, concernId: number) {
  return tx.fieldCheck.findMany({
    where: { concernId },
    orderBy: { createdAt: "desc" },
    include: {
      assignee: { select: { id: true, firstName: true, lastName: true } },
      requestedBy: { select: { firstName: true, lastName: true } },
      reviewedBy: { select: { firstName: true, lastName: true } },
    },
  });
}
