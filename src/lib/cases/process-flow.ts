// The step-by-step case flow.
//
// One place decides, from the case's own facts, which numbered step the case is
// on and what is still missing before the next one can start. The official and
// admin desks read this instead of guessing from the status badge: the page
// shows the same order every time, highlights the step that is being worked on,
// and says who has to act.
//
// Pure: no database, no framework imports, so the rules are unit-tested
// directly (see process-flow.test.ts).

import {
  STATUS_ORDER,
  isCloseableVerification,
  type CaseStatus,
} from "@/lib/cases/workflow";
import {
  realityCheckState,
  type RealityCheckState,
} from "@/lib/cases/field-check-rules";
import { planNeeds } from "@/lib/cases/plan-needs";

/**
 * The ordered steps of processing a concern, start to finish.
 *
 * The first step is the reality check: somebody has to see the location the
 * resident gave before the report is validated, planned, funded or worked on.
 * See `docs/revamp/01-architecture.md`.
 */
export const PROCESS_STEPS = [
  "CHECK",
  "VALIDATE",
  "ASSESS",
  "FUND",
  "CREW",
  "START",
  "WORK",
  "VERIFY",
  "CLOSE",
] as const;

export type ProcessStepKey = (typeof PROCESS_STEPS)[number];

/**
 * done      — finished, the case has moved past it
 * current   — the step being worked on now
 * pending   — still to come
 * notNeeded — the case closed before this step; it is never coming
 */
export type ProcessStepState = "done" | "current" | "pending" | "notNeeded";

/**
 * Why a step cannot be acted on yet, or why it is waiting on someone else.
 * The page turns these codes into sentences; the engine never writes prose.
 */
export type ProcessBlock =
  | "NEEDS_REALITY_CHECK"
  | "FIELD_CHECK_FAILED"
  | "NEEDS_TYPE"
  | "NEEDS_ASSESSMENT"
  | "WAITING_UNDER_ASSESSMENT"
  | "NEEDS_ESTIMATE"
  | "WAITING_BUDGET_STAGE"
  | "NEEDS_FUNDS"
  | "NEEDS_CREW_PLAN"
  | "NEEDS_CREW"
  | "FIELD_CHECK_OPEN"
  | "NOT_STARTED"
  | "NEEDS_RESOLUTION"
  | "NEEDS_VERIFICATION"
  | "VERIFICATION_FAILED";

export type ProcessStep = {
  key: ProcessStepKey;
  /** 1-based position among the steps, so the numbering matches the flow. */
  number: number;
  state: ProcessStepState;
  /**
   * The first thing standing in the way, or null when the step can be worked
   * on right now. A finished step has no block.
   */
  block: ProcessBlock | null;
};

export type ProcessFlowInput = {
  /** Concern.status (any value the database holds). */
  status: string;
  /** The service type set by validation; null until an admin validates. */
  typeId: number | null;
  /** A saved assessment with a manpower plan. */
  hasAssessment: boolean;
  /** Workers planned; null when no plan is saved. */
  workersNeeded: number | null;
  /** Cost estimate saved on the assessment; null when none. */
  estimatedCost: number | null;
  /** Approved earmarks set aside for this case (the treasury's figure). */
  fundedAmount: number;
  /** Active crew bookings on the case. */
  activeCrew: number;
  /** A resolution record exists. */
  hasResolution: boolean;
  /** ResolutionRecord.verificationStatus; null when there is no resolution. */
  verificationStatus: string | null;
  /** Where the reality check stands: it is step 1 of every case. */
  realityCheck: RealityCheckState;
  /** Repair work needs a crew; noise and documents do not. Default true. */
  needsCrew?: boolean;
  /** Repair and ayuda need money set aside; a noise complaint does not. Default true. */
  needsBudget?: boolean;
};

export type ProcessFlow = {
  steps: ProcessStep[];
  /** The step to show expanded; null once there is nothing left to do. */
  currentKey: ProcessStepKey | null;
  /** 1-based number of the current step (the last step when finished). */
  currentNumber: number;
  doneCount: number;
  /** Steps that count towards progress. Every step counts: none is optional. */
  activeTotal: number;
  percent: number;
  finished: boolean;
  /**
   * The case is closed and no resolution was ever recorded: the only path that
   * does this is an approved "not confirmed" field check (`closeAsUnfounded`),
   * where the report was not real and no work was done.
   */
  closedUnfounded: boolean;
};

