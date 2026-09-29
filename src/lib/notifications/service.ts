import type { Prisma } from "@prisma/client";

// Single source of truth for every notification the system can emit.
// Notifications are always produced here from real domain events (submission,
// routing, reassignment, status changes, resolution, closure, feedback request,
// priority override) — never inserted as free-form frontend messages.
export const NOTIFICATION_TYPES = {
  CONCERN_SUBMITTED: "CONCERN_SUBMITTED",
  CONCERN_ASSIGNED: "CONCERN_ASSIGNED",
  CONCERN_REASSIGNED: "CONCERN_REASSIGNED",
  CONCERN_UNROUTED: "CONCERN_UNROUTED",
  STATUS_CHANGED: "STATUS_CHANGED",
  CONCERN_RESOLVED: "CONCERN_RESOLVED",
  CASE_CLOSED: "CASE_CLOSED",
  FEEDBACK_REQUESTED: "FEEDBACK_REQUESTED",
  PRIORITY_CHANGED: "PRIORITY_CHANGED",
  SLA_BREACHED: "SLA_BREACHED",
} as const;

export type NotificationType =
  (typeof NOTIFICATION_TYPES)[keyof typeof NOTIFICATION_TYPES];

type Db = Prisma.TransactionClient;

async function createNotification(
  db: Db,
  data: {
    userId: number;
    concernId: number | null;
    type: NotificationType;
    title: string;
    message: string;
  }
): Promise<void> {
  await db.notification.create({
    data: {
      userId: data.userId,
      concernId: data.concernId,
      type: data.type,
      title: data.title,
      message: data.message,
    },
  });
}

async function notifyOfficeOfficials(
  db: Db,
  input: {
    officeId: number;
    concernId: number;
    type: NotificationType;
    title: string;
    message: string;
  }
): Promise<number> {
  const officials = await db.user.findMany({
    where: { isActive: true, officeId: input.officeId, role: { key: "OFFICIAL" } },
    select: { id: true },
  });

  for (const official of officials) {
    await createNotification(db, {
      userId: official.id,
      concernId: input.concernId,
      type: input.type,
      title: input.title,
      message: input.message,
    });
  }
  return officials.length;
}

// ---- Resident-facing events -------------------------------------

export async function notifyConcernSubmitted(
  db: Db,
  input: {
    userId: number;
    concernId: number;
    caseNumber: string;
    priorityLevel: string;
    officeName: string | null;
  }
): Promise<void> {
  await createNotification(db, {
    userId: input.userId,
    concernId: input.concernId,
    type: NOTIFICATION_TYPES.CONCERN_SUBMITTED,
    title: "Concern submitted",
    message: input.officeName
      ? `Your concern ${input.caseNumber} has been received. Preliminary priority: ${input.priorityLevel}. It was assigned to ${input.officeName}.`
      : `Your concern ${input.caseNumber} has been received. Preliminary priority: ${input.priorityLevel}. We are still determining the responsible office.`,
  });
}

export async function notifyConcernAssigned(
  db: Db,
  input: {
    concernId: number;
    caseNumber: string;
    officeId: number;
    officeName: string;
  }
): Promise<number> {
  return notifyOfficeOfficials(db, {
    officeId: input.officeId,
    concernId: input.concernId,
    type: NOTIFICATION_TYPES.CONCERN_ASSIGNED,
    title: "New concern assigned",
    message: `Concern ${input.caseNumber} was assigned to ${input.officeName}.`,
  });
}

export async function notifyConcernReassigned(
  db: Db,
  input: {
    concernId: number;
    caseNumber: string;
    officeId: number;
    officeName: string;
    previousOfficeName: string | null;
  }
): Promise<number> {
  return notifyOfficeOfficials(db, {
    officeId: input.officeId,
    concernId: input.concernId,
    type: NOTIFICATION_TYPES.CONCERN_REASSIGNED,
    title: "Concern reassigned",
    message: `Concern ${input.caseNumber} was reassigned${
      input.previousOfficeName ? ` from ${input.previousOfficeName}` : ""
    } to ${input.officeName}.`,
  });
}

