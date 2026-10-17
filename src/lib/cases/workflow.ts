// Pure domain logic for the official case-management workflow.
// No database or framework imports, so it is unit-testable in isolation.

import type { PermissionKey } from "@/lib/auth/rbac";

/**
 * The seven-stage revamp lifecycle:
 *
 *   SUBMITTED -> ASSIGNED -> UNDER_ASSESSMENT -> AWAITING_BUDGET -> IN_PROGRESS
 *     -> RESOLVED -> CLOSED
 *
 * SUBMITTED is reached by the resident. ASSIGNED is reached by the routing /
 * assignment service (automatic rule, type default office, or manual
 * reassignment). Everything after that is driven by the workflow endpoint.
 *
 * AWAITING_BUDGET is the normal waiting stage: the estimate reaches the
 * treasury and the money is set aside before any work starts. If the treasury
 * has already set aside the full estimate before the case is sent there,
 * starting the work records an automatic Awaiting Budget pass-through in the
 * history (see `budgetStageBlock` and `changeConcernStatus`). What cannot be
 * bypassed is the funding requirement itself.
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

// Allowed forward transitions. A case normally waits in AWAITING_BUDGET;
// UNDER_ASSESSMENT -> IN_PROGRESS is the funded-early path and is gated by
// budgetStageBlock() plus a recorded Awaiting Budget pass-through.
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
  "FIELD_CHECK",
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
// Anything that let a case skip the money stage is gone: every case waits in
// AWAITING_BUDGET, so there is nothing to override there.
export const OVERRIDE_KINDS = [
  "CREW_SHORTFALL",
  "STATUS_FORCE",
  "SLA_EXTENSION",
  "VALIDATION_BYPASS",
  "ASSESSMENT_BYPASS",
] as const;
export type OverrideKind = (typeof OVERRIDE_KINDS)[number];

/**
 * Kinds older records still carry. They stay readable (the history of an old
 * case must not turn into a raw database string) but can never be created.
 */
export const RETIRED_OVERRIDE_KINDS = ["BUDGET_STAGE_SKIP"] as const;
export type RetiredOverrideKind = (typeof RETIRED_OVERRIDE_KINDS)[number];

/** The kinds a user may record now. */
export const CREATABLE_OVERRIDE_KINDS = OVERRIDE_KINDS;

export const OVERRIDE_LABELS: Record<OverrideKind, string> = {
  CREW_SHORTFALL: "Start work with fewer crew than planned",
  STATUS_FORCE: "Force a status change",
  SLA_EXTENSION: "Extend the service-level deadline",
  VALIDATION_BYPASS: "Skip administrative validation",
  ASSESSMENT_BYPASS: "Skip the under-assessment record",
};

export const RETIRED_OVERRIDE_LABELS: Record<RetiredOverrideKind, string> = {
  BUDGET_STAGE_SKIP: "Skip the awaiting-budget stage (no longer allowed)",
};

/** The human label for any stored override kind, current or retired. */
export function overrideLabel(kind: string): string {
  if (kind in OVERRIDE_LABELS) {
    return OVERRIDE_LABELS[kind as OverrideKind];
  }
  if (kind in RETIRED_OVERRIDE_LABELS) {
    return RETIRED_OVERRIDE_LABELS[kind as RetiredOverrideKind];
  }
  return kind;
}

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

/**
 * The verification outcomes that show the verification step was worked
 * (a fixed or partial check happened). Closing is stricter: see
 * `CLOSE_VERIFICATION_STATUS` — only a fully fixed, verified resolution
 * lets a case close. A FAILED check or a resident confirmation still
 * outstanding does not: those cases stay open.
 */
export const PASSING_VERIFICATION_STATUSES: readonly VerificationStatus[] = [
  "FIXED_VERIFIED",
  "PARTIALLY_VERIFIED",
];

export function isPassingVerification(status: string | null | undefined): boolean {
  return (PASSING_VERIFICATION_STATUSES as readonly string[]).includes(status ?? "");
}

/**
 * The only verification stamp that lets a case close. A partially verified fix
 * is still an open problem: the check happened, but the case stays open until
 * the work is confirmed done on site. There is no override around this gate —
 * "closed" on a case sheet must mean the work is verified fixed.
 */
export const CLOSE_VERIFICATION_STATUS: VerificationStatus = "FIXED_VERIFIED";

