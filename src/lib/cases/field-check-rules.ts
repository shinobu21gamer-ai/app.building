// Field verification rules: pure functions, no database access.
//
// The reality check is step 1 of every case. The admin sends an official or a
// crew member to the location the resident gave; that person records what they
// found; an admin approves it. Nothing else happens on the case until the
// finding is in and approved — no validation, no assessment, no money, no crew,
// no work. A finding that is not confirmed either sends the checker back out or
// closes the case as unfounded.

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

/** Residents may add context only while a check is waiting for site work/review. */
export function canReplyToFieldCheck(status: string): boolean {
  return OPEN_FIELD_CHECK_STATUSES.includes(status);
}

export type FieldCheckSummary = { status: string; finding: string | null };

/**
 * Where the reality check stands for a case:
 *
 *   NONE   — nobody has been sent yet (a brand new report);
 *   OPEN   — somebody is out, or the finding is waiting for the admin;
 *   PASSED — an approved finding confirmed the report is real;
 *   FAILED — the only approved findings did not confirm it.
 */
export type RealityCheckState = "NONE" | "OPEN" | "PASSED" | "FAILED";

/**
 * The reality check for a case, from its check history.
 *
 * `legacyPassed` is for cases that were already past this point when the check
 * became the first step of every case: without it, an old in-progress case would
 * be reported as still waiting for its first check.
 */
export function realityCheckState(
  checks: FieldCheckSummary[],
  options: { legacyPassed?: boolean } = {}
): RealityCheckState {
  if (checks.some((check) => check.status === "APPROVED" && check.finding === "CONFIRMED")) {
    return "PASSED";
  }
  if (checks.some((check) => OPEN_FIELD_CHECK_STATUSES.includes(check.status))) {
    return "OPEN";
  }
  if (checks.some((check) => check.status === "APPROVED")) {
    return "FAILED";
  }
  return options.legacyPassed ? "PASSED" : "NONE";
}

/** Why the first step is still holding the case, or null once it has passed. */
export function realityCheckBlock(state: RealityCheckState): string | null {
  switch (state) {
    case "PASSED":
      return null;
    case "OPEN":
      return "A field check is open. The case waits until the person who went to the location sends the finding and an admin approves it.";
    case "FAILED":
      return "The field check did not confirm that the concern is real. Send somebody to check again — a report that is not real is closed as unfounded.";
    default:
      return "Nobody has checked the location yet. Send an official or crew member to confirm the report is real: nothing else happens on this case until that finding is approved.";
  }
}

/**
 * The same rule as a sentence, for the transitions it guards (validation, the
 * start of the assessment). Every case passes through the reality check, so
 * there is no "no checks requested" way around it.
 */
export function fieldCheckGateBlock(
  checks: FieldCheckSummary[],
  options: { legacyPassed?: boolean } = {}
): string | null {
  return realityCheckBlock(realityCheckState(checks, options));
}

export type FindingInput = {
  finding: FieldCheckFinding;
  notes: string | null;
  hasPhoto: boolean;
};

/**
 * What a finding must carry. Every finding needs a photo of the site so the
 * admin can see what was there — without it there is no way to tell if the
 * report is real. "Not confirmed" also needs a written reason (it closes the
 * case). "Cannot verify" needs a reason.
 */
export function findingProblem(input: FindingInput): string | null {
  const notes = input.notes?.trim() ?? "";
  if (!input.hasPhoto) {
    return "Attach a photo of the site. A finding without a photo cannot be approved — there is no way to tell if the report is real.";
  }
  if (input.finding === "NOT_CONFIRMED" && notes.length < 10) {
    return "Describe what you found (at least 10 characters). A case is closed as unfounded only with a written reason.";
  }
  if (input.finding === "CANNOT_VERIFY" && notes.length < 10) {
    return "Say why the concern could not be verified (at least 10 characters).";
  }
  return null;
}

/**
 * Whether a field check may be requested for a case in this status: the two
 * stages before the case is assessed, because the check comes first.
 */
export function canRequestFieldCheck(status: string): boolean {
  return status === "SUBMITTED" || status === "ASSIGNED";
}