export async function notifyResidentAssigned(
  db: Db,
  input: {
    userId: number;
    concernId: number;
    caseNumber: string;
    officeName: string;
    reassigned: boolean;
  }
): Promise<void> {
  await createNotification(db, {
    userId: input.userId,
    concernId: input.concernId,
    type: input.reassigned
      ? NOTIFICATION_TYPES.CONCERN_REASSIGNED
      : NOTIFICATION_TYPES.CONCERN_ASSIGNED,
    title: input.reassigned
      ? "Your concern has been reassigned"
      : "Your concern has been assigned",
    message: `Concern ${input.caseNumber} was ${
      input.reassigned ? "reassigned" : "assigned"
    } to ${input.officeName}.`,
  });
}

export async function notifyStatusChanged(
  db: Db,
  input: {
    userId: number;
    concernId: number;
    caseNumber: string;
    status: string;
  }
): Promise<void> {
  await createNotification(db, {
    userId: input.userId,
    concernId: input.concernId,
    type: NOTIFICATION_TYPES.STATUS_CHANGED,
    title: "Your concern is being processed",
    message: `Concern ${input.caseNumber} is now ${input.status
      .replaceAll("_", " ")
      .toLowerCase()}.`,
  });
}

export async function notifyResolutionRecorded(
  db: Db,
  input: { userId: number; concernId: number; caseNumber: string }
): Promise<void> {
  await createNotification(db, {
    userId: input.userId,
    concernId: input.concernId,
    type: NOTIFICATION_TYPES.CONCERN_RESOLVED,
    title: "Your concern has been resolved",
    message: `Concern ${input.caseNumber} has been marked resolved. Please review the resolution details.`,
  });
}

export async function notifyFeedbackRequested(
  db: Db,
  input: { userId: number; concernId: number; caseNumber: string }
): Promise<void> {
  await createNotification(db, {
    userId: input.userId,
    concernId: input.concernId,
    type: NOTIFICATION_TYPES.FEEDBACK_REQUESTED,
    title: "How did we do?",
    message: `Concern ${input.caseNumber} was resolved. Please rate how it was handled — your feedback helps the barangay improve.`,
  });
}

export async function notifyCaseClosed(
  db: Db,
  input: { userId: number; concernId: number; caseNumber: string }
): Promise<void> {
  await createNotification(db, {
    userId: input.userId,
    concernId: input.concernId,
    type: NOTIFICATION_TYPES.CASE_CLOSED,
    title: "Your case has been closed",
    message: `Case ${input.caseNumber} has been closed.`,
  });
}

export async function notifyPriorityChanged(
  db: Db,
  input: {
    userId: number;
    concernId: number;
    caseNumber: string;
    level: string;
  }
): Promise<void> {
  await createNotification(db, {
    userId: input.userId,
    concernId: input.concernId,
    type: NOTIFICATION_TYPES.PRIORITY_CHANGED,
    title: "Priority updated",
    message: `The priority of concern ${input.caseNumber} was updated to ${input.level}.`,
  });
}

// ---- Administrator-facing events --------------------------------

export async function notifyConcernUnrouted(
  db: Db,
  input: { concernId: number; caseNumber: string; categoryName: string }
): Promise<number> {
  const admins = await db.user.findMany({
    where: { isActive: true, role: { key: "ADMIN" } },
    select: { id: true },
  });

  for (const admin of admins) {
    await createNotification(db, {
      userId: admin.id,
      concernId: input.concernId,
      type: NOTIFICATION_TYPES.CONCERN_UNROUTED,
      title: "Concern needs manual routing",
      message: `Concern ${input.caseNumber} could not be routed automatically (no active rule for category "${input.categoryName}").`,
    });
  }
  return admins.length;
}
