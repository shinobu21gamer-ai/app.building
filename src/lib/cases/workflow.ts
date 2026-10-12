// Pure domain logic for the official case-management workflow.
// No database or framework imports, so it is unit-testable in isolation.

import type { PermissionKey } from "@/lib/auth/rbac";

/**
 * The seven-stage revamp lifecycle:
 *
 *   SUBMITTED -> ASSIGNED -> UNDER_ASSESSMENT -> AWAITING_BUDGET (skippable)
 *     -> IN_PROGRESS -> RESOLVED -> CLOSED
 *
 * SUBMITTED is reached by the resident. ASSIGNED is reached by the routing /
 * assignment service (automatic rule, type default office, or manual
 * reassignment). Everything after that is driven by the workflow endpoint.
 */
export const CASE_STATUSES = [
  "SUBMITTED",
  "ASSIGNED",
  "UNDER_ASSESSMENT",
  "AWAITING_BUDGET",
  "IN_PROGRESS",
  "RESOLVED",
  "CLOSED",
] as const;

export type CaseStatus = (typeof CASE_STATUSES)[number];

// Allowed forward transitions. AWAITING_BUDGET is skippable: a case that does
// not need money (DOCUMENTS) moves straight from UNDER_ASSESSMENT to
// IN_PROGRESS, and a case that does need money may only skip the stage with a
// recorded override reason (see BUDGET_STAGE_SKIP).
export const STATUS_TRANSITIONS: Record<CaseStatus, CaseStatus[]> = {
  SUBMITTED: ["ASSIGNED"],
  ASSIGNED: ["UNDER_ASSESSMENT"],
  UNDER_ASSESSMENT: ["AWAITING_BUDGET", "IN_PROGRESS"],
  AWAITING_BUDGET: ["IN_PROGRESS"],
  IN_PROGRESS: ["RESOLVED"],
  RESOLVED: ["CLOSED"],
  CLOSED: [],
};

// Statuses an official/admin may move a case to through the workflow endpoint.
export const WORKFLOW_TARGET_STATUSES = [
  "UNDER_ASSESSMENT",
  "AWAITING_BUDGET",
  "IN_PROGRESS",
  "RESOLVED",
  "CLOSED",
] as const;
export type WorkflowTargetStatus = (typeof WORKFLOW_TARGET_STATUSES)[number];

// Every status change made through case management must carry a proof photo.
// The photo is stored on the journal entry and is the evidence for the change.
// Remarks and actions are text entries and do not need one.
export const PROOF_REQUIRED_MESSAGE =
  "A proof photo is required to update the status of a case. Attach a JPEG, PNG, or WebP image of up to 5 MB.";

// case_status_history.entryType values. The schema comment lists the full set;
// this constant is what the code is allowed to write.
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
  "ASSESSMENT",
  "CREW_ASSIGNMENT",
  "MANPOWER_PLAN",
  "ESCALATION",
  "BUDGET",
  "DISBURSEMENT",
  "OVERRIDE",
  "VERIFICATION",
  "CREW_PROGRESS",
] as const;

export type HistoryEntryType = (typeof HISTORY_ENTRY_TYPES)[number];

export const HISTORY_ENTRY_SLA_BREACH =
  "SLA_BREACH" as const satisfies HistoryEntryType;

// case_status_history.visibility values.
export const HISTORY_VISIBILITIES = [
  "RESIDENT_VISIBLE",
  "INTERNAL",
  "SYSTEM",
] as const;
export type HistoryVisibility = (typeof HISTORY_VISIBILITIES)[number];

// CaseWorkflowOverride.kind values — every one of them demands a reason.
export const OVERRIDE_KINDS = [
  "CREW_SHORTFALL",
  "BUDGET_STAGE_SKIP",
  "STATUS_FORCE",
  "SLA_EXTENSION",
  "VALIDATION_BYPASS",
  "ASSESSMENT_BYPASS",
] as const;
export type OverrideKind = (typeof OVERRIDE_KINDS)[number];

export const OVERRIDE_LABELS: Record<OverrideKind, string> = {
  CREW_SHORTFALL: "Start work with fewer crew than planned",
  BUDGET_STAGE_SKIP: "Skip the awaiting-budget stage",
  STATUS_FORCE: "Force a status change",
  SLA_EXTENSION: "Extend the service-level deadline",
  VALIDATION_BYPASS: "Skip administrative validation",
  ASSESSMENT_BYPASS: "Skip the under-assessment record",
};

/** Minimum reason length for a workflow override. */
export const OVERRIDE_REASON_MIN = 15;

export const RESOLUTION_TYPES = [
  "FIXED",
  "PARTIALLY_FIXED",
  "REFERRED",
  "NO_ACTION",
  "OTHER",
] as const;

