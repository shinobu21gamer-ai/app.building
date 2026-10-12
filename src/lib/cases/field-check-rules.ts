// Field verification rules: pure functions, no database access.
//
// An admin may ask an official or crew member to confirm that a concern is real
// before the case continues. Once a check has been requested, the case cannot
// leave ASSIGNED until an approved check has CONFIRMED the concern.

export const FIELD_CHECK_STATUSES = ["PENDING", "SUBMITTED", "APPROVED"] as const;
export type FieldCheckStatus = (typeof FIELD_CHECK_STATUSES)[number];

export const FIELD_CHECK_FINDINGS = ["CONFIRMED", "NOT_CONFIRMED", "CANNOT_VERIFY"] as const;
export type FieldCheckFinding = (typeof FIELD_CHECK_FINDINGS)[number];

export const FIELD_CHECK_REVIEW_DECISIONS = ["APPROVE", "REQUEST_RECHECK"] as const;
export type FieldCheckReviewDecision = (typeof FIELD_CHECK_REVIEW_DECISIONS)[number];

/** Roles that may be given a field check. */
export const FIELD_CHECK_ASSIGNEE_ROLES = ["OFFICIAL", "CREW"] as const;

/** Checks still waiting on someone: these block the case. */
export const OPEN_FIELD_CHECK_STATUSES: readonly string[] = ["PENDING", "SUBMITTED"];

export type FieldCheckSummary = { status: string; finding: string | null };

/**
 * Why the case may not leave ASSIGNED for UNDER_ASSESSMENT, or null when it may.
 * With no check requested there is no gate. Otherwise an open check blocks, and
 * so does any history with no approved CONFIRMED finding.
 */
export function fieldCheckGateBlock(checks: FieldCheckSummary[]): string | null {
  if (checks.length === 0) return null;
  if (checks.some((check) => OPEN_FIELD_CHECK_STATUSES.includes(check.status))) {
    return "A field check is still open. The assigned person must submit the finding, and an admin must approve it, before the case continues.";
  }
  if (checks.some((check) => check.status === "APPROVED" && check.finding === "CONFIRMED")) {
    return null;
  }
  return "The field check did not confirm that the concern is real. Request a new field check before the case continues.";
}

export type FindingInput = {
  finding: FieldCheckFinding;
  notes: string | null;
  hasPhoto: boolean;
};

/**
 * What a finding must carry. A "not confirmed" finding closes the case, so it
 * needs a written reason and a photo as evidence. "Cannot verify" needs a reason.
 * Returns a message for the first thing missing, or null when the finding is complete.
 */
export function findingProblem(input: FindingInput): string | null {
  const notes = input.notes?.trim() ?? "";
  if (input.finding === "NOT_CONFIRMED") {
    if (notes.length < 10) {
      return "Describe what you found (at least 10 characters). A case is closed as unfounded only with a written reason.";
    }
    if (!input.hasPhoto) {
      return "Attach a photo of the site. A case is closed as unfounded only with photo evidence.";
    }
  }
  if (input.finding === "CANNOT_VERIFY" && notes.length < 10) {
    return "Say why the concern could not be verified (at least 10 characters).";
  }
  return null;
}

/** Whether a field check may be requested for a case in this status. */
export function canRequestFieldCheck(status: string): boolean {
  return status === "ASSIGNED";
}
