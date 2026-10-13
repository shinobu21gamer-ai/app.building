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
  CONSENT_REQUIRED: "CONSENT_REQUIRED",
  FIELD_CHECK_ASSIGNED: "FIELD_CHECK_ASSIGNED",
  FIELD_CHECK_SUBMITTED: "FIELD_CHECK_SUBMITTED",
  FIELD_CHECK_REVIEWED: "FIELD_CHECK_REVIEWED",
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

/**
 * Closing is not always a finished repair: a case closed after a field check
 * that did not confirm the report says so here, so the resident is never left
 * guessing why a case ended without any work being done.
 */
export async function notifyCaseClosed(
  db: Db,
  input: {
    userId: number;
    concernId: number;
    caseNumber: string;
    /** Extra sentence naming the outcome, when it was not a completed repair. */
    outcome?: string | null;
  }
): Promise<void> {
  await createNotification(db, {
    userId: input.userId,
    concernId: input.concernId,
    type: NOTIFICATION_TYPES.CASE_CLOSED,
    title: "Your case has been closed",
    message:
      `Case ${input.caseNumber} has been closed.` +
      (input.outcome ? ` ${input.outcome}` : ""),
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

// ---- Crew and SLA events (added with the revamp) -----------------
// Additive: these two wrap the same private writer as every event above, so the
// crew and SLA jobs write their notifications through this module as well.

/** Tells one crew member they were put on a case. `schedule` is pre-formatted text, possibly "". */
export async function notifyCrewAssigned(
  db: Db,
  input: { userId: number; concernId: number; caseNumber: string; schedule: string }
): Promise<void> {
  await createNotification(db, {
    userId: input.userId,
    concernId: input.concernId,
    type: NOTIFICATION_TYPES.CONCERN_ASSIGNED,
    title: "Crew assignment",
    message: `You have been assigned to case ${input.caseNumber} as crew.${input.schedule}`,
  });
}

/** Tells a recipient (staff or the resident) that a case has passed its service window. */
export async function notifySlaBreached(
  db: Db,
  input: { userId: number; concernId: number; title: string; message: string }
): Promise<void> {
  await createNotification(db, {
    userId: input.userId,
    concernId: input.concernId,
    type: NOTIFICATION_TYPES.SLA_BREACHED,
    title: input.title,
    message: input.message,
  });
}

/**
 * Tells every active administrator that a newly received case is waiting for
 * validation. Reuses the CONCERN_SUBMITTED type, so the notification contract is
 * unchanged. Returns how many administrators were told.
 */
export async function notifyAdminsAwaitingValidation(
  db: Db,
  input: { concernId: number; caseNumber: string }
): Promise<number> {
  const admins = await db.user.findMany({
    where: { isActive: true, role: { key: "ADMIN" } },
    select: { id: true },
  });
  for (const admin of admins) {
    await createNotification(db, {
      userId: admin.id,
      concernId: input.concernId,
      type: NOTIFICATION_TYPES.CONCERN_SUBMITTED,
      title: "New concern awaiting validation",
      message: `Concern ${input.caseNumber} was received and is waiting for validation before it is assigned to an office.`,
    });
  }
  return admins.length;
}

/**
 * Asks a resident to grant data-processing consent, which is needed before a
 * concern can be filed. Sent once per resident by the consent-notice script.
 */
export async function notifyConsentRequired(
  db: Db,
  input: { userId: number }
): Promise<void> {
  await createNotification(db, {
    userId: input.userId,
    concernId: null,
    type: NOTIFICATION_TYPES.CONSENT_REQUIRED,
    title: "Consent needed to file concerns",
    message:
      "To file a concern, please grant consent to process your data on your Privacy page. Your existing records are not affected.",
  });
}

/** Tells the person given a field check what to confirm on site. */
export async function notifyFieldCheckAssigned(
  db: Db,
  input: { userId: number; concernId: number; caseNumber: string }
): Promise<void> {
  await createNotification(db, {
    userId: input.userId,
    concernId: input.concernId,
    type: NOTIFICATION_TYPES.FIELD_CHECK_ASSIGNED,
    title: "Field check requested",
    message: `Please confirm on site that case ${input.caseNumber} is real, then record your finding.`,
  });
}

/** Tells every active administrator that a field-check finding is waiting for review. */
export async function notifyFieldCheckSubmitted(
  db: Db,
  input: { concernId: number; caseNumber: string; finding: string }
): Promise<number> {
  const admins = await db.user.findMany({
    where: { isActive: true, role: { key: "ADMIN" } },
    select: { id: true },
  });
  for (const admin of admins) {
    await createNotification(db, {
      userId: admin.id,
      concernId: input.concernId,
      type: NOTIFICATION_TYPES.FIELD_CHECK_SUBMITTED,
      title: "Field check finding to review",
      message: `A field check on case ${input.caseNumber} was submitted (${input.finding.replaceAll("_", " ").toLowerCase()}). Review it before the case continues.`,
    });
  }
  return admins.length;
}

/** Tells the person who did the check how the admin answered. */
export async function notifyFieldCheckReviewed(
  db: Db,
  input: { userId: number; concernId: number; caseNumber: string; decision: string }
): Promise<void> {
  const recheck = input.decision === "REQUEST_RECHECK";
  await createNotification(db, {
    userId: input.userId,
    concernId: input.concernId,
    type: NOTIFICATION_TYPES.FIELD_CHECK_REVIEWED,
    title: recheck ? "Field check sent back" : "Field check approved",
    message: recheck
      ? `The admin has asked you to check case ${input.caseNumber} again. See the note on the case.`
      : `The admin approved your field check on case ${input.caseNumber}.`,
  });
}