/** A small tolerance so "set aside ₱5,000" covers a ₱5,000 estimate. */
const MONEY_EPSILON = 0.005;

function stageOf(status: string): number {
  return STATUS_ORDER[status as CaseStatus] ?? 0;
}

/** True when the plan's workers are all booked in. */
export function crewSatisfied(
  workersNeeded: number | null,
  activeCrew: number
): boolean {
  if (workersNeeded === null) return activeCrew > 0;
  return activeCrew >= workersNeeded;
}

/**
 * True when an estimate exists and the treasury has set that much aside. A
 * saved ₱0 estimate is a real answer — "this case costs nothing" — and needs
 * nothing set aside.
 */
export function fundingSatisfied(
  estimatedCost: number | null,
  fundedAmount: number
): boolean {
  if (estimatedCost === null) return false;
  return fundedAmount + MONEY_EPSILON >= estimatedCost;
}

/**
 * Walks the case through the nine steps and returns their states plus the one
 * the desk should be working on.
 *
 * The first step that is not done is the current one, except on a closed case:
 * nothing is being worked on there, so no step is current and the steps that
 * never happened read `notNeeded` instead of "still to come". A case closed as
 * unfounded (the on-site check did not confirm the report) only ever validated
 * and closed, so its work steps are not "done" either.
 */
