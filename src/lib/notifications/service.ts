import type { Prisma } from "@prisma/client";
import { rolesWithCodePermission } from "@/lib/auth/rbac";
import { EARMARK_APPROVE_PERMISSION } from "@/lib/treasury/approval";

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
  EARMARK_PROPOSED: "EARMARK_PROPOSED",
  EARMARK_APPROVED: "EARMARK_APPROVED",
  EARMARK_CANCELLED: "EARMARK_CANCELLED",
  CREW_PAYMENT_READY: "CREW_PAYMENT_READY",
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


// ---- Treasury events ----------------------------------------------

/**
 * Alerts every active treasurer once a crew-assigned case is resolved, so the
 * payment handoff does not depend on someone remembering to check the case.
 */
export async function notifyTreasurerCrewPaymentReady(
  db: Db,
  input: { concernId: number; caseNumber: string; crewCount: number }
): Promise<number> {
  if (input.crewCount < 1) return 0;

  const treasurers = await db.user.findMany({
    where: { isActive: true, role: { key: "TREASURER" } },
    select: { id: true },
  });
  let sent = 0;
  for (const treasurer of treasurers) {
    const existing = await db.notification.findFirst({
      where: {
        userId: treasurer.id,
        concernId: input.concernId,
        type: NOTIFICATION_TYPES.CREW_PAYMENT_READY,
      },
      select: { id: true },
    });
    if (existing) continue;
    await createNotification(db, {
      userId: treasurer.id,
      concernId: input.concernId,
      type: NOTIFICATION_TYPES.CREW_PAYMENT_READY,
      title: "Crew payment ready for review",
      message: `Case ${input.caseNumber} is resolved and has ${input.crewCount} assigned crew member${input.crewCount === 1 ? "" : "s"}. Review the crew payment request in Treasury.`,
    });
    sent += 1;
  }
  return sent;
}

// A case cannot leave AWAITING_BUDGET until an earmark is approved, and an
// earmark may not be approved by whoever proposed it. Without these three
// notifications the hand-off is invisible: the proposer waits for an approval
// nobody was told to make, and the case sits in Awaiting budget with no reason
// on screen. Each message names the earmark, the amount and the case, and says
// whose desk it is now on.

/** Formats an earmark reference the way the screens show it. */
function earmarkRef(code: string | null, id: number): string {
  return code ?? `Earmark #${id}`;
}

function peso(amount: number): string {
  return `₱${amount.toLocaleString("en-PH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Notifies a set of users, skipping duplicates and any id that is null. */
async function notifyUsers(
  db: Db,
  userIds: readonly (number | null)[],
  data: {
    concernId: number | null;
    type: NotificationType;
    title: string;
    message: string;
  }
): Promise<number> {
  const unique = [...new Set(userIds.filter((id): id is number => id !== null))];
  for (const userId of unique) {
    await createNotification(db, { userId, ...data });
  }
  return unique.length;
}

/**
 * Tells everyone who may approve earmarks that one is waiting, minus whoever
 * proposed it: segregation of duties means the proposer cannot act on it, so a
 * notification to them is a bell they cannot answer.
 *
 * The approver roles are read from the permission matrix rather than named
 * here, so the queue keeps reaching the right desks if the matrix changes.
 */
export async function notifyEarmarkProposed(
  db: Db,
  input: {
    earmarkId: number;
    earmarkCode: string | null;
    amount: number;
    purpose: string;
    preparedById: number | null;
    concernId: number | null;
    caseNumber: string | null;
  }
): Promise<number> {
  const approverRoles = rolesWithCodePermission(EARMARK_APPROVE_PERMISSION);
  if (approverRoles.length === 0) return 0;

  const approvers = await db.user.findMany({
    where: {
      isActive: true,
      role: { key: { in: approverRoles } },
      ...(input.preparedById === null ? {} : { id: { not: input.preparedById } }),
    },
    select: { id: true },
  });

  const ref = earmarkRef(input.earmarkCode, input.earmarkId);
  return notifyUsers(
    db,
    approvers.map((approver) => approver.id),
    {
      concernId: input.concernId,
      type: NOTIFICATION_TYPES.EARMARK_PROPOSED,
      title: "Earmark waiting for your approval",
      message: input.caseNumber
        ? `${ref} — ${peso(input.amount)} for "${input.purpose}" — is waiting for approval. It is linked to case ${input.caseNumber}, which stays in Awaiting budget until the money is set aside.`
        : `${ref} — ${peso(input.amount)} for "${input.purpose}" — is waiting for approval. It is not linked to a case.`,
    }
  );
}

/**
 * Tells the proposer the money is set aside, and the office holding the case
 * that it can now move: the official watching a case sit in AWAITING_BUDGET has
 * no other way to learn the approval happened.
 */
export async function notifyEarmarkApproved(
  db: Db,
  input: {
    earmarkId: number;
    earmarkCode: string | null;
    amount: number;
    preparedById: number | null;
    concernId: number | null;
    caseNumber: string | null;
    officeId: number | null;
  }
): Promise<number> {
  const ref = earmarkRef(input.earmarkCode, input.earmarkId);
  const recipients: (number | null)[] = [input.preparedById];

  if (input.officeId !== null) {
    const officials = await db.user.findMany({
      where: {
        isActive: true,
        officeId: input.officeId,
        role: { key: "OFFICIAL" },
      },
      select: { id: true },
    });
    recipients.push(...officials.map((official) => official.id));
  }

  return notifyUsers(db, recipients, {
    concernId: input.concernId,
    type: NOTIFICATION_TYPES.EARMARK_APPROVED,
    title: "Earmark approved",
    message: input.caseNumber
      ? `${ref} — ${peso(input.amount)} — has been approved and the money is set aside for case ${input.caseNumber}. Check the case's funding panel: if the estimate is now covered, the case can move out of Awaiting budget.`
      : `${ref} — ${peso(input.amount)} — has been approved and the money is set aside.`,
  });
}

/**
 * Tells the proposer and the office holding the case that the reservation was
 * given back. A cancelled earmark quietly leaves a case short again, so the
 * reason travels with the notification.
 */
export async function notifyEarmarkCancelled(
  db: Db,
  input: {
    earmarkId: number;
    earmarkCode: string | null;
    amount: number;
    reason: string;
    preparedById: number | null;
    concernId: number | null;
    caseNumber: string | null;
    officeId: number | null;
  }
): Promise<number> {
  const ref = earmarkRef(input.earmarkCode, input.earmarkId);
  const recipients: (number | null)[] = [input.preparedById];

  if (input.officeId !== null) {
    const officials = await db.user.findMany({
      where: {
        isActive: true,
        officeId: input.officeId,
        role: { key: "OFFICIAL" },
      },
      select: { id: true },
    });
    recipients.push(...officials.map((official) => official.id));
  }

  return notifyUsers(db, recipients, {
    concernId: input.concernId,
    type: NOTIFICATION_TYPES.EARMARK_CANCELLED,
    title: "Earmark cancelled",
    message: input.caseNumber
      ? `${ref} — ${peso(input.amount)} — was cancelled, so that money is no longer set aside for case ${input.caseNumber}. Reason: ${input.reason}`
      : `${ref} — ${peso(input.amount)} — was cancelled. Reason: ${input.reason}`,
  });
}
