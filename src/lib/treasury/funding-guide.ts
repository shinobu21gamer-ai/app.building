// The guided case-funding decision.
//
// Funding a resident's concern used to mean arriving at a generic "new
// earmark" form with five inputs (purpose, amount, budget line, case, notes)
// and no help choosing between them: the case's own numbers lived on a screen
// the treasurer cannot even open (`case.view.office` scopes the case page to
// the case's office), and "which budget line pays for a pothole repair?"
// was answered by reading a dropdown of COA object codes.
//
// This module computes, from facts alone, everything the guided flow needs so
// that proposing the earmark becomes two decisions instead of five inputs:
//
//   * what the case still needs — the estimate, what is already set aside,
//     what is already waiting on the Captain's approval, and therefore what
//     a new proposal must cover (never double-proposing pending money);
//   * which budget line should pay — allocations that can cover the need on
//     their own, ranked: the case's own office first, barangay-wide next,
//     then other offices, each by the headroom they have left.
//
// Pure: no database, no framework imports. It returns codes and numbers; the
// screens turn them into sentences through `copy`, the same split as
// `earmarkApprovalBrief`.
//
// The money rules match `earmarkApprovalBrief` (see `MONEY_EPSILON` there):
// "covers" is compared within half a centavo so a rounding artefact can never
// recommend a budget that would then fail the ledger's availability check.

/** Matches `MONEY_EPSILON` in `cases/process-flow.ts` and `approval.ts`. */
export const MONEY_EPSILON = 0.005;

/** The facts the treasury holds about one case that may need funding. */
export type FundingCaseFacts = {
  concernId: number;
  caseNumber: string;
  title: string;
  /** The case's current workflow status. */
  status: string;
  /** The office the case is assigned to; null when unrouted. */
  officeId: number | null;
  /**
   * The cost estimate saved on the case's assessment; null when the case has
   * none yet. A saved ₱0 is a real figure: the case costs nothing.
   */
  estimate: number | null;
  /** Approved/released earmarks already set aside for the case. */
  setAside: number;
  /** Earmarks proposed but not yet decided — money the Captain may still release. */
  proposed: number;
};

/** One budget line the money could come from, with its live balance. */
export type FundingAllocationOption = {
  allocationId: number;
  label: string;
  coaCode: string;
  coaName: string;
  fundSourceCode: string;
  fundSourceName: string;
  fiscalYear: number;
  /** Null = barangay-wide. */
  officeId: number | null;
  available: number;
};

function money(value: number): number {
  return Math.round(value * 100) / 100;
}

/** True when `have` covers `need` within the rounding tolerance. */
function covers(need: number, have: number): boolean {
  return have + MONEY_EPSILON >= need;
}

/**
 * What a case still needs beyond what is already set aside. An unestimated
 * case has no figure to fund, so the answer reads as zero — the caller
 * distinguishes the two cases with {@link fundingQueueState}.
 */
export function fundingShortfall(facts: {
  estimate: number | null;
  setAside: number;
}): number {
  if (facts.estimate === null) return 0;
  return money(Math.max(0, facts.estimate - facts.setAside));
}

/**
 * The part of the shortfall a NEW proposal must cover: pending proposals are
 * money the Captain may still approve, so counting them again is how a case
 * ends up over-funded by two people who each did the arithmetic right.
 */
export function uncommittedShortfall(facts: FundingCaseFacts): number {
  if (facts.estimate === null) return 0;
  return money(Math.max(0, facts.estimate - facts.setAside - facts.proposed));
}

/**
 * Where a case stands in the funding queue.
 *
 * NEEDS_ESTIMATE   — no saved estimate: the case office must finish the
 *                    assessment before there is anything to fund.
 * PROPOSED_PENDING — a proposal already waits on the Captain and would cover
 *                    the rest; proposing again would double-book the money.
 * NEEDS_MONEY      — still short after set-aside and pending proposals: this
 *                    is the case the guided form is for.
 * COVERED          — the estimate is fully set aside; the case is waiting on
 *                    its office to start the work, not on money.
 */