export type ResolutionType = (typeof RESOLUTION_TYPES)[number];

// ResolutionRecord.verificationStatus values.
export const VERIFICATION_STATUSES = [
  "PENDING",
  "FIXED_VERIFIED",
  "PARTIALLY_VERIFIED",
  "FAILED",
  "PENDING_RESIDENT_CONFIRMATION",
] as const;
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

export const PRIORITY_LEVELS = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
export type PriorityLevel = (typeof PRIORITY_LEVELS)[number];

/** Position of a status in the lifecycle, for the stepper. */
export const STATUS_ORDER: Record<CaseStatus, number> = {
  SUBMITTED: 0,
  ASSIGNED: 1,
  UNDER_ASSESSMENT: 2,
  AWAITING_BUDGET: 3,
  IN_PROGRESS: 4,
  RESOLVED: 5,
  CLOSED: 6,
};

export function isCaseStatus(value: unknown): value is CaseStatus {
  return (
    typeof value === "string" && (CASE_STATUSES as readonly string[]).includes(value)
  );
}

export function isOverrideKind(value: unknown): value is OverrideKind {
  return (
    typeof value === "string" && (OVERRIDE_KINDS as readonly string[]).includes(value)
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

/**
 * Permission required to move a case to `target`. Progress and closure are
 * separate rights: officials may drive a case forward, while closing is the
 * approving official's call.
 */
export function statusPermissionFor(target: string): PermissionKey | null {
  switch (target) {
    case "UNDER_ASSESSMENT":
    case "AWAITING_BUDGET":
    case "IN_PROGRESS":
    case "RESOLVED":
      return "case.status.progress";
    case "CLOSED":
      return "case.status.close";
    default:
      return null;
  }
}

/**
 * Whether leaving UNDER_ASSESSMENT for IN_PROGRESS skips the budget stage for a
 * case whose type says money is involved. The caller must then demand an
 * override reason.
 */
export function requiresBudgetSkipOverride(input: {
  fromStatus: string;
  toStatus: string;
  typeRequiresBudget: boolean;
}): boolean {
  if (!input.typeRequiresBudget) return false;
  return input.fromStatus === "UNDER_ASSESSMENT" && input.toStatus === "IN_PROGRESS";
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
 * Office scoping for mutating an existing concern's case record.
 *
 * Administrators and the approving official (the Captain) act on any case; an
 * official may only act on a case assigned to their own office. Unassigned
 * cases can only be handled by an administrator. The *permission* that a given
 * action needs is checked separately by the route (see `statusPermissionFor`),
 * so the Captain still cannot assign crew or plan manpower.
 */
export function canManageConcern(
  actor: WorkflowActor,
  concern: ManageableConcern
): boolean {
  if (actor.roleKey === "ADMIN" || actor.roleKey === "CAPTAIN") return true;
  if (actor.roleKey !== "OFFICIAL") return false;
  if (actor.officeId === null) return false;
  return concern.assignedOfficeId === actor.officeId;
}

/** Closing a case is the approving official's (or an administrator's) call. */
export function canCloseConcern(actor: WorkflowActor): boolean {
  return actor.roleKey === "ADMIN" || actor.roleKey === "CAPTAIN";
}

export type CaseWorkflowFlags = {
  /** Created before the revamp and never assessed: workable, but ungated. */
  legacy: boolean;
  assessmentCompleted: boolean;
  /** Workers planned on the assessment, if any. */
  workersNeeded: number | null;
  /** Active crew bookings on the case. */
  activeCrew: number;
  crewSatisfied: boolean;
  crewProgressLabel: string;
};

/**
 * Workflow flags shown on the case page and used by the IN_PROGRESS gate.
 *
 * A legacy case (open, but without a completed assessment) is explicitly
 * flagged instead of being silently treated as planned: the manpower gate does
 * not apply to it, and the UI offers the assessment as the next step.
 */
export function caseWorkflowFlags(input: {
  status: string;
  workersNeeded: number | null;
  activeCrew: number;
}): CaseWorkflowFlags {
  const completed = input.workersNeeded !== null && input.workersNeeded > 0;
  const required = completed ? input.workersNeeded : null;
  const satisfied = required === null ? true : input.activeCrew >= required;
  const openStatus = input.status !== "RESOLVED" && input.status !== "CLOSED";

  return {
    legacy: openStatus && !completed,
    assessmentCompleted: completed,
    workersNeeded: required,
    activeCrew: input.activeCrew,
    crewSatisfied: satisfied,
    crewProgressLabel:
      required === null
        ? `${input.activeCrew} assigned`
        : `${input.activeCrew} of ${required} assigned`,
  };
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
