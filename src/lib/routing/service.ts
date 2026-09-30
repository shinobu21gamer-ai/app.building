import type { Prisma } from "@prisma/client";
import { createApiError } from "@/lib/api";
import { selectRoutingRule } from "@/lib/routing/engine";
import {
  notifyConcernAssigned,
  notifyConcernReassigned,
  notifyConcernUnrouted,
  notifyResidentAssigned,
} from "@/lib/notifications/service";

type Tx = Prisma.TransactionClient;

export type RoutingOutcome =
  | {
      routed: true;
      officeId: number;
      officeName: string;
      assignmentId: number;
      notifiedOfficials: number;
    }
  | { routed: false; reason: "no_rule" };

/**
 * Determines the responsible office from the administrator-configured routing
 * rules and applies the assignment inside the caller's transaction. Must be
 * called after the concern row exists (the case number is used in messages).
 *
 * When no active rule matches, the concern deliberately stays SUBMITTED and
 * administrators are notified so it can be routed manually — a missing rule
 * must never block a resident's submission.
 */
export async function routeConcern(
  tx: Tx,
  concern: { id: number; categoryId: number; caseNumber: string }
): Promise<RoutingOutcome> {
  const rules = await tx.routingRule.findMany({
    where: { categoryId: concern.categoryId },
    include: { office: { select: { id: true, name: true, isActive: true } } },
  });

  const selected = selectRoutingRule(
    rules.map((rule) => ({
      id: rule.id,
      categoryId: rule.categoryId,
      officeId: rule.officeId,
      priorityOrder: rule.priorityOrder,
      isActive: rule.isActive,
      officeIsActive: rule.office.isActive,
    })),
    concern.categoryId
  );

  if (!selected) {
    const category = await tx.concernCategory.findUnique({
      where: { id: concern.categoryId },
      select: { name: true },
    });

    await tx.caseStatusHistory.create({
      data: {
        concernId: concern.id,
        entryType: "REMARK",
        fromStatus: "SUBMITTED",
        toStatus: "SUBMITTED",
        remarks: `No active routing rule matched category "${
          category?.name ?? "Unknown"
        }". The concern is awaiting manual assignment.`,
        actorRole: "SYSTEM",
      },
    });

    await notifyConcernUnrouted(tx, {
      concernId: concern.id,
      caseNumber: concern.caseNumber,
      categoryName: category?.name ?? "Unknown",
    });

    return { routed: false, reason: "no_rule" };
  }

  const officeName = rules.find((r) => r.id === selected.id)!.office.name;
  const now = new Date();

  const assignment = await tx.caseAssignment.create({
    data: {
      concernId: concern.id,
      officeId: selected.officeId,
      officialId: null,
      assignedById: null,
      isCurrent: true,
      assignedAt: now,
      reason: "Automatically routed by category rule.",
    },
  });

  await tx.concern.update({
    where: { id: concern.id },
    data: {
      assignedOfficeId: selected.officeId,
      assignedOfficialId: null,
      status: "ASSIGNED",
    },
  });

  await tx.caseStatusHistory.create({
    data: {
      concernId: concern.id,
      entryType: "ASSIGNMENT",
      fromStatus: "SUBMITTED",
      toStatus: "ASSIGNED",
      remarks: `Automatically routed to ${officeName}.`,
      actorRole: "SYSTEM",
    },
  });

  const notifiedOfficials = await notifyConcernAssigned(tx, {
    officeId: selected.officeId,
    concernId: concern.id,
    caseNumber: concern.caseNumber,
    officeName,
  });

  return {
    routed: true,
    officeId: selected.officeId,
    officeName,
    assignmentId: assignment.id,
    notifiedOfficials,
  };
}

export type ReassignInput = {
  concernId: number;
  officeId: number;
  officialId?: number | null;
  reason: string;
  actor: { id: number; roleKey: string; officeId: number | null };
};

export type ReassignOutcome = {
  assignmentId: number;
  officeId: number;
  officeName: string;
  officialName: string | null;
  status: string;
  previousOfficeName: string | null;
  notifiedOfficials: number;
};

