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
  isPassingVerification,
  type CaseStatus,
} from "@/lib/cases/workflow";
import { fieldCheckGateBlock } from "@/lib/cases/field-check-rules";

/** The ordered steps of processing a concern, start to finish. */
export const PROCESS_STEPS = [
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
 * done    — finished, the case has moved past it
 * current — the step being worked on now
 * pending — still to come
 * skipped — not needed for this case (a case that needs no money has no FUND)
 */
export type ProcessStepState = "done" | "current" | "pending" | "skipped";

/**
 * Why a step cannot be acted on yet, or why it is waiting on someone else.
 * The page turns these codes into sentences; the engine never writes prose.
 */
export type ProcessBlock =
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
  /** ConcernType.requiresBudget — money cases must stop at AWAITING_BUDGET. */
  requiresBudget: boolean;
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
  /** A field check is open, which pauses the case. */
  fieldCheckOpen: boolean;
};

export type ProcessFlow = {
  steps: ProcessStep[];
  /** The step to show expanded; null once there is nothing left to do. */
  currentKey: ProcessStepKey | null;
  /** 1-based number of the current step (the last step when finished). */
  currentNumber: number;
  doneCount: number;
  /** Steps that count towards progress (skipped steps excluded). */
  activeTotal: number;
  percent: number;
  finished: boolean;
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

/** True when an estimate exists and the treasury has set that much aside. */
export function fundingSatisfied(
  estimatedCost: number | null,
  fundedAmount: number
): boolean {
  if (estimatedCost === null || estimatedCost <= 0) return false;
  return fundedAmount + MONEY_EPSILON >= estimatedCost;
}

/**
 * Walks the case through the eight steps and returns their states plus the one
 * the desk should be working on.
 *
 * The first step that is neither done nor skipped is the current one. A case
 * that is CLOSED has no current step.
 */
export function caseProcessFlow(input: ProcessFlowInput): ProcessFlow {
  const stage = stageOf(input.status);
  const closed = input.status === "CLOSED";
  const crewOk = crewSatisfied(input.workersNeeded, input.activeCrew);
  const funded = fundingSatisfied(input.estimatedCost, input.fundedAmount);
  const verified = isPassingVerification(input.verificationStatus);
  const resolved = input.hasResolution;

  const steps: ProcessStep[] = [];
  const push = (
    key: ProcessStepKey,
    state: ProcessStepState,
    block: ProcessBlock | null = null
  ) => {
    steps.push({ key, number: steps.length + 1, state, block });
  };

  // 1 — Validate the report: a service type decides routing, budget and crew.
  push(
    "VALIDATE",
    input.typeId !== null ? "done" : "pending",
    input.typeId === null ? "NEEDS_TYPE" : null
  );

  // 2 — Assess and plan: the four checks, the manpower plan and the estimate.
  const assessed = input.hasAssessment && stage >= 2;
  push(
    "ASSESS",
    assessed ? "done" : "pending",
    assessed
      ? null
      : input.hasAssessment
        ? "WAITING_UNDER_ASSESSMENT"
        : "NEEDS_ASSESSMENT"
  );

  // 3 — Wait for the budget: only for types that need money.
  if (!input.requiresBudget) {
    push("FUND", "skipped");
  } else {
    push(
      "FUND",
      funded ? "done" : "pending",
      funded
        ? null
        : input.estimatedCost === null || input.estimatedCost <= 0
          ? "NEEDS_ESTIMATE"
          : stage < 3
            ? "WAITING_BUDGET_STAGE"
            : "NEEDS_FUNDS"
    );
  }

  // 4 — Assign the crew named in the plan.
  push(
    "CREW",
    crewOk ? "done" : "pending",
    crewOk ? null : input.workersNeeded === null ? "NEEDS_CREW_PLAN" : "NEEDS_CREW"
  );

  // 5 — Start the work: everything the plan and the money rules require is in
  //     place before the case may move to IN_PROGRESS.
  const startBlock: ProcessBlock | null =
    stage >= 4
      ? null
      : !input.hasAssessment
        ? "NEEDS_ASSESSMENT"
        : input.fieldCheckOpen
          ? "FIELD_CHECK_OPEN"
          : input.requiresBudget && !funded
            ? stage < 3
              ? "WAITING_BUDGET_STAGE"
              : "NEEDS_FUNDS"
            : !crewOk
              ? "NEEDS_CREW"
              : "NOT_STARTED";
  push("START", stage >= 4 ? "done" : "pending", stage >= 4 ? null : startBlock);

  // 6 — Do the work: log progress while IN_PROGRESS, then record the resolution
  //     with its proof photo (that is what completes the step).
  push(
    "WORK",
    resolved ? "done" : "pending",
    resolved ? null : stage < 4 ? "NOT_STARTED" : null
  );

  // 7 — Verify the fix: the proof is checked by someone other than the official
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

  // 8 — Close the case and let the resident rate the work.
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

  const currentIndex = steps.findIndex(
    (step) => step.state === "pending"
  );
  const withCurrent = steps.map((step, index) =>
    index === currentIndex ? { ...step, state: "current" as const } : step
  );

  const activeTotal = steps.filter((step) => step.state !== "skipped").length;
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
  typeId: number | null;
  type?: { requiresBudget: boolean } | null;
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
 * when the page did not load them.
 */
export function concernProcessFlow(
  concern: FlowConcernRow,
  fundedAmount = 0
): ProcessFlow {
  return caseProcessFlow({
    status: concern.status,
    typeId: concern.typeId,
    requiresBudget: concern.type?.requiresBudget ?? false,
    hasAssessment: Boolean(concern.caseAssessment?.workersNeeded),
    workersNeeded: concern.caseAssessment?.workersNeeded ?? null,
    estimatedCost: concern.caseAssessment
      ? Number(concern.caseAssessment.totalCost ?? 0)
      : null,
    fundedAmount,
    activeCrew: concern.crewAssignments?.length ?? 0,
    hasResolution: (concern.resolutions?.length ?? 0) > 0,
    verificationStatus: concern.resolutions?.[0]?.verificationStatus ?? null,
    fieldCheckOpen:
      fieldCheckGateBlock(concern.fieldChecks ?? []) !== null,
  });
}