export function caseProcessFlow(input: ProcessFlowInput): ProcessFlow {
  const stage = stageOf(input.status);
  const closed = input.status === "CLOSED";
  const needsCrew = input.needsCrew !== false;
  const needsBudget = input.needsBudget !== false;
  const crewOk = !needsCrew || crewSatisfied(input.workersNeeded, input.activeCrew);
  const funded = !needsBudget || fundingSatisfied(input.estimatedCost, input.fundedAmount);
  // The VERIFY step only completes once the fix is confirmed fixed: a
  // partial verification still blocks closing, so it reads "pending" here.
  const verified = isCloseableVerification(input.verificationStatus);
  const resolved = input.hasResolution;
  /**
   * Closed with no resolution on record: the only path that does this is a
   * field check whose finding was approved as "not confirmed" (see
   * `closeAsUnfounded`). The report was not real, so the work never happened.
   */
  const unfounded = closed && !resolved;

  const steps: ProcessStep[] = [];
  const push = (
    key: ProcessStepKey,
    state: ProcessStepState,
    block: ProcessBlock | null = null
  ) => {
    steps.push({ key, number: steps.length + 1, state, block });
  };

  // 1 — Check the report is real: somebody goes to the location the resident
  //     gave and an admin approves what they found. Nothing else happens until
  //     then, so this is the one gate every case passes through first.
  const checkDone = input.realityCheck === "PASSED";
  const realityGate: ProcessBlock | null =
    input.realityCheck === "NONE"
      ? "NEEDS_REALITY_CHECK"
      : input.realityCheck === "OPEN"
        ? "FIELD_CHECK_OPEN"
        : input.realityCheck === "FAILED"
          ? "FIELD_CHECK_FAILED"
          : null;
  push("CHECK", checkDone ? "done" : "pending", checkDone ? null : realityGate);

  // 2 — Validate the report: a service type decides routing, budget and crew.
  // A type the resident suggested (or an admin who typed the case too early)
  // does not finish this step: the check has to pass first.
  const validated = checkDone && input.typeId !== null;
  push(
    "VALIDATE",
    validated ? "done" : "pending",
    validated ? null : !checkDone ? realityGate : "NEEDS_TYPE"
  );

  // 3 — Assess and plan: the four checks, the manpower plan and the estimate.
  const assessed = input.hasAssessment && stage >= 2;
  push(
    "ASSESS",
    assessed ? "done" : "pending",
    assessed
      ? null
      : !checkDone
        ? realityGate
        : input.hasAssessment
          ? "WAITING_UNDER_ASSESSMENT"
          : "NEEDS_ASSESSMENT"
  );

  // 4 — Wait for the budget. A noise complaint or a document request costs
  //     nothing, so this step is not on the path.
  if (!needsBudget) {
    push("FUND", "notNeeded");
  } else {
    push(
      "FUND",
      funded ? "done" : "pending",
      funded
        ? null
        : input.estimatedCost === null
          ? "NEEDS_ESTIMATE"
          : stage < 3
            ? "WAITING_BUDGET_STAGE"
            : "NEEDS_FUNDS"
    );
  }

  // 5 — Assign the crew named in the plan. Peace-and-order cases have no crew.
  if (!needsCrew) {
    push("CREW", "notNeeded");
  } else {
    push(
      "CREW",
      crewOk ? "done" : "pending",
      crewOk ? null : input.workersNeeded === null ? "NEEDS_CREW_PLAN" : "NEEDS_CREW"
    );
  }

  // 6 — Start the work: everything the plan and the money rules require is in
  //     place before the case may move to IN_PROGRESS.
  const startBlock: ProcessBlock | null =
    stage >= 4
      ? null
      : !input.hasAssessment
        ? "NEEDS_ASSESSMENT"
        : !checkDone
          ? realityGate
          : !funded
            ? stage < 3
              ? "WAITING_BUDGET_STAGE"
              : "NEEDS_FUNDS"
            : !crewOk
              ? "NEEDS_CREW"
              : "NOT_STARTED";
  push("START", stage >= 4 ? "done" : "pending", stage >= 4 ? null : startBlock);

  // 7 — Do the work: log progress while IN_PROGRESS, then record the resolution
  //     with its proof photo (that is what completes the step).
  push(
    "WORK",
    resolved ? "done" : "pending",
    resolved ? null : stage < 4 ? "NOT_STARTED" : null
  );

  // 8 — Verify the fix: the proof is checked by someone other than the official
  //     who recorded the resolution.
  push(
    "VERIFY",
    verified ? "done" : "pending",
    verified
      ? null
      : !resolved
        ? "NEEDS_RESOLUTION"
        : input.verificationStatus === "FAILED"
          ? "VERIFICATION_FAILED"
          : "NEEDS_VERIFICATION"
  );

  // 9 — Close the case and let the resident rate the work.
  push(
    "CLOSE",
    closed ? "done" : "pending",
    closed
      ? null
      : stage < 5
        ? "NOT_STARTED"
        : verified
          ? null
          : "NEEDS_VERIFICATION"
  );

  // Later steps cannot finish while an earlier one is still open. Without this,
  // a type set at filing marked Validate as Done while Check was still out.
  if (!closed) {
    let hold: ProcessBlock | null = null;
    let previousDone = true;
    for (const step of steps) {
      if (!previousDone) {
        if (step.state === "done") step.state = "pending";
        if (step.block === null) step.block = hold;
      }
      if (step.state === "done" || step.state === "notNeeded") {
        previousDone = true;
        hold = null;
      } else {
        previousDone = false;
        hold = step.block;
      }
    }
  }

  // A case closed before its work steps existed is not "on step 2" forever.
  // Only an open case has a current step, and the steps a closed case never
  // reached are dropped from the count so the progress bar stays honest.
  if (closed) {
    for (const step of steps) {
      if (step.key === "CLOSE") {
        step.state = "done";
        step.block = null;
        continue;
      }
      // On an unfounded case only two steps ran: the check that ended it and a
      // validation that may have come before it. Everything else is "not
      // needed" — never "done", because the work never happened.
      const ranBeforeClosing = unfounded
        ? step.key === "CHECK"
          ? input.realityCheck !== "NONE"
          : step.key === "VALIDATE"
        : step.state === "done";
      step.state = ranBeforeClosing ? "done" : "notNeeded";
      step.block = null;
    }
  }

  const currentIndex = closed
    ? -1
    : steps.findIndex((step) => step.state === "pending");
  const withCurrent = steps.map((step, index) =>
    index === currentIndex ? { ...step, state: "current" as const } : step
  );

  const activeTotal = steps.filter((step) => step.state !== "notNeeded").length;
  const doneCount = steps.filter((step) => step.state === "done").length;
  const percent =
    activeTotal === 0 ? 100 : Math.round((doneCount / activeTotal) * 100);

  return {
    steps: withCurrent,
    currentKey: currentIndex === -1 ? null : steps[currentIndex].key,
    currentNumber:
      currentIndex === -1
        ? steps[steps.length - 1]?.number ?? 0
        : steps[currentIndex].number,
    doneCount,
    activeTotal,
    percent: closed ? 100 : percent,
    finished: currentIndex === -1,
    closedUnfounded: unfounded,
  };
}