/**
 * Manually assigns or reassigns a concern to an office (optionally a specific
 * official). Appends a new CaseAssignment linked to the previous one, so the
 * full reassignment history is preserved, and never regresses a case that has
 * already progressed past ASSIGNED.
 */
export async function reassignConcern(
  tx: Tx,
  input: ReassignInput
): Promise<ReassignOutcome> {
  const concern = await tx.concern.findUnique({
    where: { id: input.concernId },
    include: {
      assignments: {
        where: { isCurrent: true },
        orderBy: { assignedAt: "desc" },
        take: 1,
        include: { office: { select: { id: true, name: true } } },
      },
    },
  });
  if (!concern) throw createApiError.notFound("Concern not found.");

  if (concern.status === "CLOSED" || concern.status === "RESOLVED") {
    throw createApiError.conflict(
      concern.status === "CLOSED"
        ? "Closed cases cannot be modified."
        : "Resolved cases can no longer be reassigned."
    );
  }

  // Officials may only reassign within the office that already owns the case
  // (or an unrouted case); administrators may reassign anything.
  if (
    input.actor.roleKey === "OFFICIAL" &&
    (concern.assignedOfficeId === null ||
      concern.assignedOfficeId !== input.actor.officeId)
  ) {
    throw createApiError.forbidden(
      "This concern is assigned to another office."
    );
  }
  if (input.actor.roleKey === "OFFICIAL" && input.officeId !== input.actor.officeId) {
    throw createApiError.forbidden(
      "Officials can only reassign cases within their own office."
    );
  }

  const office = await tx.office.findUnique({
    where: { id: input.officeId },
    select: { id: true, name: true, isActive: true },
  });
  if (!office || !office.isActive) {
    throw createApiError.badRequest("Select an active office.");
  }

  let official: {
    id: number;
    firstName: string;
    lastName: string;
  } | null = null;
  if (input.officialId) {
    const found = await tx.user.findFirst({
      where: {
        id: input.officialId,
        isActive: true,
        officeId: office.id,
        role: { key: "OFFICIAL" },
      },
      select: { id: true, firstName: true, lastName: true },
    });
    if (!found) {
      throw createApiError.badRequest(
        "The selected official does not belong to that office."
      );
    }
    official = found;
  }

  const previous = concern.assignments[0] ?? null;
  if (previous) {
    await tx.caseAssignment.update({
      where: { id: previous.id },
      data: { isCurrent: false },
    });
  }

  const now = new Date();
  const assignment = await tx.caseAssignment.create({
    data: {
      concernId: concern.id,
      officeId: office.id,
      officialId: official?.id ?? null,
      assignedById: input.actor.id,
      prevAssignmentId: previous?.id ?? null,
      reason: input.reason,
      isCurrent: true,
      assignedAt: now,
    },
  });

  const nextStatus = concern.status === "SUBMITTED" ? "ASSIGNED" : concern.status;
  await tx.concern.update({
    where: { id: concern.id },
    data: {
      assignedOfficeId: office.id,
      assignedOfficialId: official?.id ?? null,
      status: nextStatus,
    },
  });

  const fromLabel = previous ? previous.office.name : "unassigned";
  await tx.caseStatusHistory.create({
    data: {
      concernId: concern.id,
      entryType: "ASSIGNMENT",
      fromStatus: concern.status,
      toStatus: nextStatus,
      remarks:
        `${previous ? "Reassigned" : "Assigned"} from ${fromLabel} to ${
          office.name
        }${official ? ` (${official.firstName} ${official.lastName})` : ""}. ` +
        `Reason: ${input.reason}`,
      actorId: input.actor.id,
      actorRole: input.actor.roleKey,
    },
  });

  const notifiedOfficials = previous
    ? await notifyConcernReassigned(tx, {
        officeId: office.id,
        concernId: concern.id,
        caseNumber: concern.caseNumber,
        officeName: office.name,
        previousOfficeName: previous.office.name,
      })
    : await notifyConcernAssigned(tx, {
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
    reassigned: previous !== null,
  });

  return {
    assignmentId: assignment.id,
    officeId: office.id,
    officeName: office.name,
    officialName: official
      ? `${official.firstName} ${official.lastName}`
      : null,
    status: nextStatus,
    previousOfficeName: previous?.office.name ?? null,
    notifiedOfficials,
  };
}
