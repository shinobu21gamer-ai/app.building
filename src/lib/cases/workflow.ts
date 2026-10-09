// Pure domain logic for the official case-management workflow.
// No database or framework imports, so it is unit-testable in isolation.

export const CASE_STATUSES = [
  "SUBMITTED",
  "ASSIGNED",
  "IN_PROGRESS",
  "RESOLVED",
  "CLOSED",
] as const;

export type CaseStatus = (typeof CASE_STATUSES)[number];

// Allowed forward transitions. ASSIGNED is reached through the routing /
// assignment services, not the workflow status endpoint, but it is included
// here so the map is the single source of truth for the whole lifecycle.
export const STATUS_TRANSITIONS: Record<CaseStatus, CaseStatus[]> = {
  SUBMITTED: ["ASSIGNED"],
  ASSIGNED: ["IN_PROGRESS"],
  IN_PROGRESS: ["RESOLVED"],
  RESOLVED: ["CLOSED"],
  CLOSED: [],
};

// Statuses an official/admin may move a case to through the workflow endpoint.
export const WORKFLOW_TARGET_STATUSES = ["IN_PROGRESS", "RESOLVED", "CLOSED"] as const;
export type WorkflowTargetStatus = (typeof WORKFLOW_TARGET_STATUSES)[number];

// Every status change made through case management must carry a proof photo.
// The photo is stored on the journal entry and is the evidence for the change.
// Remarks and actions are text entries and do not need one.
export const PROOF_REQUIRED_MESSAGE =
  "A proof photo is required to update the status of a case. Attach a JPEG, PNG, or WebP image of up to 5 MB.";

// case_status_history.entryType values used by the workflow. The schema
// comment lists the full set (ASSIGNMENT / PRIORITY_OVERRIDE come from the
// routing and priority services; SLA_BREACH from the SLA scanner).
export const HISTORY_ENTRY_TYPES = [
  "STATUS_CHANGE",
  "REMARK",
  "ACTION",
  "ASSIGNMENT",
  "PRIORITY_ASSESSED",
  "PRIORITY_OVERRIDE",
  "RESOLUTION",
  "CLOSE",
  "SLA_BREACH",
] as const;

export const HISTORY_ENTRY_SLA_BREACH =
  "SLA_BREACH" as const satisfies (typeof HISTORY_ENTRY_TYPES)[number];

export const RESOLUTION_TYPES = [
  "FIXED",
  "PARTIALLY_FIXED",
  "REFERRED",
  "NO_ACTION",
  "OTHER",
] as const;

export type ResolutionType = (typeof RESOLUTION_TYPES)[number];

export const PRIORITY_LEVELS = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
export type PriorityLevel = (typeof PRIORITY_LEVELS)[number];

export function isCaseStatus(value: unknown): value is CaseStatus {
  return (
    typeof value === "string" && (CASE_STATUSES as readonly string[]).includes(value)
  );
}

/** The statuses a case in `status` is allowed to move to. */
export function allowedTransitions(status: string): CaseStatus[] {
  if (!isCaseStatus(status)) return [];
  return [...STATUS_TRANSITIONS[status]];
}

/** Whether moving from `from` to `to` is a permitted lifecycle transition. */
export function canTransition(from: string, to: string): boolean {
  if (!isCaseStatus(from) || !isCaseStatus(to)) return false;
  return STATUS_TRANSITIONS[from].includes(to);
}

export type WorkflowActor = {
  id: number;
  roleKey: string;
  officeId: number | null;
};

export type ManageableConcern = {
  assignedOfficeId: number | null;
};

/**
 * Authorization for mutating an existing concern's case record.
 * Administrators may act on any case; an official may only act on a case
 * assigned to their own office. Unassigned cases can only be handled by an
 * administrator. (Assignment/reassignment has its own related rule.)
 */
export function canManageConcern(
  actor: WorkflowActor,
  concern: ManageableConcern
): boolean {
  if (actor.roleKey === "ADMIN") return true;
  if (actor.roleKey !== "OFFICIAL") return false;
  if (actor.officeId === null) return false;
  return concern.assignedOfficeId === actor.officeId;
}

export function statusLabel(status: string): string {
  return status.replaceAll("_", " ").toLowerCase().replace(/\b\w/g, (c) =>
    c.toUpperCase()
  );
}

// ---------------------------------------------------------------
// Resident feedback
// ---------------------------------------------------------------

// A resident may only give feedback once the case has a recorded resolution.
export const FEEDBACK_STATUSES = ["RESOLVED", "CLOSED"] as const;

export function canSubmitFeedback(status: string): boolean {
  return (FEEDBACK_STATUSES as readonly string[]).includes(status);
}

export type Satisfaction = "SATISFIED" | "NEUTRAL" | "DISSATISFIED";

/** Maps a 1-5 rating to the stored satisfaction category. */
export function satisfactionForRating(rating: number): Satisfaction {
  if (rating >= 4) return "SATISFIED";
  if (rating <= 2) return "DISSATISFIED";
  return "NEUTRAL";
}