/** The step's own record, for the cases where a page needs just one of them. */
export function stepByKey(
  flow: ProcessFlow,
  key: ProcessStepKey
): ProcessStep | null {
  return flow.steps.find((step) => step.key === key) ?? null;
}

/**
 * The concern fields the flow reads, as a list query can select them. Kept
 * structural (no Prisma import) so the engine stays dependency-free.
 */
export type FlowConcernRow = {
  status: string;
  /** The case's field checks: they decide the first step of the flow. */
  typeId: number | null;
  /** Optional: list pages that only selected `name` still type-check. */
  type?: {
    key?: string | null;
    requiresCrew?: boolean | null;
    requiresBudget?: boolean | null;
  } | null;
  category?: { code?: string | null } | null;
  caseAssessment?: {
    workersNeeded: number | null;
    totalCost: unknown;
  } | null;
  resolutions?: { verificationStatus: string }[];
  crewAssignments?: unknown[];
  fieldChecks?: { status: string; finding: string | null }[];
};

/**
 * The flow for a concern row from a list query. `fundedAmount` comes from the
 * treasury (approved earmarks set aside for the case); 0 is the honest answer
 * when the page did not load them. The first step is decided by the case's own
 * field checks.
 */
export function concernProcessFlow(
  concern: FlowConcernRow,
  fundedAmount = 0
): ProcessFlow {
  const needs = planNeeds({
    typeKey: concern.type?.key ?? null,
    categoryCode: concern.category?.code ?? null,
    requiresCrew: concern.type?.requiresCrew ?? null,
    requiresBudget: concern.type?.requiresBudget ?? null,
  });
  return caseProcessFlow({
    status: concern.status,
    typeId: concern.typeId,
    hasAssessment: concern.caseAssessment != null,
    workersNeeded: concern.caseAssessment?.workersNeeded ?? null,
    estimatedCost: concern.caseAssessment
      ? Number(concern.caseAssessment.totalCost ?? 0)
      : null,
    fundedAmount,
    activeCrew: concern.crewAssignments?.length ?? 0,
    hasResolution: (concern.resolutions?.length ?? 0) > 0,
    verificationStatus: concern.resolutions?.[0]?.verificationStatus ?? null,
    // Cases that were already past this point when the check became step 1
    // (in assessment or further) count as checked, or every old case would read
    // as still waiting for its first visit.
    realityCheck: realityCheckState(concern.fieldChecks ?? [], {
      legacyPassed: (STATUS_ORDER[concern.status as CaseStatus] ?? 0) >= 2,
    }),
    needsCrew: needs.crew,
    needsBudget: needs.budget,
  });
}

/**
 * Which desk actually works a step. Admin may review the site check and
 * validate the report — that is the whole of their case work. The assigned
 * official plans, books crew and does the job. Admin having every permission
 * in the matrix does not make Assess or Close theirs.
 */
export function roleOwnsProcessStep(role: string, key: ProcessStepKey): boolean {
  switch (key) {
    case "CHECK":
      return role === "ADMIN" || role === "OFFICIAL" || role === "CREW";
    case "VALIDATE":
      return role === "ADMIN";
    case "ASSESS":
    case "CREW":
    case "START":
    case "WORK":
      return role === "OFFICIAL";
    case "FUND":
      return role === "OFFICIAL" || role === "TREASURER" || role === "CAPTAIN";
    case "VERIFY":
      return role === "OFFICIAL" || role === "CAPTAIN";
    case "CLOSE":
      return role === "CAPTAIN";
    default:
      return false;
  }
}