export type FundingQueueState =
  | "NEEDS_ESTIMATE"
  | "PROPOSED_PENDING"
  | "NEEDS_MONEY"
  | "COVERED";

export function fundingQueueState(facts: FundingCaseFacts): FundingQueueState {
  if (facts.estimate === null) return "NEEDS_ESTIMATE";
  if (covers(facts.estimate, facts.setAside)) return "COVERED";
  if (covers(facts.estimate, facts.setAside + facts.proposed)) {
    return "PROPOSED_PENDING";
  }
  return "NEEDS_MONEY";
}

/** How an allocation's office scope relates to the case's office. */
export type FundingScope = "CASE_OFFICE" | "BARANGAY_WIDE" | "OTHER_OFFICE";

function scopeOf(
  allocationOfficeId: number | null,
  caseOfficeId: number | null
): FundingScope {
  if (allocationOfficeId === null) return "BARANGAY_WIDE";
  return allocationOfficeId === caseOfficeId ? "CASE_OFFICE" : "OTHER_OFFICE";
}

const SCOPE_RANK: Record<FundingScope, number> = {
  CASE_OFFICE: 0,
  BARANGAY_WIDE: 1,
  OTHER_OFFICE: 2,
};

/** An allocation read against one case's need. */
export type RankedFundingOption = {
  option: FundingAllocationOption;
  scope: FundingScope;
  /** The allocation can cover the whole uncommitted shortfall by itself. */
  covers: boolean;
  /** Available after reserving the shortfall (the unchanged figure when it does not fit). */
  remainingAfter: number;
  /**
   * Sort key: covering options first, then the case's own office, then
   * barangay-wide, then other offices, each with the most headroom first.
   */
  rank: number;
  /** The one option the flow preselects: the first covering option. */
  recommended: boolean;
};

/**
 * Ranks the budget lines for one case's need.
 *
 * The order is the answer to "which budget should pay for this?": what can
 * cover the amount on its own comes before what cannot; between two that can,
 * the case's own office comes before barangay-wide before another office's
 * money; and between equals, the budget with the most left wins — it is the
 * recommendation least likely to fail later.
 *
 * When nothing covers the need, no option is recommended: the treasurer must
 * split the reservation or adjust the budget, and the screen says so instead
 * of preselecting a line that would fail the approval's ledger check.
 */
export function rankFundingOptions(input: {
  /** The uncommitted shortfall to reserve (see {@link uncommittedShortfall}). */
  shortfall: number;
  caseOfficeId: number | null;
  allocations: FundingAllocationOption[];
}): RankedFundingOption[] {
  const ranked = input.allocations.map((option) => {
    const available = money(option.available);
    const fits = covers(input.shortfall, available);
    return {
      option,
      scope: scopeOf(option.officeId, input.caseOfficeId),
      covers: fits,
      remainingAfter: fits ? money(available - input.shortfall) : available,
      rank: 0,
      recommended: false,
    };
  });

  ranked.sort((a, b) => {
    if (a.covers !== b.covers) return a.covers ? -1 : 1;
    const scope =
      SCOPE_RANK[a.scope] - SCOPE_RANK[b.scope];
    if (scope !== 0) return scope;
    return b.option.available - a.option.available;
  });

  const firstCovering = ranked.find((item) => item.covers) ?? null;
  return ranked.map((item, index) => ({
    ...item,
    rank: index,
    recommended: firstCovering !== null && item === firstCovering,
  }));
}

/**
 * The queue order of the funding desk: the case a resident is waiting on
 * comes first (it is sitting in AWAITING_BUDGET), then the longest-waiting
 * case. `waitingSince` is when the case was submitted; AWAITING_BUDGET cases
 * carry their `awaitingBudgetAt` so a case that has waited in the money stage
 * itself outranks one that arrived there yesterday.
 */
export function compareFundingQueue(
  a: { waitingForBudget: boolean; waitingSince: Date },
  b: { waitingForBudget: boolean; waitingSince: Date }
): number {
  if (a.waitingForBudget !== b.waitingForBudget) {
    return a.waitingForBudget ? -1 : 1;
  }
  return a.waitingSince.getTime() - b.waitingSince.getTime();
}