/** Whether a verification stamp lets its case be closed. */
export function isCloseableVerification(status: string | null | undefined): boolean {
  return status === CLOSE_VERIFICATION_STATUS;
}

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

export type BudgetStageInput = {
  fromStatus: string;
  toStatus: string;
  /** Cost estimate from the assessment, labour included. Null when none is saved. */
  estimatedCost: number | null;
  /** Approved earmarks set aside for this case (the treasury's figure). */
  fundedAmount: number;
  /**
   * True when the assessment itself declared that a supervisor must sign off
   * before the case proceeds (`approvalRequired`), and that sign-off has not
   * been recorded (the assessment is still `DRAFT`). Without this check the
   * approval checkbox was purely cosmetic: a case could reach AWAITING_BUDGET
   * and even IN_PROGRESS with an assessment nobody ever approved.
   */
  assessmentApprovalPending?: boolean;
};

function peso(value: number): string {
  return `₱${value.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Why a status change is blocked by the money rules, or null when it may go ahead.
 *
 * Every case walks the same money path:
 *   1. it must state how much it needs (a saved cost estimate) before it can
 *      wait for or pass through the budget stage — a saved ₱0 says "this
 *      costs nothing", which is an answer;
 *   2. normally it then waits in AWAITING_BUDGET until the approved funds
 *      cover that estimate;
 *   3. if the treasury already covered the estimate before the case was sent
 *      to AWAITING_BUDGET, the funding requirement is already met. Starting
 *      work is allowed and the status service records the Awaiting Budget
 *      pass-through, so no one has to perform a redundant send step merely
 *      to make the status dwell in a stage whose work is finished;
 *   4. and because labour is recounted live off whoever is actually on the
 *      crew (see `refreshCaseLabour`), a crew swap or addition during
 *      IN_PROGRESS can raise the cost after the treasury already set money
 *      aside for the smaller, original figure — so the cover is checked again
 *      before the case is marked resolved. This has no override: the fix is
 *      an additional earmark, not a reason typed into a box.
 */
export function budgetStageBlock(input: BudgetStageInput): string | null {
  const estimate = input.estimatedCost;
  const hasEstimate = estimate !== null;

  // The assessment can demand its own sign-off before the case is allowed to
  // move on at all — checked first so a pending approval blocks both the
  // zero-cost shortcut below and the normal AWAITING_BUDGET path.
  if (
    input.assessmentApprovalPending &&
    (input.toStatus === "AWAITING_BUDGET" || input.toStatus === "IN_PROGRESS")
  ) {
    return "This case's assessment requires approval before it can move forward. Record the approval on the assessment first.";
  }

  // Starting work straight from assessment is allowed only when the budget
  // requirement is already fulfilled: either the case costs nothing (₱0
  // estimate), or the treasury has already set aside the full estimate.
  // Otherwise the case must first move to AWAITING_BUDGET and wait there.
  if (
    input.fromStatus === "UNDER_ASSESSMENT" &&
    input.toStatus === "IN_PROGRESS"
  ) {
    if (!hasEstimate) {
      return "Save the cost estimate before work starts. The estimate is how the treasury knows how much to set aside.";
    }
    if (estimate > 0 && input.fundedAmount + 0.005 < estimate) {
      return `Only ${peso(input.fundedAmount)} is set aside for this case, but the estimate is ${peso(estimate)}. Move the case to Awaiting budget and have the treasury approve an earmark for the rest before work starts.`;
    }
  }
  if (input.toStatus === "AWAITING_BUDGET" && !hasEstimate) {
    return "Save the cost estimate before the case waits for budget. The estimate is how the treasury knows how much to set aside.";
  }
  if (input.fromStatus === "AWAITING_BUDGET" && input.toStatus === "IN_PROGRESS") {
    if (!hasEstimate) {
      return "Save the cost estimate before work starts.";
    }
    if (input.fundedAmount + 0.005 < estimate) {
      return `Only ${peso(input.fundedAmount)} is set aside for this case, but the estimate is ${peso(estimate)}. The treasury must approve an earmark for the rest before work starts.`;
    }
  }
  if (input.toStatus === "RESOLVED" && hasEstimate && estimate > 0) {
    if (input.fundedAmount + 0.005 < estimate) {
      return `Crew changes since the budget was set aside raised this case's cost to ${peso(estimate)}, but only ${peso(input.fundedAmount)} is funded. The treasury must approve an additional earmark before this case can be marked resolved.`;
    }
  }
  return null;
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
